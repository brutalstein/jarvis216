param([string]$Destination = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\jarvis216-checkpoint.bundle'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
git -C $root bundle create $Destination --all
if ($LASTEXITCODE -ne 0) { throw 'Bundle creation failed' }
git -C $root bundle verify $Destination
if ($LASTEXITCODE -ne 0) { throw 'Bundle verification failed' }
Write-Output 'Git history backed up. Uncommitted files, .env and database volumes are not in the bundle.'
