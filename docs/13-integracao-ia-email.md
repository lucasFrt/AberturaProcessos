# 13 - Alimentação por IA (e-mail → processo)

## Objetivo

A entrada de processos e documentos deixa de ser feita por pessoas no formulário e passa a ser feita
por um **agente de IA** (Claude Haiku 4.5, em tarefa agendada, com o conector de Outlook) que lê a
caixa de e-mail da trading ao longo do dia. O operacional continua consultando e movimentando o
funil normalmente; o que muda é **quem alimenta** o sistema.

O agente precisa conseguir, com segurança e sem intervenção humana:

1. Abrir processo novo a partir de um e-mail: empresa (CNPJ ou CPF), solicitante (nome e e-mail),
   referência, informações adicionais, anexos e **data de recebimento** de cada informação.
2. Anexar documentos (e informações em texto) a um processo **já existente**, identificado pela
   referência ou pelo código que o cliente cita no e-mail ("Processo 123123, documento em anexo").
3. Repetir a leitura da mesma caixa quantas vezes for preciso **sem duplicar** nada.

## Decisões de arquitetura

### 1. O agente é um cliente da API, não parte dela

O agente não roda dentro do backend. Ele consome uma **API de intake** (`/intake/*`) desenhada para
máquina: idempotente, tolerante a cadastro faltando, com respostas que dizem explicitamente o que
foi feito e o que ficou pendente. Isso mantém as regras de negócio (escopo, auditoria, tempo real)
em um único lugar — o mesmo `ProcessService`/`DocumentService` que o formulário web usa — e permite
trocar o modelo, o orquestrador ou até o canal (WhatsApp, portal) sem tocar no domínio.

### 2. Autenticação por chave de API vinculada a um usuário interno

JWT de 15 minutos + refresh em cookie (docs/06) não serve para um processo agendado. O agente
autentica com o header `X-Api-Key`, cuja chave é:

- gerada por ADMIN em `POST /api-keys`, exibida **uma única vez** e persistida apenas por hash
  SHA-256 (mesmo tratamento do refresh token);
- **vinculada a um usuário interno** (OPERATIONAL ou ADMIN, ex.: "Agente de E-mail"). O agente age
  *como* esse usuário: `createdById`, `uploadedById` e `actorId` do histórico apontam para ele, então
  a timeline mostra "Agente de E-mail" como autor — auditoria preservada sem papel novo;
- revogável a qualquer momento (`DELETE /api-keys/:id`), com `lastUsedAt` para detectar chave morta.

O middleware `authenticate` aceita `X-Api-Key` **ou** `Authorization: Bearer <jwt>`; o restante da
cadeia (`authorize`, rate limit por usuário, `AccessScope`) não muda. Desativar o usuário vinculado
corta a chave imediatamente, pelo mesmo caminho que corta o JWT.

### 3. O agente nunca transporta bytes de anexo

Um modelo de linguagem não deve copiar megabytes de base64 de uma ferramenta para outra — é lento,
caro e falha silenciosamente. Por isso o intake aceita anexos de duas formas:

| Forma | Quando usar |
| --- | --- |
| `fetchAttachments: true` + `source.externalId` (id da mensagem no Microsoft Graph) | Padrão. **O backend baixa os anexos direto do Graph** com credenciais de aplicação (client credentials, `Mail.Read` restrito à caixa da trading). O agente só passa o id da mensagem que o conector de Outlook já devolveu. |
| `multipart/form-data` com `files[]` | Quando o orquestrador tem os arquivos em disco (ex.: um MCP de Outlook local que salva anexos). Mesmo `multer` do upload normal. |

As duas formas podem ser combinadas na mesma chamada. Sem `GRAPH_*` configurado,
`fetchAttachments: true` responde `503 MAIL_ATTACHMENTS_DISABLED` e o restante do intake funciona.

### 4. Idempotência por `externalId`, com "claim" antes do trabalho

Cada e-mail gera **um** `IntakeEvent`, único por `(channel, externalId)`. O fluxo é:

1. **Claim**: insere o evento como `PROCESSING`. Se já existe:
   - `COMPLETED` → responde `200` com o resultado gravado (`duplicate: true`), sem refazer nada;
   - `PROCESSING` → `409 INTAKE_IN_PROGRESS` (outra execução do agente está no meio);
   - `FAILED` → reaproveita o evento e **retoma**: se um processo já tinha sido criado antes da
     falha, anexa nele em vez de criar outro.
2. Faz o trabalho (baixa anexos → resolve empresa → cria/localiza processo → grava documentos e
   nota).
3. Marca `COMPLETED` com `processId`, `documentIds` e um resumo; em erro, marca `FAILED` com a
   mensagem e propaga o erro.

Assim, rodar o agente de novo sobre o mesmo e-mail (ou a mesma execução ser interrompida e refeita)
nunca duplica processo nem documento. Os anexos são baixados **antes** de criar o processo, para
que uma falha do Graph não deixe processo sem documento.

### 5. Empresa desconhecida é cadastrada, não rejeitada

O e-mail chega com um CNPJ/CPF que pode não estar cadastrado. Rejeitar travaria a alimentação e
exigiria um humano no caminho. A regra de resolução, em ordem:

1. Normaliza para dígitos. 14 dígitos → CNPJ, 11 → CPF; ambos validam dígito verificador
   (`400 INVALID_CNPJ` / `400 INVALID_CPF`).
2. `Company` existente pelo documento → usa. Inativa → `409 COMPANY_INACTIVE` (desativar foi uma
   decisão humana; o agente deve escalar em vez de contornar).
3. Não existe → resolve a **Organization**:
   - domínio do e-mail do solicitante cadastrado em `EmailDomain` → aquela organização;
   - senão, cria uma organização nova com o nome da empresa e, se o domínio **não** for de webmail
     público (gmail, hotmail, outlook, yahoo, etc.), cadastra o `EmailDomain` com
     `defaultRole = CLIENT` e **`autoApprove = false`** — agrupa as filiais que vierem depois sem
     conceder acesso automático a ninguém; quem logar por esse domínio entra `PENDING`.
4. Razão social: CNPJ → `CnpjLookupProvider` (ReceitaWS, docs/05) quando disponível; senão o nome
   informado pelo agente; senão o próprio documento formatado (com aviso em `warnings`).
5. Se a organização do domínio já tem uma empresa em **cadastro pendente** (decisão 10), o
   documento conclui esse cadastro (CNPJ, tipo e razão social) em vez de criar uma segunda
   empresa para o mesmo cliente. Senão, cria a `Company` com `documentType` (`CNPJ` | `CPF`).

Tudo que foi criado automaticamente vem listado na resposta (`company.created`,
`organization.created`, `warnings[]`), para o agente poder relatar e para o ADMIN revisar depois.

### 6. Resolução de processo por referência, com desempate e candidatos

"Processo 123123" pode ser o `code` (`PRC-2026-00042`) ou a `reference` que o cliente informou. A
ordem é: `code` exato (case-insensitive) → `reference` exata (case-insensitive, sem espaços
extras) → se houver mais de um, desempata pela organização do domínio do solicitante → ainda
ambíguo, `409 PROCESS_REF_AMBIGUOUS` com os candidatos → nenhum, `404 PROCESS_REF_NOT_FOUND` com
até 5 candidatos por busca parcial. O agente pode então decidir (ou perguntar ao operacional) e
chamar de novo com `processId` explícito, que pula a resolução.

Desde a Tarefa 30 (docs/15) há um degrau a mais entre a referência exata e a busca parcial: o
**índice de identificadores** (`ProcessIdentifier`) — exato pelo valor normalizado (`31435/26` =
`31435-26`), devolvendo o `kind` casado (`HBL`, `OPUS_NUMBER`, `CONTAINER`...) — e, se ele não
tem o identificador, **uma** consulta ao iLog que espelha o processo na hora. Ver decisão 13.

### 7. Origem, solicitante e data de recebimento passam a fazer parte do domínio

`Process` ganha `source` (`WEB` | `EMAIL` | `API`), `requesterName`, `requesterEmail` e
`receivedAt`; `Document` ganha `source` e `receivedAt`. `source` é derivado da autenticação, nunca
informado pelo cliente: JWT → `WEB`, chave de API em rota comum → `API`, rota de intake → `EMAIL`.
A gaveta do processo mostra "Aberto por e-mail — João <joao@clientex.com.br>, recebido em
18/09/2026 10:32", e cada documento mostra sua data de recebimento.

### 8. Um MCP server próprio, fino, sobre a API

Para que o Haiku não precise montar `curl` com multipart, o repositório traz `mcp-server/`: um
servidor MCP (stdio) com sete ferramentas — `get_intake_cursor`, `get_intake_event`,
`lookup_process`, `create_process_from_email`, `attach_to_process`, `skip_email`, `get_process` —
que só traduzem chamada de ferramenta em requisição HTTP com a chave de API. Zero regra de negócio
ali. Se o orquestrador não suportar MCP local, a API continua utilizável diretamente (docs/05).

### 9. A IA lê a caixa de entrada, descarta remetentes bloqueados e sabe onde parou

A caixa `opusoperacional@` recebe centenas de e-mails por dia — notificações de terminal,
faturamento, follow-up de DUIMP, conversas internas. Ler a caixa com uma "janela das últimas N
horas" não funciona: o que não é examinado a tempo sai da janela e nunca mais é visto (foi o que a
primeira execução real mostrou: 240 e-mails em 3 h). E qualquer arranjo que dependa de alguém mexer
na caixa (pasta, regra, categoria) foi descartado: a caixa é usada o dia inteiro pelo operacional e
não pode ganhar ruído nem tarefa nova.

O desenho final tem quatro partes, todas do lado da IA e da API:

1. **A caixa é lida pelo servidor, não pelo conector.** A primeira execução com Haiku mostrou o
   limite do conector: a listagem traz ~2 KB por e-mail (vinte destinatários, prévia, links) e o
   corpo vem em HTML com todo o histórico citado (um só e-mail: 68 mil caracteres) — a execução
   estoura a memória em poucas páginas e o modelo "encerra" antes de terminar (3 de 14 páginas). O
   backend já tem acesso à caixa pelo Graph (é como baixa os anexos), então passou a expor
   `GET /intake/mailbox/messages` (lista enxuta desde `after`, ~300 bytes por e-mail) e
   `GET /intake/mailbox/messages/:id` (corpo em texto, sem histórico citado, limitado a 6 mil
   caracteres, com a lista de anexos). O conector Microsoft 365 fica só para o relatório.
2. **Remetentes bloqueados no prompt, aplicados no servidor.** A lista (`followupopus`,
   `multiterminais`, `noreply`... e **todo e-mail interno `@opusce.com.br`** — a IA só trabalha
   com e-mail de fora) mora no prompt da rotina (e na cópia em `docs/prompts/`), editável sem
   deploy; a rotina a envia no parâmetro `exclude` da listagem e esses e-mails nem chegam ao
   modelo. `blocked` na resposta diz quantos foram.
3. **Cursor gravado na API.** `GET /intake/cursor` diz de onde continuar; ao terminar cada página, o
   agente grava `PUT /intake/cursor` com o `nextAfter` que a listagem devolveu — o `receivedAt` da
   última mensagem listada, bloqueada ou não. A próxima execução começa dali (menos 1 minuto de
   folga; a checagem de `externalId` cobre a borda). O ponteiro só anda para a frente; uma execução
   atrasada não regride o cursor. Sem ponteiro gravado, a API deduz o cursor do último `IntakeEvent`
   `COMPLETED`/`FAILED` — é o ponto de partida.
4. **Eventos `IGNORED`/`ESCALATED` para o que foi lido.** Todo e-mail que o agente **leu** e não
   processou entra por `POST /intake/events/skip` com o motivo: é a auditoria do que a IA decidiu
   ("por que não abriu esse?"), no mesmo lugar dos processos criados. Ruído bloqueado não entra —
   seria volume sem informação.

Retentativa de `FAILED` é um passo próprio da rotina (`GET /intake/events?status=FAILED`, uma
tentativa; falhou de novo → `skip` com `ESCALATED`), não a releitura pelo cursor — senão um e-mail
que falha sempre travaria a fila atrás dele.

Não há teto de e-mails por execução: o modelo é o Haiku 4.5 (barato e rápido) e a rotina pagina
(50 por página) até a listagem responder `hasMore: false`. A única salvaguarda é de tempo (40 min
→ grava o cursor da última página completa e para). Se a cota do Max apertar, o próximo passo é o
plano de API.

A alternativa "pasta `Intake IA` alimentada por regra de cópia do Outlook" (filtrar o ruído antes
da IA, sem mexer na caixa de entrada) continua válida e o backend não a impede — o cursor funciona
em qualquer pasta —, mas foi preterida por exigir configuração na caixa. Mover e-mails processados
(`Processos IA/<código>`) foi descartado de vez: exigiria `Mail.ReadWrite` e mexeria na caixa em uso.

### 10. Sem CNPJ no e-mail, a empresa vem do domínio — e nasce "pendente" se preciso

A maioria dos e-mails de cliente recorrente não repete o CNPJ ("Novo Processo - 230/26, segue em
anexo os documentos"). Exigir o documento faria a IA escalar quase tudo. A resolução quando
`company.document` não vem:

1. Domínio do remetente sem organização conhecida? Cria organização + `EmailDomain`
   (`autoApprove = false`, só domínio corporativo — decisão 5) e uma `Company` em **cadastro
   pendente**: `cnpj = null`, `documentType = null`, nome = `company.name` (assinatura) ou o
   próprio domínio. O processo abre e a origem fica registrada; o ADMIN completa o CNPJ depois pela
   tela de empresas (`PATCH /companies/:id` com `cnpj`, só permitido enquanto pendente).
2. Organização conhecida com **uma** empresa ativa → usa (aviso "resolvida pelo domínio").
3. Várias ativas → desempate por `company.name` contra razão social/nome fantasia; ainda ambíguo →
   `409 COMPANY_AMBIGUOUS` com candidatos, e o agente escolhe ou escala.
4. Organização conhecida sem empresa → cria a pendente nela (mesmo cliente, segunda tentativa,
   reaproveita a pendente em vez de criar outra).
5. Webmail público (`@gmail.com`...) não identifica empresa nenhuma → `400 COMPANY_REQUIRED`; o
   agente escala.

Um e-mail posterior do mesmo domínio que traga o CNPJ **conclui** a pendente (decisão 5, passo 5).
No banco, `companies.cnpj` passa a aceitar `NULL` com um índice único **filtrado**
(`WHERE cnpj IS NOT NULL`, migration manual — docs/04): o SQL Server só aceitaria um `NULL` num
índice único comum, e o Prisma não expressa filtro, por isso o `@unique` saiu do schema e a
unicidade vive só no índice. A listagem `GET /companies?pendingRegistration=true` é a fila de
pendências do ADMIN.

### 11. Documento de embarque vem de qualquer parceiro — e o processo acumula todos

Os prints da caixa real mostram o que é a alimentação de verdade: a commercial invoice final vem do
cliente, o HBL original vem do agente de carga (CIL Agency), a minuta de armazenagem vem do
terminal, o boleto do despachante, o pré-alerta do armador. O BL original costuma chegar semanas
depois da abertura. O processo no sistema só serve se **todos** esses documentos forem parar nele,
automaticamente, venham de quem vierem. Daí três regras:

1. **Documento de embarque de qualquer remetente externo é COMPLEMENTO** do processo que os
   identificadores apontarem (número do processo/embarque, HBL/MBL, contêiner, pedido/PO, DUIMP,
   CE). O agente procura pelo mais específico primeiro; o `lookup` casa código e referência exatos
   e, em `PARTIAL`, "contém" — por isso a `reference` do processo guarda **todos** os
   identificadores conhecidos, separados por ` / `.
2. **Cada documento ensina a referência.** `POST /intake/attachments` aceita `addReferences`: os
   identificadores que o e-mail trouxe e ainda não constam na `reference` são acrescentados a ela
   (com `PROCESS_UPDATED` no histórico). O HBL que aparece pela primeira vez no pré-alerta do agente
   é o que fará o "original HBL" do armador, dias depois, encontrar o mesmo processo.
   Desde a Tarefa 30 (docs/15) o `contains` na `reference` é só o último recurso: cada
   identificador (da `reference`, de `identifiers` na criação e de `addReferences`) vai para o
   índice `ProcessIdentifier`, e o `lookup` casa **exato** por valor normalizado, com o `kind`.
3. **Um processo = um embarque = um BL, e processo só nasce a pedido do cliente.** Quem abre
   processo é o cliente (importador/exportador), pedindo abertura ou mandando "os documentos do
   processo X" de um embarque novo. Documento de terceiro só entra em processo que **já existe**
   e do **mesmo embarque** (mesmo BL, ou mesmo número de processo com o mesmo cliente); um e-mail
   com documentos de vários embarques não é documento de processo nenhum (escala). Sem processo, o
   agente **não cria e não anexa**: registra `IGNORED` com motivo `sem processo para
   <identificadores>`, e o relatório lista esses casos num bloco próprio ("Documentos sem
   processo") para alguém criar o processo pelo front — a partir daí os próximos documentos entram
   sozinhos. Foi decisão da operação (21/09): um documento avulso sem processo "não tem como
   anexar"; melhor um bloco no relatório do que processos criados a partir de documento de agente.

`company.senderIsClient = false` continua existindo na API (cliente resolvido pelo nome citado,
pendente sem domínio) para o caso de a operação um dia querer criação a partir de terceiro; o
prompt atual não o usa. O que já era verdade continua: o documento que chega **depois** do
processo aberto — o BL original semanas depois, a minuta, o boleto — cai no processo pela
referência, e cada um acrescenta os identificadores que trouxer.

Um "guarda-volumes" de documentos sem processo (anexar automaticamente quando o processo com
aquele identificador for criado) é a evolução natural; hoje o rastro é o `IntakeEvent` `IGNORED` com
o motivo, e o e-mail original continua na caixa.

### 12. Sem relatório por e-mail: pasta por organização na caixa e tela "Intake IA"

O relatório da rotina por e-mail para a própria caixa operacional não fazia sentido para quem
recebe ("eles já receberam o e-mail; para que um resumo?") e virou ruído. Substituído por duas
coisas:

1. **Cópia do e-mail processado para `Processos IA/<Organização>/`** na mesma caixa, feita pelo
   **backend** logo depois de criar ou complementar o processo (`MailboxOrganizer`, implementado
   no mesmo provider Graph). Cópia, nunca movimentação: a caixa de entrada que o operacional usa
   não muda. O nome da pasta é o da organização do cliente (sanitizado para o Exchange); as pastas
   são criadas sob demanda e os ids ficam em cache no processo da API. Exige o papel Exchange
   **`Application Mail.ReadWrite`** no lugar de `Mail.Read` (mesmo escopo `IntakeProcessos`) e
   `GRAPH_ORGANIZE_ENABLED=true` (`GRAPH_ORGANIZE_FOLDER` muda o nome da pasta raiz). É
   best-effort: sem permissão (403) ou com o Graph fora, o intake conclui normalmente e o aviso
   ("E-mail não copiado para a pasta…") fica no resultado e no evento.
2. **Tela "Intake IA"** no front (`/intake`, OPERATIONAL e ADMIN): lista os `IntakeEvent` com
   resultado (processo criado, documento anexado, sem ação, precisa de uma pessoa), motivo,
   avisos, remetente e link para o processo, com filtros por resultado e situação, e a posição do
   cursor. É onde o operacional vê os "documentos sem processo" e os escalados — o que antes ia no
   e-mail.

A rotina, com isso, **não usa conector nenhum**: só a API. O relatório continua existindo como
resposta final da execução (visível em claude.ai/code/routines), para auditoria da própria rotina.

### 13. O iLog é a fonte da verdade: espelho incremental + índice de identificadores

Estudo completo e desenho no **docs/15**. O resumo do que muda para o intake:

1. **Os processos "de verdade" nascem no iLog** (sistema de comex), pela equipe, horas depois do
   e-mail do cliente. O backend os **espelha** aqui a cada 5 minutos (`IlogSyncService`, job no
   processo da API, `ILOG_SYNC_ENABLED`): processo com `source = ILOG`, `ilogProcessId`/`ilogNumber`
   ("31435/26"), importador com CNPJ real, e todos os identificadores que o iLog conhece
   (número da Opus, referência do cliente, HBL, MBL, DI, CE, DTA, contêineres, faturas) no índice.
   O processo que o e-mail do cliente já tinha aberto **é vinculado** ao do iLog quando ele
   nasce (mesmo identificador, mesma empresa ou empresa pendente), nunca duplicado; o cadastro
   pendente é concluído com os dados do iLog. A regra "processo só nasce a pedido do cliente"
   (decisão 11) continua: o e-mail "Novo Processo" abre na hora, o sync vincula depois.
2. **O intake consulta o índice antes de qualquer `contains`**: `lookup` e `attach` resolvem por
   identificador exato (normalizado), e a resposta diz **qual** identificador casou (`matchedBy` =
   `HBL`, `OPUS_NUMBER`, `CONTAINER`...). Se o índice não tem e o iLog está ligado, o backend
   pergunta ao iLog **uma vez** e espelha o que achar — o agente não precisa de ferramenta nova
   nem de decidir quando consultar. Nome de empresa não vai ao iLog (só o que tem cara de
   identificador).
3. **"Documento sem processo" vira exceção real**: o HBL do pré-alerta do agente que antes era
   `IGNORED sem processo` agora acha o processo do iLog (88% dos processos têm HBL lá). O que
   continuar sem processo é porque a equipe ainda não abriu no iLog — e aí a regra 3 da decisão 11
   vale como antes.
4. **Empresas e domínios vêm do iLog**: importador por `ilogCompanyId` → CNPJ → cadastro pendente
   compatível (empresa do processo, mesmo nome ou domínio de contato já conhecido) → criação com
   razão social e CNPJ reais. Os domínios de contato corporativos viram `EmailDomain`
   (`autoApprove = false`, como no intake), e um domínio já registrado agrupa a empresa nova na
   mesma organização (filiais e grupos); só domínios usados por 4+ empresas sem relação (webmail,
   transportadoras, despachantes) ficam de fora. Isso elimina o "cadastro pendente" para clientes
   recorrentes.
5. **O agente informa `identifiers`** na criação (HBL, contêineres, número do agente, fatura),
   além da `reference`, para o índice já nascer completo; e um "novo processo" cujo identificador
   já existe na mesma empresa é tratado pelo servidor como complemento (`event.kind =
   ATTACHMENT`), não como duplicata.

Nada escreve no iLog (usuário do banco somente leitura, sessão `READ ONLY`); arquivos do
`ifilesystem` no processo e mapeamento de etapas ficam para a fase seguinte (docs/15, Tarefa 30c).

## Fluxo de uma execução do agente

```mermaid
sequenceDiagram
    participant A as Agente (Haiku)
    participant O as Outlook (conector)
    participant M as MCP abertura-processos
    participant API as API /intake
    participant G as Microsoft Graph

    A->>M: get_intake_cursor()
    M->>API: GET /intake/cursor
    API-->>A: { receivedAt } (de onde continuar; null na primeira vez)
    A->>O: listar a caixa de entrada depois do cursor, mais antigos primeiro (páginas de 25)
    O-->>A: lista com messageId, remetente, assunto, prévia
    loop cada e-mail (remetente bloqueado → descarta sem ler)
        A->>M: get_intake_event(externalId)
        M->>API: GET /intake/events?externalId=...
        API-->>A: 200 { data: [] } (não processado) / 200 com evento COMPLETED (já processado → pula)
        A->>A: classificar: NOVO PROCESSO, COMPLEMENTO (ref citada), IGNORAR ou ESCALAR
        alt novo processo
            A->>M: create_process_from_email({source, requester, company, reference, ...})
            M->>API: POST /intake/processes (fetchAttachments: true)
            API->>G: GET /users/{caixa}/messages/{id}/attachments
            G-->>API: bytes dos anexos
            API-->>A: 201 { process, company.created, documents[], warnings[] }
        else complemento
            A->>M: attach_to_process({processRef, note, ...})
            M->>API: POST /intake/attachments
            API-->>A: 201 { process, documents[] } | 404 com candidatos | 409 ambíguo
        else ignorar / escalar
            A->>M: skip_email({outcome: IGNORED | ESCALATED, reason})
            M->>API: POST /intake/events/skip
            API-->>A: 201 { event }
        end
    end
    A->>M: advance_intake_cursor(receivedAt do último da página)
    M->>API: PUT /intake/cursor
    A->>O: enviar relatório da execução para a caixa operacional
```

## Contrato resumido

Detalhe completo em `docs/05-contrato-api.md`, seção "Intake (alimentação por IA)". Resumo:

| Método | Rota | Papel | Descrição |
| --- | --- | --- | --- |
| `POST` | `/api-keys` | ADMIN | Cria chave vinculada a um usuário interno. Devolve o segredo **uma vez**. |
| `GET` | `/api-keys` | ADMIN | Lista (prefixo, usuário, `lastUsedAt`, `revokedAt`). |
| `DELETE` | `/api-keys/:id` | ADMIN | Revoga. |
| `GET` | `/intake/processes/lookup` | OPERATIONAL, ADMIN | Candidatos por `ref` (código/referência), `companyDocument`, `requesterEmail`. |
| `POST` | `/intake/processes` | OPERATIONAL, ADMIN | Abre processo a partir de um e-mail (JSON ou multipart com `payload` + `files`). |
| `POST` | `/intake/attachments` | OPERATIONAL, ADMIN | Anexa documentos/nota a processo existente por `processRef` ou `processId`. |
| `GET` | `/intake/events` | OPERATIONAL, ADMIN | Eventos de intake; filtro `externalId` para checar idempotência, `status=FAILED` para retentativas, `kind=ESCALATED` para auditoria. |
| `GET` | `/intake/mailbox/messages` | OPERATIONAL, ADMIN | Caixa de entrada desde `after`, já sem remetentes bloqueados (`exclude`), lida pelo servidor (decisão 9). |
| `GET` | `/intake/mailbox/messages/:id` | OPERATIONAL, ADMIN | Corpo em texto limpo + anexos de uma mensagem (decisão 9). |
| `GET` | `/intake/cursor` | OPERATIONAL, ADMIN | De onde a próxima execução continua a leitura da caixa (decisão 9). |
| `PUT` | `/intake/cursor` | OPERATIONAL, ADMIN | Grava até onde a leitura chegou (fim de cada página); só anda para a frente. |
| `POST` | `/intake/events/skip` | OPERATIONAL, ADMIN | Registra e-mail lido e não processado (IGNORED/ESCALATED) com o motivo (decisão 9). |

## Configuração

Variáveis novas (docs/10): `GRAPH_INTAKE_ENABLED`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
`GRAPH_CLIENT_SECRET`, `GRAPH_MAILBOX`, `GRAPH_TIMEOUT_MS`.

### Acesso do backend à caixa (Microsoft Graph, credenciais de aplicação)

Sem restrição, `Mail.Read` de aplicação lê **todas** as caixas do tenant. A restrição a uma caixa é
obrigatória e o mecanismo recomendado pela Microsoft é **RBAC for Applications** do Exchange Online —
`ApplicationAccessPolicy` está marcada como legado ("Don't create new App Access Policies"), não aceita
caixa compartilhada diretamente e terá depreciação anunciada
([learn.microsoft.com/exchange/permissions-exo/application-rbac](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)).

1. No Entra ID: registro de aplicação (client id + client secret = `GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`).
   **Não** conceda `Mail.Read` de aplicação no Entra quando usar RBAC: a concessão no Entra é sem
   escopo e anularia a restrição (FAQ da Microsoft). O papel vem do Exchange, no passo 3.
2. No Exchange Online (PowerShell, papel Exchange Administrator / Organization Management):

```powershell
Connect-ExchangeOnline
# ObjectId = "Object ID" do app em Enterprise Applications (não o do App Registration)
New-ServicePrincipal -AppId <GRAPH_CLIENT_ID> -ObjectId <ObjectId-do-Enterprise-App> -DisplayName "Intake de processos"
New-ManagementScope -Name "IntakeProcessos" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'opusoperacional@opusce.com.br'"
New-ManagementRoleAssignment -App <ObjectId-do-Enterprise-App> -Role "Application Mail.ReadWrite" -CustomResourceScope "IntakeProcessos"
# Valida na hora (ignora o cache de 30 min a 2 h da propagação real):
Test-ServicePrincipalAuthorization -Identity <ObjectId-do-Enterprise-App> -Resource opusoperacional@opusce.com.br
```

`Application Mail.ReadWrite` (não `Mail.Read`) porque a decisão 12 copia o e-mail processado para
a pasta da organização. Se o papel já tinha sido concedido como `Mail.Read`, troque:

```powershell
Get-ManagementRoleAssignment -App <ObjectId-do-Enterprise-App> | Remove-ManagementRoleAssignment -Confirm:$false
New-ManagementRoleAssignment -App <ObjectId-do-Enterprise-App> -Role "Application Mail.ReadWrite" -CustomResourceScope "IntakeProcessos"
```

O escopo continua restrito à caixa `opusoperacional@`: a escrita vale só ali, e o backend só usa
para criar pastas e copiar mensagens (nunca move, apaga ou envia).

3. `GRAPH_MAILBOX` **tem de ser a mesma caixa que o agente lê pelo conector**: o id de mensagem do
   Graph é específico da caixa, e o backend busca `/users/{GRAPH_MAILBOX}/messages/{id}`. A caixa
   definida é a compartilhada **`opusoperacional@opusce.com.br`**, lida pelo conector via `mailboxOwnerEmail`
   (o usuário que autorizou o conector precisa de Full Access nela — `Add-MailboxPermission`). Ids
   também mudam quando a mensagem é movida de pasta; por isso o agente envia também o
   `source.internetMessageId` (Message-ID RFC 5322, que o conector devolve): é a chave secundária de
   idempotência e o backend o usa para reencontrar a mensagem no Graph quando o id original não
   responde mais (docs/05, "Intake").

### Remetentes bloqueados (decisão 9)

A lista vive na seção "Remetentes bloqueados" do prompt da rotina
(`docs/prompts/rotina-intake-claude-max.md`) e na cópia publicada em claude.ai/code/routines — as
duas têm de ficar iguais. Para descobrir o que ainda está passando, `GET /intake/events?kind=IGNORED`
lista o que a IA leu e descartou, com o motivo; remetentes recorrentes ali vão para a lista.

### O agente

Há dois prompts, um por forma de execução:

- `docs/prompts/rotina-intake-claude-max.md` — **rotina agendada na nuvem da Anthropic** (Claude
  Code routines, plano Max). Não usa o `mcp-server/` (a nuvem só enxerga conectores claude.ai por
  HTTPS): chama a API pública por `curl`, com a chave guardada como *API credential* do ambiente e
  injetada pelo proxy da Anthropic. É o caminho da fase de validação.
- `docs/prompts/agente-email-haiku.md` — execução com Claude Code local/headless usando as ferramentas
  do `mcp-server/` (`mcp-server/README.md`).

O estudo de viabilidade que fundamenta essa divisão (restrições da plataforma, Graph, custo) está em
`docs/14-viabilidade-rotina-nuvem.md`.

## O que fica fora deste escopo

- Responder o cliente por e-mail (confirmação de abertura). O agente pode fazer isso com o próprio
  conector de Outlook, usando a resposta da API — não é responsabilidade do backend.
- Classificação do e-mail (novo × complemento × ruído). É trabalho do modelo, guiado pelo prompt; a
  API só oferece `lookup` para ele conferir antes de decidir — e `skip` para registrar a decisão.
- Filtrar ruído antes da IA. É a lista de remetentes bloqueados do prompt (decisão 9); o backend
  não a conhece.
- Escrever no iLog (criar processo, anexar arquivo) — docs/15, seção 5.4.
- Fila assíncrona para o intake. O agente espera a resposta síncrona (segundos) e precisa dela para
  relatar; se um dia o volume exigir, `POST /intake/processes` pode passar a enfileirar e responder
  `202` com o `IntakeEvent` para consulta — o modelo de evento já comporta isso.
