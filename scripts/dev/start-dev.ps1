<#
.SYNOPSIS
    PurpleInk one-click local development launcher.

.DESCRIPTION
    Brings up the full local stack in dependency order:

      1. Toolchain preflight  - node / pnpm / docker presence and versions.
      2. Environment preflight - required variable NAMES in .env.local (values are never printed).
      3. Postgres             - starts the Docker engine if needed, then docker-compose.dev.yml,
                                waits for the container healthcheck and a real TCP handshake.
      4. Dependencies         - pnpm install when node_modules is missing or the lockfile is newer.
      5. Migrations           - pnpm db:migrate.
      6. Dev processes        - Next (default 3000) and the render worker (default 8787), each in
                                its own persistent PowerShell window so logs stay readable and the
                                window does not close when the process exits.
      7. Readiness            - HTTP probes for the web app, the worker /health endpoint and the
                                same-origin /api/engine/health reverse proxy seam.

    Port conflicts are detected before launch. By default the script picks the next free port and
    keeps the reverse proxy wired (BACKEND_ORIGIN is adjusted automatically). Use -KillPort to
    reclaim the configured port instead, or -StrictPort to fail fast.

.PARAMETER WebPort
    Port for the Next dev server. Default 3000.

.PARAMETER WorkerPort
    Port for the render worker. Default 8787.

.PARAMETER SkipDocker
    Do not touch Docker. Assumes Postgres is already reachable.

.PARAMETER SkipInstall
    Do not run pnpm install even if dependencies look stale.

.PARAMETER SkipMigrate
    Do not run pnpm db:migrate.

.PARAMETER NoWeb
    Do not start the Next dev server.

.PARAMETER NoWorker
    Do not start the render worker.

.PARAMETER KillPort
    Stop whatever owns a needed port instead of shifting to a free one. Prompts unless -Force.

.PARAMETER StrictPort
    Fail instead of shifting to a free port when the configured port is busy.

.PARAMETER OpenBrowser
    Open the products workbench once the web app answers.

.PARAMETER Log
    Tee child-process output into .data/logs (git-ignored) in addition to the console.

.PARAMETER ReadyTimeoutSec
    Seconds to wait for each dev process to answer. Default 180.

.PARAMETER Status
    Report stack state and exit without starting anything.

.PARAMETER Stop
    Stop the dev processes owning the configured ports and exit. Prompts unless -Force.

.PARAMETER Force
    Skip confirmation prompts for -KillPort and -Stop.

.EXAMPLE
    pnpm dev:all

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-dev.ps1 -Status

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-dev.ps1 -KillPort -Force -OpenBrowser

.NOTES
    Windows PowerShell 5.1 compatible. Secret values are never echoed, logged or written anywhere.
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$WebPort = 3000,
    [ValidateRange(1, 65535)][int]$WorkerPort = 8787,
    [switch]$SkipDocker,
    [switch]$SkipInstall,
    [switch]$SkipMigrate,
    [switch]$NoWeb,
    [switch]$NoWorker,
    [switch]$KillPort,
    [switch]$StrictPort,
    [switch]$OpenBrowser,
    [switch]$Log,
    [ValidateRange(10, 900)][int]$ReadyTimeoutSec = 180,
    [switch]$Status,
    [switch]$Stop,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- Constants -------------------------------------------------------------------------------

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeFile = Join-Path $RepoRoot 'docker-compose.dev.yml'
$ComposeService = 'postgres'
$LogDir = Join-Path $RepoRoot '.data\logs'
$MinNodeMajor = 22
$MinNodeMinor = 11
$ExpectedPnpm = '10.30.0'
$DockerEngineWaitSec = 180
$PostgresWaitSec = 120

# Required variable NAMES only. Values are read to test emptiness and never printed.
$RequiredEnvKeys = @('DATABASE_URL', 'CVC_CREDENTIAL_MASTER_KEY')
$AdvisoryEnvKeys = @('TEST_DATABASE_URL', 'GEMINI_API_KEY', 'STEPFUN_API_KEY')

$script:Warnings = New-Object System.Collections.Generic.List[string]

# --- Output helpers --------------------------------------------------------------------------

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host "== $Title " -ForegroundColor Cyan -NoNewline
    Write-Host ('=' * [Math]::Max(4, 72 - $Title.Length)) -ForegroundColor DarkCyan
}

function Write-Step {
    param([string]$Message)
    Write-Host "  -> $Message" -ForegroundColor Gray
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [ ok ] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [warn] $Message" -ForegroundColor Yellow
    $script:Warnings.Add($Message)
}

function Write-Fail {
    param([string]$Message, [string]$Hint)
    Write-Host "  [fail] $Message" -ForegroundColor Red
    if ($Hint) { Write-Host "         hint: $Hint" -ForegroundColor DarkYellow }
}

function Stop-WithError {
    param([string]$Message, [string]$Hint)
    Write-Fail -Message $Message -Hint $Hint
    exit 1
}

function Clear-StatusLine {
    <# Wipes an in-place progress line so the next message does not inherit its tail. #>
    Write-Host ("`r" + (' ' * 78) + "`r") -NoNewline
}

function Confirm-Action {
    param([string]$Question)
    if ($Force) { return $true }
    $answer = Read-Host "  $Question [y/N]"
    return ($answer -match '^(y|yes)$')
}

# --- Process / port helpers ------------------------------------------------------------------

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
    <# Runs an external command, returns @{ Code; Output } and never throws on non-zero exit. #>
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @(),
        [string]$WorkDir = $RepoRoot
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $previousLocation = Get-Location
    try {
        Set-Location -LiteralPath $WorkDir
        $output = & $File @Arguments 2>&1
        return @{ Code = $LASTEXITCODE; Output = ($output | Out-String).Trim() }
    }
    finally {
        Set-Location -LiteralPath $previousLocation
        $ErrorActionPreference = $prev
    }
}

function Get-PortOwner {
    <# Returns @{ Pid; Name; Path } for the process listening on a port, or $null. #>
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
    }
    catch {
        return $null
    }
    if (-not $conn) { return $null }
    $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    $name = 'unknown'
    $path = ''
    if ($owner) {
        $name = $owner.ProcessName
        if ($owner.Path) { $path = $owner.Path }
    }
    return @{ Pid = [int]$conn.OwningProcess; Name = $name; Path = $path }
}

function Test-PortFree {
    param([int]$Port)
    return ($null -eq (Get-PortOwner -Port $Port))
}

function Find-FreePort {
    param([int]$Start, [int]$Attempts = 25)
    for ($candidate = $Start; $candidate -lt ($Start + $Attempts); $candidate++) {
        if ($candidate -gt 65535) { break }
        if (Test-PortFree -Port $candidate) { return $candidate }
    }
    return 0
}

function Stop-PortOwner {
    param([int]$Port, [string]$Label)
    $owner = Get-PortOwner -Port $Port
    if (-not $owner) {
        Write-Step "$Label port $Port is already free."
        return $true
    }
    if (-not (Confirm-Action "Stop $($owner.Name) (pid $($owner.Pid)) holding $Label port ${Port}?")) {
        Write-Warn "Left pid $($owner.Pid) running on port $Port."
        return $false
    }
    try {
        Stop-Process -Id $owner.Pid -Force -ErrorAction Stop
    }
    catch {
        Write-Fail "Could not stop pid $($owner.Pid) on port $Port." 'Run this window as the same user that started the process.'
        return $false
    }
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-PortFree -Port $Port) {
            Write-Ok "Freed $Label port $Port (stopped pid $($owner.Pid))."
            return $true
        }
    }
    Write-Warn "Port $Port still busy after stopping pid $($owner.Pid)."
    return $false
}

function Resolve-DevPort {
    <# Returns the port to use, honouring -KillPort / -StrictPort, or 0 when unresolvable. #>
    param([int]$Requested, [string]$Label)
    if (Test-PortFree -Port $Requested) {
        Write-Ok "$Label port $Requested is free."
        return $Requested
    }
    $owner = Get-PortOwner -Port $Requested
    Write-Warn "$Label port $Requested is held by $($owner.Name) (pid $($owner.Pid))."
    if ($KillPort) {
        if (Stop-PortOwner -Port $Requested -Label $Label) { return $Requested }
        return 0
    }
    if ($StrictPort) {
        Write-Fail "$Label port $Requested unavailable and -StrictPort was set." 'Re-run with -KillPort, or pass another port.'
        return 0
    }
    $shifted = Find-FreePort -Start ($Requested + 1)
    if ($shifted -eq 0) {
        Write-Fail "No free $Label port near $Requested." 'Free a port manually or pass an explicit value.'
        return 0
    }
    Write-Ok "$Label will use port $shifted instead."
    return $shifted
}

function Wait-HttpReady {
    <# Polls a URL until any HTTP response arrives (a 4xx still proves the listener is up). #>
    param([string]$Url, [int]$TimeoutSec, [string]$Label)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $spinner = '|/-\'
    $tick = 0
    while ((Get-Date) -lt $deadline) {
        try {
            $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -Method Get
            Clear-StatusLine
            Write-Ok "$Label answered at $Url"
            return $true
        }
        catch {
            $response = $null
            try { $response = $_.Exception.Response } catch { $response = $null }
            if ($response) {
                $code = [int]$response.StatusCode
                Clear-StatusLine
                Write-Ok "$Label answered at $Url (HTTP $code)"
                return $true
            }
        }
        $frame = $spinner[$tick % 4]
        $left = [int]([Math]::Max(0, ($deadline - (Get-Date)).TotalSeconds))
        Write-Host "`r  $frame waiting for $Label at $Url (${left}s left) " -NoNewline -ForegroundColor DarkGray
        $tick++
        Start-Sleep -Milliseconds 900
    }
    Clear-StatusLine
    Write-Warn "$Label did not answer at $Url within ${TimeoutSec}s. Check its window for errors."
    return $false
}

# --- Environment file inspection ---------------------------------------------------------------

function Read-EnvKeys {
    <#
        Parses a .env style file into @{ KEY = 'value' }. The caller must only ever surface KEY
        names: values may contain secrets (AGENTS.md 7) and must not be printed or logged.
    #>
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $eq = $trimmed.IndexOf('=')
        if ($eq -lt 1) { continue }
        $key = $trimmed.Substring(0, $eq).Trim()
        $value = $trimmed.Substring($eq + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value[0]
            $last = $value[$value.Length - 1]
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $map[$key] = $value
    }
    return $map
}

function Get-EffectiveEnv {
    <# Mirrors Next's precedence for local dev: .env first, then .env.local overrides. #>
    $merged = @{}
    foreach ($file in @('.env', '.env.local')) {
        $path = Join-Path $RepoRoot $file
        if (-not (Test-Path -LiteralPath $path)) { continue }
        foreach ($pair in (Read-EnvKeys -Path $path).GetEnumerator()) {
            $merged[$pair.Key] = $pair.Value
        }
    }
    return $merged
}

function Get-DbEndpoint {
    <# Extracts host/port from a postgres URL without exposing credentials. #>
    param([string]$Url)
    if (-not $Url) { return $null }
    $match = [regex]::Match($Url, '^[a-zA-Z0-9+.\-]+://(?:[^@/]*@)?(?<host>[^:/?#]+)(?::(?<port>\d+))?')
    if (-not $match.Success) { return $null }
    $port = 5432
    if ($match.Groups['port'].Success) { $port = [int]$match.Groups['port'].Value }
    return @{ Host = $match.Groups['host'].Value; Port = $port }
}

function Test-EnvironmentFiles {
    Write-Section 'Environment'
    $rootLocal = Join-Path $RepoRoot '.env.local'
    if (-not (Test-Path -LiteralPath $rootLocal)) {
        Write-Warn 'Missing .env.local. Copy .env.example and fill it in (values stay untracked).'
    }
    else {
        Write-Ok 'Found .env.local'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'server\.env'))) {
        Write-Warn 'Missing server/.env. The worker will start but provider-backed features stay unconfigured.'
    }
    else {
        Write-Ok 'Found server/.env'
    }

    $envMap = Get-EffectiveEnv
    $missing = @()
    foreach ($key in $RequiredEnvKeys) {
        if (-not $envMap.ContainsKey($key) -or -not $envMap[$key]) { $missing += $key }
    }
    if ($missing.Count -gt 0) {
        Stop-WithError "Required variables have no value: $($missing -join ', ')" 'See .env.example for what each one does. Never commit real values.'
    }
    Write-Ok "Required variables present: $($RequiredEnvKeys -join ', ')"

    foreach ($key in $AdvisoryEnvKeys) {
        if (-not $envMap.ContainsKey($key) -or -not $envMap[$key]) {
            Write-Warn "$key is empty. Related features report as unconfigured rather than failing silently."
        }
    }
    return $envMap
}

# --- Toolchain preflight -----------------------------------------------------------------------

function Test-Toolchain {
    Write-Section 'Toolchain'
    if (-not (Test-CommandExists 'node')) {
        Stop-WithError 'node was not found on PATH.' "Install Node.js >= $MinNodeMajor.$MinNodeMinor.0"
    }
    $nodeVersion = (Invoke-Native -File 'node' -Arguments @('--version')).Output
    $parsed = [regex]::Match($nodeVersion, 'v(?<major>\d+)\.(?<minor>\d+)')
    if ($parsed.Success) {
        $major = [int]$parsed.Groups['major'].Value
        $minor = [int]$parsed.Groups['minor'].Value
        if ($major -lt $MinNodeMajor -or ($major -eq $MinNodeMajor -and $minor -lt $MinNodeMinor)) {
            Stop-WithError "Node $nodeVersion is below the required $MinNodeMajor.$MinNodeMinor.0." 'package.json engines pins the minimum.'
        }
    }
    Write-Ok "node $nodeVersion"

    if (-not (Test-CommandExists 'pnpm')) {
        Stop-WithError 'pnpm was not found on PATH.' "pnpm is the only supported package manager. Enable it with: corepack enable pnpm"
    }
    $pnpmVersion = (Invoke-Native -File 'pnpm' -Arguments @('--version')).Output
    if ($pnpmVersion -ne $ExpectedPnpm) {
        Write-Warn "pnpm $pnpmVersion differs from the pinned $ExpectedPnpm (packageManager field)."
    }
    else {
        Write-Ok "pnpm $pnpmVersion"
    }
}

# --- Postgres --------------------------------------------------------------------------------

function Test-DockerEngine {
    if (-not (Test-CommandExists 'docker')) { return $false }
    return ((Invoke-Native -File 'docker' -Arguments @('version', '--format', '{{.Server.Version}}')).Code -eq 0)
}

function Start-DockerEngine {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe')
    )
    $exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $exe) {
        Stop-WithError 'Docker engine is not running and Docker Desktop was not found.' 'Start the engine manually, or re-run with -SkipDocker when Postgres runs elsewhere.'
    }
    Write-Step 'Docker engine is down. Starting Docker Desktop.'
    Start-Process -FilePath $exe | Out-Null
    $deadline = (Get-Date).AddSeconds($DockerEngineWaitSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        if (Test-DockerEngine) {
            Clear-StatusLine
            Write-Ok 'Docker engine is up.'
            return
        }
        $left = [int]([Math]::Max(0, ($deadline - (Get-Date)).TotalSeconds))
        Write-Host "`r  ... waiting for the Docker engine (${left}s left) " -NoNewline -ForegroundColor DarkGray
    }
    Clear-StatusLine
    Stop-WithError "Docker engine did not come up within ${DockerEngineWaitSec}s." 'Open Docker Desktop and check its status, then re-run.'
}

function Get-ComposeContainerId {
    $result = Invoke-Native -File 'docker' -Arguments @('compose', '-f', $ComposeFile, 'ps', '-q', $ComposeService)
    if ($result.Code -ne 0) { return '' }
    return ($result.Output -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
}

function Get-ContainerHealth {
    param([string]$ContainerId)
    if (-not $ContainerId) { return 'absent' }
    $result = Invoke-Native -File 'docker' -Arguments @('inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', $ContainerId)
    if ($result.Code -ne 0) { return 'absent' }
    return $result.Output.Trim()
}

function Test-TcpEndpoint {
    param([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Start-PostgresStack {
    param([hashtable]$Endpoint)
    Write-Section 'Postgres'
    if ($SkipDocker) {
        Write-Step '-SkipDocker set. Only probing the configured endpoint.'
    }
    else {
        if (-not (Test-CommandExists 'docker')) {
            Stop-WithError 'docker was not found on PATH.' 'Install Docker Desktop, or re-run with -SkipDocker.'
        }
        if (-not (Test-DockerEngine)) { Start-DockerEngine } else { Write-Ok 'Docker engine is up.' }

        Write-Step "docker compose up -d $ComposeService"
        $up = Invoke-Native -File 'docker' -Arguments @('compose', '-f', $ComposeFile, 'up', '-d', $ComposeService)
        if ($up.Code -ne 0) {
            Write-Host $up.Output -ForegroundColor DarkGray
            Stop-WithError 'docker compose up failed.' 'Check the output above; a stale container or port clash is the usual cause.'
        }

        $containerId = Get-ComposeContainerId
        $deadline = (Get-Date).AddSeconds($PostgresWaitSec)
        $health = Get-ContainerHealth -ContainerId $containerId
        while ($health -ne 'healthy' -and (Get-Date) -lt $deadline) {
            if ($health -eq 'unhealthy') {
                Stop-WithError 'The Postgres container reports unhealthy.' "Inspect it with: docker compose -f docker-compose.dev.yml logs $ComposeService"
            }
            $left = [int]([Math]::Max(0, ($deadline - (Get-Date)).TotalSeconds))
            Write-Host "`r  ... container health: $health (${left}s left) " -NoNewline -ForegroundColor DarkGray
            Start-Sleep -Seconds 2
            $health = Get-ContainerHealth -ContainerId $containerId
        }
        Clear-StatusLine
        if ($health -ne 'healthy') {
            Stop-WithError "Postgres container never became healthy (last state: $health)." 'Re-run after checking the container logs.'
        }
        Write-Ok 'Postgres container is healthy.'
    }

    if (-not (Test-TcpEndpoint -HostName $Endpoint.Host -Port $Endpoint.Port -TimeoutMs 3000)) {
        Stop-WithError "Cannot reach Postgres at $($Endpoint.Host):$($Endpoint.Port) (from DATABASE_URL)." 'Confirm the port mapping in docker-compose.dev.yml matches DATABASE_URL.'
    }
    Write-Ok "TCP handshake succeeded at $($Endpoint.Host):$($Endpoint.Port)."
}

# --- Dependencies and migrations ---------------------------------------------------------------

function Test-DependenciesStale {
    $rootModules = Join-Path $RepoRoot 'node_modules'
    $serverModules = Join-Path $RepoRoot 'server\node_modules'
    if (-not (Test-Path -LiteralPath $rootModules)) { return 'root node_modules is missing' }
    if (-not (Test-Path -LiteralPath $serverModules)) { return 'server/node_modules is missing' }
    $lockFile = Join-Path $RepoRoot 'pnpm-lock.yaml'
    if (-not (Test-Path -LiteralPath $lockFile)) { return '' }
    # pnpm rewrites node_modules/.modules.yaml on every real install, while the node_modules
    # directory mtime does not move on a no-op install. Comparing against the directory would
    # therefore reinstall on every launch.
    $stamp = Join-Path $rootModules '.modules.yaml'
    $stampPath = if (Test-Path -LiteralPath $stamp) { $stamp } else { $rootModules }
    $lockTime = (Get-Item -LiteralPath $lockFile).LastWriteTimeUtc
    $stampTime = (Get-Item -LiteralPath $stampPath).LastWriteTimeUtc
    if ($lockTime -gt $stampTime) { return 'pnpm-lock.yaml is newer than the last pnpm install' }
    return ''
}

function Install-Dependencies {
    Write-Section 'Dependencies'
    $reason = Test-DependenciesStale
    if (-not $reason) {
        Write-Ok 'Workspace dependencies look current.'
        return
    }
    if ($SkipInstall) {
        Write-Warn "$reason, but -SkipInstall was set."
        return
    }
    Write-Step "$reason. Running pnpm install."
    $result = Invoke-Native -File 'pnpm' -Arguments @('install')
    if ($result.Code -ne 0) {
        Write-Host $result.Output -ForegroundColor DarkGray
        Stop-WithError 'pnpm install failed.' 'Fix the resolution error above, then re-run.'
    }
    Write-Ok 'pnpm install completed.'
}

function Invoke-Migrations {
    Write-Section 'Migrations'
    if ($SkipMigrate) {
        Write-Warn '-SkipMigrate set. The schema may lag behind the committed migrations.'
        return
    }
    Write-Step 'pnpm db:migrate'
    $result = Invoke-Native -File 'pnpm' -Arguments @('db:migrate')
    if ($result.Code -ne 0) {
        Write-Host $result.Output -ForegroundColor DarkGray
        Stop-WithError 'pnpm db:migrate failed.' 'Migrations are idempotent; read the error above before retrying.'
    }
    Write-Ok 'Database migrations are applied.'
}

# --- Dev process windows -----------------------------------------------------------------------

function Start-DevWindow {
    <#
        Opens a dedicated, persistent PowerShell window for one long-running dev process.
        -NoExit keeps the window (and its logs) around even if the process crashes.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Command,
        [hashtable]$EnvVars = @{},
        [string]$WorkDir = $RepoRoot,
        [string]$LogName = ''
    )
    $parts = New-Object System.Collections.Generic.List[string]
    $parts.Add('$ErrorActionPreference = ''Continue''')
    $parts.Add('$host.UI.RawUI.WindowTitle = ' + ("'" + ($Title -replace "'", "''") + "'"))
    foreach ($pair in $EnvVars.GetEnumerator()) {
        $parts.Add('$env:' + $pair.Key + ' = ' + ("'" + ([string]$pair.Value -replace "'", "''") + "'"))
    }
    $parts.Add('Write-Host ' + ("'== " + ($Title -replace "'", "''") + " =='") + ' -ForegroundColor Cyan')
    $parts.Add('Write-Host ''Ctrl+C stops this process. The window stays open afterwards.'' -ForegroundColor DarkGray')
    $runLine = $Command
    if ($Log -and $LogName) {
        if (-not (Test-Path -LiteralPath $LogDir)) {
            New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
        }
        $logPath = Join-Path $LogDir ("{0}-{1}.log" -f $LogName, (Get-Date -Format 'yyyyMMdd-HHmmss'))
        $runLine = $Command + " 2>&1 | Tee-Object -FilePath '" + ($logPath -replace "'", "''") + "'"
        Write-Step "Log: $logPath"
    }
    $parts.Add($runLine)
    $script = [string]::Join('; ', $parts)

    $arguments = @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $script)
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $WorkDir -PassThru
    Write-Ok "$Title started in a new window (pid $($process.Id))."
    return $process
}

# --- Status / stop -----------------------------------------------------------------------------

function Show-StackStatus {
    param([hashtable]$Endpoint)
    Write-Section 'Status'
    if (Test-CommandExists 'docker') {
        if (Test-DockerEngine) {
            $health = Get-ContainerHealth -ContainerId (Get-ComposeContainerId)
            Write-Host "  docker engine   : up"
            Write-Host "  postgres        : $health"
        }
        else {
            Write-Host "  docker engine   : down"
        }
    }
    else {
        Write-Host "  docker engine   : docker not on PATH"
    }

    if ($Endpoint) {
        $reachable = if (Test-TcpEndpoint -HostName $Endpoint.Host -Port $Endpoint.Port) { 'reachable' } else { 'unreachable' }
        Write-Host "  database        : $($Endpoint.Host):$($Endpoint.Port) $reachable"
    }

    foreach ($item in @(@{ Label = 'web'; Port = $WebPort }, @{ Label = 'worker'; Port = $WorkerPort })) {
        $owner = Get-PortOwner -Port $item.Port
        if ($owner) {
            Write-Host ("  {0,-15} : port {1} held by {2} (pid {3})" -f $item.Label, $item.Port, $owner.Name, $owner.Pid)
        }
        else {
            Write-Host ("  {0,-15} : port {1} free (not running)" -f $item.Label, $item.Port)
        }
    }
}

function Stop-DevProcesses {
    Write-Section 'Stop'
    $stoppedAny = $false
    foreach ($item in @(@{ Label = 'web'; Port = $WebPort }, @{ Label = 'worker'; Port = $WorkerPort })) {
        if (Get-PortOwner -Port $item.Port) {
            if (Stop-PortOwner -Port $item.Port -Label $item.Label) { $stoppedAny = $true }
        }
        else {
            Write-Step "$($item.Label) port $($item.Port) is already free."
        }
    }
    if (-not $stoppedAny) { Write-Step 'Nothing was stopped.' }
    Write-Step 'The Postgres container was left running. Stop it with: docker compose -f docker-compose.dev.yml down'
}

# --- Main --------------------------------------------------------------------------------------

Write-Host ''
Write-Host '  PurpleInk local development launcher' -ForegroundColor Magenta
Write-Host "  repo: $RepoRoot" -ForegroundColor DarkGray

$knownEnv = Get-EffectiveEnv
$dbEndpoint = $null
if ($knownEnv.ContainsKey('DATABASE_URL')) {
    $dbEndpoint = Get-DbEndpoint -Url $knownEnv['DATABASE_URL']
}

if ($Stop) {
    Stop-DevProcesses
    exit 0
}

if ($Status) {
    Show-StackStatus -Endpoint $dbEndpoint
    Write-Host ''
    exit 0
}

if ($NoWeb -and $NoWorker) {
    Write-Warn 'Both -NoWeb and -NoWorker were set. Only the infrastructure steps will run.'
}

Test-Toolchain
$knownEnv = Test-EnvironmentFiles
$dbEndpoint = Get-DbEndpoint -Url $knownEnv['DATABASE_URL']
if (-not $dbEndpoint) {
    Stop-WithError 'DATABASE_URL is not a parseable postgres URL.' 'Expected form: postgres://user:pass@host:port/db'
}

Start-PostgresStack -Endpoint $dbEndpoint
Install-Dependencies
Invoke-Migrations

Write-Section 'Ports'
$resolvedWorkerPort = $WorkerPort
$resolvedWebPort = $WebPort
if (-not $NoWorker) {
    $resolvedWorkerPort = Resolve-DevPort -Requested $WorkerPort -Label 'worker'
    if ($resolvedWorkerPort -eq 0) { exit 1 }
}
if (-not $NoWeb) {
    $resolvedWebPort = Resolve-DevPort -Requested $WebPort -Label 'web'
    if ($resolvedWebPort -eq 0) { exit 1 }
}

Write-Section 'Processes'
# The worker starts first so the Next reverse proxy has a live upstream on its first request.
if (-not $NoWorker) {
    $null = Start-DevWindow -Title "PurpleInk worker :$resolvedWorkerPort" `
        -Command 'pnpm dev:worker' `
        -EnvVars @{ PORT = $resolvedWorkerPort } `
        -LogName 'worker'
}
else {
    Write-Step '-NoWorker set. Skipping the render worker.'
}

if (-not $NoWeb) {
    # next.config.ts rewrites /api/engine/* to BACKEND_ORIGIN, so a shifted worker port must be
    # handed to the web process or the engine seam would silently point at the wrong upstream.
    $webEnv = @{ PORT = $resolvedWebPort; BACKEND_ORIGIN = "http://localhost:$resolvedWorkerPort" }
    $null = Start-DevWindow -Title "PurpleInk web :$resolvedWebPort" `
        -Command 'pnpm dev' `
        -EnvVars $webEnv `
        -LogName 'web'
}
else {
    Write-Step '-NoWeb set. Skipping the Next dev server.'
}

Write-Section 'Readiness'
$webReady = $false
$workerReady = $false
if (-not $NoWorker) {
    $workerReady = Wait-HttpReady -Url "http://127.0.0.1:$resolvedWorkerPort/health" -TimeoutSec $ReadyTimeoutSec -Label 'worker'
}
if (-not $NoWeb) {
    $webReady = Wait-HttpReady -Url "http://127.0.0.1:$resolvedWebPort/" -TimeoutSec $ReadyTimeoutSec -Label 'web'
}
if ($webReady -and $workerReady) {
    # Proves the same-origin engine seam, not just the two listeners.
    $null = Wait-HttpReady -Url "http://127.0.0.1:$resolvedWebPort/api/engine/health" -TimeoutSec 45 -Label 'engine proxy'
}

Write-Section 'Summary'
if (-not $NoWeb) {
    Write-Host "  marketing   http://localhost:$resolvedWebPort/"
    Write-Host "  workbench   http://localhost:$resolvedWebPort/products"
    Write-Host "  playbook    http://localhost:$resolvedWebPort/playbook"
}
if (-not $NoWorker) {
    Write-Host "  worker      http://localhost:$resolvedWorkerPort/health"
}
Write-Host "  database    $($dbEndpoint.Host):$($dbEndpoint.Port)"

if ($script:Warnings.Count -gt 0) {
    Write-Host ''
    Write-Host "  $($script:Warnings.Count) warning(s):" -ForegroundColor Yellow
    foreach ($warning in $script:Warnings) { Write-Host "    - $warning" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '  Each dev process owns its own window. Closing this one leaves them running.' -ForegroundColor DarkGray
Write-Host '  Stop them with: pnpm dev:stop      Check state with: pnpm dev:status' -ForegroundColor DarkGray

if ($OpenBrowser -and $webReady) {
    Start-Process "http://localhost:$resolvedWebPort/products" | Out-Null
}

if ((-not $NoWeb -and -not $webReady) -or (-not $NoWorker -and -not $workerReady)) {
    exit 1
}
exit 0
