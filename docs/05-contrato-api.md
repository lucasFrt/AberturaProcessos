# 05 - Contrato da API

Base: `/api/v1`. Todo corpo de requisição e resposta é `application/json`, exceto upload
(`multipart/form-data`) e download (`application/octet-stream`).

## Convenções

**Recurso único** — o objeto vai na raiz da resposta.

**Coleção** — envelope com `data` e `meta`:

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 }
}
```

**Erro** — envelope único, sempre com `code` estável (a UI decide o texto a partir dele):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos.",
    "details": [{ "path": "reference", "message": "Campo obrigatório" }],
    "requestId": "01J9Z8K3M0QW"
  }
}
```

**Datas** — ISO 8601 em UTC (`2026-08-07T14:32:00.000Z`).
**Paginação** — `?page=1&pageSize=20` (`pageSize` máximo 100).
**Ordenação** — `?sort=createdAt&order=desc`.

### Códigos de erro

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Falha de schema Zod. `details` lista os campos. |
| 400 | `INVALID_CNPJ` | CNPJ (14 dígitos) com dígitos verificadores inválidos. |
| 400 | `INVALID_CPF` | CPF (11 dígitos) com dígitos verificadores inválidos. |
| 400 | `COMPANY_REQUIRED` | Intake: e-mail sem CNPJ/CPF e remetente sem domínio corporativo (webmail público) — não há como identificar a empresa. |
| 401 | `UNAUTHENTICATED` | Sem token, token expirado ou inválido. |
| 401 | `INVALID_CREDENTIALS` | E-mail ou senha incorretos. |
| 403 | `FORBIDDEN` | Autenticado, porém sem papel/permissão para a ação. |
| 403 | `ACCOUNT_PENDING` | Conta aguardando aprovação de ADMIN. |
| 403 | `ACCOUNT_DISABLED` | Conta desativada ou rejeitada. |
| 404 | `NOT_FOUND` | Recurso inexistente **ou** fora do escopo de acesso (ver RNF-01). |
| 404 | `CNPJ_NOT_FOUND` | CNPJ válido, mas inexistente na base da Receita (`GET /companies/lookup/:cnpj`). |
| 404 | `PROCESS_REF_NOT_FOUND` | Intake: nenhum processo com o código/referência citado. `details.candidates` traz parciais. |
| 404 | `MAIL_MESSAGE_NOT_FOUND` | Intake: `source.externalId` não existe na caixa configurada. |
| 409 | `CONFLICT` | Violação de unicidade ou de regra de estado. |
| 409 | `STAGE_NOT_EMPTY` | Exclusão de etapa que ainda contém processos ativos. |
| 409 | `PROCESS_REF_AMBIGUOUS` | Intake: mais de um processo com a referência citada. `details.candidates` lista-os. |
| 409 | `COMPANY_INACTIVE` | Intake: o CNPJ/CPF do e-mail está cadastrado como inativo. |
| 409 | `COMPANY_AMBIGUOUS` | Intake: e-mail sem CNPJ/CPF e o domínio do remetente tem mais de uma empresa ativa. `details.candidates` lista-as. |
| 409 | `COMPANY_DOCUMENT_LOCKED` | `PATCH /companies/:id` com `cnpj` em empresa que já tem documento — só cadastro pendente aceita. |
| 409 | `INTAKE_IN_PROGRESS` | Intake: a mesma mensagem está sendo processada por outra execução. |
| 413 | `PAYLOAD_TOO_LARGE` | Upload acima de `MAX_UPLOAD_SIZE_MB`. |
| 429 | `RATE_LIMIT_EXCEEDED` | Limite atingido. Header `Retry-After` presente. |
| 429 | `CNPJ_LOOKUP_RATE_LIMITED` | Cota do provedor externo de consulta de CNPJ estourada. |
| 500 | `INTERNAL_ERROR` | Falha não prevista. Nunca expõe stack trace. |
| 503 | `CNPJ_LOOKUP_UNAVAILABLE` | Provedor de consulta de CNPJ fora do ar, em timeout ou fora do contrato. |
| 503 | `CNPJ_LOOKUP_DISABLED` | Consulta de CNPJ desligada por configuração (`CNPJ_LOOKUP_ENABLED=false`). |
| 503 | `MAIL_ATTACHMENTS_DISABLED` | Intake com `fetchAttachments: true` sem `GRAPH_INTAKE_ENABLED`. |
| 503 | `MAIL_ATTACHMENTS_UNAVAILABLE` | Microsoft Graph indisponível, sem token ou falha ao baixar anexo. |

> **Por que 404 e não 403 fora do escopo:** responder 403 confirmaria a existência de um processo de
> outro cliente. Para recursos de outra Organization a API responde 404.

## Autenticação

Toda rota autenticada aceita **uma** de duas credenciais (docs/06 e docs/13, decisão 2):

| Header | Quem usa | Resolve para |
| --- | --- | --- |
| `Authorization: Bearer <access token>` | Pessoas (front) | O usuário do JWT. |
| `X-Api-Key: <chave>` | Integrações (agente de e-mail, MCP) | O usuário interno vinculado à chave (`POST /api-keys`). |

Depois de resolvida a credencial, nada muda: status, papel, escopo e rate limit são os do usuário.
Chave revogada ou inexistente → `401 UNAUTHENTICATED`; usuário vinculado desativado →
`403 ACCOUNT_DISABLED`. Quando os dois headers vêm juntos, `X-Api-Key` prevalece.

### `POST /auth/register`

Público. Cria conta local. Rate limit de auth.

```json
{ "name": "Maria Silva", "email": "maria@clientex.com.br", "password": "SenhaForte1!" }
```

Senha: mínimo 10 caracteres, com letra maiúscula, minúscula e dígito.

Resposta `201`:

```json
{
  "status": "ACTIVE",
  "message": "Conta criada e vinculada à organização Cliente X.",
  "accessToken": "eyJ...",
  "user": { "id": "clx...", "name": "Maria Silva", "role": "CLIENT" }
}
```

Se o domínio não corresponder a nenhum `EmailDomain`, ou se o domínio tiver `autoApprove = false`,
a resposta é `202` sem token:

```json
{ "status": "PENDING", "message": "Conta criada. Aguarde a aprovação de um administrador." }
```

### `POST /auth/login`

```json
{ "email": "maria@clientex.com.br", "password": "SenhaForte1!" }
```

`200` + `Set-Cookie: refreshToken=...; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Secure`:

```json
{
  "accessToken": "eyJ...",
  "expiresIn": 900,
  "user": {
    "id": "clx...", "name": "Maria Silva", "email": "maria@clientex.com.br",
    "role": "CLIENT", "organization": { "id": "clo...", "name": "Cliente X" }
  }
}
```

Erros: `401 INVALID_CREDENTIALS`, `403 ACCOUNT_PENDING`, `403 ACCOUNT_DISABLED`.
Conta existente apenas via social responde `401 INVALID_CREDENTIALS` (não revela o provedor).

### `GET /auth/providers`

Público. Informa quais provedores sociais estão configurados, para o front esconder botões inúteis.

```json
{ "local": true, "google": true, "microsoft": false }
```

### `GET /auth/google` · `GET /auth/microsoft`

Redirect 302 para o provedor. Aceita `?redirect=/board` para retorno pós-login (validado contra
lista de caminhos internos permitidos, para evitar open redirect).

### `GET /auth/google/callback` · `GET /auth/microsoft/callback`

Processa o retorno, aplica o provisionamento por domínio (documento 06), grava o cookie de refresh e
redireciona para `FRONTEND_URL + /auth/callback?status=ok`. Em caso de conta pendente,
`?status=pending`; em erro, `?status=error&code=...`. O front então chama `/auth/refresh` para obter
o access token — o token não trafega na URL.

### `POST /auth/refresh`

Sem corpo; usa o cookie. `200` com novo `accessToken` e rotação do refresh token (o antigo é
marcado como revogado). Reuso de token já revogado revoga toda a família de tokens do usuário e
responde `401`.

### `POST /auth/logout`

Revoga o refresh token atual e limpa o cookie. `204`.

### `GET /auth/me`

Autenticado. Retorna tudo que a UI precisa para montar navegação e permissões:

```json
{
  "id": "clx...",
  "name": "Maria Silva",
  "email": "maria@clientex.com.br",
  "role": "CLIENT",
  "status": "ACTIVE",
  "avatarUrl": null,
  "organization": { "id": "clo...", "name": "Cliente X", "isInternal": false },
  "accessScope": "ORGANIZATION",
  "companies": [
    { "id": "cco1", "cnpj": "12345678000190", "legalName": "Cliente X Matriz LTDA" },
    { "id": "cco2", "cnpj": "12345678000271", "legalName": "Cliente X Filial SP LTDA" }
  ],
  "permissions": [
    "process:create", "process:read", "process:update",
    "document:create", "document:read"
  ]
}
```

## Chaves de API (ADMIN)

Contas de serviço para integrações (docs/13, decisão 2). A chave age como o usuário interno
vinculado — o histórico dos processos mostra esse usuário como autor.

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api-keys` | `{ data: [...] }` com todas as chaves (ativas e revogadas), mais recentes primeiro. |
| `POST` | `/api-keys` | `{ name, userId }`. `userId` precisa ser OPERATIONAL/ADMIN e `ACTIVE`, senão `400 VALIDATION_ERROR`. |
| `DELETE` | `/api-keys/:id` | Revoga. `204`. Idempotente. |

Resposta do `POST` (`201`) — o campo `key` **só existe aqui**; só o hash SHA-256 é persistido:

```json
{
  "id": "cak1",
  "name": "Agente de e-mail",
  "key": "apk_Xk2...47 caracteres...",
  "keyPrefix": "apk_Xk2pQ9aB",
  "user": { "id": "cus7", "name": "Agente de E-mail", "email": "agente@opusce.com.br", "role": "OPERATIONAL", "status": "ACTIVE" },
  "lastUsedAt": null,
  "revokedAt": null,
  "createdAt": "2026-09-18T12:00:00.000Z"
}
```

Os itens de `GET /api-keys` têm a mesma forma, sem `key`. `lastUsedAt` é atualizado no máximo uma
vez por minuto por chave.

## Organizações (ADMIN)

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/organizations` | Lista paginada. Filtros: `q`, `isInternal`, `isActive`. |
| `POST` | `/organizations` | `{ name, isInternal? }` |
| `GET` | `/organizations/:id` | Detalhe com domínios e CNPJs. |
| `PATCH` | `/organizations/:id` | `{ name?, isActive? }` |
| `DELETE` | `/organizations/:id` | `409 CONFLICT` se houver usuários, CNPJs ou processos. |
| `GET` | `/organizations/:id/domains` | Domínios da organização. |
| `POST` | `/organizations/:id/domains` | `{ domain, defaultRole?, autoApprove? }`. `409` se o domínio já pertence a outra org. |
| `DELETE` | `/organizations/:orgId/domains/:domainId` | Remove o domínio. |

`domain` é normalizado para minúsculas, sem `@` e sem espaços antes de validar/gravar.

## Empresas / CNPJs (ADMIN para escrita)

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/companies` | Filtros: `q` (razão social, nome fantasia ou CNPJ), `organizationId`, `isActive`, `pendingRegistration` (`true` = só cadastros pendentes, sem CNPJ). CLIENT recebe apenas os CNPJs do seu escopo. |
| `POST` | `/companies` | `{ cnpj, legalName, tradeName?, organizationId }`. `cnpj` aceita CNPJ (14 dígitos) **ou CPF** (11); a resposta traz `documentType: "CNPJ" \| "CPF"` (docs/13, decisão 5). |
| `GET` | `/companies/lookup/:cnpj` | Consulta os dados cadastrais na Receita para autopreencher o formulário. Ver abaixo. |
| `GET` | `/companies/:id` | Detalhe. |
| `PATCH` | `/companies/:id` | `{ cnpj?, legalName?, tradeName?, isActive?, organizationId? }`. `cnpj` só é aceito para **concluir cadastro pendente** (empresa com `cnpj: null`); em empresa já completa responde `409 COMPANY_DOCUMENT_LOCKED`. |
| `DELETE` | `/companies/:id` | `409 CONFLICT` se houver processos. |

O CNPJ/CPF é aceito com ou sem máscara e persistido apenas com dígitos na coluna `cnpj`
(nome histórico); `documentType` diz o que ela contém. A consulta na Receita
(`GET /companies/lookup/:cnpj`) só existe para CNPJ.

**Cadastro pendente** (docs/13, decisão 10): o intake por e-mail cria a empresa **sem documento**
quando o e-mail não traz CNPJ/CPF, identificando-a pelo domínio do remetente. Nas respostas ela
aparece com `cnpj: null` e `documentType: null` — em `GET /companies`, no `clientCompany` dos
processos, em `GET /auth/me` e no dashboard. O front exibe "Cadastro pendente" no lugar do
documento; o ADMIN completa pelo `PATCH /companies/:id` com `cnpj`. Um e-mail posterior do mesmo
domínio que traga o CNPJ também conclui o cadastro automaticamente.

### `GET /companies/lookup/:cnpj`

ADMIN. Evita digitação manual de razão social e nome fantasia no cadastro de empresa. O `:cnpj`
pode vir com ou sem máscara.

```json
{
  "cnpj": "05557450000608",
  "legalName": "SAINT PAUL'S IMPORTACAO E EXPORTACAO LTDA",
  "tradeName": null,
  "registrationStatus": "ATIVA",
  "alreadyRegistered": false,
  "companyId": null,
  "organizationId": null
}
```

`alreadyRegistered: true` significa que o CNPJ **já existe neste sistema**: nesse caso os dados
vêm do nosso banco (não da Receita), `registrationStatus` é `null` e `companyId`/`organizationId`
apontam para o registro existente. Serve para o front avisar antes de o `POST /companies` falhar
com `409 CONFLICT`.

A ordem de execução é validar os dígitos → procurar no banco local → só então consultar o
provedor externo. O motivo é cota: o plano gratuito do provedor permite 3 consultas por minuto por
IP, então nem CNPJ malformado nem empresa já cadastrada devem gastar uma requisição. O provedor
concreto é detalhe de infraestrutura atrás de `CnpjLookupProvider`
(`backend/src/domain/cnpj/cnpj-lookup-provider.ts`); a implementação padrão usa a ReceitaWS e é
configurada pelas variáveis `CNPJ_LOOKUP_*` (docs/10).

Erros específicos desta rota:

| Código | Status | Quando |
| --- | --- | --- |
| `INVALID_CNPJ` | 400 | Dígitos verificadores inválidos (não consulta o provedor). |
| `CNPJ_NOT_FOUND` | 404 | CNPJ válido, mas inexistente na base da Receita. |
| `CNPJ_LOOKUP_RATE_LIMITED` | 429 | Cota do provedor externo estourada. |
| `CNPJ_LOOKUP_UNAVAILABLE` | 503 | Timeout, falha de rede, 5xx ou resposta fora do contrato. |
| `CNPJ_LOOKUP_DISABLED` | 503 | `CNPJ_LOOKUP_ENABLED=false`. O cadastro manual continua funcionando. |

## Usuários (ADMIN)

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/users` | Filtros: `status`, `role`, `organizationId`, `q`. |
| `GET` | `/users/pending` | Atalho para `status=PENDING`, ordenado por `createdAt` asc. |
| `GET` | `/users/:id` | Detalhe com identidades e CNPJs acessíveis. |
| `POST` | `/users/:id/approve` | `{ role, organizationId, accessScope, companyIds? }` → `status = ACTIVE`, grava `approvedAt`/`approvedById`. |
| `POST` | `/users/:id/reject` | `{ reason? }` → `status = REJECTED`. |
| `PATCH` | `/users/:id` | `{ name?, role?, status?, organizationId?, accessScope? }`. Mudar para `DISABLED` revoga refresh tokens. |
| `PUT` | `/users/:id/companies` | `{ companyIds: string[] }` substitui o conjunto de acessos. Exige `accessScope = COMPANIES`. |
| `GET` | `/users/operational` | Usuários ativos OPERATIONAL/ADMIN, para popular o seletor de responsável. Acessível a OPERATIONAL e ADMIN. |

Regras de guarda: ADMIN não pode rebaixar o próprio papel nem se desativar (`409 CONFLICT`), e o
sistema deve manter pelo menos um ADMIN ativo.

## Etapas do Kanban

| Método | Rota | Papel | Descrição |
| --- | --- | --- | --- |
| `GET` | `/stages` | autenticado | Lista ordenada por `order`. Aceita `?withCounts=true` para incluir `processCount` no escopo do usuário. |
| `POST` | `/stages` | ADMIN | `{ name, color?, isFinal? }`. Entra no fim da ordem. |
| `PATCH` | `/stages/:id` | ADMIN | `{ name?, color?, isFinal? }` |
| `PATCH` | `/stages/reorder` | ADMIN | `{ stageIds: string[] }` com **todos** os ids; grava `order` pelo índice. |
| `DELETE` | `/stages/:id` | ADMIN | `409 STAGE_NOT_EMPTY` com `details.processCount`. `409 CONFLICT` se for a última etapa. |

## Processos

### `POST /processes`

CLIENT, OPERATIONAL, ADMIN. `Content-Type: application/json` (documentos são anexados depois, ou
enviados no mesmo passo pelo front via chamada sequencial de upload).

```json
{
  "clientCompanyId": "cco1",
  "requestingCompanyId": null,
  "reference": "IMP-2026-0042 / Contêiner MSKU1234567",
  "additionalInfo": "Carga com licença de importação pendente. Contato: João (11) 99999-0000."
}
```

Validação: `reference` 3–255 caracteres; `additionalInfo` até 10.000 caracteres;
`clientCompanyId` precisa existir, estar ativo e estar no escopo do usuário (CLIENT).

`201` com o processo criado (mesma forma de `GET /processes/:id`, sem `history` e `documents`
populados além do que já existe).

### `GET /processes`

Filtros: `stageId`, `clientCompanyId`, `responsibleId`, `organizationId` (ADMIN/OPERATIONAL),
`q` (busca em `code` e `reference`), `createdFrom`, `createdTo`, `page`, `pageSize`, `sort`, `order`.

Item da lista:

```json
{
  "id": "cpr1",
  "code": "PRC-2026-00042",
  "reference": "IMP-2026-0042 / Contêiner MSKU1234567",
  "clientCompany": { "id": "cco1", "cnpj": "12345678000190", "legalName": "Cliente X Matriz LTDA" },
  "requestingCompany": null,
  "currentStage": { "id": "cst2", "name": "Em Andamento", "color": "#faad14", "order": 1, "isFinal": false },
  "responsible": { "id": "cus9", "name": "Carlos Souza" },
  "documentCount": 3,
  "source": "EMAIL",
  "requesterName": "João",
  "requesterEmail": "joao@clientex.com.br",
  "receivedAt": "2026-08-01T09:10:00.000Z",
  "stageChangedAt": "2026-08-05T12:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-08-01T09:15:00.000Z"
}
```

### `GET /processes/board`

Endpoint agregador do Kanban. Aceita os mesmos filtros de `/processes` exceto `stageId`, mais
`limitPerStage` (padrão 50).

```json
{
  "stages": [
    {
      "id": "cst1", "name": "Entrada", "color": "#1677ff", "order": 0, "isFinal": false,
      "total": 12,
      "processes": [ /* itens no formato da listagem */ ]
    }
  ],
  "generatedAt": "2026-08-07T14:32:00.000Z"
}
```

`total` é a contagem real da coluna; `processes` traz até `limitPerStage` itens. Se
`total > processes.length`, a coluna exibe "carregar mais", que busca a página seguinte via
`GET /processes?stageId=...`.

### `GET /processes/:id`

Detalhe agregado para a gaveta:

```json
{
  "id": "cpr1",
  "code": "PRC-2026-00042",
  "reference": "IMP-2026-0042 / Contêiner MSKU1234567",
  "additionalInfo": "Carga com licença de importação pendente.",
  "clientCompany": { "id": "cco1", "cnpj": "12345678000190", "legalName": "Cliente X Matriz LTDA" },
  "requestingCompany": null,
  "currentStage": { "id": "cst2", "name": "Em Andamento", "color": "#faad14", "order": 1, "isFinal": false },
  "responsible": { "id": "cus9", "name": "Carlos Souza", "email": "carlos@opusce.com.br" },
  "createdBy": { "id": "cus3", "name": "Maria Silva" },
  "source": "WEB",
  "requesterName": null,
  "requesterEmail": null,
  "receivedAt": null,
  "stageChangedAt": "2026-08-05T12:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-08-01T09:15:00.000Z",
  "updatedAt": "2026-08-05T12:00:00.000Z",
  "documents": [
    {
      "id": "cdo1", "originalName": "invoice.pdf", "mimeType": "application/pdf",
      "size": 184320, "uploadedBy": { "id": "cus3", "name": "Maria Silva" },
      "source": "WEB", "receivedAt": null,
      "createdAt": "2026-08-01T09:20:00.000Z",
      "downloadUrl": "/api/v1/documents/cdo1/download"
    }
  ],
  "history": [
    {
      "id": "chi2", "action": "STAGE_CHANGED",
      "fromStage": { "id": "cst1", "name": "Entrada" },
      "toStage": { "id": "cst2", "name": "Em Andamento" },
      "actor": { "id": "cus9", "name": "Carlos Souza" },
      "description": "Etapa alterada de Entrada para Em Andamento",
      "createdAt": "2026-08-05T12:00:00.000Z"
    }
  ],
  "permissions": {
    "canEdit": true, "canMove": false, "canDelete": false,
    "canAssign": false, "canUploadDocument": true
  }
}
```

`source`, `requesterName`, `requesterEmail` e `receivedAt` (docs/13, decisão 7) existem na
listagem e no detalhe. `source` **não é aceito no payload** de `POST /processes`: é derivado da
credencial (JWT → `WEB`, `X-Api-Key` → `API`) ou da rota de intake (`EMAIL`). Os campos de
solicitante e `receivedAt` só são preenchidos pelo intake.

`permissions` é calculado no servidor para o usuário da requisição. A UI usa esse objeto para
habilitar/desabilitar ações, mas a autorização real continua sendo feita em cada endpoint.

### `PATCH /processes/:id`

`{ reference?, additionalInfo?, clientCompanyId?, requestingCompanyId? }`. Gera histórico
`PROCESS_UPDATED` com o diff em `metadata` (apenas os campos alterados, valor antigo e novo).

### `PATCH /processes/:id/stage`

OPERATIONAL, ADMIN.

```json
{ "toStageId": "cst3", "note": "Documentação liberada pelo cliente." }
```

Efeitos: atualiza `currentStageId` e `stageChangedAt`; grava `completedAt` se a etapa destino tem
`isFinal = true`, ou limpa se estava concluído e saiu de etapa final; cria histórico
`STAGE_CHANGED`; enfileira e-mail para o operacional; emite `process:moved`.
`409 CONFLICT` se `toStageId` for igual à etapa atual.

### `PATCH /processes/:id/responsible`

OPERATIONAL, ADMIN. `{ "responsibleId": "cus9" }` ou `{ "responsibleId": null }` para desatribuir.
O responsável precisa ser usuário ativo OPERATIONAL ou ADMIN, senão `400 VALIDATION_ERROR`.

### `DELETE /processes/:id`

OPERATIONAL, ADMIN. Exclusão lógica. `204`.

### `GET /processes/:id/history`

Trilha paginada em ordem cronológica (`order=asc` por padrão). Mesmo formato de `history` do detalhe.

## Documentos

### `POST /processes/:id/documents`

`multipart/form-data`, campo `files` (aceita múltiplos). Sem restrição de tipo (RF-40); limite de
tamanho por arquivo em `MAX_UPLOAD_SIZE_MB` (padrão 100). Rate limit de upload.

`201`:

```json
{ "data": [ { "id": "cdo7", "originalName": "bl.pdf", "size": 91234, "mimeType": "application/pdf", "uploadedBy": { "id": "cus3", "name": "Maria Silva" }, "source": "WEB", "receivedAt": null, "createdAt": "..." } ] }
```

`source` segue a mesma regra do processo (JWT → `WEB`, chave de API → `API`); `receivedAt` só é
preenchido pelo intake por e-mail.

Gera um histórico `DOCUMENT_ADDED` por arquivo e emite `process:updated`.

### `GET /processes/:id/documents`

Lista os documentos não excluídos do processo.

### `GET /documents/:id/download`

Retorna o binário com `Content-Disposition: attachment; filename*=UTF-8''<nome original>` e
`Content-Type` do mime gravado. Sempre com `X-Content-Type-Options: nosniff`.
Antes de responder, valida escopo de acesso e que o caminho resolvido está dentro de
`STORAGE_ROOT` (RNF-11). Arquivo ausente em disco → `404 NOT_FOUND` com log de erro em nível `error`.

### `DELETE /documents/:id`

OPERATIONAL, ADMIN, ou o CLIENT que enviou o arquivo. Exclusão lógica. `204`.

## Intake (alimentação por IA)

OPERATIONAL e ADMIN — na prática, a chave de API do agente de e-mail (docs/13). Todas as rotas
passam por `apiKeyFailureLimiter` (só respostas 401 contam, por IP; `RATE_LIMIT_API_KEY_FAILURE_*`)
→ `authenticate` → `rateLimitByRole` → `authorize('OPERATIONAL', 'ADMIN')`; **não** passam pelo
limitador de upload (30/10 min, pensado para pessoas) — um agente processando a caixa inteira faria
dezenas de anexos em minutos.

Os dois `POST` aceitam o corpo de duas formas, com a **mesma estrutura**:

| `Content-Type` | Como enviar |
| --- | --- |
| `application/json` | O corpo é o payload. Anexos só via `fetchAttachments: true`. |
| `multipart/form-data` | Campo de texto `payload` com o JSON + campo `files` (múltiplos). Pode combinar com `fetchAttachments`. |

### `POST /intake/processes`

Abre um processo a partir de um e-mail (docs/13, decisões 3 a 5).

```json
{
  "source": { "channel": "EMAIL", "externalId": "AAMkAGI2...", "internetMessageId": "<abc123@mail.clientex.com.br>", "subject": "Abertura IMP-2026-0042", "receivedAt": "2026-09-18T10:32:00.000Z" },
  "requester": { "email": "joao@clientex.com.br", "name": "João" },
  "company": { "document": "12.345.678/0001-90", "name": "Cliente X LTDA" },
  "requestingCompany": null,
  "reference": "IMP-2026-0042",
  "additionalInfo": "Carga com LI pendente. Contato: João (11) 99999-0000.",
  "fetchAttachments": true
}
```

- `source.externalId` é a chave de idempotência (id da mensagem no Graph — o campo `id` bruto que o
  conector devolve, terminado em `=`, não a URI com `%3D`). `channel` só aceita `EMAIL` no v1 e é o
  padrão.
- `source.internetMessageId` (opcional, recomendado): Message-ID RFC 5322 do e-mail. É a **chave
  secundária** de idempotência: o id do Graph muda quando a mensagem é movida de pasta; este não. Se
  um evento com o mesmo `internetMessageId` já existir, a chamada é tratada como duplicata (ou
  retomada, se `FAILED`) mesmo com `externalId` diferente — e o backend também o usa para localizar
  a mensagem no Graph quando o `externalId` não é mais encontrado.
- `company.document` aceita CNPJ ou CPF, com ou sem máscara. Empresa desconhecida é **cadastrada**:
  razão social pela Receita (se `CNPJ_LOOKUP_ENABLED`), senão `company.name`, senão o próprio
  documento; organização pelo domínio de `requester.email` (conhecido → usa; desconhecido → cria e,
  se não for webmail público, registra o domínio com `autoApprove = false`). Se a organização do
  domínio já tinha uma empresa em **cadastro pendente**, o documento conclui esse cadastro em vez de
  criar outra empresa.
- `company` pode ser `null` ou vir **sem `document`** (docs/13, decisão 10 — a maioria dos e-mails
  de cliente recorrente não repete o CNPJ). A empresa é então resolvida pelo **domínio** de
  `requester.email`: uma empresa ativa na organização do domínio → usa; várias → desempate por
  `company.name` contra razão social/nome fantasia, senão `409 COMPANY_AMBIGUOUS` com
  `details.candidates`; nenhuma (organização sem empresa ou domínio corporativo nunca visto) → cria
  a empresa em **cadastro pendente** (`cnpj: null`, nome = `company.name` ou o domínio) e abre o
  processo mesmo assim; webmail público → `400 COMPANY_REQUIRED`.
- `fetchAttachments: true` faz o servidor baixar os anexos da mensagem pelo Graph (`GRAPH_*`).
  Anexos inline (assinaturas) são ignorados; acima de `MAX_UPLOAD_SIZE_MB` são pulados com aviso.

`201` (ou `200` com `duplicate: true` se o `externalId` já foi processado):

```json
{
  "duplicate": false,
  "event": { "id": "cie1", "channel": "EMAIL", "externalId": "AAMkAGI2...", "internetMessageId": "<abc123@mail.clientex.com.br>", "kind": "PROCESS", "status": "COMPLETED", "processId": "cpr9", "result": { "documentIds": ["cdo7"], "warnings": [], "company": { "id": "cco5", "created": true }, "organization": { "id": "clo3", "created": true, "domainRegistered": true } }, "errorMessage": null, "createdAt": "...", "updatedAt": "..." },
  "process": { "...": "mesmo formato de GET /processes/:id, com source = EMAIL" },
  "documents": [ { "id": "cdo7", "originalName": "invoice.pdf", "mimeType": "application/pdf", "size": 91234, "receivedAt": "2026-09-18T10:32:00.000Z", "createdAt": "..." } ],
  "company": { "id": "cco5", "created": true },
  "organization": { "id": "clo3", "created": true, "domainRegistered": true },
  "warnings": [ "Empresa 12.345.678/0001-90 (CLIENTE X LTDA) cadastrada automaticamente.", "Organização \"CLIENTE X LTDA\" criada automaticamente." ]
}
```

`warnings` lista tudo que o agente deve relatar e o ADMIN revisar. Erros: `400 INVALID_CNPJ` /
`INVALID_CPF` / `COMPANY_REQUIRED`, `409 COMPANY_INACTIVE` / `COMPANY_AMBIGUOUS`,
`409 INTAKE_IN_PROGRESS`, `404 MAIL_MESSAGE_NOT_FOUND`, `503 MAIL_ATTACHMENTS_DISABLED` /
`MAIL_ATTACHMENTS_UNAVAILABLE`.

### `POST /intake/attachments`

Anexa documentos e/ou uma nota a um processo existente citado no e-mail (docs/13, decisão 6).

```json
{
  "source": { "externalId": "AAMkAGI3...", "receivedAt": "2026-09-19T08:00:00.000Z" },
  "requester": { "email": "joao@clientex.com.br", "name": "João" },
  "processRef": "Processo 123123",
  "processId": null,
  "note": "Segue o BL conforme solicitado.",
  "fetchAttachments": true
}
```

Resolução de `processRef`: `code` exato (case-insensitive) → `reference` exata → se houver mais
de uma, desempate pela organização do domínio do solicitante → `409 PROCESS_REF_AMBIGUOUS` com
`details.candidates` → nenhum, `404 PROCESS_REF_NOT_FOUND` com até 5 candidatos parciais. Com
`processId` a resolução é pulada. `note` é acrescentada a `additionalInfo` com o carimbo
`--- E-mail de João <joao@clientex.com.br> em 19/09/2026 05:00 ---` e gera `PROCESS_UPDATED`.
Sem arquivos, sem `fetchAttachments` e sem `note` → `400`.

Resposta: mesmo envelope de `POST /intake/processes` (`event.kind = "ATTACHMENT"`,
`company`/`organization` sempre `null`). Uma retentativa do mesmo `externalId` (ou do mesmo
`internetMessageId`) depois de um 404/409 (evento `FAILED`) é aceita e reprocessa — é assim que o
agente responde a um 409 escolhendo um `processId`, ou reclassifica um 404 como processo novo: o
evento passa a refletir a tentativa atual (`kind`, `externalId`).

### `GET /intake/processes/lookup`

Candidatos para o agente conferir antes de decidir entre abrir e complementar. Query: `ref`
(código ou referência), `companyDocument` (filtra pelo CNPJ/CPF cliente), `limit` (padrão 5, máx.
20). Exige `ref` ou `companyDocument`.

```json
{ "matches": [ { "matchedBy": "CODE", "process": { "...": "item de listagem" } }, { "matchedBy": "PARTIAL", "process": { "...": "" } } ] }
```

`matchedBy`: `CODE` (código exato), `REFERENCE` (referência exata), `PARTIAL` (contém).

### `GET /intake/events`

Eventos de intake, mais recentes primeiro. Filtros: `externalId`, `internetMessageId`, `kind`
(`PROCESS | ATTACHMENT | IGNORED | ESCALATED`), `status` (`PROCESSING | COMPLETED | FAILED`),
`processId`, paginação padrão. Serve para o agente checar se uma mensagem já foi processada
(`externalId`) antes de gastar trabalho, listar retentativas pendentes (`status=FAILED`), e para o
operacional auditar o que a IA fez (`kind=ESCALATED` = o que ficou para uma pessoa).

### `GET /intake/cursor`

De onde a próxima execução do agente continua a leitura da pasta de intake (docs/13, decisão 9).
Query: `channel` (padrão `EMAIL`).

```json
{ "channel": "EMAIL", "receivedAt": "2026-09-21T15:33:40.000Z", "event": { "...": "evento com o maior receivedAt entre COMPLETED e FAILED" } }
```

`receivedAt` é o `source.receivedAt` do **último e-mail examinado** — concluído (`COMPLETED`,
inclusive `IGNORED`/`ESCALATED`) ou com tentativa falha (`FAILED`); `null` antes do primeiro.
`PROCESSING` não conta (pode ser uma execução interrompida). A retentativa de `FAILED` não é pelo
cursor, e sim por `GET /intake/events?status=FAILED`.

### `POST /intake/events/skip`

Registra um e-mail examinado que **não** vira processo, para o cursor avançar por ele (docs/13,
decisão 9). Idempotente pelas mesmas chaves dos demais (`externalId`, `internetMessageId`).

```json
{
  "source": { "channel": "EMAIL", "externalId": "AAMkAGI2...", "internetMessageId": "<abc@x.com>", "subject": "Fatura 1234", "receivedAt": "2026-09-21T15:33:40.000Z" },
  "requester": { "email": "faturamento@terminal.com.br", "name": null },
  "outcome": "IGNORED",
  "reason": "Notificação automática de faturamento do terminal."
}
```

`outcome`: `IGNORED` (ruído descartado) ou `ESCALATED` (precisa de uma pessoa). `requester` é
opcional. `201` com `{ duplicate: false, event }` — o evento fica `kind = outcome`,
`status = COMPLETED`, `processId = null` e `result.reason` com o motivo. Regras:

- mensagem já `COMPLETED` (processo criado/complementado ou já pulada) → `200` com
  `duplicate: true` e o evento existente, **sem alterar nada**;
- `FAILED` (ex.: `PROCESS_REF_NOT_FOUND` sem candidato e o agente desistiu) → o evento é concluído
  como `outcome` e sai da lista de retentativas;
- `PROCESSING` → `409 INTAKE_IN_PROGRESS`.

Um e-mail pulado pode ser processado depois (`POST /intake/processes` ou `/attachments` com o mesmo
`externalId`): o evento é reaberto como `PROCESS`/`ATTACHMENT`, não duplicado.

## Dashboard (ADMIN)

### `GET /dashboard/metrics`

Query: `from`, `to` (ISO date, padrão últimos 30 dias), `organizationId?`.

```json
{
  "period": { "from": "2026-07-08", "to": "2026-08-07" },
  "totals": {
    "processes": 137,
    "active": 92,
    "completed": 45,
    "createdInPeriod": 38,
    "completedInPeriod": 31
  },
  "byStage": [
    { "stageId": "cst1", "stageName": "Entrada", "color": "#1677ff", "order": 0, "count": 12 },
    { "stageId": "cst2", "stageName": "Em Andamento", "color": "#faad14", "order": 1, "count": 80 },
    { "stageId": "cst3", "stageName": "Concluído", "color": "#52c41a", "order": 2, "count": 45 }
  ],
  "byCompany": [
    { "companyId": "cco1", "cnpj": "12345678000190", "legalName": "Cliente X Matriz LTDA", "count": 61 }
  ],
  "byOrganization": [
    { "organizationId": "clo1", "name": "Cliente X", "count": 74 }
  ],
  "completionTime": {
    "averageHours": 132.5,
    "medianHours": 96,
    "formatted": "5d 12h",
    "sampleSize": 45
  },
  "averageTimePerStage": [
    { "stageId": "cst1", "stageName": "Entrada", "averageHours": 18.2, "sampleSize": 137 },
    { "stageId": "cst2", "stageName": "Em Andamento", "averageHours": 110.4, "sampleSize": 125 }
  ],
  "throughputByDay": [
    { "date": "2026-08-05", "created": 4, "completed": 2 }
  ]
}
```

`completionTime` usa `completedAt - createdAt` dos processos concluídos no período.
`averageTimePerStage` é derivado de `ProcessHistory`: para cada processo, a diferença entre entradas
consecutivas de `STAGE_CHANGED` (a primeira medida a partir de `createdAt`); a etapa atual de um
processo em aberto não entra na média, para não enviesar com tempo ainda em curso.

## Saúde

| Rota | Descrição |
| --- | --- |
| `GET /health` | `200 { "status": "ok", "uptime": 1234, "version": "1.0.0" }`. Sem dependências externas; é o que o IIS/monitoração consulta. |
| `GET /health/ready` | Verifica SQL Server (`SELECT 1`) e Redis (`PING`). `200` com o estado de cada um, ou `503` se algo estiver fora. |

## Eventos WebSocket

Namespace padrão, autenticação por access token no handshake. Detalhes de sala e autorização no
documento 07.

| Evento | Payload | Emitido em |
| --- | --- | --- |
| `process:created` | `{ process: <item de listagem> }` | `POST /processes` |
| `process:moved` | `{ processId, fromStageId, toStageId, actor: { id, name }, at }` | `PATCH /processes/:id/stage` |
| `process:updated` | `{ processId }` | `PATCH /processes/:id`, upload/exclusão de documento, troca de responsável |
| `process:deleted` | `{ processId }` | `DELETE /processes/:id` |
| `stages:changed` | `{}` | qualquer escrita em `/stages` |
