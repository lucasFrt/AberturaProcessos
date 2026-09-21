# CLAUDE.md

Contexto para agentes de IA (Claude, Kiro, etc.) trabalhando neste repositório. Leia isto antes de
qualquer alteração — a maior parte das decisões de arquitetura já está tomada e documentada; o
trabalho é implementar seguindo o que já existe, não redesenhar.

## O que é este projeto

Sistema interno de abertura e acompanhamento de processos de comércio exterior para uma empresa de
trading/despachante aduaneiro. Formulário de entrada → funil Kanban configurável → dashboard
gerencial. Multi-tenant por organização (domínio de e-mail agrupa CNPJs). Backend (BFF) em
TypeScript/Express, frontend em React, ambos em `backend/` e `frontend/` na raiz.

**A alimentação do sistema é feita por IA** (docs/13): um agente (Claude Haiku 4.5 em tarefa
agendada com conector de Outlook) lê a caixa de e-mail e abre/complementa processos pela API de
intake (`/intake/*`), autenticado por chave de API (`X-Api-Key`). O pacote `mcp-server/` expõe
esse intake como ferramentas MCP; o prompt do agente está em `docs/prompts/agente-email-haiku.md`.
O operacional continua consultando e movimentando o funil pelo front.

## Antes de escrever qualquer código

1. **Leia `docs/README.md`** — índice de toda a documentação, com o que cada arquivo cobre.
2. **Leia `docs/12-plano-de-tarefas.md`** — as 22 tarefas do projeto, em ordem, cada uma com
   critério de aceite explícito. Trabalhe uma tarefa por vez, na ordem, salvo instrução contrária.
3. Antes de implementar a tarefa N, leia os documentos que ela referencia (campo **Refs** de cada
   tarefa). Normalmente são 2-3 documentos específicos, não todos os 13.
4. Confira o estado atual: rode `git log --oneline` e veja quais tarefas já têm commit. O progresso
   real está no histórico do git, não em memória de conversas anteriores nem na seção "Estado do
   projeto" abaixo (que também pode ficar desatualizada — trate como indício, não como fonte da
   verdade).
5. Ao final de cada tarefa, confira o checklist **Definition of Done** no fim de
   `docs/12-plano-de-tarefas.md` antes de considerá-la concluída.

## Documentação (docs/)

| Arquivo | Quando consultar |
| --- | --- |
| `01-visao-geral.md` | Entender o domínio, glossário, decisões de stack e por quê |
| `02-requisitos.md` | Requisitos funcionais (RF-x), não funcionais (RNF-x), matriz de permissões |
| `03-arquitetura.md` | Camadas MVC, injeção de dependência, estrutura de pastas, fluxo de uma requisição |
| `04-modelo-de-dados.md` | Schema Prisma completo, limitações do SQL Server, regras de exclusão |
| `05-contrato-api.md` | Toda rota, payload, código de erro — fonte da verdade do contrato HTTP |
| `06-autenticacao-autorizacao.md` | JWT, OAuth, provisionamento por domínio, rate limiting, escopo de acesso |
| `07-filas-notificacoes-realtime.md` | BullMQ, Redis, e-mail, Socket.IO |
| `08-frontend.md` | Estrutura React, estado, componentes, telas |
| `09-padroes-de-codigo-e-testes.md` | SOLID aplicado, convenções de nome, estratégia de testes |
| `10-ambiente-e-configuracao.md` | Variáveis de ambiente, docker-compose, setup local |
| `11-deploy-windows-server.md` | IIS, NSSM, produção |
| `12-plano-de-tarefas.md` | **Comece aqui.** As 22 tarefas do núcleo + Fase 7 (alimentação por IA). |
| `13-integracao-ia-email.md` | Alimentação por IA: chaves de API, intake idempotente, anexos via Graph, cadastro automático, MCP |

Ao mudar comportamento de contrato (rota, payload, schema), atualize o documento correspondente
**antes** ou **junto** da implementação — os docs são a fonte da verdade, não um artefato descartável.

## Regras de arquitetura (não negociáveis)

- **Camadas**: Routes → Middlewares → Controllers → Services → Repositories (interface no domínio,
  implementação Prisma em `infra/`). Controllers não têm regra de negócio; services não conhecem
  Express nem Prisma diretamente.
- **Nenhum arquivo em `src/services/` ou `src/domain/` importa `@prisma/client`, `express`, ou
  qualquer coisa de `infra/prisma`, `infra/queue`, `infra/mail`, `infra/storage`, `infra/realtime`,
  `infra/cnpj`, `infra/graph`.**
  Isso é reforçado por `no-restricted-imports` no `eslint.config.js` do backend — se o lint falhar
  com esse erro, o código está na camada errada, não é para suprimir a regra.
- **AccessScope obrigatório**: todo método de leitura de repositório que toca em dados
  multi-tenant recebe `AccessScope` (`{ kind: 'ALL' }` ou `{ kind: 'COMPANIES', companyIds }`) e o
  aplica na query. Nunca confiar apenas em filtro na UI.
- **Presenters nunca espalham a entidade** (`...user`). Montam o DTO campo a campo — é o que
  impede `passwordHash` e outros campos sensíveis de vazar para o cliente.
- **Injeção de dependência manual** via `src/container.ts`. Sem decorators, sem
  tsyringe/inversify. Serviço novo → adicionar a composição em `buildContainer`.
- **Erros de domínio** lançam `AppError` (ou subclasse: `NotFoundError`, `ConflictError`,
  `ForbiddenError`, `UnauthenticatedError`, `ValidationError`) de `src/domain/errors/app-error.ts`.
  O `errorHandler` central converte para o envelope de `docs/05-contrato-api.md`.
- **Sem `enum` do Prisma** (SQL Server + Prisma não suporta). "Enums" são uniões de string em
  `src/domain/enums/index.ts`, com `CHECK constraint` espelhada em migration manual.
- **`Container` em `src/container.ts` é construído uma vez** (`buildContainer(prisma)`) e monta
  todos os repositórios, services e controllers por injeção manual de construtor. Serviço novo →
  adicionar a composição ali, seguindo a ordem: repositórios → providers de infra → services →
  controllers.
- **`realtimeProvider` é um `DeferredRealtimeProvider`**, não o `SocketIoProvider` direto — o
  socket precisa do `http.Server`, que só existe depois de `app.listen()`, ou seja, depois que o
  container já foi montado. `http/server.ts` chama `.attach(...)` nele assim que o servidor sobe.
  Em teste de integração nada é anexado; o delegate interno fica no-op. Não replicar esse padrão
  para `queueProvider` ou outros providers — é específico do Socket.IO.

## Backend — camadas em detalhe (`backend/src/`)

```
domain/       entidades, interfaces de repositório/provider, erros, enums (união de string)
services/     regra de negócio, um arquivo por serviço, dependências por construtor
http/
  controllers/  traduzem request/response, sem regra de negócio
  routes/       registram controller + authenticate + authorize + validate
  schemas/      validação Zod dos payloads
  presenters/   montam o DTO de resposta campo a campo (nunca `...entity`)
  middlewares/  authenticate, authorize, validate, upload, rate-limit, error-handler, request-context
infra/        implementações concretas: prisma/, queue/ (BullMQ), mail/, realtime/ (Socket.IO),
              storage/ (disco local), security/ (bcrypt, JWT, chave de API), cnpj/ (ReceitaWS),
              graph/ (anexos de e-mail via Microsoft Graph, client credentials)
passport/     estratégias OAuth (Google, Microsoft), registradas condicionalmente por credencial
workers/      processo separado (`npm run dev:worker`), consome fila de e-mail
container.ts  composição manual de dependências (ver acima)
```

## Intake por IA (`backend/src/services/intake-service.ts`, docs/13)

- **`authenticate` aceita `X-Api-Key` além do JWT.** A chave resolve para o usuário interno
  vinculado (`ApiKey.userId`); `req.auth.authKind` diz qual credencial foi usada e é o que define
  `Process.source`/`Document.source` (JWT → `WEB`, chave → `API`, rota de intake → `EMAIL`).
  `source` nunca vem do payload.
- **Idempotência por `IntakeEvent (channel, externalId)`** com claim `PROCESSING` → `COMPLETED`
  | `FAILED`. Duplicata responde 200 `duplicate: true`; `FAILED` é retomado (reaproveita
  `processId` se já existia). Não "otimizar" o claim para find-then-create — a unicidade é do
  banco de propósito (execuções concorrentes do agente).
- **Anexos são baixados antes de qualquer escrita** (`MailAttachmentProvider`), para uma falha do
  Graph não deixar processo sem documento. `GRAPH_INTAKE_ENABLED=false` → `503
  MAIL_ATTACHMENTS_DISABLED`; o multipart (`payload` + `files`) continua funcionando e é o que a
  suíte usa.
- **Empresa desconhecida é cadastrada, não rejeitada** (docs/13, decisão 5). Domínio de webmail
  público nunca vira `EmailDomain`; domínio corporativo novo entra com `autoApprove = false`.
- **Sem CNPJ no e-mail, a empresa vem do domínio do remetente** e, se não existir, nasce em
  **cadastro pendente** (`companies.cnpj = NULL`, docs/13 decisão 10). `cnpj` é anulável **sem
  `@unique`** no schema: a unicidade é um índice filtrado em migration manual (docs/04,
  "Limitações"). Não reintroduzir `@unique` — o Prisma acusaria drift e recriaria a constraint.
- **A caixa é lida pelo servidor** (`GET /intake/mailbox/messages` + `/:id`, Graph app-only, o
  mesmo provider dos anexos — `MailboxReader` no domínio), não pelo conector: lista enxuta desde
  `after`, remetentes de `exclude` descartados no servidor (a lista mora no prompt), corpo em
  texto sem histórico citado. A rotina grava `PUT /intake/cursor` com o `nextAfter` de cada página
  (ponteiro por canal em `intake_cursors`, só anda para a frente). O que a IA leu e não processou
  vira `IntakeEvent` `IGNORED`/`ESCALATED` via `POST /intake/events/skip`, com o motivo (docs/13,
  decisão 9). A retentativa de `FAILED` é pela lista `status=FAILED`, não pelo cursor. Nada de
  pasta, regra ou categoria no Outlook — a caixa em uso não é tocada.
- **Documento de embarque de qualquer remetente externo vai para o processo que já existe** (docs/13,
  decisão 11): `addReferences` em `/intake/attachments` acrescenta identificadores à `reference`.
  Um processo = um embarque = um BL; processo só nasce a pedido do cliente — documento sem processo
  vira `IGNORED` com motivo `sem processo para ...` (bloco próprio no relatório), nunca cria.
  `company.senderIsClient=false` (cliente pelo nome citado, pendente sem domínio) existe na API mas
  o prompt não o usa.
- **`/intake/*` não passa pelo `uploadLimiter`** (30/10 min é para pessoas); usa o limite
  interno de `rateLimitByRole`.
- `mcp-server/` é um pacote separado (ESM, `@modelcontextprotocol/sdk`), sem regra de negócio:
  só traduz ferramentas em chamadas a `/intake/*`. `npm test` ali sobe o servidor por stdio.

## Frontend — estrutura em detalhe (`frontend/src/`)

Vite + React 19 + TypeScript, Ant Design (`antd`) para componentes, TanStack Query para estado de
servidor, Zustand (sem persistência) só para sessão de auth, React Hook Form + Zod para formulários,
`@hello-pangea/dnd` para o board, Socket.IO client para tempo real, `axios` para HTTP.

```
app/            providers (QueryClient, Socket), router, bootstrap
features/<x>/   um domínio por pasta: api/ (chamadas HTTP), hooks/ (TanStack Query), pages/,
                components/ — não misturar chamada HTTP direta em componente
shared/
  api/          http-client (axios com interceptors de refresh) e tradução de erro por `code`
  components/   RequireAuth, RequireRole, Can, AppLayout, EmptyState, ErrorBoundary
  hooks/        usePermissions, useSocketStatus, useDebounce
  lib/          formatação, validação de CNPJ
```

- **Permissão nunca é decidida no front.** `usePermissions`/`<Can>` só espelham o array
  `permissions` que a API já calculou e devolveu (ver `process-permissions.ts` no backend e
  `docs/06`). Esconder um botão é UX; a autorização real está no controller/service.
- Arquivos de componente em `PascalCase.tsx`, hooks em `camelCase.ts` com prefixo `use`, o resto em
  `kebab-case.ts` — convenção do documento 09, mesma do backend para não-componentes.
- **Não há testes automatizados no frontend hoje** (`frontend/src/` não tem nenhum arquivo
  `*.test.*`), apesar de `docs/09-padroes-de-codigo-e-testes.md` descrever Vitest + Testing
  Library como padrão pretendido. Se for pedido para escrever teste de frontend, será necessário
  primeiro instalar e configurar Vitest — não existe suíte prévia para seguir de exemplo.

## Convenções de código

- TypeScript strict, sem `any`, sem `as` para contornar erro de tipo (usar type guard ou parse).
- Retorno de função pública sempre anotado explicitamente (regra de lint, gera warning se faltar).
- Arquivos do backend em `kebab-case` (`auth-service.ts`), classes em `PascalCase` sem prefixo `I`.
- Comentário explica **por quê**, não **o quê**. Comentários no código citam o documento relevante
  (ex.: `// docs/06, seção "Rotação e detecção de reuso"`) quando a decisão não é óbvia sozinha.
- Convenções de commit estão na seção **Git** abaixo.

## Testes

- Jest (`--runInBand`, nunca `--watch` em execução automatizada). `tests/unit/` usa fakes em
  memória (`tests/helpers/fakes/`) — nunca sobe banco nem Redis. `tests/integration/` usa
  Supertest contra o app real e o banco de teste real (`abertura_processos_test`, configurado em
  `backend/.env.test`). Usa `truncateAll` + `seedBaseline` (`tests/helpers/`) antes de cada teste.
- Toda tarefa nova exige: testes unitários do service (fakes) + testes de integração dos endpoints
  novos (Supertest). Não é opcional — está no critério de aceite de cada tarefa do documento 12.
- Os 14 fluxos de integração obrigatórios e os limites de cobertura por pasta estão em
  `docs/09-padroes-de-codigo-e-testes.md` (seção "Testes") e espelhados em `backend/jest.config.js`.
- **Frontend não tem suíte de testes configurada** (nenhum `*.test.*` em `frontend/src/`), apesar
  de o documento 09 descrever Vitest + Testing Library como padrão pretendido. Não presumir que
  existe uma suíte para seguir de exemplo.
- **O banco de teste precisa estar migrado** antes de `npm test` (a suíte não aplica migrations):
  `npm run prisma:deploy:test` de dentro de `backend/`, depois de cada migration nova.
- Comandos, de dentro de `backend/`:
  ```powershell
  npm test                 # suíte completa (unit + integration), --runInBand
  npx jest tests/unit       # só unitários
  npx jest tests/integration # só integração (precisa do banco de teste rodando e migrado)
  npm run test:coverage    # com relatório de cobertura em backend/coverage/
  ```
- Rodar antes de considerar uma tarefa concluída, de dentro de `backend/` (e `frontend/` quando a
  tarefa tocar o front): `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` — todos
  devem passar sem erro. Da raiz, `npm run lint` e `npm run typecheck` cobrem os dois projetos de
  uma vez; `npm test` na raiz só roda o backend.

## Git

- Commits em Conventional Commits, escopo pelo domínio afetado: `feat(auth): ...`,
  `feat(processos): ...`, `fix(dashboard): ...`, `docs(...)`. Ver `git log --oneline` para o
  padrão real seguido até aqui (um commit por tarefa, normalmente).
- Pre-commit (Husky + lint-staged, `.husky/pre-commit`) roda `eslint --fix` e `prettier --write`
  nos arquivos alterados. Não pular com `--no-verify` sem pedido explícito.
- `docs/prompts/` guarda prompts prontos usados para delegar tarefas específicas a uma IA (ex.:
  `tarefa-05-prompt.md`). Não é obrigatório para trabalhar no projeto, mas é o formato a seguir se
  for pedido para gerar um prompt de delegação de uma tarefa nova.

## Ambiente local

- `docker-compose.yml` na raiz sobe SQL Server, Redis e Mailpit. **Portas não são as padrão**:
  SQL Server em `1434` (host) → `1433` (container), Redis em `6380` → `6379`. Isso porque a máquina
  de desenvolvimento já tinha um SQL Server nativo na 1433 e um Redis de outro projeto na 6379 — não
  mude essas portas sem necessidade real, e nunca toque em containers que não tenham o prefixo `ap-`.
- `backend/.env` (não versionado) tem os segredos reais; `backend/.env.example` é o template
  versionado. Mesma relação para `.env.test` / `.env.test.example`.
- Comandos frequentes, todos de dentro de `backend/`:
  ```powershell
  npm run dev              # API em :3000, prefixo /api/v1
  npm run seed             # idempotente: org interna, admin, etapas do Kanban
  npm run prisma:migrate   # nova migration
  npm run prisma:studio    # GUI do banco
  npm test                 # suíte completa
  ```

## Decisões técnicas que desviam do que os documentos pressupõem

O ambiente de desenvolvimento vem com versões mais novas do que os documentos (escritos antes de
verificar as versões reais) assumiam. Onde isso importou, a decisão já foi tomada — não reabra:

- **Prisma fixado em `6.19.3`** (exato, sem `^`). O Prisma 7 (que vem por padrão em instalação nova)
  exige migração para ESM e driver adapters obrigatórios — mudança arquitetural grande que quebraria
  compatibilidade com o resto do backend em CommonJS. Não atualizar para Prisma 7 sem decisão
  explícita do usuário.
- **`z.coerce.boolean()` do Zod não é usado** para variáveis de ambiente booleanas. Ele converte
  qualquer string não vazia (incluindo `"false"`) para `true`. Use o padrão em
  `backend/src/config/env.ts` (`booleanFromEnv`) para qualquer nova variável booleana.
- **TypeScript 6** veio instalado; `baseUrl` sem `paths` relativos causa erro de depreciação — os
  `tsconfig.json` já usam `paths: { "@/*": ["./src/*"] }` sem `baseUrl`. Siga o padrão existente.
- **CORS sempre com lista explícita de origens** (`CORS_ORIGINS` no env), nunca `origin: '*'` — a
  API usa cookies (`credentials: true`), e as duas coisas juntas são inseguras.
- **Nomes de arquivo do backend não seguem o exemplo literal do documento 09.** O documento mostra
  `process.service.ts` / `authenticate.middleware.ts` (ponto antes do sufixo), mas o código real
  usa hífen e frequentemente omite o sufixo de papel: `process-service.ts`,
  `authenticate.ts` (sem `-middleware`). Siga o padrão dos arquivos existentes na mesma pasta, não
  o exemplo do documento.

## Estado do projeto

As 22 tarefas do núcleo e a Fase 7 (Tarefas 23–28, alimentação por IA — chaves de API,
origem/solicitante/CPF, intake idempotente por e-mail com anexos via Graph, MCP server + prompts,
cursor gravado e empresa pelo domínio/cadastro pendente, caixa lida pelo servidor e documentos de
qualquer parceiro) estão concluídas.
A API está publicada em `https://processos.opusce.com.br` (Windows Server, docs/11, scripts em
`deploy/`), o app do Entra ID tem RBAC for Applications `Application Mail.Read` restrito à caixa
`opusoperacional@opusce.com.br` (docs/13, "Configuração"), e a rotina agendada do Claude Code
(plano Max, Haiku 4.5, `docs/prompts/rotina-intake-claude-max.md`) existe em
claude.ai/code/routines. O que depende de gente: completar os cadastros pendentes na tela de
empresas e manter a lista de remetentes bloqueados do prompt.

Backend completo (auth local/social, rate limiting,
admin, kanban, processos com escopo/movimentação/auditoria, documentos, fila de e-mail, tempo
real, dashboard) e frontend completo (scaffolding/rotas/auth, formulário de abertura, board
Kanban com drag-and-drop, tempo real, gaveta de detalhe, telas de admin por papel, dashboard
gerencial). Suíte de testes do backend com os 14 fluxos de integração do documento 09, teste de
arquitetura, teste de consistência enum/CHECK constraint e limites de cobertura configurados.

O checklist de deploy do documento 11 pressupõe Windows Server + IIS reais, que não existem nesta
sessão de desenvolvimento — só os itens verificáveis sem essa infraestrutura (health checks,
build de produção, variáveis de ambiente) foram confirmados. O restante (IIS/ARR, NSSM, SSL,
firewall) precisa ser validado em homologação real antes de ir para produção.

Esta seção é um resumo pontual e **fica desatualizada com o tempo** — confirme sempre com
`git log --oneline` e, se preciso, com o estado real de `frontend/src/` (sem testes ainda, ver
seção Testes) antes de assumir que algo está pronto. Repositório remoto:
`https://github.com/lucasFrt/AberturaProcessos` (privado).
