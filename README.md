# Abertura de Processos

Sistema interno de abertura e acompanhamento de processos de comércio exterior para uma empresa
de trading/despachante aduaneiro. Um formulário de entrada alimenta um funil Kanban configurável
por etapas, com controle de acesso multi-organização (o domínio de e-mail do usuário agrupa CNPJs
sob uma organização), notificações por e-mail assíncronas, atualização em tempo real via
WebSocket e um dashboard gerencial com métricas de volume e tempo de conclusão.

O backend é um BFF (Backend for Frontend) em Express/TypeScript sobre SQL Server via Prisma, com
BullMQ/Redis para filas de e-mail e Socket.IO para tempo real. O frontend é uma SPA em React com
Ant Design, TanStack Query para estado de servidor e drag-and-drop no board Kanban.

## Estrutura do repositório

```
AberturaProcessos/
├── docs/          # documentação completa: requisitos, arquitetura, contrato de API, deploy etc.
├── backend/       # BFF: Express + TypeScript + Prisma + SQL Server + BullMQ + Socket.IO
└── frontend/      # SPA: React + TypeScript + Vite + Ant Design + TanStack Query
```

## Stack tecnológica

**Backend:** Node.js 20, Express 5, TypeScript (strict), Prisma 6 (provider `sqlserver`), SQL
Server 2022, Redis + BullMQ (fila de e-mail), Socket.IO (tempo real), Passport (login local +
OAuth Google/Microsoft), Zod (validação), Pino (logs), Jest + Supertest (testes).

**Frontend:** React 19, TypeScript, Vite, Ant Design, TanStack Query, React Hook Form + Zod,
Zustand (sessão de auth), `@hello-pangea/dnd` (drag-and-drop do board), Socket.IO client, Recharts
(dashboard).

## Documentação

Toda a especificação do projeto está em [`docs/`](./docs/README.md) — visão geral e glossário,
requisitos funcionais/não funcionais, arquitetura em camadas, modelo de dados, contrato de API
completo, autenticação/autorização, filas e tempo real, estrutura do frontend, padrões de código e
testes, ambiente local e deploy em produção. O plano de execução incremental (22 tarefas, cada uma
com critério de aceite) está em
[`docs/12-plano-de-tarefas.md`](./docs/12-plano-de-tarefas.md).

## Status do projeto

As 22 tarefas do plano estão concluídas:

- **Backend completo:** autenticação local e OAuth (Google/Microsoft) com provisionamento por
  domínio, rate limiting por escopo, cadastros de organizações/empresas/usuários, Kanban
  configurável, CRUD de processos com escopo de acesso multi-tenant, documentos (upload/download
  com storage local), notificação por e-mail via fila, eventos em tempo real via Socket.IO e
  métricas agregadas de dashboard.
- **Frontend completo:** scaffolding com autenticação e rotas por papel, formulário de abertura de
  processo, board Kanban com drag-and-drop, tempo real, gaveta de detalhe do processo, telas de
  administração por papel e dashboard gerencial.
- **Suíte de testes:** os 14 fluxos de integração exigidos pelo documento 09 (incluindo teste de
  arquitetura e consistência entre `domain/enums` e as `CHECK constraints` do banco) e os limites
  de cobertura configurados em `backend/jest.config.js`.

O frontend não tem suíte de testes automatizada (decisão registrada nas tarefas anteriores — ver
`CLAUDE.md`). O checklist de deploy do documento 11 pressupõe um Windows Server + IIS reais; os
itens executáveis sem essa infraestrutura (health checks, build de produção, variáveis de ambiente)
foram verificados — o restante (IIS, NSSM, SSL) precisa ser validado em homologação real.

## Setup local

Pré-requisitos: Node.js 20 LTS, Docker Desktop, Git. Não é necessário instalar SQL Server nem
Redis na máquina — ambos sobem via Docker Compose. Detalhes completos (incluindo o SQL do
docker-compose.yml) estão em
[`docs/10-ambiente-e-configuracao.md`](./docs/10-ambiente-e-configuracao.md); o resumo abaixo é
suficiente para subir o ambiente do zero.

### 1. Suba a infraestrutura local

```powershell
docker compose up -d
```

Isso inicia três containers: `ap-sqlserver` (SQL Server 2022, porta `1434` no host → `1433` no
container), `ap-redis` (porta `6380` → `6379`) e `ap-mailpit` (SMTP em `1025`, interface web em
`8025`). As portas não-padrão evitam conflito com instâncias nativas que já possam existir na
máquina de desenvolvimento.

Depois do primeiro `up`, crie os bancos (a imagem do SQL Server não os cria automaticamente):

```powershell
docker exec -it ap-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Dev@Str0ngPass!" -C -Q "CREATE DATABASE abertura_processos; CREATE DATABASE abertura_processos_test;"
```

### 2. Configure e prepare o backend

```powershell
cd backend
npm install
copy .env.example .env
copy .env.test.example .env.test
npx prisma migrate deploy
npm run prisma:deploy:test   # banco de teste (necessário para `npm test`)
npm run seed
```

O seed é idempotente: cria a organização interna, o domínio de e-mail reconhecido, um usuário
admin e as etapas padrão do Kanban (credenciais em `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` no
`.env`).

### 3. Configure o frontend

```powershell
cd ../frontend
npm install
```

O frontend não precisa de `.env` próprio para desenvolvimento local (aponta para
`http://localhost:3000` por padrão — ver `docs/08-frontend.md` se precisar customizar).

### 4. Rode os três processos

Em três terminais separados, a partir das respectivas pastas:

```powershell
# backend/ — API em http://localhost:3000, prefixo /api/v1
npm run dev

# backend/ — worker de e-mail (processa a fila BullMQ)
npm run dev:worker

# frontend/ — SPA em http://localhost:5173
npm run dev
```

Acesse `http://localhost:5173` e entre com as credenciais do seed. E-mails enviados em
desenvolvimento aparecem em `http://localhost:8025` (Mailpit), nunca saem da máquina.

## Scripts principais

**Raiz** (roda o comando equivalente nos dois projetos, quando aplicável):

```powershell
npm run lint        # eslint em backend e frontend
npm run typecheck    # tsc --noEmit em backend e frontend
npm test            # suíte completa do backend
```

**`backend/`:**

```powershell
npm run dev              # API com reload automático (tsx watch)
npm run dev:worker       # worker de e-mail, processo separado
npm run build            # compila para dist/ (inclui reescrita de path aliases)
npm run lint / lint:fix
npm run typecheck
npm test                 # suíte completa (unit + integration), --runInBand
npm run test:coverage    # com relatório de cobertura em backend/coverage/
npm run seed              # idempotente
npm run prisma:migrate    # nova migration em desenvolvimento
npm run prisma:deploy     # aplica migrations existentes (produção/CI)
npm run prisma:studio     # GUI do banco
```

**`frontend/`:**

```powershell
npm run dev        # servidor Vite com HMR
npm run build       # typecheck + build de produção em dist/
npm run preview     # serve o build de produção localmente
npm run lint / lint:fix
npm run typecheck
```

Um hook de pre-commit (Husky + lint-staged) roda `eslint --fix` e `prettier --write` nos arquivos
alterados antes de cada commit.

## Testes

O backend usa Jest: `tests/unit/` com fakes em memória (sem banco nem Redis) e
`tests/integration/` com Supertest contra o app real e um banco de teste dedicado
(`abertura_processos_test`, requer os containers Docker ativos). Os limites de cobertura por área
(global, `src/services/`, `src/http/middlewares/`) estão documentados em
[`docs/09-padroes-de-codigo-e-testes.md`](./docs/09-padroes-de-codigo-e-testes.md) e configurados
em `backend/jest.config.js`. O frontend não tem suíte automatizada nesta versão do projeto.

## Deploy

O processo completo de deploy em Windows Server 2022 (IIS como reverse proxy, NSSM como gerenciador
de serviço, SQL Server local, Redis via Docker) está documentado em
[`docs/11-deploy-windows-server.md`](./docs/11-deploy-windows-server.md), incluindo o checklist de
verificação pós-deploy.
