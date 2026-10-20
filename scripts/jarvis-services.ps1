#Requires -Version 5.1
<#
.SYNOPSIS
  Start, check, stop and diagnose JARVIS native Windows services in the background.
.EXAMPLE
  .\scripts\jarvis-services.ps1 -Action Start -WithDesktop
#>
[CmdletBinding()]
param(
  [ValidateSet('Start','Stop','Restart','Status','Logs','Doctor','EnvCheck')][string]$Action='Start',
  [ValidateSet('All','core','openclaw','browser','desktop')][string]$Service='All',
  [ValidateRange(1,500)][int]$Tail=50,
  [switch]$WithDesktop,
  [switch]$NoBuild,
  [switch]$InternalService,
  [ValidateSet('core','openclaw','browser')][string]$InternalName='core'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath=Join-Path $root '.env'
$stateDir=Join-Path $root 'data\runtime\service-manager'
$stateFile=Join-Path $stateDir 'state.json'
$logDir=Join-Path $stateDir 'logs'
$scriptPath=$MyInvocation.MyCommand.Path
$scriptName=[IO.Path]::GetFileName($scriptPath)

function Say([string]$Level,[string]$Message) {
  $color=switch ($Level) { 'OK' {'Green'} 'WARN' {'Yellow'} 'ERROR' {'Red'} default {'Cyan'} }
  Write-Host "[$Level] $Message" -ForegroundColor $color
}
function Die([string]$Code,[string]$Fix) { throw ("{0}: {1}" -f $Code,$Fix) }
function Env-Map {
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    Die 'ENV_MISSING' 'Missing .env. Run .\scripts\bootstrap.ps1 then configure providers.'
  }
  $items=@{}; $number=0
  foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    $number++
    # Windows editors / copied dotenv content sometimes add invisible prefix characters.
    # Do not alter the on-disk .env or any actual credential value.
    $s=$line.Trim().TrimStart([char]0xFEFF,[char]0x200B,[char]0x2060)
    if (-not $s -or $s.StartsWith('#')) { continue }
    # Regex.Match has explicit capture groups; it does not rely on PowerShell's
    # stateful $Matches automatic variable (which can be stale with -notmatch).
    $match=[regex]::Match($s,'^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)
}
function Value($Config,[string]$Name,[string]$Default='') {
  if ($null -ne $Config -and $Config.ContainsKey($Name)) { return [string]$Config[$Name] }
  return $Default
}
function Enabled($Config,[string]$Name) {
  $v=Value $Config $Name 'false'
  if ($v -notin @('true','false')) { Die 'ENV_FLAG' "Setting $Name must be true or false." }
  return $v -eq 'true'
}
function Command-Exists([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }
function Require-Command([string]$Name,[string]$Help) {
  if (-not (Command-Exists $Name)) { Die 'DEPENDENCY_MISSING' "Missing $Name. $Help" }
}
function Test-Port([int]$Port) {
  $tcp=New-Object System.Net.Sockets.TcpClient
  try {
    $async=$tcp.BeginConnect('127.0.0.1',$Port,$null,$null)
    if (-not $async.AsyncWaitHandle.WaitOne(600,$false)) { return $false }
    try { $tcp.EndConnect($async) } catch { return $false }
    return $true
  } catch { return $false } finally { $tcp.Close() }
}
function Test-Endpoint([string]$Url,[string]$Token='') {
  try {
    $headers=@{}
    if ($Token) { $headers['Authorization']="Bearer $Token" }
    $r=Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Get -Headers $headers -TimeoutSec 3 -ErrorAction Stop
    return $r.StatusCode -eq 200
  } catch { return $false }
}
function Wait-For([scriptblock]$Probe,[int]$Seconds,[string]$Name,[scriptblock]$Alive=$null) {
  $end=[DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $end) {
    if (& $Probe) { Say 'OK' "$Name responding."; return }
    if ($null -ne $Alive -and -not (& $Alive)) {
      Die 'SERVICE_EXITED' "$Name exited before readiness. Run: .\scripts\jarvis-services.ps1 -Action Logs -Service $Name"
    }
    Start-Sleep -Milliseconds 900
  }
  Die 'HEALTH_TIMEOUT' "$Name not healthy after $($Seconds)s. Check -Action Logs and port/configuration."
}
function Ensure-Dirs { [void](New-Item -ItemType Directory -Force -Path $logDir) }
function Read-State {
  if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { return @{processes=@{};docker=@{}} }
  try {
    $obj=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($stateFile))
    $state=@{processes=@{};docker=@{}}
    if ($null -ne $obj.processes) {
      foreach ($prop in $obj.processes.PSObject.Properties) { $state.processes[$prop.Name]=$prop.Value }
    }
    if ($null -ne $obj.docker) {
      foreach ($prop in $obj.docker.PSObject.Properties) { $state.docker[$prop.Name]=$prop.Value }
    }
    return $state
  } catch { Die 'STATE_INVALID' 'Back up and examine data/runtime/service-manager/state.json before continuing.' }
}
function Write-State($State) {
  Ensure-Dirs
  $tmp=Join-Path $stateDir ("state-{0}.tmp" -f $PID)
  try {
    [IO.File]::WriteAllText($tmp,(ConvertTo-Json -InputObject $State -Depth 12),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $stateFile -Force
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
function Tracked($Record,[string]$Name) {
  if ($null -eq $Record -or $null -eq $Record.pid) { return $false }
  $proc=Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return $false }
  try {
    $started=([DateTime]::Parse([string]$Record.startedUtc)).ToUniversalTime()
    if ([Math]::Abs(($proc.StartTime.ToUniversalTime()-$started).TotalSeconds) -gt 10) { return $false }
    $cim=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.pid)" -ErrorAction Stop
    if ($null -eq $cim) { return $false }
    if ($Name -eq 'desktop') { return $cim.CommandLine -like '*electron*' }
    return ($cim.CommandLine.Contains($scriptName) -and $cim.CommandLine.Contains('-InternalService') -and $cim.CommandLine.Contains($Name))
  } catch { return $false }
}
function Process-Alive($State,[string]$Name) {
  return $State.processes.ContainsKey($Name) -and (Tracked $State.processes[$Name] $Name)
}
function Print-Tail([string]$Name,$State,[int]$Lines) {
  $entry=$State.processes[$Name]
  if ($null -eq $entry) { Say 'WARN' "No managed $Name log entry."; return }
  foreach ($stream in @('stdout','stderr')) {
    $p=[string]$entry.$stream
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      Say 'INFO' "[$Name/$stream] $p"
      Get-Content -LiteralPath $p -Tail $Lines
    }
  }
}
function Run-Internal([string]$Name) {
  Set-Location -LiteralPath $root
  try {
    if ($Name -eq 'core') {
      # node --env-file does not override inherited environment: remove only .env settings.
      $settings=Env-Map
      foreach ($key in $settings.Keys) {
        if ($key -in @('PATH','Path','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','SystemRoot')) { continue }
        Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
      }
      & node --env-file=.env dist/main.js
    } elseif ($Name -eq 'openclaw') {
      & (Join-Path $PSScriptRoot 'openclaw-native.ps1')
    } elseif ($Name -eq 'browser') {
      & (Join-Path $PSScriptRoot 'browser-native.ps1')
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } catch {
    [Console]::Error.WriteLine("SERVICE_BOOT_FAILED ($Name). Check local config, dependencies and logs; secret values omitted.")
    exit 1
  }
}
if ($InternalService) { Run-Internal $InternalName; exit 0 }

function Start-Managed($State,[string]$Name,[scriptblock]$Probe,[int]$Seconds,[string]$Address) {
  if (Process-Alive $State $Name) {
    if ($null -ne $Probe -and -not (& $Probe)) {
      Say 'WARN' "$Name has a process but is not responding. Checking readiness."
      Wait-For $Probe $Seconds $Name { Process-Alive $State $Name }
    } else { Say 'OK' "$Name already running as managed PID $($State.processes[$Name].pid)." }
    return
  }
  if ($null -ne $Probe -and (& $Probe)) {
    Say 'WARN' "$Name responds at $Address but was started outside this manager; leaving untouched."
    if ($State.processes.ContainsKey($Name)) {
      [void]$State.processes.Remove($Name)
      Write-State $State
    }
    return
  }
  if ($Name -eq 'browser' -and (Test-Port 8765)) {
    Die 'BROWSER_PORT_BUSY' 'Port 8765 is in use but /healthz failed. Check existing process before retrying.'
  }
  Ensure-Dirs
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
  $stdout=Join-Path $logDir "$Name-$stamp.stdout.log"
  $stderr=Join-Path $logDir "$Name-$stamp.stderr.log"
  if ($Name -eq 'desktop') {
    $exe=Join-Path $root 'apps\desktop\node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $exe)) {
      Die 'DESKTOP_NOT_INSTALLED' 'Electron missing. Run npm ci --prefix apps/desktop --ignore-scripts and download Electron.'
    }
    $proc=Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory (Join-Path $root 'apps\desktop') -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  } else {
    $shell=(Get-Process -Id $PID).Path
    $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $scriptPath),'-InternalService','-InternalName',$Name)
    $proc=Start-Process -FilePath $shell -ArgumentList $arguments -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  }
  $State.processes[$Name]=@{pid=$proc.Id;startedUtc=$proc.StartTime.ToUniversalTime().ToString('o');stdout=$stdout;stderr=$stderr}
  Write-State $State
  Say 'INFO' "Started $Name as PID $($proc.Id). Logs in $logDir"
  if ($null -ne $Probe) { Wait-For $Probe $Seconds $Name { Process-Alive $State $Name } }
}
function Stop-Managed($State,[string]$Name) {
  if (-not $State.processes.ContainsKey($Name)) { return }
  if (-not (Process-Alive $State $Name)) {
    Say 'WARN' "$Name has no verified managed process; refusing to kill an unknown PID."
    [void]$State.processes.Remove($Name)
    Write-State $State
    return
  }
  $id=[int]$State.processes[$Name].pid
  Say 'INFO' "Stopping managed $Name process tree $id."
  & taskkill.exe /PID $id /T /F 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Say 'WARN' "Could not terminate $Name PID $id. Investigate manually." }
  else { [void]$State.processes.Remove($Name) }
  Write-State $State
}
function Compose([string[]]$DockerArgs,$Config) {
  # Compose environment interpolation otherwise prefers unrelated ambient variables.
  $keys=@('POSTGRES_PASSWORD','N8N_ENCRYPTION_KEY','BROWSER_WORKER_TOKEN','BROWSER_EGRESS_VERIFIED','BROWSER_ALLOWED_URLS','POSTGRES_HOST_PORT')
  $previous=@{}
  foreach ($key in $keys) {
    $previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    $value=Value $Config $key
    [Environment]::SetEnvironmentVariable($key,$(if ($value) {$value} else {$null}),'Process')
  }
  try {
    $argsForDocker=@('compose','--env-file',$envPath,'-f',(Join-Path $root 'compose.yaml'),'-f',(Join-Path $root 'compose.dev.yaml')) + $DockerArgs
    $output=& docker @argsForDocker 2>&1
    if ($LASTEXITCODE -ne 0) { Die 'DOCKER_COMPOSE_FAILED' 'Docker Compose failed. Inspect Docker Desktop and Compose files; secrets suppressed.' }
    return $output
  } finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
  }
}
function Compose-Running([string]$Name,$Config) {
  $id=@(Compose @('ps','--status','running','-q',$Name) $Config) | Where-Object { $_ -match '^[a-f0-9]{12,64}$' } | Select-Object -First 1
  return [bool]$id
}
function Start-Docker($State,[string]$Name,$Config) {
  Require-Command docker 'Install and launch Docker Desktop.'
  $dockerReady=$false
  try {
    $null=& docker info --format '{{.ServerVersion}}' 2>$null
    $dockerReady=$LASTEXITCODE -eq 0
  } catch { $dockerReady=$false }
  if (-not $dockerReady) {
    $desktop=Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktop -PathType Leaf)) {
      Die 'DOCKER_NOT_READY' 'Docker Engine is down and Docker Desktop executable was not found. Start Docker Desktop manually.'
    }
    Say 'WARN' 'Docker Engine is not running; launching Docker Desktop...'
    Start-Process -FilePath $desktop -WindowStyle Minimized | Out-Null
    Wait-For {
      try {
        $null=& docker info --format '{{.ServerVersion}}' 2>$null
        $LASTEXITCODE -eq 0
      } catch { $false }
    } 180 'Docker Engine' $null
  }
  if (Compose-Running $Name $Config) {
    if ($State.docker.ContainsKey($Name) -and [bool]$State.docker[$Name]) {
      Say 'OK' "Docker $Name already running and owned by this manager."
    } else {
      Say 'OK' "Docker $Name was already running externally; leaving ownership unchanged."
    }
    return
  }
  Say 'INFO' "Starting Docker $Name..."
  $null=Compose @('up','-d',$Name) $Config
  $State.docker[$Name]=$true
  Write-State $State
  if ($Name -eq 'postgres') {
    $port=[int](Value $Config 'POSTGRES_HOST_PORT' '55432')
    Wait-For { Test-Port $port } 100 'postgres' $null
  } elseif ($Name -eq 'n8n') {
    Wait-For { Test-Port 5678 } 150 'n8n' $null
  }
}
function Stop-Docker($State,[string]$Name,$Config) {
  if (-not $State.docker.ContainsKey($Name) -or -not [bool]$State.docker[$Name]) { return }
  if (-not (Command-Exists docker)) { Say 'WARN' "Docker CLI unavailable: cannot stop $Name."; return }
  Say 'INFO' "Stopping Docker $Name (retaining volumes)."
  $null=Compose @('stop',$Name) $Config
  [void]$State.docker.Remove($Name)
  Write-State $State
}
function Validate-Config($Config) {
  foreach ($key in @('POSTGRES_PASSWORD','DATABASE_URL','JARVIS_TOKEN')) {
    if (-not (Value $Config $key)) { Die 'ENV_INCOMPLETE' "Set required $key in .env." }
  }
  $db=Value $Config 'DATABASE_URL'
  if ($db -notmatch '^postgres(ql)?://') { Die 'DATABASE_URL_INVALID' 'Expected PostgreSQL connection string; value omitted.' }
  if ($db -notmatch '@(127\.0\.0\.1|localhost):([0-9]+)/') {
    Die 'DATABASE_ADDRESS' 'This manager requires PostgreSQL on a localhost TCP port.'
  }
  if ([int]$Matches[2] -ne [int](Value $Config 'POSTGRES_HOST_PORT' '55432')) {
    Die 'POSTGRES_PORT_MISMATCH' 'DATABASE_URL port and POSTGRES_HOST_PORT differ.'
  }
  if ((Enabled $Config 'ENABLE_BROWSER') -and -not (Enabled $Config 'BROWSER_EGRESS_VERIFIED')) {
    Die 'BROWSER_NOT_ATTESTED' 'Legacy browser worker needs verified network egress isolation. Do not set verified=true without checking.'
  }
  if ((Enabled $Config 'CLAUDE_AGENT_OPENCLAW_MCP') -and -not (Enabled $Config 'ENABLE_OPENCLAW')) {
    Die 'OPENCLAW_CONFIG' 'CLAUDE_AGENT_OPENCLAW_MCP requires ENABLE_OPENCLAW=true.'
  }
  if ((Enabled $Config 'CLAUDE_AGENT_PLAYWRIGHT') -and -not (Enabled $Config 'ENABLE_CLAUDE_AGENT')) {
    Die 'PLAYWRIGHT_CONFIG' 'CLAUDE_AGENT_PLAYWRIGHT requires ENABLE_CLAUDE_AGENT=true.'
  }
  if ((Enabled $Config 'CLAUDE_AGENT_PLAYWRIGHT') -and -not (Command-Exists npx)) {
    Die 'NPX_MISSING' 'Playwright MCP needs npx on PATH.'
  }
  if (Enabled $Config 'ENABLE_OPENCLAW') {
    Require-Command openclaw 'Install the OpenClaw CLI or fix PATH.'
  }
  if (Enabled $Config 'ENABLE_BROWSER') {
    Require-Command uv 'Install uv or disable the legacy Browser worker; Claude Playwright MCP is separate.'
  }
  if (Enabled $Config 'ENABLE_DESKTOP') {
    Require-Command uvx 'Windows-MCP desktop actions need uvx on PATH; install uv first.'
  }
}
function Report($State,$Config) {
  $port=2160
  if ($null -ne $Config -and (Value $Config 'PORT')) { $port=[int](Value $Config 'PORT') }
  $health=Test-Endpoint "http://127.0.0.1:$port/healthz"
  $ready=$false
  if ($null -ne $Config) { $ready=Test-Endpoint "http://127.0.0.1:$port/readyz" (Value $Config 'JARVIS_TOKEN') }
  $ocUrl=if ($null -ne $Config) { Value $Config 'OPENCLAW_URL' 'http://127.0.0.1:18789' } else { 'http://127.0.0.1:18789' }
  $ocPort=18789
  try { $ocPort=([Uri]$ocUrl).Port } catch {}
  $rows=@(
    @{name='core'; ready=$health; note="HTTP /healthz; /readyz=$ready"},
    @{name='openclaw';ready=(Test-Port $ocPort);note="TCP port $ocPort (not auth)"},
    @{name='browser';ready=(Test-Port 8765);note='TCP 8765 (not auth)'},
    @{name='n8n';ready=(Test-Port 5678);note='TCP 5678 (not auth)'}
  )
  foreach ($item in $rows) {
    $owned=Process-Alive $State $item.name
    $label=if ($item.ready -and $owned) {'managed/online'} elseif ($item.ready) {'external/online'} elseif ($owned) {'managed/unhealthy'} else {'stopped'}
    Say 'INFO' "$($item.name): $label; $($item.note)"
  }
  Say 'INFO' "desktop UI: $(if (Process-Alive $State 'desktop') {'managed/running'} else {'not managed'}) (Electron starts the voice worker)"
  if ($null -ne $Config -and (Enabled $Config 'CLAUDE_AGENT_PLAYWRIGHT')) {
    Say 'INFO' 'Playwright MCP: on demand inside Claude agent, no permanent daemon.'
  }
}
function Do-Stop($State,$Config) {
  foreach ($name in @('desktop','core','browser','openclaw')) { Stop-Managed $State $name }
  foreach ($name in @('n8n','postgres')) { Stop-Docker $State $name $Config }
  Say 'OK' 'Stopped managed processes only. External services remain untouched.'
}

try {
  if ($Action -in @('Status','Logs')) {
    $state=Read-State
    if ($Action -eq 'Logs') {
      foreach ($name in @('core','openclaw','browser','desktop')) {
        if ($Service -eq 'All' -or $Service -eq $name) { Print-Tail $name $state $Tail }
      }
      Say 'INFO' 'Docker logs: docker compose -f compose.yaml -f compose.dev.yaml logs --tail=50 postgres n8n'
    } else {
      $settings=$null
      if (Test-Path -LiteralPath $envPath) { try { $settings=Env-Map } catch { Say 'WARN' 'Could not parse .env; using defaults.' } }
      Report $state $settings
    }
    exit 0
  }
  if ($Action -eq 'EnvCheck') {
    $config=Env-Map
    Say 'OK' "ENV_PARSED: $($config.Count) effective keys. No values or files changed."
    # Show only explicitly non-secret settings; never dump the full environment.
    foreach ($key in @('ENABLE_CLAUDE_AGENT','CLAUDE_AGENT_PERMISSION_MODE',
       'CLAUDE_AGENT_PLAYWRIGHT','CLAUDE_AGENT_OPENCLAW_MCP',
       'ENABLE_OPENCLAW','ENABLE_BROWSER','ENABLE_N8N','ENABLE_CODEX','ENABLE_CLAUDE_CODE')) {
      if ($config.ContainsKey($key)) { Say 'INFO' "$key=$($config[$key])" }
    }
    exit 0
  }
  if ($Action -eq 'Doctor') {
    $config=Env-Map
    Validate-Config $config
    Require-Command node 'Install Node 24 and add it to PATH.'
    Require-Command npm 'Install npm with Node.'
    Require-Command docker 'Install Docker Desktop.'
    Say 'OK' 'Local .env and prerequisites checked; remote provider login not tested.'
    if (-not (Test-Path (Join-Path $root 'dist\main.js'))) { Say 'WARN' 'Core not built; Start will run npm run build.' }
    if ($WithDesktop -and -not (Test-Path (Join-Path $root 'apps\desktop\node_modules\electron\dist\electron.exe'))) {
      Say 'WARN' 'Electron missing. Install desktop dependencies before -WithDesktop.'
    }
    exit 0
  }
  $config=Env-Map
  $state=Read-State
  if ($Action -in @('Stop','Restart')) {
    Do-Stop $state $config
    if ($Action -eq 'Stop') { exit 0 }
  }
  Validate-Config $config
  Require-Command node 'Install Node 24.'
  Require-Command npm 'Install npm.'
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Die 'NPM_NOT_INSTALLED' 'Run npm ci --ignore-scripts first; installer is deliberately not automatic.'
  }
  if (-not $NoBuild) {
    Say 'INFO' 'Building Core (no model requests)...'
    Push-Location $root
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) { Die 'BUILD_FAILED' 'npm run build failed; inspect compiler output.' }
    } finally { Pop-Location }
  }
  if (-not (Test-Path (Join-Path $root 'dist\main.js'))) {
    Die 'DIST_MISSING' 'dist/main.js missing; rerun without -NoBuild.'
  }
  $port=[int](Value $config 'PORT' '2160')
  $endpoint="http://127.0.0.1:$port/readyz"
  $coreExternal=Test-Endpoint $endpoint (Value $config 'JARVIS_TOKEN')
  if (-not $coreExternal -and (Test-Port $port) -and -not (Process-Alive $state 'core')) {
    Die 'CORE_PORT_BUSY' "Port $port is occupied by an unknown/unhealthy process; refusing to start a duplicate."
  }
  if (-not $coreExternal -and -not (Process-Alive $state 'core')) {
    Start-Docker $state 'postgres' $config
  } else { Say 'INFO' 'Core already online/managed; leaving PostgreSQL lifecycle alone.' }
  if (Enabled $config 'ENABLE_OPENCLAW') {
    $ocPort=([Uri](Value $config 'OPENCLAW_URL' 'http://127.0.0.1:18789')).Port
    Start-Managed $state 'openclaw' { Test-Port $ocPort } 165 "127.0.0.1:$ocPort"
  }
  if (Enabled $config 'ENABLE_BROWSER') {
    Start-Managed $state 'browser' { Test-Endpoint 'http://127.0.0.1:8765/healthz' } 90 '127.0.0.1:8765'
  }
  if ((Enabled $config 'ENABLE_N8N') -or (Value $config 'CLAUDE_AGENT_N8N_MCP_URL')) {
    Say 'WARN' 'n8n with host-published native PostgreSQL weakens network isolation; avoid valued data.'
    Start-Docker $state 'n8n' $config
  }
  Start-Managed $state 'core' { Test-Endpoint $endpoint (Value $config 'JARVIS_TOKEN') } 105 "127.0.0.1:$port"
  if ($WithDesktop) {
    $desktopBuild=Join-Path $root 'apps\desktop\dist\main.cjs'
    if (-not (Test-Path -LiteralPath $desktopBuild)) {
      Say 'INFO' 'Building Electron UI...'
      Push-Location $root
      try {
        & npm --prefix apps/desktop run build
        if ($LASTEXITCODE -ne 0) { Die 'DESKTOP_BUILD_FAILED' 'Desktop build failed.' }
      } finally { Pop-Location }
    }
    Start-Managed $state 'desktop' $null 0 'desktop'
  }
  Say 'OK' 'JARVIS processes are detached; closing this terminal does not stop them.'
  Report $state $config
  Say 'INFO' 'Manage: .\scripts\jarvis-services.ps1 -Action Status | Logs | Stop | Restart'
} catch {
  Say 'ERROR' $_.Exception.Message
  Say 'INFO' 'Logs: .\scripts\jarvis-services.ps1 -Action Logs -Service All'
  Say 'INFO' 'Doctor: .\scripts\jarvis-services.ps1 -Action Doctor'
  exit 1
}
)
    if (-not $match.Success) {
      Die 'ENV_SYNTAX' "Invalid .env assignment at line $number. Expected KEY=VALUE; contents withheld. Check for pasted prompts or invisible characters."
    }
    $key=$match.Groups[1].Value
    $value=$match.Groups[2].Value.Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
      $value=$value.Substring(1,$value.Length-2)
    }
    if ($items.ContainsKey($key)) {
      # Node dotenv allows duplicate assignments; the last one is effective.
      # Only the key and line number are reported, never its contents.
      Say 'WARN' "ENV_DUPLICATE_OVERRIDE: $key appears again at line $number. Keeping the last value, leaving .env untouched."
    }
    $items[$key]=$value
  }
  return ,$items
}
function Value($Config,[string]$Name,[string]$Default='') {
  if ($null -ne $Config -and $Config.ContainsKey($Name)) { return [string]$Config[$Name] }
  return $Default
}
function Enabled($Config,[string]$Name) {
  $v=Value $Config $Name 'false'
  if ($v -notin @('true','false')) { Die 'ENV_FLAG' "Setting $Name must be true or false." }
  return $v -eq 'true'
}
function Command-Exists([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }
function Require-Command([string]$Name,[string]$Help) {
  if (-not (Command-Exists $Name)) { Die 'DEPENDENCY_MISSING' "Missing $Name. $Help" }
}
function Test-Port([int]$Port) {
  $tcp=New-Object System.Net.Sockets.TcpClient
  try {
    $async=$tcp.BeginConnect('127.0.0.1',$Port,$null,$null)
    if (-not $async.AsyncWaitHandle.WaitOne(600,$false)) { return $false }
    try { $tcp.EndConnect($async) } catch { return $false }
    return $true
  } catch { return $false } finally { $tcp.Close() }
}
function Test-Endpoint([string]$Url,[string]$Token='') {
  try {
    $headers=@{}
    if ($Token) { $headers['Authorization']="Bearer $Token" }
    $r=Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Get -Headers $headers -TimeoutSec 3 -ErrorAction Stop
    return $r.StatusCode -eq 200
  } catch { return $false }
}
function Wait-For([scriptblock]$Probe,[int]$Seconds,[string]$Name,[scriptblock]$Alive=$null) {
  $end=[DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $end) {
    if (& $Probe) { Say 'OK' "$Name responding."; return }
    if ($null -ne $Alive -and -not (& $Alive)) {
      Die 'SERVICE_EXITED' "$Name exited before readiness. Run: .\scripts\jarvis-services.ps1 -Action Logs -Service $Name"
    }
    Start-Sleep -Milliseconds 900
  }
  Die 'HEALTH_TIMEOUT' "$Name not healthy after $($Seconds)s. Check -Action Logs and port/configuration."
}
function Ensure-Dirs { [void](New-Item -ItemType Directory -Force -Path $logDir) }
function Read-State {
  if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { return @{processes=@{};docker=@{}} }
  try {
    $obj=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($stateFile))
    $state=@{processes=@{};docker=@{}}
    if ($null -ne $obj.processes) {
      foreach ($prop in $obj.processes.PSObject.Properties) { $state.processes[$prop.Name]=$prop.Value }
    }
    if ($null -ne $obj.docker) {
      foreach ($prop in $obj.docker.PSObject.Properties) { $state.docker[$prop.Name]=$prop.Value }
    }
    return $state
  } catch { Die 'STATE_INVALID' 'Back up and examine data/runtime/service-manager/state.json before continuing.' }
}
function Write-State($State) {
  Ensure-Dirs
  $tmp=Join-Path $stateDir ("state-{0}.tmp" -f $PID)
  try {
    [IO.File]::WriteAllText($tmp,(ConvertTo-Json -InputObject $State -Depth 12),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $stateFile -Force
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
function Tracked($Record,[string]$Name) {
  if ($null -eq $Record -or $null -eq $Record.pid) { return $false }
  $proc=Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return $false }
  try {
    $started=([DateTime]::Parse([string]$Record.startedUtc)).ToUniversalTime()
    if ([Math]::Abs(($proc.StartTime.ToUniversalTime()-$started).TotalSeconds) -gt 10) { return $false }
    $cim=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.pid)" -ErrorAction Stop
    if ($null -eq $cim) { return $false }
    if ($Name -eq 'desktop') { return $cim.CommandLine -like '*electron*' }
    return ($cim.CommandLine.Contains($scriptName) -and $cim.CommandLine.Contains('-InternalService') -and $cim.CommandLine.Contains($Name))
  } catch { return $false }
}
function Process-Alive($State,[string]$Name) {
  return $State.processes.ContainsKey($Name) -and (Tracked $State.processes[$Name] $Name)
}
function Print-Tail([string]$Name,$State,[int]$Lines) {
  $entry=$State.processes[$Name]
  if ($null -eq $entry) { Say 'WARN' "No managed $Name log entry."; return }
  foreach ($stream in @('stdout','stderr')) {
    $p=[string]$entry.$stream
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      Say 'INFO' "[$Name/$stream] $p"
      Get-Content -LiteralPath $p -Tail $Lines
    }
  }
}
function Run-Internal([string]$Name) {
  Set-Location -LiteralPath $root
  try {
    if ($Name -eq 'core') {
      # node --env-file does not override inherited environment: remove only .env settings.
      $settings=Env-Map
      foreach ($key in $settings.Keys) {
        if ($key -in @('PATH','Path','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','SystemRoot')) { continue }
        Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
      }
      & node --env-file=.env dist/main.js
    } elseif ($Name -eq 'openclaw') {
      & (Join-Path $PSScriptRoot 'openclaw-native.ps1')
    } elseif ($Name -eq 'browser') {
      & (Join-Path $PSScriptRoot 'browser-native.ps1')
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } catch {
    [Console]::Error.WriteLine("SERVICE_BOOT_FAILED ($Name). Check local config, dependencies and logs; secret values omitted.")
    exit 1
  }
}
if ($InternalService) { Run-Internal $InternalName; exit 0 }

function Start-Managed($State,[string]$Name,[scriptblock]$Probe,[int]$Seconds,[string]$Address) {
  if (Process-Alive $State $Name) {
    if ($null -ne $Probe -and -not (& $Probe)) {
      Say 'WARN' "$Name has a process but is not responding. Checking readiness."
      Wait-For $Probe $Seconds $Name { Process-Alive $State $Name }
    } else { Say 'OK' "$Name already running as managed PID $($State.processes[$Name].pid)." }
    return
  }
  if ($null -ne $Probe -and (& $Probe)) {
    Say 'WARN' "$Name responds at $Address but was started outside this manager; leaving untouched."
    if ($State.processes.ContainsKey($Name)) {
      [void]$State.processes.Remove($Name)
      Write-State $State
    }
    return
  }
  if ($Name -eq 'browser' -and (Test-Port 8765)) {
    Die 'BROWSER_PORT_BUSY' 'Port 8765 is in use but /healthz failed. Check existing process before retrying.'
  }
  Ensure-Dirs
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
  $stdout=Join-Path $logDir "$Name-$stamp.stdout.log"
  $stderr=Join-Path $logDir "$Name-$stamp.stderr.log"
  if ($Name -eq 'desktop') {
    $exe=Join-Path $root 'apps\desktop\node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $exe)) {
      Die 'DESKTOP_NOT_INSTALLED' 'Electron missing. Run npm ci --prefix apps/desktop --ignore-scripts and download Electron.'
    }
    $proc=Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory (Join-Path $root 'apps\desktop') -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  } else {
    $shell=(Get-Process -Id $PID).Path
    $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $scriptPath),'-InternalService','-InternalName',$Name)
    $proc=Start-Process -FilePath $shell -ArgumentList $arguments -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  }
  $State.processes[$Name]=@{pid=$proc.Id;startedUtc=$proc.StartTime.ToUniversalTime().ToString('o');stdout=$stdout;stderr=$stderr}
  Write-State $State
  Say 'INFO' "Started $Name as PID $($proc.Id). Logs in $logDir"
  if ($null -ne $Probe) { Wait-For $Probe $Seconds $Name { Process-Alive $State $Name } }
}
function Stop-Managed($State,[string]$Name) {
  if (-not $State.processes.ContainsKey($Name)) { return }
  if (-not (Process-Alive $State $Name)) {
    Say 'WARN' "$Name has no verified managed process; refusing to kill an unknown PID."
    [void]$State.processes.Remove($Name)
    Write-State $State
    return
  }
  $id=[int]$State.processes[$Name].pid
  Say 'INFO' "Stopping managed $Name process tree $id."
  & taskkill.exe /PID $id /T /F 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Say 'WARN' "Could not terminate $Name PID $id. Investigate manually." }
  else { [void]$State.processes.Remove($Name) }
  Write-State $State
}
function Compose([string[]]$DockerArgs,$Config) {
  # Compose environment interpolation otherwise prefers unrelated ambient variables.
  $keys=@('POSTGRES_PASSWORD','N8N_ENCRYPTION_KEY','BROWSER_WORKER_TOKEN','BROWSER_EGRESS_VERIFIED','BROWSER_ALLOWED_URLS','POSTGRES_HOST_PORT')
  $previous=@{}
  foreach ($key in $keys) {
    $previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    $value=Value $Config $key
    [Environment]::SetEnvironmentVariable($key,$(if ($value) {$value} else {$null}),'Process')
  }
  try {
    $argsForDocker=@('compose','--env-file',$envPath,'-f',(Join-Path $root 'compose.yaml'),'-f',(Join-Path $root 'compose.dev.yaml')) + $DockerArgs
    $output=& docker @argsForDocker 2>&1
    if ($LASTEXITCODE -ne 0) { Die 'DOCKER_COMPOSE_FAILED' 'Docker Compose failed. Inspect Docker Desktop and Compose files; secrets suppressed.' }
    return $output
  } finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
  }
}
function Compose-Running([string]$Name,$Config) {
  $id=@(Compose @('ps','--status','running','-q',$Name) $Config) | Where-Object { $_ -match '^[a-f0-9]{12,64}$' } | Select-Object -First 1
  return [bool]$id
}
function Start-Docker($State,[string]$Name,$Config) {
  Require-Command docker 'Install and launch Docker Desktop.'
  $dockerReady=$false
  try {
    $null=& docker info --format '{{.ServerVersion}}' 2>$null
    $dockerReady=$LASTEXITCODE -eq 0
  } catch { $dockerReady=$false }
  if (-not $dockerReady) {
    $desktop=Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktop -PathType Leaf)) {
      Die 'DOCKER_NOT_READY' 'Docker Engine is down and Docker Desktop executable was not found. Start Docker Desktop manually.'
    }
    Say 'WARN' 'Docker Engine is not running; launching Docker Desktop...'
    Start-Process -FilePath $desktop -WindowStyle Minimized | Out-Null
    Wait-For {
      try {
        $null=& docker info --format '{{.ServerVersion}}' 2>$null
        $LASTEXITCODE -eq 0
      } catch { $false }
    } 180 'Docker Engine' $null
  }
  if (Compose-Running $Name $Config) {
    if ($State.docker.ContainsKey($Name) -and [bool]$State.docker[$Name]) {
      Say 'OK' "Docker $Name already running and owned by this manager."
    } else {
      Say 'OK' "Docker $Name was already running externally; leaving ownership unchanged."
    }
    return
  }
  Say 'INFO' "Starting Docker $Name..."
  $null=Compose @('up','-d',$Name) $Config
  $State.docker[$Name]=$true
  Write-State $State
  if ($Name -eq 'postgres') {
    $port=[int](Value $Config 'POSTGRES_HOST_PORT' '55432')
    Wait-For { Test-Port $port } 100 'postgres' $null
  } elseif ($Name -eq 'n8n') {
    Wait-For { Test-Port 5678 } 150 'n8n' $null
  }
}
function Stop-Docker($State,[string]$Name,$Config) {
  if (-not $State.docker.ContainsKey($Name) -or -not [bool]$State.docker[$Name]) { return }
  if (-not (Command-Exists docker)) { Say 'WARN' "Docker CLI unavailable: cannot stop $Name."; return }
  Say 'INFO' "Stopping Docker $Name (retaining volumes)."
  $null=Compose @('stop',$Name) $Config
  [void]$State.docker.Remove($Name)
  Write-State $State
}
function Validate-Config($Config) {
  foreach ($key in @('POSTGRES_PASSWORD','DATABASE_URL','JARVIS_TOKEN')) {
    if (-not (Value $Config $key)) { Die 'ENV_INCOMPLETE' "Set required $key in .env." }
  }
  $db=Value $Config 'DATABASE_URL'
  if ($db -notmatch '^postgres(ql)?://') { Die 'DATABASE_URL_INVALID' 'Expected PostgreSQL connection string; value omitted.' }
  if ($db -notmatch '@(127\.0\.0\.1|localhost):([0-9]+)/') {
    Die 'DATABASE_ADDRESS' 'This manager requires PostgreSQL on a localhost TCP port.'
  }
  if ([int]$Matches[2] -ne [int](Value $Config 'POSTGRES_HOST_PORT' '55432')) {
    Die 'POSTGRES_PORT_MISMATCH' 'DATABASE_URL port and POSTGRES_HOST_PORT differ.'
  }
  if ((Enabled $Config 'ENABLE_BROWSER') -and -not (Enabled $Config 'BROWSER_EGRESS_VERIFIED')) {
    Die 'BROWSER_NOT_ATTESTED' 'Legacy browser worker needs verified network egress isolation. Do not set verified=true without checking.'
  }
  if ((Enabled $Config 'CLAUDE_AGENT_OPENCLAW_MCP') -and -not (Enabled $Config 'ENABLE_OPENCLAW')) {
    Die 'OPENCLAW_CONFIG' 'CLAUDE_AGENT_OPENCLAW_MCP requires ENABLE_OPENCLAW=true.'
  }
  if ((Enabled $Config 'CLAUDE_AGENT_PLAYWRIGHT') -and -not (Enabled $Config 'ENABLE_CLAUDE_AGENT')) {
    Die 'PLAYWRIGHT_CONFIG' 'CLAUDE_AGENT_PLAYWRIGHT requires ENABLE_CLAUDE_AGENT=true.'
  }
  if ((Enabled $Config 'CLAUDE_AGENT_PLAYWRIGHT') -and -not (Command-Exists npx)) {
    Die 'NPX_MISSING' 'Playwright MCP needs npx on PATH.'
  }
  if (Enabled $Config 'ENABLE_OPENCLAW') {
    Require-Command openclaw 'Install the OpenClaw CLI or fix PATH.'
  }
  if (Enabled $Config 'ENABLE_BROWSER') {
    Require-Command uv 'Install uv or disable the legacy Browser worker; Claude Playwright MCP is separate.'
  }
  if (Enabled $Config 'ENABLE_DESKTOP') {
    Require-Command uvx 'Windows-MCP desktop actions need uvx on PATH; install uv first.'
  }
}
function Report($State,$Config) {
  $port=2160
  if ($null -ne $Config -and (Value $Config 'PORT')) { $port=[int](Value $Config 'PORT') }
  $health=Test-Endpoint "http://127.0.0.1:$port/healthz"
  $ready=$false
  if ($null -ne $Config) { $ready=Test-Endpoint "http://127.0.0.1:$port/readyz" (Value $Config 'JARVIS_TOKEN') }
  $ocUrl=if ($null -ne $Config) { Value $Config 'OPENCLAW_URL' 'http://127.0.0.1:18789' } else { 'http://127.0.0.1:18789' }
  $ocPort=18789
  try { $ocPort=([Uri]$ocUrl).Port } catch {}
  $rows=@(
    @{name='core'; ready=$health; note="HTTP /healthz; /readyz=$ready"},
    @{name='openclaw';ready=(Test-Port $ocPort);note="TCP port $ocPort (not auth)"},
    @{name='browser';ready=(Test-Port 8765);note='TCP 8765 (not auth)'},
    @{name='n8n';ready=(Test-Port 5678);note='TCP 5678 (not auth)'}
  )
  foreach ($item in $rows) {
    $owned=Process-Alive $State $item.name
    $label=if ($item.ready -and $owned) {'managed/online'} elseif ($item.ready) {'external/online'} elseif ($owned) {'managed/unhealthy'} else {'stopped'}
    Say 'INFO' "$($item.name): $label; $($item.note)"
  }
  Say 'INFO' "desktop UI: $(if (Process-Alive $State 'desktop') {'managed/running'} else {'not managed'}) (Electron starts the voice worker)"
  if ($null -ne $Config -and (Enabled $Config 'CLAUDE_AGENT_PLAYWRIGHT')) {
    Say 'INFO' 'Playwright MCP: on demand inside Claude agent, no permanent daemon.'
  }
}
function Do-Stop($State,$Config) {
  foreach ($name in @('desktop','core','browser','openclaw')) { Stop-Managed $State $name }
  foreach ($name in @('n8n','postgres')) { Stop-Docker $State $name $Config }
  Say 'OK' 'Stopped managed processes only. External services remain untouched.'
}

try {
  if ($Action -in @('Status','Logs')) {
    $state=Read-State
    if ($Action -eq 'Logs') {
      foreach ($name in @('core','openclaw','browser','desktop')) {
        if ($Service -eq 'All' -or $Service -eq $name) { Print-Tail $name $state $Tail }
      }
      Say 'INFO' 'Docker logs: docker compose -f compose.yaml -f compose.dev.yaml logs --tail=50 postgres n8n'
    } else {
      $settings=$null
      if (Test-Path -LiteralPath $envPath) { try { $settings=Env-Map } catch { Say 'WARN' 'Could not parse .env; using defaults.' } }
      Report $state $settings
    }
    exit 0
  }
  if ($Action -eq 'Doctor') {
    $config=Env-Map
    Validate-Config $config
    Require-Command node 'Install Node 24 and add it to PATH.'
    Require-Command npm 'Install npm with Node.'
    Require-Command docker 'Install Docker Desktop.'
    Say 'OK' 'Local .env and prerequisites checked; remote provider login not tested.'
    if (-not (Test-Path (Join-Path $root 'dist\main.js'))) { Say 'WARN' 'Core not built; Start will run npm run build.' }
    if ($WithDesktop -and -not (Test-Path (Join-Path $root 'apps\desktop\node_modules\electron\dist\electron.exe'))) {
      Say 'WARN' 'Electron missing. Install desktop dependencies before -WithDesktop.'
    }
    exit 0
  }
  $config=Env-Map
  $state=Read-State
  if ($Action -in @('Stop','Restart')) {
    Do-Stop $state $config
    if ($Action -eq 'Stop') { exit 0 }
  }
  Validate-Config $config
  Require-Command node 'Install Node 24.'
  Require-Command npm 'Install npm.'
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Die 'NPM_NOT_INSTALLED' 'Run npm ci --ignore-scripts first; installer is deliberately not automatic.'
  }
  if (-not $NoBuild) {
    Say 'INFO' 'Building Core (no model requests)...'
    Push-Location $root
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) { Die 'BUILD_FAILED' 'npm run build failed; inspect compiler output.' }
    } finally { Pop-Location }
  }
  if (-not (Test-Path (Join-Path $root 'dist\main.js'))) {
    Die 'DIST_MISSING' 'dist/main.js missing; rerun without -NoBuild.'
  }
  $port=[int](Value $config 'PORT' '2160')
  $endpoint="http://127.0.0.1:$port/readyz"
  $coreExternal=Test-Endpoint $endpoint (Value $config 'JARVIS_TOKEN')
  if (-not $coreExternal -and (Test-Port $port) -and -not (Process-Alive $state 'core')) {
    Die 'CORE_PORT_BUSY' "Port $port is occupied by an unknown/unhealthy process; refusing to start a duplicate."
  }
  if (-not $coreExternal -and -not (Process-Alive $state 'core')) {
    Start-Docker $state 'postgres' $config
  } else { Say 'INFO' 'Core already online/managed; leaving PostgreSQL lifecycle alone.' }
  if (Enabled $config 'ENABLE_OPENCLAW') {
    $ocPort=([Uri](Value $config 'OPENCLAW_URL' 'http://127.0.0.1:18789')).Port
    Start-Managed $state 'openclaw' { Test-Port $ocPort } 165 "127.0.0.1:$ocPort"
  }
  if (Enabled $config 'ENABLE_BROWSER') {
    Start-Managed $state 'browser' { Test-Endpoint 'http://127.0.0.1:8765/healthz' } 90 '127.0.0.1:8765'
  }
  if ((Enabled $config 'ENABLE_N8N') -or (Value $config 'CLAUDE_AGENT_N8N_MCP_URL')) {
    Say 'WARN' 'n8n with host-published native PostgreSQL weakens network isolation; avoid valued data.'
    Start-Docker $state 'n8n' $config
  }
  Start-Managed $state 'core' { Test-Endpoint $endpoint (Value $config 'JARVIS_TOKEN') } 105 "127.0.0.1:$port"
  if ($WithDesktop) {
    $desktopBuild=Join-Path $root 'apps\desktop\dist\main.cjs'
    if (-not (Test-Path -LiteralPath $desktopBuild)) {
      Say 'INFO' 'Building Electron UI...'
      Push-Location $root
      try {
        & npm --prefix apps/desktop run build
        if ($LASTEXITCODE -ne 0) { Die 'DESKTOP_BUILD_FAILED' 'Desktop build failed.' }
      } finally { Pop-Location }
    }
    Start-Managed $state 'desktop' $null 0 'desktop'
  }
  Say 'OK' 'JARVIS processes are detached; closing this terminal does not stop them.'
  Report $state $config
  Say 'INFO' 'Manage: .\scripts\jarvis-services.ps1 -Action Status | Logs | Stop | Restart'
} catch {
  Say 'ERROR' $_.Exception.Message
  Say 'INFO' 'Logs: .\scripts\jarvis-services.ps1 -Action Logs -Service All'
  Say 'INFO' 'Doctor: .\scripts\jarvis-services.ps1 -Action Doctor'
  exit 1
}
