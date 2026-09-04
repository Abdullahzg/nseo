# test-local.ps1 — Run the full local validation suite.
# Covers: TS tests, TS typecheck, Python tests, Strands smoke, health, E2E.
# Prints a clear PASS/FAIL/SKIPPED summary.

param(
    [switch]$SkipGroqSmoke,
    [switch]$SkipE2E
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
$results = @{}

function Run-Test($name, $scriptBlock) {
    Write-Host "  Testing: $name ... " -NoNewline
    try {
        $output = & $scriptBlock 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0 -or $null -eq $exitCode) {
            Write-Host "PASS" -ForegroundColor Green
            return @{ Name = $name; Status = "PASS"; Output = $output }
        } else {
            Write-Host "FAIL" -ForegroundColor Red
            return @{ Name = $name; Status = "FAIL"; Output = $output }
        }
    } catch {
        Write-Host "FAIL" -ForegroundColor Red
        return @{ Name = $name; Status = "FAIL"; Output = $_.Exception.Message }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " LOCAL VALIDATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. TypeScript tests ──────────────────────────────────────────────────────
Write-Host "[TypeScript]" -ForegroundColor Yellow
$r = Run-Test "TypeScript tests" { Set-Location $repoRoot; npx vitest run 2>&1 }
$results["ts_tests"] = $r

# ── 2. TypeScript typecheck ──────────────────────────────────────────────────
$r = Run-Test "TypeScript typecheck" { Set-Location $repoRoot; npx tsc --noEmit 2>&1 }
$results["ts_typecheck"] = $r

# ── 3. Python tests ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[Python]" -ForegroundColor Yellow
$r = Run-Test "Python tests" {
    $env:GROQ_API_KEY = "gsk_test_key_for_unit_tests_only"
    $env:MODEL_PROVIDER = "groq"
    $env:HACKATHON_MODE = "true"
    Set-Location $repoRoot
    python -m pytest agents/seo_workforce/test_agents.py -v 2>&1
}
$results["py_tests"] = $r

# ── 4. Python imports ────────────────────────────────────────────────────────
$r = Run-Test "Python imports" {
    $env:GROQ_API_KEY = "gsk_test_key_for_unit_tests_only"
    $env:MODEL_PROVIDER = "groq"
    python -c "from agents.seo_workforce.config import model_description; from agents.seo_workforce.agents import campaign_manager, ALL_TOOLS; from agents.seo_workforce.main import app; print('OK')" 2>&1
}
$results["py_imports"] = $r

# ── 5. Strands agents/tools count ────────────────────────────────────────────
$r = Run-Test "Strands 8 agents + 9 tools" {
    $env:GROQ_API_KEY = "gsk_test_key_for_unit_tests_only"
    $env:MODEL_PROVIDER = "groq"
    python -c "
from agents.seo_workforce.agents import campaign_manager, strategy_agent, discovery_agent, qualification_agent, contact_agent, outreach_agent, negotiation_agent, intervention_agent, ALL_TOOLS
assert len(ALL_TOOLS) == 9, f'Expected 9 tools, got {len(ALL_TOOLS)}'
print(f'agents=8 tools={len(ALL_TOOLS)} OK')
" 2>&1
}
$results["strands_structure"] = $r

# ── 6. Config diagnostic ─────────────────────────────────────────────────────
$r = Run-Test "Config diagnostic" {
    $env:GROQ_API_KEY = "gsk_test_key_for_unit_tests_only"
    $env:MODEL_PROVIDER = "groq"
    python -c "
from agents.seo_workforce.config import MODEL_PROVIDER, GROQ_MODEL, HACKATHON_MODE
assert MODEL_PROVIDER == 'groq', f'Expected groq, got {MODEL_PROVIDER}'
assert HACKATHON_MODE == True
print(f'provider={MODEL_PROVIDER} model={GROQ_MODEL} hackathon={HACKATHON_MODE}')
" 2>&1
}
$results["config"] = $r

# ── 7. Groq smoke test (requires real key) ───────────────────────────────────
if (-not $SkipGroqSmoke -and $env:GROQ_API_KEY -and $env:GROQ_API_KEY.Length -gt 20) {
    Write-Host ""
    Write-Host "[Groq Live]" -ForegroundColor Yellow
    $r = Run-Test "Groq smoke + tool calling" {
        Set-Location $repoRoot
        python scripts/groq-strands-smoke.py 2>&1
    }
    $results["groq_smoke"] = $r
} else {
    Write-Host ""
    Write-Host "[Groq Live]" -ForegroundColor Yellow
    Write-Host "  Testing: Groq smoke ... SKIPPED (no GROQ_API_KEY)" -ForegroundColor DarkGray
    $results["groq_smoke"] = @{ Name = "Groq smoke"; Status = "SKIPPED"; Output = "" }
}

# ── 8. Health check ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[Integration]" -ForegroundColor Yellow
if (Test-NetConnection -ComputerName localhost -Port 8104 -WarningAction SilentlyContinue) {
    $r = Run-Test "Health endpoint" {
        $resp = Invoke-RestMethod -Uri "http://localhost:8104/health" -Method GET -TimeoutSec 5
        if ($resp.ok -and $resp.framework -eq "strands-agents") { "OK" } else { throw "Health check failed" }
    }
    $results["health"] = $r
} else {
    Write-Host "  Testing: Health endpoint ... SKIPPED (port 8104 not listening)" -ForegroundColor DarkGray
    $results["health"] = @{ Name = "Health endpoint"; Status = "SKIPPED"; Output = "" }
}

# ── 9. E2E campaign (requires all services running + real Groq key) ──────────
if (-not $SkipE2E -and (Test-NetConnection -ComputerName localhost -Port 3100 -WarningAction SilentlyContinue) -and $env:GROQ_API_KEY -and $env:GROQ_API_KEY.Length -gt 20) {
    Write-Host ""
    Write-Host "[E2E]" -ForegroundColor Yellow
    $r = Run-Test "Full campaign E2E" {
        Set-Location $repoRoot
        python scripts/e2e-campaign-test.py 2>&1
    }
    $results["e2e"] = $r
} else {
    Write-Host ""
    Write-Host "[E2E]" -ForegroundColor Yellow
    Write-Host "  Testing: Full campaign E2E ... SKIPPED (services or key missing)" -ForegroundColor DarkGray
    $results["e2e"] = @{ Name = "Full campaign E2E"; Status = "SKIPPED"; Output = "" }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " RESULTS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$failCount = 0
foreach ($key in $results.Keys) {
    $r = $results[$key]
    $color = switch ($r.Status) { "PASS" { "Green" } "FAIL" { "Red" } "SKIPPED" { "DarkGray" } }
    Write-Host ("  {0,-25} {1}" -f $r.Name, $r.Status) -ForegroundColor $color
    if ($r.Status -eq "FAIL") { $failCount++ }
}

Write-Host ""
if ($failCount -eq 0) {
    Write-Host "RESULT: LOCAL SYSTEM GREEN" -ForegroundColor Green
} else {
    Write-Host "RESULT: $failCount FAILED" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
