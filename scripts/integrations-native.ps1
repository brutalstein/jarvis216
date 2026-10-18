param(
    [switch]$SkipOpenClaw,
    [switch]$SkipBrowser,
    [switch]$SkipN8n,
    [int]$OpenClawWaitSeconds = 90,
    [int]$BrowserWaitSeconds = 30
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    throw '.env missing; run scripts/bootstrap.ps1 first.'
}

function Get-DotEnvValue([string]$Name) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line.Substring($Name.Length + 1).Trim().Trim('"'))
}

function Wait-HttpOk([string]$Url, [int]$Seconds, [hashtable]$Headers = @{}) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method GET -Headers $Headers -TimeoutSec 3 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

$jobs = @()
try {
    if (-not $SkipN8n) {
        Write-Output 'Starting n8n via Docker Compose automations profile...'
        Push-Location $root
        try {
            docker compose --profile automations up -d
        } finally {
            Pop-Location
        }
    }

    if (-not $SkipOpenClaw) {
        Write-Output 'Starting OpenClaw Gateway (native)...'
        $jobs += Start-Job -Name 'openclaw-native' -ScriptBlock {
            param($scriptRoot)
            & (Join-Path $scriptRoot 'openclaw-native.ps1')
        } -ArgumentList $PSScriptRoot
        $openclawUrl = (Get-DotEnvValue 'OPENCLAW_URL')
        if (-not $openclawUrl) { $openclawUrl = 'http://127.0.0.1:18789' }
        $probe = ($openclawUrl.TrimEnd('/') + '/')
        if (-not (Wait-HttpOk $probe $OpenClawWaitSeconds)) {
            Write-Warning "OpenClaw did not answer at $probe within ${OpenClawWaitSeconds}s; check the openclaw-native job."
        } else {
            Write-Output "OpenClaw reachable at $openclawUrl"
        }
    }

    if (-not $SkipBrowser) {
        Write-Output 'Starting Browser Use worker (native)...'
        $jobs += Start-Job -Name 'browser-native' -ScriptBlock {
            param($scriptRoot)
            & (Join-Path $scriptRoot 'browser-native.ps1')
        } -ArgumentList $PSScriptRoot
        if (-not (Wait-HttpOk 'http://127.0.0.1:8765/healthz' $BrowserWaitSeconds)) {
            Write-Warning "Browser worker did not answer /healthz within ${BrowserWaitSeconds}s; confirm BROWSER_EGRESS_VERIFIED and allowlist."
        } else {
            Write-Output 'Browser worker healthy on 127.0.0.1:8765'
        }
    }

    Write-Output ''
    Write-Output 'Native integration processes launched. Next:'
    Write-Output '  1. Ensure PostgreSQL is up (docker compose up -d postgres, or compose.dev).'
    Write-Output '  2. Enable only attested providers in .env (ENABLE_OPENCLAW / ENABLE_BROWSER / ENABLE_N8N).'
    Write-Output '  3. Start Core: npm run build; npm start'
    Write-Output '  4. Stop background jobs: Get-Job | Stop-Job; Get-Job | Remove-Job'
    Write-Output ''
    Write-Output 'Active jobs (receive with Receive-Job -Name <name>):'
    Get-Job | Format-Table -AutoSize Id, Name, State
} catch {
    foreach ($job in $jobs) {
        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    }
    throw
}
