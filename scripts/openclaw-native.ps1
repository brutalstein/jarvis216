$ErrorActionPreference = 'Stop'
# Packaged Windows apps redirect AppData on creation. Materialize the lock directory
# before OpenClaw canonicalizes it, so its ownership map uses one stable physical path.
$lockDirectory = Join-Path $env:USERPROFILE 'AppData\Local\OpenClaw\locks\openclaw-state-owners'
New-Item -ItemType Directory -Path $lockDirectory -Force | Out-Null

$portable = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\node-v24.22.0-win-x64'
$originalPath = $env:PATH
$apiKeys = @('OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY')
$previous = @{}
try {
    if (Test-Path -LiteralPath (Join-Path $portable 'node.exe')) { $env:PATH = "$portable;$env:PATH" }
    foreach ($key in $apiKeys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
    }
    $cliArgs = if ($args.Count) { $args } else { @('gateway', 'run') }
    & openclaw @cliArgs
    $result = $LASTEXITCODE
} finally {
    $env:PATH = $originalPath
    foreach ($key in $apiKeys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
exit $result
