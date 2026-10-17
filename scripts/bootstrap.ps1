$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
if (Test-Path -LiteralPath $target) { throw '.env already exists; preserve it and edit explicitly.' }
function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
$content = Get-Content -LiteralPath (Join-Path $root '.env.example') -Raw
$password = New-LocalSecret
$content = $content.Replace('REPLACE_POSTGRES_PASSWORD', $password)
foreach ($placeholder in @('REPLACE_OPERATOR_TOKEN_WITH_RANDOM_SECRET', 'REPLACE_N8N_TOKEN_WITH_DIFFERENT_RANDOM_SECRET', 'REPLACE_N8N_ENCRYPTION_KEY', 'REPLACE_BROWSER_TOKEN')) {
    $content = $content.Replace($placeholder, (New-LocalSecret))
}
[IO.File]::WriteAllText($target, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Created .env with independent random secrets. No provider has been enabled.'
