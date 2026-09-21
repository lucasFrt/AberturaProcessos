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

### 9. A IA lê uma pasta alimentada por cópia, e sabe onde parou

A caixa `opusoperacional@` recebe centenas de e-mails por dia — notificações de terminal,
faturamento, follow-up de DUIMP, conversas internas. Ler a caixa de entrada com uma "janela das
últimas N horas" não funciona: com o teto de e-mails por execução, o que não é examinado a tempo
sai da janela e nunca mais é visto, e a cota da rotina vai embora em ruído (foi o que a primeira
execução real mostrou: 240 e-mails em 3 h, 12 examinados).

A solução tem duas partes, e nenhuma mexe na caixa que o operacional usa:

1. **Pasta `Intake IA`, alimentada por uma regra de *cópia*** do Outlook na própria caixa. A regra
   decide o que a IA vê e é onde o ruído é cortado (exceções por remetente: `followupopus`,
   `multiterminais`, notificações de sistema...). É *copiar*, nunca *mover*: a caixa de entrada
   fica intocada e ninguém do operacional percebe diferença. Nada é movido nem apagado depois — a
   pasta só cresce.
2. **Cursor na API**: como nada sai da pasta, a rotina precisa saber de onde continuar.
   `GET /intake/cursor` devolve o `receivedAt` do último e-mail examinado, e a busca na pasta é
   sempre "depois desse instante, mais antigos primeiro". Para o cursor passar também pelos e-mails
   que **não** viram processo, todo e-mail examinado termina registrado: os descartados e os
   escalados entram por `POST /intake/events/skip` como `IntakeEvent` de `kind` `IGNORED` ou
   `ESCALATED` (`status = COMPLETED`, `result.reason` com o motivo). Ninguém é relido; nada é
   perdido; a auditoria do que a IA decidiu fica no mesmo lugar que os processos criados.

O cursor conta `COMPLETED` e `FAILED` (último *examinado*), não só concluídos: a retentativa de um
`FAILED` é um passo próprio da rotina (`GET /intake/events?status=FAILED`, uma tentativa; falhou de
novo → `skip` com `ESCALATED`), e não a releitura pelo cursor — senão um e-mail que falha sempre
travaria a fila atrás dele. `PROCESSING` não conta: pode ser uma execução interrompida no meio.

Copiar (em vez de mover) tem uma consequência prática que o backend já cobre: a cópia na pasta tem
**outro id do Graph** que o original, mas o mesmo `internetMessageId` — a chave secundária de
idempotência (docs/14) — então um e-mail já tratado pelo original nunca é reprocessado pela cópia, e
vice-versa. E o backend baixa os anexos pelo id da cópia normalmente (mesma caixa).

Esta decisão substitui a ideia anterior de "mover o e-mail processado para `Processos IA/<código>`":
mover exigiria `Mail.ReadWrite` de aplicação e mexeria na caixa em uso. Se um dia fizer sentido
organizar por processo, que seja por *cópia* também.

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
    A->>O: buscar na pasta "Intake IA" e-mails depois do cursor, mais antigos primeiro
    O-->>A: lista com messageId, remetente, assunto, corpo
    loop cada e-mail (até o teto por execução)
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
            API-->>A: 201 { event } (o cursor passa a incluir este e-mail)
        end
    end
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
| `GET` | `/intake/cursor` | OPERATIONAL, ADMIN | `receivedAt` do último e-mail examinado — de onde a próxima execução continua (decisão 9). |
| `POST` | `/intake/events/skip` | OPERATIONAL, ADMIN | Registra e-mail IGNORED/ESCALATED para o cursor avançar (decisão 9). |

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
New-ManagementRoleAssignment -App <ObjectId-do-Enterprise-App> -Role "Application Mail.Read" -CustomResourceScope "IntakeProcessos"
# Valida na hora (ignora o cache de 30 min a 2 h da propagação real):
Test-ServicePrincipalAuthorization -Identity <ObjectId-do-Enterprise-App> -Resource opusoperacional@opusce.com.br
```

3. `GRAPH_MAILBOX` **tem de ser a mesma caixa que o agente lê pelo conector**: o id de mensagem do
   Graph é específico da caixa, e o backend busca `/users/{GRAPH_MAILBOX}/messages/{id}`. A caixa
   definida é a compartilhada **`opusoperacional@opusce.com.br`**, lida pelo conector via `mailboxOwnerEmail`
   (o usuário que autorizou o conector precisa de Full Access nela — `Add-MailboxPermission`). Ids
   também mudam quando a mensagem é movida de pasta; por isso o agente envia também o
   `source.internetMessageId` (Message-ID RFC 5322, que o conector devolve): é a chave secundária de
   idempotência e o backend o usa para reencontrar a mensagem no Graph quando o id original não
   responde mais (docs/05, "Intake").

### Pasta `Intake IA` e regra de cópia (decisão 9)

Na caixa `opusoperacional@opusce.com.br`, por quem tem *Full Access* nela (Outlook Web →
abrir a caixa compartilhada → Configurações → E-mail → Regras), ou pelo Exchange PowerShell:

```powershell
# Pasta e regra de CÓPIA (nunca mover). Exceções = remetentes automáticos que a IA não deve ver.
New-MailboxFolder -Parent "opusoperacional@opusce.com.br:\" -Name "Intake IA"
New-InboxRule -Mailbox opusoperacional@opusce.com.br -Name "Intake IA" `
  -CopyToFolder "opusoperacional@opusce.com.br:\Intake IA" `
  -ExceptIfFromAddressContainsWords "followupopus","multiterminais","noreply","no-reply","naoresponda"
```

Ajuste a lista de exceções conforme o ruído aparecer nos relatórios (os e-mails que a IA registra
como `IGNORED` em `GET /intake/events?kind=IGNORED` mostram o que ainda está passando). A regra só
vale para e-mails novos; para testar com um e-mail antigo, copie-o à mão para a pasta (Ctrl+arrastar
no Outlook, ou "Copiar para").

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
- Filtrar ruído antes da IA. É a regra de cópia do Outlook (decisão 9), mantida pelo operacional.
- Fila assíncrona para o intake. O agente espera a resposta síncrona (segundos) e precisa dela para
  relatar; se um dia o volume exigir, `POST /intake/processes` pode passar a enfileirar e responder
  `202` com o `IntakeEvent` para consulta — o modelo de evento já comporta isso.
