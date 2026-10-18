$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    throw '.env missing; run scripts/bootstrap.ps1 then set BROWSER_* attestation values.'
}

# Load BROWSER_* (and related) from .env without printing secrets.
Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $name, $value = $_.Split('=', 2)
    $name = $name.Trim()
    if ($name -notmatch '^(BROWSER_|ANONYMIZED_TELEMETRY)') { return }
    Set-Item -Path "Env:$name" -Value $value.Trim().Trim('"')
}

if ($env:BROWSER_EGRESS_VERIFIED -ne 'true') {
    throw 'BROWSER_EGRESS_VERIFIED must be true before starting the native worker.'
}
if (-not $env:BROWSER_WORKER_TOKEN -or $env:BROWSER_WORKER_TOKEN.Length -lt 32) {
    throw 'BROWSER_WORKER_TOKEN must be at least 32 characters.'
}
if (-not $env:BROWSER_ALLOWED_URLS -or $env:BROWSER_ALLOWED_URLS -eq '[]') {
    throw 'BROWSER_ALLOWED_URLS must be a nonempty JSON array of exact public HTTPS URLs.'
}
if (-not $env:ANONYMIZED_TELEMETRY) { $env:ANONYMIZED_TELEMETRY = 'false' }
# Native Core reaches loopback; never publish the worker beyond 127.0.0.1 without attestation.
Remove-Item Env:JARVIS_CONTAINER -ErrorAction SilentlyContinue

Push-Location $root
try {
    uv sync --project workers/browser --locked | Out-Null
    Write-Output 'Starting Browser Use worker on 127.0.0.1:8765'
    uv run --project workers/browser --locked python workers/browser/worker.py
} finally {
    Pop-Location
}
