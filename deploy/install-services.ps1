<#
.SYNOPSIS
  Instala (ou reinstala) os serviços Windows da API e do Worker via NSSM (docs/11).

.DESCRIPTION
  Idempotente: rodar de novo remove e recria os serviços com a configuração atual.
  - Baixa o NSSM em C:\Tools\nssm se não existir.
  - Detecta o node.exe e o serviço do SQL Server (instância padrão ou nomeada).
  - Cria as pastas de uploads/logs fora do clone e dá permissão de escrita ao SYSTEM.
  - Lê PORT do backend\.env para validar /health/ready ao final.

.EXAMPLE
  # Executar como Administrador, de qualquer pasta:
  powershell -ExecutionPolicy Bypass -File deploy\install-services.ps1

  # Com caminhos diferentes:
  powershell -ExecutionPolicy Bypass -File deploy\install-services.ps1 -DataRoot "C:\AberturaProcessos"
#>
[CmdletBinding()]
param(
  # Pasta backend\ do clone. Padrão: a pasta backend ao lado da pasta deste script.
  [string]$BackendDir,
  # Raiz de dados fora do clone (uploads\ e logs\). Padrão: D:\AberturaProcessos, ou C:\ se não houver D:.
  [string]$DataRoot = $(if (Test-Path 'D:\') { 'D:\AberturaProcessos' } else { 'C:\AberturaProcessos' }),
  [string]$NssmPath = 'C:\Tools\nssm\nssm.exe',
  [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

# $PSScriptRoot fica vazio no default de parâmetro no PS 5.1; resolvido aqui no corpo.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $BackendDir) { $BackendDir = Join-Path (Split-Path -Parent $scriptDir) 'backend' }

# ── Pré-checagens ────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Execute este script em um PowerShell como Administrador.' }

$BackendDir = (Resolve-Path $BackendDir).Path
if (-not (Test-Path (Join-Path $BackendDir 'dist\http\server.js'))) {
  throw "Não encontrei $BackendDir\dist\http\server.js — rode 'npm ci' e 'npm run build' em backend\ antes."
}
if (-not (Test-Path (Join-Path $BackendDir '.env'))) {
  throw "Não encontrei $BackendDir\.env — copie o .env.example e preencha os valores de produção (docs/11)."
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'node.exe não está no PATH. Instale o Node.js LTS (MSI para todos os usuários).' }
$node = $nodeCmd.Source
Write-Step "Node: $node ($(& $node --version))"

# ── NSSM ─────────────────────────────────────────────────────────────
if (-not (Test-Path $NssmPath)) {
  Write-Step "NSSM não encontrado em $NssmPath — baixando de nssm.cc"
  $nssmDir = Split-Path -Parent $NssmPath
  New-Item -ItemType Directory -Force $nssmDir | Out-Null
  $zip = Join-Path $env:TEMP 'nssm-2.24.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip
  $extract = Join-Path $env:TEMP 'nssm-extract'
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $extract
  Copy-Item (Join-Path $extract 'nssm-2.24\win64\nssm.exe') $NssmPath -Force
}
Write-Step "NSSM: $NssmPath"

# ── SQL Server: instância padrão ou nomeada ─────────────────────────
$sqlService = Get-Service -Name 'MSSQLSERVER' -ErrorAction SilentlyContinue
if (-not $sqlService) { $sqlService = Get-Service -Name 'MSSQL$*' -ErrorAction SilentlyContinue | Select-Object -First 1 }
$sqlServiceName = if ($sqlService) { $sqlService.Name } else { $null }
Write-Step "SQL Server: $(if ($sqlServiceName) { $sqlServiceName } else { 'não encontrado local — sem DependOnService' })"

# ── Pastas de dados (fora do clone) ─────────────────────────────────
$uploads = Join-Path $DataRoot 'uploads'
$logs    = Join-Path $DataRoot 'logs'
New-Item -ItemType Directory -Force $uploads, $logs | Out-Null
icacls $uploads /grant 'NT AUTHORITY\SYSTEM:(OI)(CI)M' /T | Out-Null
icacls $logs    /grant 'NT AUTHORITY\SYSTEM:(OI)(CI)M' /T | Out-Null
Write-Step "Dados: $uploads e $logs (SYSTEM com modificação)"

$envFile = Get-Content (Join-Path $BackendDir '.env')
$storageLine = $envFile | Where-Object { $_ -match '^\s*STORAGE_ROOT\s*=' } | Select-Object -Last 1
if (-not $storageLine -or ($storageLine -replace '^\s*STORAGE_ROOT\s*=\s*', '').Trim('"') -ne $uploads) {
  Write-Warning "STORAGE_ROOT no .env não é '$uploads'. Ajuste o .env para: STORAGE_ROOT=$uploads"
}
$portLine = $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
$port = if ($portLine) { ($portLine -replace '^\s*PORT\s*=\s*', '').Trim() } else { '3000' }

# ── Serviços ─────────────────────────────────────────────────────────
function Install-ApService {
  param([string]$Name, [string]$DisplayName, [string]$Script, [string]$LogPrefix, [int]$StopTimeoutMs)

  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
    Write-Step "$Name já existe — parando e removendo para recriar"
    & $NssmPath stop $Name 2>$null | Out-Null
    & $NssmPath remove $Name confirm | Out-Null
    Start-Sleep -Seconds 2
  }

  Write-Step "Instalando $Name"
  & $NssmPath install $Name $node $Script | Out-Null
  & $NssmPath set $Name AppDirectory $BackendDir | Out-Null
  & $NssmPath set $Name DisplayName $DisplayName | Out-Null
  & $NssmPath set $Name Description 'Sistema de abertura de processos (docs/11)' | Out-Null
  & $NssmPath set $Name Start SERVICE_AUTO_START | Out-Null
  & $NssmPath set $Name AppStdout (Join-Path $logs "$LogPrefix-stdout.log") | Out-Null
  & $NssmPath set $Name AppStderr (Join-Path $logs "$LogPrefix-stderr.log") | Out-Null
  & $NssmPath set $Name AppRotateFiles 1 | Out-Null
  & $NssmPath set $Name AppRotateOnline 1 | Out-Null
  & $NssmPath set $Name AppRotateBytes 10485760 | Out-Null
  & $NssmPath set $Name AppStopMethodConsole $StopTimeoutMs | Out-Null
  & $NssmPath set $Name AppExit Default Restart | Out-Null
  & $NssmPath set $Name AppRestartDelay 5000 | Out-Null
  & $NssmPath set $Name AppEnvironmentExtra 'NODE_ENV=production' 'TZ=America/Sao_Paulo' | Out-Null
  if ($sqlServiceName) { & $NssmPath set $Name DependOnService $sqlServiceName | Out-Null }
}

Install-ApService -Name 'AberturaProcessos-API'    -DisplayName 'Abertura de Processos - API'    -Script 'dist\http\server.js'    -LogPrefix 'api'    -StopTimeoutMs 15000
Install-ApService -Name 'AberturaProcessos-Worker' -DisplayName 'Abertura de Processos - Worker' -Script 'dist\workers\index.js' -LogPrefix 'worker' -StopTimeoutMs 30000

if ($SkipStart) { Write-Step 'Serviços instalados (não iniciados, -SkipStart).'; return }

# ── Start + verificação ─────────────────────────────────────────────
Write-Step 'Iniciando AberturaProcessos-API'
Start-Service AberturaProcessos-API
$ready = $null
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try { $ready = Invoke-RestMethod "http://127.0.0.1:$port/health/ready" -TimeoutSec 5; break } catch { }
}

if ($ready) {
  Write-Host ("API ok em :$port -> status={0} database={1} redis={2}" -f $ready.status, $ready.checks.database, $ready.checks.redis) -ForegroundColor Green
} else {
  Write-Warning "A API não respondeu em http://127.0.0.1:$port/health/ready. Últimas linhas de $logs\api-stderr.log:"
  Get-Content (Join-Path $logs 'api-stderr.log') -Tail 30 -ErrorAction SilentlyContinue
  Get-Service AberturaProcessos-API
  return
}

Write-Step 'Iniciando AberturaProcessos-Worker'
Start-Service AberturaProcessos-Worker
Start-Sleep -Seconds 3
Get-Service AberturaProcessos-* | Format-Table Name, Status, StartType -AutoSize

Write-Host "Pronto. Logs em $logs. Para atualizar a versão: deploy\update.ps1" -ForegroundColor Green
