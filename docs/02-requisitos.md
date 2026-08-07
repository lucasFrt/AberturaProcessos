# 02 - Requisitos

Identificadores `RF-x` (funcional) e `RNF-x` (não funcional) são referenciados nas tarefas do
documento 12 e devem ser citados nos testes.

## Requisitos funcionais

### Autenticação e contas

| ID | Requisito |
| --- | --- |
| RF-01 | Login com e-mail e senha. Senha armazenada com bcrypt (cost 12). |
| RF-02 | Login social com Google e com Microsoft (Azure AD). |
| RF-03 | Sessão via JWT: access token de curta duração + refresh token em cookie `httpOnly`. |
| RF-04 | Logout invalida o refresh token no servidor. |
| RF-05 | No primeiro acesso, se o domínio do e-mail corresponder a um domínio cadastrado, o usuário é vinculado automaticamente àquela Organization com o papel padrão configurado no domínio. |
| RF-06 | Sem correspondência de domínio, a conta é criada com status `PENDING` e não recebe token de acesso até aprovação por ADMIN. |
| RF-07 | ADMIN lista contas pendentes, aprova/rejeita, define papel e vincula a Organization/CNPJs. |
| RF-08 | ADMIN pode desativar (`status = DISABLED`) uma conta; refresh tokens ativos são revogados. |
| RF-09 | O mesmo e-mail pode autenticar por mais de um provedor (local, Google, Microsoft) resolvendo para um único usuário. |

### Organizações e empresas

| ID | Requisito |
| --- | --- |
| RF-10 | ADMIN faz CRUD de Organization (nome, `isInternal`). |
| RF-11 | ADMIN faz CRUD de Company (CNPJ, razão social, nome fantasia, ativo) vinculada a uma Organization. |
| RF-12 | CNPJ é único no sistema e validado (14 dígitos + dígitos verificadores). |
| RF-13 | ADMIN gerencia os domínios de e-mail de cada Organization, com papel padrão por domínio. |
| RF-14 | Um domínio de e-mail pertence a no máximo uma Organization. |

### Processos

| ID | Requisito |
| --- | --- |
| RF-20 | Criar processo com: `clientCompanyId` (obrigatório), `requestingCompanyId` (opcional), `reference` (texto curto, obrigatório), `additionalInfo` (texto longo, opcional) e zero ou mais documentos. |
| RF-21 | Ao criar, o processo recebe um código sequencial legível no formato `PRC-{ano}-{sequência 5 dígitos}` e é posicionado na primeira etapa do Kanban (menor `order`). |
| RF-22 | Listar processos com filtros: etapa, CNPJ cliente, responsável, texto livre (código, referência) e faixa de datas; com paginação. |
| RF-23 | Endpoint de board: processos agrupados por etapa, respeitando o escopo do usuário. |
| RF-24 | Editar `reference`, `additionalInfo`, `clientCompanyId`, `requestingCompanyId`. |
| RF-25 | Mover processo entre etapas. A movimentação registra origem, destino, autor e timestamp. |
| RF-26 | Atribuir/alterar responsável (somente usuários da organização interna). |
| RF-27 | Ao entrar em etapa com `isFinal = true`, gravar `completedAt`. Ao sair dela, limpar `completedAt`. |
| RF-28 | Exclusão é lógica (`deletedAt` + `deletedById`). Processos excluídos não aparecem em listagens nem no board. |
| RF-29 | Consultar a trilha de auditoria de um processo em ordem cronológica. |

### Etapas do Kanban

| ID | Requisito |
| --- | --- |
| RF-30 | CRUD de etapas (nome, cor, `order`, `isFinal`). |
| RF-31 | Reordenar etapas em uma única operação atômica. |
| RF-32 | Não é possível excluir etapa que contenha processos ativos; a API deve retornar erro explicando quantos processos impedem a exclusão. |
| RF-33 | Deve existir sempre ao menos uma etapa. Etapas são globais (não por organização). |

### Documentos

| ID | Requisito |
| --- | --- |
| RF-40 | Anexar arquivos a um processo. Qualquer tipo de arquivo é aceito no v1. |
| RF-41 | Bytes gravados em disco no servidor; banco guarda nome original, nome físico, caminho relativo, tamanho, mime type, hash SHA-256 e autor do upload. |
| RF-42 | Listar e baixar documentos de um processo, respeitando o escopo de acesso do usuário. |
| RF-43 | Excluir documento (lógico). O arquivo físico é preservado; a remoção física fica para rotina de limpeza futura. |
| RF-44 | Upload e exclusão de documento geram entrada na trilha de auditoria. |

### Notificações e tempo real

| ID | Requisito |
| --- | --- |
| RF-50 | Mudança de etapa dispara e-mail para todos os usuários ativos com papel OPERATIONAL, descrevendo processo, etapa de origem, etapa de destino, autor e horário. |
| RF-51 | O envio de e-mail é assíncrono via fila; falha de SMTP não pode falhar a requisição HTTP que originou a ação. |
| RF-52 | Jobs de e-mail têm retentativa com backoff exponencial (5 tentativas). |
| RF-53 | Criação, edição, movimentação e exclusão de processo emitem evento em tempo real para os usuários autorizados a ver aquele processo. |
| RF-54 | A conexão de socket é autenticada com o access token e só recebe eventos dentro do escopo do usuário. |

### Dashboard gerencial

| ID | Requisito |
| --- | --- |
| RF-60 | Métricas para ADMIN: total de processos, contagem por etapa, contagem por CNPJ cliente, criados no período, concluídos no período. |
| RF-61 | Tempo médio de conclusão (média de `completedAt - createdAt` dos processos concluídos), em horas e formatado em dias/horas. |
| RF-62 | Tempo médio de permanência por etapa, calculado a partir da trilha de auditoria. |
| RF-63 | Filtro de período (data inicial/final) e por Organization. |

## Matriz de permissões

| Ação | CLIENT | OPERATIONAL | ADMIN |
| --- | :---: | :---: | :---: |
| Criar processo | ✔ (só para CNPJs do seu escopo) | ✔ (qualquer CNPJ) | ✔ |
| Ver processo | ✔ (escopo) | ✔ (todos) | ✔ (todos) |
| Editar processo | ✔ (escopo) | ✔ | ✔ |
| Mover entre etapas | ✖ | ✔ | ✔ |
| Definir responsável | ✖ | ✔ | ✔ |
| Excluir processo | ✖ | ✔ | ✔ |
| Anexar documento | ✔ (escopo) | ✔ | ✔ |
| Baixar documento | ✔ (escopo) | ✔ | ✔ |
| Excluir documento | ✔ (apenas os que enviou) | ✔ | ✔ |
| Ver trilha de auditoria | ✔ (escopo) | ✔ | ✔ |
| CRUD de etapas do Kanban | ✖ | ✖ | ✔ |
| CRUD de Organization / Company / domínios | ✖ | ✖ | ✔ |
| Gerir usuários e aprovar pendentes | ✖ | ✖ | ✔ |
| Dashboard gerencial | ✖ | ✖ | ✔ |

> O usuário pediu "poder total da ferramenta" para o operacional. Isso está atendido no domínio de
> processos. Gestão de cadastros estruturais (etapas, empresas, usuários) fica com ADMIN, que é a
> "pegada gerencial" definida para esse papel.

### Escopo de acesso do CLIENT

Cada usuário tem `accessScope`:

- `ORGANIZATION` (padrão para contas provisionadas por domínio) — acessa todos os CNPJs ativos da
  sua Organization. Filial nova entra no escopo automaticamente.
- `COMPANIES` — acessa somente os CNPJs listados em `UserCompany`.

Um processo é visível ao CLIENT quando `clientCompanyId` **ou** `requestingCompanyId` está no
conjunto resolvido acima. Toda consulta de processo/documento/histórico deve aplicar esse filtro na
camada de repositório, nunca apenas na UI.

## Requisitos não funcionais

| ID | Requisito |
| --- | --- |
| RNF-01 | **Isolamento de dados.** Nenhuma resposta pode conter dados de Organization à qual o usuário não pertence. Vale para listagens, detalhes, downloads, eventos de socket e mensagens de erro (usar 404 em vez de 403 quando revelar a existência do recurso for indevido). |
| RNF-02 | **Rate limiting diferenciado.** `/auth/*`: 10 tentativas / 15 min por IP+e-mail. CLIENT: 120 req/min. OPERATIONAL e ADMIN: 1000 req/min (limite simbólico, só evita loop acidental derrubar a aplicação). Upload: 30 req / 10 min por usuário. |
| RNF-03 | **Auditoria imutável.** `ProcessHistory` é append-only. Sem endpoints de update/delete. |
| RNF-04 | **Validação de entrada.** Todo body, query e param passa por schema Zod antes de chegar ao controller. |
| RNF-05 | **Segurança HTTP.** Helmet, CORS restrito por lista de origens, cookies `httpOnly` + `sameSite=lax` + `secure` em produção, limite de tamanho de body. |
| RNF-06 | **Segredos fora do código.** Somente variáveis de ambiente. `.env` no `.gitignore`; `.env.example` versionado. |
| RNF-07 | **Cobertura de testes** mínima de 70% nas camadas de service e nos middlewares de autorização; fluxos críticos cobertos por teste de integração. |
| RNF-08 | **Logs estruturados** em JSON com `requestId`, `userId` e latência. Sem log de senha, token ou conteúdo de arquivo. |
| RNF-09 | **Timezone** `America/Sao_Paulo` na apresentação; persistência sempre em UTC. |
| RNF-10 | **Idempotência de migrations.** Nenhuma alteração de schema aplicada manualmente no banco; sempre via `prisma migrate`. |
| RNF-11 | **Path traversal.** Nome de arquivo enviado pelo cliente nunca é usado como caminho físico. Nome físico é UUID; caminho final é validado como descendente de `STORAGE_ROOT`. |
| RNF-12 | **Graceful shutdown.** `SIGTERM`/`SIGINT` fecham servidor HTTP, workers BullMQ e Prisma antes de sair — necessário para reinício limpo pelo NSSM. |
