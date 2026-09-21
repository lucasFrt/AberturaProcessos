# 11 - Deploy em Windows Server 2022

Topologia: IIS como porta de entrada HTTPS, servindo o front estático e fazendo reverse proxy para a
API Node; dois serviços Windows criados com NSSM (API e worker); SQL Server local; Redis em container
Docker.

```
Internet/Intranet
   │ HTTPS 443
   ▼
┌─────────────────────────── IIS ───────────────────────────┐
│ Site "AberturaProcessos"                                  │
│  /            -> D:\AberturaProcessos\frontend  (estático) │
│  /api         -> http://127.0.0.1:3000/api      (ARR)      │
│  /socket.io   -> http://127.0.0.1:3000/socket.io (ARR + WS)│
└───────────────────────────────────────────────────────────┘
   │                              │
   ▼                              ▼
NSSM: AberturaProcessos-API   NSSM: AberturaProcessos-Worker
   │            │                 │
   ▼            ▼                 ▼
SQL Server   Disco (uploads)   Redis (Docker) ──> SMTP
```

## Pré-requisitos no servidor

| Item | Detalhe |
| --- | --- |
| Node.js 20 LTS | Instalação MSI para todos os usuários. Confirmar `node -v` no PowerShell como Administrador. |
| IIS | Roles: Web Server, Static Content, **WebSocket Protocol**, URL Rewrite Module 2.1, Application Request Routing 3.0. |
| SQL Server 2022 | Instância local. Habilitar autenticação SQL se a aplicação for usar usuário SQL. |
| Docker Desktop / Docker Engine | Para o Redis. Configurar para iniciar com o sistema. |
| NSSM | `nssm.exe` em `C:\Tools\nssm\`. |
| Certificado TLS | Instalado no IIS e vinculado ao site na porta 443. **De CA pública** (ex.: win-acme / Let's Encrypt): o agente de intake chama a API a partir da nuvem da Anthropic e o `curl` de lá rejeita certificado autoassinado (docs/14). |

URL Rewrite e ARR **não** vêm com o IIS: precisam ser instalados (Web Platform Installer ou download
direto da Microsoft). Sem ARR não há reverse proxy.

## Estrutura de diretórios

```
D:\AberturaProcessos\
├── api\            # build do backend: dist\, node_modules\, prisma\, package.json, .env
├── frontend\       # conteúdo de frontend\dist + web.config
├── uploads\        # STORAGE_ROOT (anexos)
├── logs\
│   ├── api-stdout.log
│   ├── api-stderr.log
│   ├── worker-stdout.log
│   └── worker-stderr.log
└── backup\
```

`uploads` fora de `api` e fora de `frontend`: assim um redeploy não apaga anexos, e nenhum arquivo
enviado por usuário fica acessível diretamente pelo IIS. O download passa obrigatoriamente pela API,
que valida o escopo de acesso.

## Banco de dados

Criar o banco e um login dedicado (não usar `sa` em produção):

```sql
CREATE DATABASE abertura_processos;
GO
CREATE LOGIN ap_app WITH PASSWORD = '<senha forte>', CHECK_POLICY = ON;
GO
USE abertura_processos;
CREATE USER ap_app FOR LOGIN ap_app;
ALTER ROLE db_datareader ADD MEMBER ap_app;
ALTER ROLE db_datawriter ADD MEMBER ap_app;
ALTER ROLE db_ddladmin ADD MEMBER ap_app;   -- necessário para prisma migrate deploy
GO
```

`db_ddladmin` é necessário porque `prisma migrate deploy` altera schema. Se a política de segurança
não permitir, gerar o SQL com `prisma migrate diff` e aplicar por um DBA:

```powershell
npx prisma migrate diff --from-schema-datasource prisma\schema.prisma --to-schema-datamodel prisma\schema.prisma --script > migration.sql
```

Connection string de produção (em `D:\AberturaProcessos\api\.env`):

```dotenv
DATABASE_URL="sqlserver://localhost:1433;database=abertura_processos;user=ap_app;password=<senha>;encrypt=true;trustServerCertificate=true"
```

`trustServerCertificate=true` é aceitável para conexão local (loopback). Se o SQL Server estiver em
outro host, instalar um certificado válido e usar `trustServerCertificate=false`.

## Redis via Docker

```powershell
docker run -d --name ap-redis --restart unless-stopped `
  -p 127.0.0.1:6379:6379 `
  -v ap-redis-data:/data `
  redis:7-alpine redis-server --appendonly yes --requirepass "<senha redis>"
```

Dois pontos de segurança: publicar em `127.0.0.1` (não em `0.0.0.0`, que exporia o Redis na rede) e
definir `--requirepass`. A senha vai em `REDIS_PASSWORD` no `.env`. `--restart unless-stopped`
garante que o container volte após reboot, junto com o serviço do Docker.

## Publicação

Na máquina de build (ou no próprio servidor):

```powershell
# Backend
cd backend
npm ci                             # postinstall: prisma generate (obrigatório antes do build)
npm run build                      # gera dist\

# Frontend
cd ..\frontend
npm ci
npm run build                      # gera dist\
```

Copiar para o servidor:

| Origem | Destino |
| --- | --- |
| `backend\dist\` | `D:\AberturaProcessos\api\dist\` |
| `backend\package.json`, `package-lock.json` | `D:\AberturaProcessos\api\` |
| `backend\prisma\` | `D:\AberturaProcessos\api\prisma\` |
| `frontend\dist\*` | `D:\AberturaProcessos\frontend\` |

No servidor:

```powershell
cd D:\AberturaProcessos\api
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
npm run seed        # apenas na primeira instalação (é idempotente)
```

`npm ci --omit=dev` no servidor (em vez de copiar `node_modules`) garante binários nativos corretos
para a plataforma — o Prisma tem engine binária específica.

`.env` de produção nunca é copiado do ambiente de desenvolvimento. Diferenças obrigatórias:

```dotenv
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
FRONTEND_URL=https://processos.opusce.com.br
API_BASE_URL=https://processos.opusce.com.br
CORS_ORIGINS=https://processos.opusce.com.br
COOKIE_SECURE=true
STORAGE_ROOT=D:\AberturaProcessos\uploads
GOOGLE_CALLBACK_URL=https://processos.opusce.com.br/api/v1/auth/google/callback
MICROSOFT_CALLBACK_URL=https://processos.opusce.com.br/api/v1/auth/microsoft/callback
JWT_ACCESS_SECRET=<48 bytes aleatórios, exclusivo desta instalação>
```

Como front e API compartilham o host em produção, `API_BASE_URL` e `FRONTEND_URL` são iguais, e o
CORS praticamente não é exercitado (mesma origem).

## Alternativa: deploy a partir do clone do repositório

Quando o servidor tem Git e o repositório é clonado nele (ex.: `C:\apps\AberturaProcessos`), não é
preciso copiar `dist\` de outra máquina: build e atualização acontecem no próprio clone e os
serviços apontam para dentro dele. É o caminho usado na instalação atual.

Recomendações que mudam em relação à seção "Publicação":

- Clonar **fora** de perfis de usuário (não em `Desktop`): `C:\apps\AberturaProcessos` ou
  `D:\AberturaProcessos\repo`. `uploads\` e `logs\` continuam fora do clone (`git clean`/redeploy
  nunca os toca).
- `npm ci` **completo** em `backend/` (sem `--omit=dev`): o build (`tsc`), o `prisma migrate` e o
  `seed` (`tsx`) precisam das dependências de desenvolvimento.
- Não rodar `npm init` na raiz — o `package.json` da raiz já existe (Husky/lint-staged); `npm init`
  o sobrescreve. Se aconteceu: `git checkout -- package.json`.

Primeira instalação:

```powershell
cd C:\apps\AberturaProcessos
git checkout master

cd backend
Copy-Item .env.example .env       # e editar com os valores de produção (seção "Publicação")
npm ci                            # o postinstall roda `prisma generate` (o build depende dos tipos gerados)
npm run build                     # backend\dist\
npx prisma migrate deploy
npm run seed

cd ..\frontend
npm ci
npm run build                     # frontend\dist\ (inclui public\web.config)
```

Serviços NSSM: mesmos comandos da seção seguinte, com `AppDirectory` em
`C:\apps\AberturaProcessos\backend` (o programa continua `dist\http\server.js` e
`dist\workers\index.js`). Site do IIS: physical path `C:\apps\AberturaProcessos\frontend\dist`.

Atualização de versão:

```powershell
Stop-Service AberturaProcessos-Worker, AberturaProcessos-API
cd C:\apps\AberturaProcessos
git pull
cd backend;  npm ci; npm run build; npx prisma migrate deploy
cd ..\frontend; npm ci; npm run build
Start-Service AberturaProcessos-API, AberturaProcessos-Worker
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

Backup do banco antes do `migrate deploy` continua obrigatório (seção "Atualização de versão").

## Serviços com NSSM

### API

```powershell
$nssm = "C:\Tools\nssm\nssm.exe"

& $nssm install AberturaProcessos-API "C:\Program Files\nodejs\node.exe" "dist\http\server.js"
& $nssm set AberturaProcessos-API AppDirectory "D:\AberturaProcessos\api"
& $nssm set AberturaProcessos-API DisplayName "Abertura de Processos - API"
& $nssm set AberturaProcessos-API Description "BFF do sistema de abertura de processos"
& $nssm set AberturaProcessos-API Start SERVICE_AUTO_START
& $nssm set AberturaProcessos-API AppStdout "D:\AberturaProcessos\logs\api-stdout.log"
& $nssm set AberturaProcessos-API AppStderr "D:\AberturaProcessos\logs\api-stderr.log"
& $nssm set AberturaProcessos-API AppRotateFiles 1
& $nssm set AberturaProcessos-API AppRotateOnline 1
& $nssm set AberturaProcessos-API AppRotateBytes 10485760      # 10 MB
& $nssm set AberturaProcessos-API AppStopMethodConsole 15000   # 15s para o shutdown ordenado
& $nssm set AberturaProcessos-API AppExit Default Restart
& $nssm set AberturaProcessos-API AppRestartDelay 5000
& $nssm set AberturaProcessos-API AppEnvironmentExtra "NODE_ENV=production" "TZ=America/Sao_Paulo"

Start-Service AberturaProcessos-API
```

### Worker

```powershell
& $nssm install AberturaProcessos-Worker "C:\Program Files\nodejs\node.exe" "dist\workers\index.js"
& $nssm set AberturaProcessos-Worker AppDirectory "D:\AberturaProcessos\api"
& $nssm set AberturaProcessos-Worker DisplayName "Abertura de Processos - Worker"
& $nssm set AberturaProcessos-Worker Start SERVICE_AUTO_START
& $nssm set AberturaProcessos-Worker AppStdout "D:\AberturaProcessos\logs\worker-stdout.log"
& $nssm set AberturaProcessos-Worker AppStderr "D:\AberturaProcessos\logs\worker-stderr.log"
& $nssm set AberturaProcessos-Worker AppRotateFiles 1
& $nssm set AberturaProcessos-Worker AppRotateOnline 1
& $nssm set AberturaProcessos-Worker AppRotateBytes 10485760
& $nssm set AberturaProcessos-Worker AppStopMethodConsole 30000   # espera o job corrente terminar
& $nssm set AberturaProcessos-Worker AppExit Default Restart
& $nssm set AberturaProcessos-Worker AppEnvironmentExtra "NODE_ENV=production" "TZ=America/Sao_Paulo"

Start-Service AberturaProcessos-Worker
```

`AppStopMethodConsole` envia `CTRL+C` (equivalente a `SIGINT`) e aguarda o tempo configurado. É o que
faz o graceful shutdown do RNF-12 funcionar de verdade: sem isso o NSSM mata o processo e um job de
e-mail em andamento é interrompido no meio.

Dependência de serviços — a API não deve subir antes do SQL Server:

```powershell
& $nssm set AberturaProcessos-API DependOnService MSSQLSERVER
& $nssm set AberturaProcessos-Worker DependOnService "MSSQLSERVER" "com.docker.service"
```

## Configuração do IIS

1. Criar o site **AberturaProcessos** apontando o physical path para
   `D:\AberturaProcessos\frontend`, com binding HTTPS 443 e o certificado.
2. Confirmar que **Application Request Routing** está com proxy habilitado:
   IIS Manager → nó do servidor → Application Request Routing Cache → Server Proxy Settings →
   marcar "Enable proxy".
3. O `web.config` abaixo está versionado em `frontend/public/web.config` — o Vite o copia para
   `frontend/dist/` a cada build, então ele chega ao IIS junto com o front (não precisa copiar à
   mão; se o site apontar para `frontend\dist`, já está lá).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- 1) WebSocket / Socket.IO -->
        <rule name="SocketIO" stopProcessing="true">
          <match url="^socket.io/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/socket.io/{R:1}" />
        </rule>

        <!-- 2) API -->
        <rule name="ApiProxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/api/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
        </rule>

        <!-- 3) SPA: qualquer rota não-arquivo cai no index.html -->
        <rule name="SpaFallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>

    <webSocket enabled="true" pingInterval="00:00:10" />

    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
        <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains" />
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
      </customHeaders>
    </httpProtocol>

    <security>
      <requestFiltering>
        <!-- 100 MB: precisa acompanhar MAX_UPLOAD_SIZE_MB -->
        <requestLimits maxAllowedContentLength="104857600" />
      </requestFiltering>
    </security>

    <staticContent>
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".woff2" />
      <mimeMap fileExtension=".woff2" mimeType="font/woff2" />
    </staticContent>
  </system.webServer>
</configuration>
```

Pontos de atenção que costumam custar horas:

- **A ordem das regras importa.** O fallback do SPA precisa ser a última; se vier antes, engole
  `/api` e `/socket.io`.
- **Cache de assets.** Vite gera nomes com hash em `assets/`, então esses arquivos podem ter cache
  longo. `index.html` **não** pode: precisa de `no-cache`, senão o navegador continua apontando para
  o bundle antigo depois do deploy. Configurar via regra de cabeçalho por caminho no IIS.
- **`maxAllowedContentLength`** default do IIS é 30 MB; sem ajustar, uploads maiores falham no IIS
  antes de chegar ao Node, com erro genérico.
- **`X-Forwarded-Proto`** precisa de `allowedServerVariables` liberando `HTTP_X_FORWARDED_PROTO`
  (IIS Manager → URL Rewrite → View Server Variables → Add). Sem isso a regra `serverVariables`
  causa erro 500 no IIS.
- **`trust proxy`.** Com `app.set('trust proxy', 1)` no Express, o rate limit conta o IP real; sem
  isso, todas as requisições parecem vir de `127.0.0.1` e um único usuário estoura o limite de todos.
- **Timeout do proxy do ARR.** O padrão é 30 s. `POST /api/v1/intake/*` com `fetchAttachments`
  faz token + listagem + N downloads no Graph (até 30 s cada) e a consulta na Receita dentro de uma
  única requisição — com anexos grandes estoura 30 s e o IIS responde 502.3 antes de a API terminar.
  Subir para 300 s: IIS Manager → nó do servidor → Application Request Routing Cache → Server Proxy
  Settings → *Time-out (seconds)* = 300 (ou `Set-WebConfigurationProperty
  -Filter system.webServer/proxy -Name timeout -Value "00:05:00"`).
- **Origem do intake (opcional, recomendado).** `/api/v1/intake/*` só é usado pelo agente; depois
  de confirmar no log do IIS (`c-ip`) de onde vêm as chamadas da rotina, restringir com *IP Address
  and Domain Restrictions* à faixa de saída publicada pela Anthropic (`160.79.104.0/21`,
  https://platform.claude.com/docs/en/api/ip-addresses). Sem essa confirmação, não fechar: a doc só
  garante a faixa para chamadas MCP/outbound, não explicitamente para o `curl` da sandbox.

## Permissões de arquivo

A conta que roda os serviços (por padrão `LocalSystem`; preferível uma conta de serviço dedicada)
precisa de:

| Caminho | Permissão |
| --- | --- |
| `D:\AberturaProcessos\api` | Leitura e execução |
| `D:\AberturaProcessos\uploads` | **Modificação** (leitura e escrita) |
| `D:\AberturaProcessos\logs` | Modificação |
| `D:\AberturaProcessos\frontend` | Leitura para `IIS_IUSRS` |

```powershell
icacls "D:\AberturaProcessos\uploads" /grant "NT AUTHORITY\SYSTEM:(OI)(CI)M" /T
icacls "D:\AberturaProcessos\logs"    /grant "NT AUTHORITY\SYSTEM:(OI)(CI)M" /T
icacls "D:\AberturaProcessos\frontend" /grant "IIS_IUSRS:(OI)(CI)RX" /T
```

`IIS_IUSRS` **não** deve ter acesso a `uploads`: o download é responsabilidade da API, que faz o
controle de escopo.

## Firewall

Somente 443 (e 80 apenas para redirecionar para 443) exposto. 3000, 1433 e 6379 permanecem restritos
ao loopback:

```powershell
New-NetFirewallRule -DisplayName "AP - HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
New-NetFirewallRule -DisplayName "AP - HTTP redirect" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "AP - Bloqueia API externa" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress Any -Action Block
```

O Node deve escutar em `127.0.0.1` (não em `0.0.0.0`), o que dispensa depender apenas do firewall:
`server.listen(env.PORT, '127.0.0.1')`.

## Verificação pós-deploy

```powershell
Get-Service AberturaProcessos-*                            # ambos Running
Invoke-RestMethod http://127.0.0.1:3000/health             # status ok
Invoke-RestMethod http://127.0.0.1:3000/health/ready       # db e redis ok
Invoke-RestMethod https://processos.opusce.com.br/api/v1/health   # proxy do IIS funcionando
docker ps                                                  # ap-redis Up
```

Checklist manual:

- [ ] `https://processos.opusce.com.br` carrega o front e uma rota profunda (`/board`) sobrevive ao F5.
- [ ] Login local funciona; login Google e Microsoft completam o redirect.
- [ ] Criar processo gera código sequencial.
- [ ] Upload de arquivo ~50 MB conclui; o arquivo aparece em `D:\AberturaProcessos\uploads`.
- [ ] Download devolve o arquivo com o nome original.
- [ ] Mover card em duas janelas reflete em tempo real (aba Network mostra `websocket`, não só
      `polling`).
- [ ] E-mail de mudança de etapa chega à caixa do operacional.
- [ ] `worker-stdout.log` registra o job concluído.
- [ ] Reiniciar o servidor: ambos os serviços e o container Redis voltam sozinhos.

## Atualização de versão

```powershell
Stop-Service AberturaProcessos-Worker
Stop-Service AberturaProcessos-API

# backup antes de mexer no schema
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
sqlcmd -S localhost -Q "BACKUP DATABASE abertura_processos TO DISK='D:\AberturaProcessos\backup\pre-deploy-$stamp.bak'"

# substituir dist\ e prisma\, preservando .env e uploads\
cd D:\AberturaProcessos\api
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy

Start-Service AberturaProcessos-API
Start-Service AberturaProcessos-Worker
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

Parar o worker primeiro evita que ele processe um job com código antigo enquanto o schema já mudou.
Backup antes de `migrate deploy` é obrigatório: migration não tem rollback automático.

## Rotina de backup

| O que | Como | Frequência |
| --- | --- | --- |
| Banco | `BACKUP DATABASE` completo + log de transações | Diário completo, log a cada 1h |
| `uploads\` | Cópia incremental (robocopy `/MIR` para destino externo) | Diária |
| `.env` e `web.config` | Cópia manual versionada em local seguro (contêm segredos) | A cada alteração |

O banco guarda o **caminho** do arquivo, não os bytes. Restaurar o banco sem restaurar `uploads\`
resulta em processos com anexos apontando para arquivos inexistentes (a API responde `404` e loga
`error`). Os dois backups precisam ser restaurados juntos, do mesmo ponto no tempo.

## Diagnóstico

| Sintoma | Causa provável |
| --- | --- |
| 502 em `/api/*` | Serviço da API parado, ou proxy do ARR desabilitado. Checar `api-stderr.log`. |
| 500 do IIS só na regra de proxy | `HTTP_X_FORWARDED_PROTO` não liberado em Allowed Server Variables. |
| Front carrega, F5 em rota profunda dá 404 | Regra `SpaFallback` ausente ou fora de ordem. |
| Socket cai para polling | Feature "WebSocket Protocol" não instalada, ou `<webSocket enabled="true" />` ausente. |
| Upload grande falha com erro genérico | `maxAllowedContentLength` do IIS abaixo de `MAX_UPLOAD_SIZE_MB`. |
| Rate limit bloqueando todos juntos | `trust proxy` não configurado no Express. |
| E-mail não sai, board funciona | Worker parado ou Redis fora. Checar `worker-stderr.log`, `docker ps` e `/health/ready`. |
| Serviço reinicia em loop | Erro na validação de env (segredo curto, `COOKIE_SECURE=false` em produção). Ver `api-stderr.log`. |
| Login social redireciona com erro | Callback URL cadastrada no provedor diferente da configurada no `.env`. |
