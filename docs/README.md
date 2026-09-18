# Sistema de Abertura de Processos de Comércio Exterior

Documentação de referência para construção do sistema. Backend (BFF em TypeScript/Express) e
frontend (React) vivem em pastas separadas na raiz do repositório.

## Estrutura do repositório

```
AberturaProcessos/
├── docs/          # esta documentação
├── backend/       # BFF: Express + TypeScript + Prisma + SQL Server
└── frontend/      # React + TypeScript + Vite
```

## Índice

| Documento | Conteúdo |
| --- | --- |
| [01-visao-geral.md](./01-visao-geral.md) | Problema, escopo, glossário de domínio, decisões de stack |
| [02-requisitos.md](./02-requisitos.md) | Requisitos funcionais, não funcionais e matriz de permissões |
| [03-arquitetura.md](./03-arquitetura.md) | Diagramas, camadas MVC, estrutura de pastas do backend |
| [04-modelo-de-dados.md](./04-modelo-de-dados.md) | ER, schema Prisma completo, limitações do SQL Server |
| [05-contrato-api.md](./05-contrato-api.md) | Todos os endpoints, payloads, códigos de erro |
| [06-autenticacao-autorizacao.md](./06-autenticacao-autorizacao.md) | JWT, OAuth Google/Microsoft, provisionamento por domínio, rate limiting |
| [07-filas-notificacoes-realtime.md](./07-filas-notificacoes-realtime.md) | BullMQ, Redis, e-mail, Socket.IO |
| [08-frontend.md](./08-frontend.md) | Estrutura, telas, estado, componentes do Kanban |
| [09-padroes-de-codigo-e-testes.md](./09-padroes-de-codigo-e-testes.md) | SOLID aplicado, convenções, estratégia de testes |
| [10-ambiente-e-configuracao.md](./10-ambiente-e-configuracao.md) | Variáveis de ambiente, docker-compose, setup local |
| [11-deploy-windows-server.md](./11-deploy-windows-server.md) | Windows Server 2022 + IIS + NSSM + SQL Server |
| [12-plano-de-tarefas.md](./12-plano-de-tarefas.md) | Tarefas incrementais (22 do núcleo + Fase 7 de alimentação por IA), cada uma com critério de aceite |
| [13-integracao-ia-email.md](./13-integracao-ia-email.md) | Alimentação por IA: chaves de API, intake idempotente por e-mail, anexos via Microsoft Graph, MCP server |
| [prompts/](./prompts/) | Prompts prontos para delegar cada tarefa a uma IA, com contexto e referências já resolvidas |

Ver também [`CLAUDE.md`](../CLAUDE.md) na raiz do repositório: contexto operacional para agentes de
IA (regras de arquitetura, convenções, decisões técnicas já tomadas, estado atual do projeto).

## Como usar esta documentação

Comece pelo [12-plano-de-tarefas.md](./12-plano-de-tarefas.md). Cada tarefa aponta para os
documentos que contêm as especificações necessárias para executá-la. Os documentos 04, 05 e 06
são a fonte da verdade para contratos: mudanças de comportamento devem ser refletidas ali antes
de serem implementadas.

## Ajustes feitos em relação ao plano inicial de conversa

Três pontos foram corrigidos após validação técnica e estão refletidos nos documentos:

1. **`emailDomain` não fica em `Company`.** A regra acordada é "domínio agrupa CNPJs (filiais)",
   então foi introduzida a entidade `Organization`, que possui N domínios e N CNPJs. Ver
   [04-modelo-de-dados.md](./04-modelo-de-dados.md).
2. **Sem `enum` no Prisma.** O provider `sqlserver` não suporta enums; papéis, status e afins são
   `String` com união de tipos em TypeScript e validação Zod.
3. **Sem colunas `UNIQUE` anuláveis** (SQL Server aceita apenas um `NULL` por índice único). IDs de
   provedores sociais foram movidos para a tabela `UserIdentity` com unicidade composta.
