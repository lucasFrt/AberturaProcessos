# Abertura de Processos

Sistema interno para abertura e acompanhamento de processos de comércio exterior (modelo
trading/despachante), com formulário de entrada, funil Kanban configurável, controle de acesso
multi-organização, notificações por e-mail e dashboard gerencial.

## Estrutura do repositório

```
AberturaProcessos/
├── docs/          # documentação de requisitos, arquitetura, contrato de API, deploy etc.
├── backend/       # BFF: Express + TypeScript + Prisma + SQL Server
└── frontend/      # React + TypeScript + Vite
```

## Documentação

Toda a especificação do projeto está em [`docs/`](./docs/README.md): visão geral, requisitos,
arquitetura, modelo de dados, contrato de API, autenticação, filas/tempo real, frontend, padrões de
código e testes, ambiente local e deploy em produção. O plano de execução incremental está em
[`docs/12-plano-de-tarefas.md`](./docs/12-plano-de-tarefas.md).

## Status

Scaffolding inicial (Tarefa 1 do plano) concluído: estrutura de backend e frontend criadas, com
lint, typecheck, build e testes configurados. Demais funcionalidades em desenvolvimento — ver o
plano de tarefas para o progresso detalhado.

## Setup local

Ver [`docs/10-ambiente-e-configuracao.md`](./docs/10-ambiente-e-configuracao.md) para o passo a
passo completo (Docker Compose, variáveis de ambiente, migrations, seed).

Resumo rápido:

```powershell
# Backend
cd backend
npm install
npm run dev

# Frontend (outro terminal)
cd frontend
npm install
npm run dev
```

## Scripts da raiz

```powershell
npm run lint       # lint em backend e frontend
npm run typecheck   # typecheck em backend e frontend
npm test           # testes do backend
```

Um hook de pre-commit (Husky + lint-staged) roda lint e formatação automaticamente nos arquivos
alterados.
