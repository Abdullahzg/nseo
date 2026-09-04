# stop-local.ps1 — Stop only processes belonging to this application.
# Conservative: does not kill arbitrary Node/Python processes.

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "Stopping SEO Workforce local services..." -ForegroundColor Yellow

# ── Stop Python Strands service (uvicorn on port 8104) ───────────────────────
$uvicornProcs = Get-NetTCPConnection -LocalPort 8104 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if ($uvicornProcs) {
    foreach ($pid in $uvicornProcs) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "python") {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped Python/uvicorn (PID $pid)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  Python/uvicorn not running" -ForegroundColor DarkGray
}

# ── Stop Next.js dev server (node on port 3100) ──────────────────────────────
$nextProcs = Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if ($nextProcs) {
    foreach ($pid in $nextProcs) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            # Only kill if it's running next (check command line)
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue).CommandLine
            if ($cmdLine -and $cmdLine -match "next") {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "  Stopped Next.js (PID $pid)" -ForegroundColor Gray
            }
        }
    }
} else {
    Write-Host "  Next.js not running" -ForegroundColor DarkGray
}

# ── Stop REST proxy (node on port 5440) ──────────────────────────────────────
$proxyProcs = Get-NetTCPConnection -LocalPort 5440 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if ($proxyProcs) {
    foreach ($pid in $proxyProcs) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue).CommandLine
            if ($cmdLine -and $cmdLine -match "dev-rest-proxy") {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "  Stopped REST proxy (PID $pid)" -ForegroundColor Gray
            }
        }
    }
} else {
    Write-Host "  REST proxy not running" -ForegroundColor DarkGray
}

# ── Do NOT stop Docker containers (Postgres/PostgREST) — data preservation ──
Write-Host "  Docker containers (seo-pg, seo-pgrst) left running" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
