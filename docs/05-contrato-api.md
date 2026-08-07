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
| 400 | `INVALID_CNPJ` | CNPJ com dígitos verificadores inválidos. |
| 401 | `UNAUTHENTICATED` | Sem token, token expirado ou inválido. |
| 401 | `INVALID_CREDENTIALS` | E-mail ou senha incorretos. |
| 403 | `FORBIDDEN` | Autenticado, porém sem papel/permissão para a ação. |
| 403 | `ACCOUNT_PENDING` | Conta aguardando aprovação de ADMIN. |
| 403 | `ACCOUNT_DISABLED` | Conta desativada ou rejeitada. |
| 404 | `NOT_FOUND` | Recurso inexistente **ou** fora do escopo de acesso (ver RNF-01). |
| 409 | `CONFLICT` | Violação de unicidade ou de regra de estado. |
| 409 | `STAGE_NOT_EMPTY` | Exclusão de etapa que ainda contém processos ativos. |
| 413 | `PAYLOAD_TOO_LARGE` | Upload acima de `MAX_UPLOAD_SIZE_MB`. |
| 429 | `RATE_LIMIT_EXCEEDED` | Limite atingido. Header `Retry-After` presente. |
| 500 | `INTERNAL_ERROR` | Falha não prevista. Nunca expõe stack trace. |

> **Por que 404 e não 403 fora do escopo:** responder 403 confirmaria a existência de um processo de
> outro cliente. Para recursos de outra Organization a API responde 404.

## Autenticação

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
| `GET` | `/companies` | Filtros: `q` (razão social, nome fantasia ou CNPJ), `organizationId`, `isActive`. CLIENT recebe apenas os CNPJs do seu escopo. |
| `POST` | `/companies` | `{ cnpj, legalName, tradeName?, organizationId }` |
| `GET` | `/companies/:id` | Detalhe. |
| `PATCH` | `/companies/:id` | `{ legalName?, tradeName?, isActive?, organizationId? }` |
| `DELETE` | `/companies/:id` | `409 CONFLICT` se houver processos. |

O CNPJ é aceito com ou sem máscara e persistido apenas com dígitos.

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
  "stageChangedAt": "2026-08-05T12:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-08-01T09:15:00.000Z",
  "updatedAt": "2026-08-05T12:00:00.000Z",
  "documents": [
    {
      "id": "cdo1", "originalName": "invoice.pdf", "mimeType": "application/pdf",
      "size": 184320, "uploadedBy": { "id": "cus3", "name": "Maria Silva" },
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
{ "data": [ { "id": "cdo7", "originalName": "bl.pdf", "size": 91234, "mimeType": "application/pdf", "createdAt": "..." } ] }
```

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
