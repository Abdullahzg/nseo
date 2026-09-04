# start-local.ps1 — One-command local startup for the SEO Workforce system.
# Starts Postgres, PostgREST, REST proxy, Next.js dev server, and Python Strands service.
# Follows AGENTS.md rules: no foreground blocking, explicit timeouts, port checks separate from spawn.

param(
    [switch]$SkipStrands,
    [switch]$SkipNextjs
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " SEO Workforce — Local Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Helper functions ──────────────────────────────────────────────────────────
function Test-Port($port) {
    try {
        $conn = New-Object System.Net.Sockets.TcpClient
        $conn.Connect("127.0.0.1", $port)
        $conn.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-ForPort($port, $name, $timeoutSec = 30) {
    $elapsed = 0
    while ($elapsed -lt $timeoutSec) {
        if (Test-Port $port) {
            Write-Host "  $name OK (port $port)" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }
    Write-Host "  $name TIMEOUT (port $port not responding after ${timeoutSec}s)" -ForegroundColor Red
    return $false
}

# ── 1. Postgres container ────────────────────────────────────────────────────
Write-Host "[1/5] Postgres..." -ForegroundColor Yellow
$pgContainer = docker ps -a --filter "name=seo-pg" --format "{{.Names}}" 2>$null
if ($pgContainer) {
    $pgStatus = docker inspect -f "{{.State.Status}}" seo-pg 2>$null
    if ($pgStatus -ne "running") {
        docker start seo-pg 2>$null | Out-Null
        Write-Host "  Started seo-pg container" -ForegroundColor Gray
    } else {
        Write-Host "  seo-pg already running" -ForegroundColor Gray
    }
} else {
    Write-Host "  seo-pg container not found — run docker compose up first" -ForegroundColor Red
}
Wait-ForPort 5433 "Postgres"

# ── 2. PostgREST container ───────────────────────────────────────────────────
Write-Host "[2/5] PostgREST..." -ForegroundColor Yellow
$pgrstContainer = docker ps -a --filter "name=seo-pgrst" --format "{{.Names}}" 2>$null
if ($pgrstContainer) {
    $pgrstStatus = docker inspect -f "{{.State.Status}}" seo-pgrst 2>$null
    if ($pgrstStatus -ne "running") {
        docker start seo-pgrst 2>$null | Out-Null
        Write-Host "  Started seo-pgrst container" -ForegroundColor Gray
    } else {
        Write-Host "  seo-pgrst already running" -ForegroundColor Gray
    }
} else {
    Write-Host "  seo-pgrst container not found — run docker compose up first" -ForegroundColor Red
}
Wait-ForPort 5441 "PostgREST"

# ── 3. REST proxy ────────────────────────────────────────────────────────────
Write-Host "[3/5] REST proxy..." -ForegroundColor Yellow
if (Test-Port 5440) {
    Write-Host "  REST proxy already running (port 5440)" -ForegroundColor Gray
} else {
    Start-Process -FilePath "node" -ArgumentList "scripts/dev-rest-proxy.mjs" `
        -WorkingDirectory $repoRoot -WindowStyle Hidden
    Wait-ForPort 5440 "REST proxy" 10
}

# ── 4. Next.js dev server ────────────────────────────────────────────────────
if (-not $SkipNextjs) {
    Write-Host "[4/5] Next.js dev server..." -ForegroundColor Yellow
    if (Test-Port 3100) {
        Write-Host "  Next.js already running (port 3100)" -ForegroundColor Gray
    } else {
        Start-Process -FilePath "npx" -ArgumentList "next dev -p 3100" `
            -WorkingDirectory $repoRoot -WindowStyle Hidden
        Wait-ForPort 3100 "Next.js" 60
    }
} else {
    Write-Host "[4/5] Next.js — SKIPPED" -ForegroundColor DarkGray
}

# ── 5. Python Strands service ────────────────────────────────────────────────
if (-not $SkipStrands) {
    Write-Host "[5/5] Python Strands service..." -ForegroundColor Yellow
    if (Test-Port 8104) {
        Write-Host "  Strands service already running (port 8104)" -ForegroundColor Gray
    } else {
        $env:MODEL_PROVIDER = if ($env:MODEL_PROVIDER) { $env:MODEL_PROVIDER } else { "groq" }
        $env:HACKATHON_MODE = "true"
        $env:AGENT_SERVICE_PORT = "8104"
        Start-Process -FilePath "python" `
            -ArgumentList "-m", "uvicorn", "seo_workforce.main:app", "--host", "0.0.0.0", "--port", "8104" `
            -WorkingDirectory "$repoRoot\agents" -WindowStyle Hidden
        Wait-ForPort 8104 "Strands service" 15
    }
} else {
    Write-Host "[5/5] Strands service — SKIPPED" -ForegroundColor DarkGray
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
$pgOk = Test-Port 5433
$pgrstOk = Test-Port 5441
$proxyOk = Test-Port 5440
$nextOk = Test-Port 3100
$strandsOk = Test-Port 8104

Write-Host ("  Postgres      {0}" -f ($(if($pgOk){"OK"}else{"FAIL"})) -ForegroundColor $(if($pgOk){"Green"}else{"Red"}))
Write-Host ("  PostgREST     {0}" -f ($(if($pgrstOk){"OK"}else{"FAIL"})) -ForegroundColor $(if($pgrstOk){"Green"}else{"Red"}))
Write-Host ("  REST proxy    {0}" -f ($(if($proxyOk){"OK"}else{"FAIL"})) -ForegroundColor $(if($proxyOk){"Green"}else{"Red"}))

if (-not $SkipNextjs) {
    Write-Host ("  Next.js       {0} http://localhost:3100" -f ($(if($nextOk){"OK"}else{"FAIL"})) -ForegroundColor $(if($nextOk){"Green"}else{"Red"}))
}

if (-not $SkipStrands) {
    Write-Host ("  Strands       {0} http://localhost:8104" -f ($(if($strandsOk){"OK"}else{"FAIL"})) -ForegroundColor $(if($strandsOk){"Green"}else{"Red"}))
}

$provider = if ($env:MODEL_PROVIDER) { $env:MODEL_PROVIDER } else { "groq" }
$model = if ($env:GROQ_MODEL) { $env:GROQ_MODEL } else { "openai/gpt-oss-120b" }
$hackathon = if ($env:HACKATHON_MODE -eq "true") { "true" } else { "false" }
Write-Host "  Provider      $provider"
Write-Host "  Model         $model"
Write-Host "  Hackathon     $hackathon"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
