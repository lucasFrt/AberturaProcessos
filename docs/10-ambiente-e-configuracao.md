# 10 - Ambiente e Configuração

## Pré-requisitos

| Ferramenta | Versão | Observação |
| --- | --- | --- |
| Node.js | 20 LTS | Mesma major em dev e produção. |
| npm | 10+ | Acompanha o Node 20. |
| Docker Desktop | atual | Sobe SQL Server, Redis e Mailpit em dev. |
| Git | atual | — |

Não é necessário instalar SQL Server nem Redis na máquina de desenvolvimento: ambos vêm do
`docker-compose.yml`.

## docker-compose.yml (raiz do repositório)

```yaml
services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:2022-latest
    container_name: ap-sqlserver
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "Dev@Str0ngPass!"
      MSSQL_PID: Developer
    ports:
      - "1433:1433"
    volumes:
      - sqlserver-data:/var/opt/mssql
    healthcheck:
      test: ["CMD-SHELL", "/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"$$MSSQL_SA_PASSWORD\" -C -Q 'SELECT 1' || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s

  redis:
    image: redis:7-alpine
    container_name: ap-redis
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  mailpit:
    image: axllent/mailpit:latest
    container_name: ap-mailpit
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # interface web
    environment:
      MP_MAX_MESSAGES: 500

volumes:
  sqlserver-data:
  redis-data:
```

Notas:

- A imagem 2022 usa `MSSQL_SA_PASSWORD` (a antiga `SA_PASSWORD` está depreciada) e a senha precisa
  atender à política de complexidade, senão o container sobe e morre.
- O `sqlcmd` da imagem 2022 fica em `/opt/mssql-tools18/` e exige `-C` (confia no certificado
  autoassinado). Em imagens mais antigas o caminho é `/opt/mssql-tools/`.
- Mailpit captura todo e-mail enviado em dev. Interface em <http://localhost:8025>. Nada sai para
  fora da máquina.
- Em máquinas Apple Silicon a imagem do SQL Server não roda nativamente. Alternativa:
  `mcr.microsoft.com/azure-sql-edge`. No Windows, o cenário do projeto, não há esse problema.

O banco não é criado automaticamente pela imagem. Depois do primeiro `docker compose up`:

```powershell
docker exec -it ap-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Dev@Str0ngPass!" -C -Q "CREATE DATABASE abertura_processos; CREATE DATABASE abertura_processos_test;"
```

## Variáveis de ambiente do backend

`backend/.env.example` (versionado; `.env` fica no `.gitignore`):

```dotenv
# ── Aplicação ───────────────────────────────────────────────
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1
APP_VERSION=1.0.0
LOG_LEVEL=debug
TZ=America/Sao_Paulo

# URL pública do front, usada em links de e-mail e redirect OAuth
FRONTEND_URL=http://localhost:5173
# URL pública da API, base dos callbacks OAuth
API_BASE_URL=http://localhost:3000
# Origens permitidas no CORS (separadas por vírgula)
CORS_ORIGINS=http://localhost:5173

# ── Banco ───────────────────────────────────────────────────
DATABASE_URL="sqlserver://localhost:1433;database=abertura_processos;user=sa;password=Dev@Str0ngPass!;encrypt=true;trustServerCertificate=true"

# ── JWT ─────────────────────────────────────────────────────
# gerar com: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
JWT_ACCESS_SECRET=troque-por-um-segredo-de-48-bytes
JWT_ACCESS_TTL=15m
JWT_ISSUER=abertura-processos
REFRESH_TOKEN_TTL_DAYS=7
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax

# ── OAuth Google ────────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/api/v1/auth/google/callback

# ── OAuth Microsoft ─────────────────────────────────────────
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
# "common" aceita qualquer tenant; use o id do tenant para restringir
MICROSOFT_TENANT_ID=common
MICROSOFT_CALLBACK_URL=http://localhost:3000/api/v1/auth/microsoft/callback

# ── Redis / BullMQ ──────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
# Redis compartilhado com outra aplicação: DB lógico (0-15) e prefixo das
# chaves do BullMQ. Produtor (API) e worker precisam do mesmo valor.
REDIS_DB=0
REDIS_KEY_PREFIX=ap
EMAIL_QUEUE_CONCURRENCY=5

# ── SMTP ────────────────────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM="Abertura de Processos <nao-responda@opusce.com.br>"

# ── Armazenamento de anexos ─────────────────────────────────
# Absoluto. Em produção: D:\AberturaProcessos\uploads
STORAGE_ROOT=./storage/uploads
MAX_UPLOAD_SIZE_MB=100
MAX_FILES_PER_REQUEST=10

# ── Seed ────────────────────────────────────────────────────
ADMIN_SEED_EMAIL=admin@opusce.com.br
ADMIN_SEED_PASSWORD=Admin@Local123
INTERNAL_ORG_NAME=Opusce
INTERNAL_EMAIL_DOMAIN=opusce.com.br
SEED_DEMO=true

# ── Rate limiting (docs/06, tabela de limites) ──────────────
# Todas com default igual à tabela do documento 06; existem como variáveis
# para que os testes de integração da Tarefa 6 possam injetar limites e
# janelas baixos sem tocar no código do limitador.
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_AUTH_WINDOW_MINUTES=15
RATE_LIMIT_REFRESH_MAX=60
RATE_LIMIT_REFRESH_WINDOW_MINUTES=15
RATE_LIMIT_OAUTH_CALLBACK_MAX=30
RATE_LIMIT_OAUTH_CALLBACK_WINDOW_MINUTES=15
RATE_LIMIT_CLIENT_MAX=120
RATE_LIMIT_CLIENT_WINDOW_MINUTES=1
RATE_LIMIT_INTERNAL_MAX=1000
RATE_LIMIT_INTERNAL_WINDOW_MINUTES=1
RATE_LIMIT_UPLOAD_MAX=30
RATE_LIMIT_UPLOAD_WINDOW_MINUTES=10
RATE_LIMIT_ANONYMOUS_MAX=60
RATE_LIMIT_ANONYMOUS_WINDOW_MINUTES=1
RATE_LIMIT_API_KEY_FAILURE_MAX=50
RATE_LIMIT_API_KEY_FAILURE_WINDOW_MINUTES=5

# ── Consulta de CNPJ na Receita (docs/05, "Empresas / CNPJs") ─
# Autopreenchimento de razão social / nome fantasia no cadastro de empresa.
CNPJ_LOOKUP_ENABLED=true
CNPJ_LOOKUP_BASE_URL=https://receitaws.com.br/v1
CNPJ_LOOKUP_TOKEN=
CNPJ_LOOKUP_TIMEOUT_MS=10000
CNPJ_LOOKUP_CACHE_TTL_MINUTES=60

# ── Intake por e-mail: anexos via Microsoft Graph (docs/13, decisão 3) ─
GRAPH_INTAKE_ENABLED=false
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_MAILBOX=opusoperacional@opusce.com.br
GRAPH_TIMEOUT_MS=30000
# Cópia do e-mail processado para "<pasta>/<Organização>" (docs/13, decisão 12).
# Exige o papel Exchange "Application Mail.ReadWrite"; com Mail.Read só gera aviso.
GRAPH_ORGANIZE_ENABLED=false
GRAPH_ORGANIZE_FOLDER=Processos IA
```

Sobre as variáveis `GRAPH_*` (docs/13, seção "Configuração"):

- São credenciais de **aplicação** (client credentials) de um registro próprio no Entra ID, com o
  papel Exchange `Application Mail.ReadWrite` restrito à caixa (RBAC for Applications, docs/13). **Não** reaproveitar
  `MICROSOFT_CLIENT_ID` do login social: aquele é um app delegado, com permissões de usuário.
- Obrigatório restringir o app à caixa do agente com `New-ApplicationAccessPolicy` no Exchange
  Online; sem isso `Mail.Read` de aplicação lê todas as caixas do tenant.
- Com `GRAPH_INTAKE_ENABLED=true`, as quatro variáveis (`TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`,
  `MAILBOX`) passam a ser obrigatórias e a API aborta a subida se faltar alguma — melhor que
  descobrir na primeira chamada do agente.
- Desligado, `POST /intake/*` com `fetchAttachments: true` responde `503 MAIL_ATTACHMENTS_DISABLED`;
  o envio de arquivos por multipart continua funcionando.
- **`GRAPH_MAILBOX` é a caixa que o agente lê pelo conector** (`opusoperacional@opusce.com.br`,
  compartilhada): o id de mensagem do Graph só existe dentro da caixa de onde foi lido. Trocar a
  caixa do agente exige trocar esta variável (docs/14).
- `RATE_LIMIT_API_KEY_FAILURE_*`: só respostas `401` em `/intake/*` contam, por IP. O IP de saída da
  nuvem da Anthropic é compartilhado entre clientes, por isso o limite é folgado (50 em 5 min):
  impede lixo em volume sem permitir que um terceiro no mesmo IP bloqueie o agente.

Sobre as variáveis `CNPJ_LOOKUP_*`:

- **Prefixo genérico, não `RECEITAWS_*`**, porque o provedor é detalhe de infraestrutura atrás da
  interface `CnpjLookupProvider` (`backend/src/domain/cnpj/cnpj-lookup-provider.ts`). Trocar para
  BrasilAPI ou cnpj.ws deve exigir uma classe nova em `infra/cnpj/`, não renomear configuração.
- **`CNPJ_LOOKUP_ENABLED=false`** faz `GET /companies/lookup/:cnpj` responder
  `503 CNPJ_LOOKUP_DISABLED`; o cadastro manual de empresa continua funcionando normalmente. É
  assim que a suíte de testes roda sem depender de API externa — ver `backend/.env.test`.
- **`CNPJ_LOOKUP_TOKEN` vazio = plano gratuito da ReceitaWS**, que permite apenas **3 consultas por
  minuto por IP** e responde `429` com corpo em `text/plain` ao estourar. Esse limite é o motivo de
  existir `CNPJ_LOOKUP_CACHE_TTL_MINUTES` (cache em memória por CNPJ, `0` desliga) e de a API
  validar os dígitos e procurar no banco local antes de chamar o provedor.

### Variáveis do frontend

`frontend/.env.example`:

```dotenv
# Em dev o proxy do Vite encaminha; caminho relativo mantém a mesma origem
VITE_API_URL=/api/v1
VITE_SOCKET_URL=/
VITE_APP_NAME=Abertura de Processos
```

Somente `VITE_*` chega ao bundle. **Nada secreto aqui** — o conteúdo é público no navegador. Client
secrets de OAuth vivem exclusivamente no backend.

## Validação da configuração

`src/config/env.ts` valida tudo na subida. A aplicação falha rápido, com mensagem clara, em vez de
quebrar depois em runtime por variável ausente:

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  FRONTEND_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  MAIL_FROM: z.string().min(1),
  STORAGE_ROOT: z.string().min(1),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(100),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuração inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
```

Validações extras aplicadas depois do parse:

- `NODE_ENV=production` exige `COOKIE_SECURE=true` e `JWT_ACCESS_SECRET` diferente do valor de
  exemplo. Caso contrário, aborta.
- Credenciais de um provedor OAuth ausentes desabilitam apenas aquele provedor (as rotas respondem
  `404` e o front esconde o botão via `/auth/providers`), sem impedir a subida.
- `STORAGE_ROOT` é resolvido para caminho absoluto e criado se não existir; se não for gravável,
  aborta com mensagem explícita.

## Setup local

```powershell
# 1. Dependências de infraestrutura
docker compose up -d
docker compose ps                     # aguardar sqlserver "healthy"

# 2. Criar os bancos (primeira vez)
docker exec -it ap-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Dev@Str0ngPass!" -C -Q "CREATE DATABASE abertura_processos; CREATE DATABASE abertura_processos_test;"

# 3. Backend
cd backend
Copy-Item .env.example .env           # ajustar segredos
npm install
npx prisma generate
npx prisma migrate dev
npm run seed
npm run dev                           # API em http://localhost:3000

# 4. Worker (outro terminal)
cd backend
npm run dev:worker

# 5. Frontend (outro terminal)
cd frontend
Copy-Item .env.example .env
npm install
npm run dev                           # http://localhost:5173
```

Verificação rápida do ambiente:

```powershell
curl http://localhost:3000/health
curl http://localhost:3000/health/ready    # deve mostrar db e redis "ok"
```

Depois, entrar em <http://localhost:5173> com `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`.
E-mails disparados aparecem em <http://localhost:8025>.

## Scripts npm

`backend/package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/http/server.ts",
    "dev:worker": "tsx watch src/workers/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/http/server.js",
    "start:worker": "node dist/workers/index.js",
    "seed": "tsx prisma/seed.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "lint": "eslint src tests --ext .ts",
    "lint:fix": "eslint src tests --ext .ts --fix",
    "typecheck": "tsc --noEmit",
    "test": "jest --runInBand",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration --runInBand",
    "test:coverage": "jest --coverage --runInBand"
  }
}
```

`frontend/package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run"
  }
}
```

`npm run dev` usa `tsx watch` no lugar de `ts-node-dev`: reinício mais rápido e melhor suporte a ESM
e a `paths` do tsconfig.

## Configuração dos provedores OAuth

### Google

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web application.
2. Authorized redirect URIs:
   - `http://localhost:3000/api/v1/auth/google/callback`
   - `https://<host-producao>/api/v1/auth/google/callback`
3. Copiar Client ID e Secret para o `.env`.
4. Na tela de consentimento, os scopes necessários são apenas `email` e `profile`.

### Microsoft

1. Portal Azure → Microsoft Entra ID → App registrations → New registration.
2. Redirect URI (tipo Web):
   - `http://localhost:3000/api/v1/auth/microsoft/callback`
   - `https://<host-producao>/api/v1/auth/microsoft/callback`
3. Certificates & secrets → New client secret (anotar a validade; renovação é tarefa recorrente).
4. API permissions: `openid`, `profile`, `email`, `User.Read` (delegadas).
5. Supported account types define o valor de `MICROSOFT_TENANT_ID`: single tenant → id do tenant;
   multi tenant → `common`.

## .gitignore

```gitignore
node_modules/
dist/
build/
coverage/
.env
.env.*
!.env.example
storage/
*.log
.DS_Store
.vscode/*
!.vscode/extensions.json
```

`storage/` é ignorado para que anexos de desenvolvimento não entrem no repositório.

## Ambiente de teste

`backend/.env.test`:

```dotenv
NODE_ENV=test
DATABASE_URL="sqlserver://localhost:1433;database=abertura_processos_test;user=sa;password=Dev@Str0ngPass!;encrypt=true;trustServerCertificate=true"
JWT_ACCESS_SECRET=test-secret-com-mais-de-32-caracteres-aqui
STORAGE_ROOT=./storage/test-uploads
SMTP_HOST=localhost
SMTP_PORT=1025
LOG_LEVEL=silent
# Nenhum teste automatizado chama API externa (docs/09). Com a consulta
# desligada, os testes de integração cobrem validação, escopo por papel e o
# caminho "já cadastrado"; o caminho de sucesso é coberto por unit test com
# fake de `CnpjLookupProvider`.
CNPJ_LOOKUP_ENABLED=false
# Intake sem Graph: `fetchAttachments` responde 503 e os testes enviam anexos
# por multipart; o provider é coberto por unit test com `fetch` injetado.
GRAPH_INTAKE_ENABLED=false
```

A suíte de integração usa banco próprio (`abertura_processos_test`), que **precisa estar migrado
antes de rodar os testes** — a suíte não aplica migrations sozinha. Depois de cada migration nova:

```powershell
# de dentro de backend/ (PowerShell)
$env:DATABASE_URL = (Get-Content .env.test | Select-String '^DATABASE_URL=').ToString().Split('=',2)[1].Trim('"')
npx prisma migrate deploy
```

ou simplesmente `npm run prisma:deploy:test`. O diretório de upload de teste é limpo no `afterAll`.
