# CLAUDE.md

Contexto para agentes de IA (Claude, Kiro, etc.) trabalhando neste repositório. Leia isto antes de
qualquer alteração — a maior parte das decisões de arquitetura já está tomada e documentada; o
trabalho é implementar seguindo o que já existe, não redesenhar.

## O que é este projeto

Sistema interno de abertura e acompanhamento de processos de comércio exterior para uma empresa de
trading/despachante aduaneiro. Formulário de entrada → funil Kanban configurável → dashboard
gerencial. Multi-tenant por organização (domínio de e-mail agrupa CNPJs). Backend (BFF) em
TypeScript/Express, frontend em React, ambos em `backend/` e `frontend/` na raiz.

## Antes de escrever qualquer código

1. **Leia `docs/README.md`** — índice de toda a documentação, com o que cada arquivo cobre.
2. **Leia `docs/12-plano-de-tarefas.md`** — as 22 tarefas do projeto, em ordem, cada uma com
   critério de aceite explícito. Trabalhe uma tarefa por vez, na ordem, salvo instrução contrária.
3. Antes de implementar a tarefa N, leia os documentos que ela referencia (campo **Refs** de cada
   tarefa). Normalmente são 2-3 documentos específicos, não todos os 13.
4. Confira o estado atual: rode `git log --oneline` e veja quais tarefas já têm commit. O progresso
   real está no histórico do git, não em memória de conversas anteriores.

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
| `12-plano-de-tarefas.md` | **Comece aqui.** As 22 tarefas em ordem. |

Ao mudar comportamento de contrato (rota, payload, schema), atualize o documento correspondente
**antes** ou **junto** da implementação — os docs são a fonte da verdade, não um artefato descartável.

## Regras de arquitetura (não negociáveis)

- **Camadas**: Routes → Middlewares → Controllers → Services → Repositories (interface no domínio,
  implementação Prisma em `infra/`). Controllers não têm regra de negócio; services não conhecem
  Express nem Prisma diretamente.
- **Nenhum arquivo em `src/services/` ou `src/domain/` importa `@prisma/client`, `express`, ou
  qualquer coisa de `infra/prisma`, `infra/queue`, `infra/mail`, `infra/storage`, `infra/realtime`.**
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

## Convenções de código

- TypeScript strict, sem `any`, sem `as` para contornar erro de tipo (usar type guard ou parse).
- Retorno de função pública sempre anotado explicitamente (regra de lint, gera warning se faltar).
- Arquivos do backend em `kebab-case` (`auth-service.ts`), classes em `PascalCase` sem prefixo `I`.
- Commits em Conventional Commits (`feat(auth): ...`, `fix(...)`, `docs(...)`).
- Comentário explica **por quê**, não **o quê**. Comentários no código citam o documento relevante
  (ex.: `// docs/06, seção "Rotação e detecção de reuso"`) quando a decisão não é óbvia sozinha.

## Testes

- Jest. `tests/unit/` usa fakes em memória (`tests/helpers/fakes/`) — nunca sobe banco nem Redis.
- `tests/integration/` usa Supertest contra o app real e o banco de teste real
  (`abertura_processos_test`). Usa `truncateAll` + `seedBaseline` (`tests/helpers/`) antes de cada
  teste.
- Toda tarefa nova exige: testes unitários do service (fakes) + testes de integração dos endpoints
  novos (Supertest). Não é opcional — está no critério de aceite de cada tarefa do documento 12.
- Rodar antes de considerar uma tarefa concluída: `npm run lint`, `npm run typecheck`, `npm run
  build`, `npm test` — todos devem passar sem erro.

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

## Estado do projeto

Tarefas 1-6 do plano concluídas (scaffolding, infra local + schema Prisma, esqueleto MVC, auth local
+ JWT, login social/provisionamento por domínio, rate limiting). Ver `git log --oneline` para o
histórico exato de commits e `docs/12-plano-de-tarefas.md` para o que falta. Repositório remoto:
`https://github.com/lucasFrt/AberturaProcessos` (privado).
