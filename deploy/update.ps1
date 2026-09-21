<#
.SYNOPSIS
  Atualiza a instalação a partir do clone: git pull, build do backend e do front,
  migrations e reinício dos serviços (docs/11, "Deploy a partir do clone").

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\update.ps1
  powershell -ExecutionPolicy Bypass -File deploy\update.ps1 -SkipPull   # só rebuild/restart
#>
[CmdletBinding()]
param(
  [string]$RepoDir = (Split-Path -Parent $PSScriptRoot),
  [switch]$SkipPull,
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'
function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

$RepoDir = (Resolve-Path $RepoDir).Path
$backend = Join-Path $RepoDir 'backend'
$frontend = Join-Path $RepoDir 'frontend'

$envFile = Get-Content (Join-Path $backend '.env')
$portLine = $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
$port = if ($portLine) { ($portLine -replace '^\s*PORT\s*=\s*', '').Trim() } else { '3000' }

$services = Get-Service AberturaProcessos-* -ErrorAction SilentlyContinue
if (-not $services) { throw 'Serviços AberturaProcessos-* não existem. Rode deploy\install-services.ps1 primeiro.' }

if (-not $SkipPull) {
  Write-Step "git pull em $RepoDir"
  Push-Location $RepoDir
  try { git pull --ff-only } finally { Pop-Location }
}

# Worker primeiro: não processar job com código antigo enquanto o schema muda (docs/11).
Write-Step 'Parando serviços (Worker, depois API)'
Stop-Service AberturaProcessos-Worker -ErrorAction SilentlyContinue
Stop-Service AberturaProcessos-API -ErrorAction SilentlyContinue

Push-Location $backend
try {
  if (-not $SkipBackup) {
    # Backup do banco antes do migrate deploy (migration não tem rollback automático).
    $dbLine = $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -Last 1
    $dbUrl = ($dbLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim('"')
    $dbName = if ($dbUrl -match 'database=([^;]+)') { $Matches[1] } else { $null }
    $instance = if ($dbUrl -match 'instanceName=([^;]+)') { "localhost\$($Matches[1])" } else { 'localhost' }
    $sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
    if ($dbName -and $sqlcmd) {
      $backupDir = Join-Path (Split-Path -Parent (($envFile | Where-Object { $_ -match '^\s*STORAGE_ROOT\s*=' } | Select-Object -Last 1) -replace '^\s*STORAGE_ROOT\s*=\s*', '').Trim('"')) 'backup'
      New-Item -ItemType Directory -Force $backupDir | Out-Null
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      $file = Join-Path $backupDir "pre-deploy-$stamp.bak"
      Write-Step "Backup do banco $dbName em $file"
      & sqlcmd -S $instance -E -Q "BACKUP DATABASE [$dbName] TO DISK='$file'"
    } else {
      Write-Warning 'Backup pulado: sqlcmd não encontrado ou DATABASE_URL sem database=. Use -SkipBackup para silenciar.'
    }
  }

  Write-Step 'Backend: npm ci (postinstall gera o Prisma Client) + build + migrate deploy'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci (backend) falhou' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build (backend) falhou' }
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy falhou' }
} finally { Pop-Location }

Push-Location $frontend
try {
  Write-Step 'Frontend: npm ci + build (dist\ com web.config)'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci (frontend) falhou' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build (frontend) falhou' }
} finally { Pop-Location }

Write-Step 'Iniciando serviços (API, depois Worker)'
Start-Service AberturaProcessos-API
$ready = $null
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try { $ready = Invoke-RestMethod "http://127.0.0.1:$port/health/ready" -TimeoutSec 5; break } catch { }
}
if (-not $ready) {
  Write-Warning "API não respondeu em :$port. Veja api-stderr.log."
  Get-Service AberturaProcessos-API
  return
}
Start-Service AberturaProcessos-Worker
Write-Host ("Atualizado. API status={0} database={1} redis={2}" -f $ready.status, $ready.checks.database, $ready.checks.redis) -ForegroundColor Green
Get-Service AberturaProcessos-* | Format-Table Name, Status -AutoSize
