# 01 - Visão Geral

## Problema

Uma empresa de trading / despacho aduaneiro precisa de uma ferramenta interna para abrir e
acompanhar processos de comércio exterior em nome de seus clientes. Hoje isso é feito de forma
dispersa (e-mail, planilha), sem rastreabilidade de quem fez o quê e sem visibilidade para o
cliente final.

## Solução

Um sistema web com duas partes:

- **Entry point (formulário)** — tela para registrar um novo processo com referência, informações
  adicionais e anexo de documentos.
- **Funil Kanban** — quadro com etapas configuráveis (Entrada, Em Andamento, Concluído como padrão
  inicial) onde o processo avança, com responsável, datas e histórico completo de auditoria.

Ao redor disso: autenticação com login padrão e social, controle de acesso por papel, isolamento de
dados por organização/CNPJ, notificação por e-mail ao time operacional, atualização do quadro em
tempo real e um dashboard gerencial.

## Glossário de domínio

| Termo | Significado |
| --- | --- |
| **Organization** | Grupo econômico ou empresa-mãe. Agrupa domínios de e-mail e CNPJs. É a fronteira de isolamento de dados. |
| **Company** | Um CNPJ concreto (matriz ou filial), sempre pertencente a uma Organization. |
| **Organização interna** | A Organization marcada com `isInternal = true`: a própria trading. Usuários dela são OPERATIONAL ou ADMIN. |
| **Process** | O processo de comércio exterior. Pertence a um CNPJ cliente (`clientCompany`) e pode ter sido solicitado por outro CNPJ (`requestingCompany`) — é o caso trading. |
| **KanbanStage** | Etapa do funil. Globais (fluxo da trading), ordenáveis, gerenciadas por ADMIN. |
| **ProcessHistory** | Trilha de auditoria imutável: cada criação, edição, movimentação, anexo e exclusão. |
| **Document** | Arquivo anexado a um processo. Bytes em disco no servidor, metadados e caminho no banco. |
| **Papel (role)** | `CLIENT`, `OPERATIONAL` ou `ADMIN`. |
| **Provisionamento por domínio** | Ao logar, se o domínio do e-mail corresponde a um domínio cadastrado, o usuário é vinculado automaticamente àquela Organization. Sem correspondência, fica `PENDING`. |

## Modelo trading (por que dois CNPJs no processo)

Uma trading abre processos em nome de terceiros. E um cliente pode abrir um processo cujo
beneficiário é outro CNPJ. Por isso o processo carrega:

- `clientCompanyId` — **para quem** é o processo (CNPJ beneficiário). Obrigatório.
- `requestingCompanyId` — **quem pediu** a abertura. Opcional; quando ausente, assume-se igual ao
  `clientCompanyId`.

A regra de visibilidade do CLIENT considera os dois campos: ele vê o processo se qualquer um dos
CNPJs estiver no seu escopo de acesso. Isso permite o cenário "empresa A abre processo para empresa
B" sem vazar o resto dos dados de B.

## Stack e decisões

### Backend

| Item | Escolha | Motivo |
| --- | --- | --- |
| Runtime | Node.js 20 LTS | Estável e suportado no Windows Server 2022. |
| Framework HTTP | Express 4 | Definido pelo usuário. Ecossistema maduro de middlewares. |
| Linguagem | TypeScript 5 (strict) | Requisito. |
| ORM | Prisma 5+ (`provider = sqlserver`) | Requisito. Migrations versionadas e client tipado. |
| Banco | SQL Server 2022 | Requisito e infraestrutura existente. |
| Validação | Zod | Preferência do usuário. Mesma lib no front, schemas compartilháveis. |
| Auth social | Passport.js (`passport-google-oauth20`, `passport-azure-ad` / `passport-microsoft`) | Mais testado em produção com Express para múltiplos provedores. |
| Sessão | JWT próprio: access token curto + refresh token em cookie httpOnly | Stateless na API, refresh revogável em tabela. |
| Filas | BullMQ + Redis (Docker) | Requisito. E-mails fora do ciclo da requisição. |
| E-mail | Nodemailer (SMTP) | Simples e configurável por env. |
| Real-time | Socket.IO | Requisito. Fallback automático para long-polling, o que ajuda atrás do IIS. |
| Upload | Multer (disk storage) | Bytes em disco, caminho no banco, conforme decidido. |
| Testes | Jest + Supertest | Preferência do usuário. |
| Injeção de dependência | Composição manual via factories | Explícito, sem decorators nem container. Mais fácil de testar e de ler. |
| Logs | Pino + pino-http | Baixo overhead, JSON estruturado, `requestId` por requisição. |

### Frontend

| Item | Escolha | Motivo |
| --- | --- | --- |
| Build | Vite | Rápido, saída estática simples de servir pelo IIS. |
| UI | React 18 + TypeScript | Requisito. |
| Componentes | Ant Design 5 | Formulários, tabelas e modais prontos; adequado a ferramenta interna. |
| Rotas | React Router 6 | Padrão de mercado; suporta rotas protegidas por papel. |
| Dados de servidor | TanStack Query v5 | Cache, invalidação e sincronia com eventos de socket. |
| Estado local/global | Zustand | Somente sessão e preferências de UI. |
| Formulários | React Hook Form + Zod | Mesmos schemas de validação do backend. |
| Drag-and-drop | @hello-pangea/dnd | Fork mantido do react-beautiful-dnd, API estável para Kanban. |
| Gráficos | Recharts | Suficiente para as métricas do dashboard. |
| Real-time | socket.io-client | Par do servidor. |

### Infraestrutura

Produção: Windows Server 2022, IIS como reverse proxy e servidor dos estáticos, aplicação Node
registrada como serviço via NSSM, SQL Server local, Redis em container Docker.
Detalhes em [11-deploy-windows-server.md](./11-deploy-windows-server.md).

## Fora de escopo no v1

- Campos aduaneiros detalhados (NCM, país de origem/destino, modal, valores). O formulário inicial
  tem apenas Referência, Adicionais e Documentos.
- Antivírus / inspeção de conteúdo nos uploads.
- Storage em nuvem (Azure Blob / S3). A camada de storage é abstraída por interface para permitir
  a troca depois sem tocar em regra de negócio.
- Notificação para o cliente (v1 notifica apenas o time operacional).
- Aplicativo mobile.
