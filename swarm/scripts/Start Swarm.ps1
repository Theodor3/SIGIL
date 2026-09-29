param(
    [switch]$Restart,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
$swarmCheckout = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$swarmPython = Join-Path $swarmCheckout '.venv-swarm/Scripts/python.exe'
$swarmRuntime = Join-Path $swarmCheckout '.swarm/runtime'
$swarmUrl = 'http://127.0.0.1:8765/'
$expectedVersion = '0.4.1'

function Get-SwarmHealth {
    try { return Invoke-RestMethod ($swarmUrl + 'api/health') -TimeoutSec 2 }
    catch { return $null }
}

function Assert-SwarmIdentity($health) {
    if ($health.app -ne 'sigil-swarm') {
        throw 'Port 8765 is being used by a different application. No process was changed.'
    }
    if ($health.workspace -and [IO.Path]::GetFullPath([string]$health.workspace) -ne $swarmCheckout) {
        throw 'Port 8765 is serving a different SIGIL checkout. No process was changed.'
    }
}

function Get-VerifiedSwarmProcessId($health) {
    $listeners = @(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop)
    if ($listeners.Count -ne 1) {
        throw 'The dashboard does not have one identifiable listener on port 8765. No process was changed.'
    }
    $listenerId = [int]$listeners[0].OwningProcess
    if ($health.pid -and [int]$health.pid -ne $listenerId) {
        throw 'The dashboard health record does not match its listening process. No process was changed.'
    }
    $listener = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerId"
    $commandLine = [string]$listener.CommandLine
    if (-not $commandLine.Contains('-m swarm.server') -or -not $commandLine.Contains('8765')) {
        throw 'The listening process command does not match the SIGIL dashboard. No process was changed.'
    }
    $trustedEnvironment = $false
    if ($listener.ExecutablePath -and [IO.Path]::GetFullPath([string]$listener.ExecutablePath) -eq [IO.Path]::GetFullPath($swarmPython)) {
        $trustedEnvironment = $true
    } elseif ($listener.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.ParentProcessId)"
        if ($parent -and $parent.ExecutablePath -and [IO.Path]::GetFullPath([string]$parent.ExecutablePath) -eq [IO.Path]::GetFullPath($swarmPython)) {
            $trustedEnvironment = $true
        }
    }
    if (-not $trustedEnvironment) {
        throw 'The dashboard process does not match the SIGIL Python environment. No process was changed.'
    }
    if (-not $health.workspace) {
        $legacyPidFile = Join-Path $swarmRuntime 'server.pid'
        if (-not (Test-Path -LiteralPath $legacyPidFile)) {
            throw 'The older dashboard has no verifiable process record. No process was changed.'
        }
        $legacyId = [int](Get-Content -LiteralPath $legacyPidFile -Raw)
        if ($legacyId -ne $listenerId -and $legacyId -ne [int]$listener.ParentProcessId) {
            throw 'The older dashboard process does not match its saved record. No process was changed.'
        }
    }
    return $listenerId
}

function Rotate-SwarmLog($path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    if ((Get-Item -LiteralPath $path).Length -lt 1MB) { return }
    $archive = $path + '.1'
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Move-Item -LiteralPath $path -Destination $archive
}

if (-not (Test-Path -LiteralPath $swarmPython)) {
    throw 'The SIGIL Python environment is missing. Ask Codex to restore the dashboard environment.'
}

$swarmHealth = Get-SwarmHealth
if ($swarmHealth) {
    Assert-SwarmIdentity $swarmHealth
    if ($Status) {
        if ($swarmHealth.version -ne $expectedVersion -or -not $swarmHealth.workspace) {
            Write-Output ("SIGIL Swarm {0} Â· safe upgrade restart needed" -f $swarmHealth.version)
            return
        }
        $readiness = Invoke-RestMethod ($swarmUrl + 'api/readiness') -TimeoutSec 3
        Write-Output ("SIGIL Swarm {0} Â· {1}" -f $swarmHealth.version, $readiness.label)
        Write-Output ("Studio commit {0} Â· PID {1}" -f ([string]$swarmHealth.studio_commit).Substring(0, 10), $swarmHealth.pid)
        return
    }
    if ($Restart) {
        $state = Invoke-RestMethod ($swarmUrl + 'api/state') -TimeoutSec 3
        if ($state.active_mission_id) {
            throw 'A mission is active. Wait for it to finish or stop it from the dashboard before restarting.'
        }
        $processId = Get-VerifiedSwarmProcessId $swarmHealth
        Stop-Process -Id $processId
        Wait-Process -Id $processId -Timeout 15 -ErrorAction SilentlyContinue
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
            throw 'The old dashboard did not stop cleanly. No replacement was started.'
        }
        $swarmHealth = $null
    } else {
        if ($swarmHealth.version -ne $expectedVersion -or -not $swarmHealth.studio_current) {
            throw 'The dashboard is running an older snapshot. Run this launcher with -Restart after confirming no mission is active.'
        }
        Write-Output "SIGIL Swarm is ready at $swarmUrl"
        Write-Output ("Version {0} Â· Studio commit {1}" -f $swarmHealth.version, ([string]$swarmHealth.studio_commit).Substring(0, 10))
        return
    }
}

if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8765 is occupied or the dashboard is still stopping. Try again shortly.'
}

New-Item -ItemType Directory -Path $swarmRuntime -Force | Out-Null
$stdoutLog = Join-Path $swarmRuntime 'server.out.log'
$stderrLog = Join-Path $swarmRuntime 'server.err.log'
Rotate-SwarmLog $stdoutLog
Rotate-SwarmLog $stderrLog
$swarmProcess = Start-Process -FilePath $swarmPython -ArgumentList '-m','swarm.server','--port','8765','--data-dir',$swarmRuntime -WorkingDirectory $swarmCheckout -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
$processRecord = [ordered]@{
    pid = $swarmProcess.Id
    started_at = [DateTimeOffset]::UtcNow.ToString('o')
    executable = [IO.Path]::GetFullPath($swarmPython)
    workspace = $swarmCheckout
    expected_version = $expectedVersion
}
$processRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $swarmRuntime 'server.process.json')
$swarmProcess.Id | Set-Content -LiteralPath (Join-Path $swarmRuntime 'server.pid')

for ($swarmAttempt = 0; $swarmAttempt -lt 24; $swarmAttempt++) {
    Start-Sleep -Milliseconds 500
    $swarmHealth = Get-SwarmHealth
    if ($swarmHealth) {
        Assert-SwarmIdentity $swarmHealth
        if ($swarmHealth.version -eq $expectedVersion -and $swarmHealth.studio_current) { break }
        throw 'The dashboard started with an unexpected build or Studio snapshot.'
    }
    if ($swarmProcess.HasExited) {
        throw 'The dashboard could not start. Ask Codex to inspect its local server log.'
    }
}
if (-not $swarmHealth) {
    throw 'The dashboard did not become ready. Ask Codex to inspect its local server log.'
}

Write-Output "SIGIL Swarm is ready at $swarmUrl"
Write-Output ("Version {0} Â· Studio commit {1}" -f $swarmHealth.version, ([string]$swarmHealth.studio_commit).Substring(0, 10))
Write-Output 'Pasted API keys stay in this server session. Starting or restarting never starts a paid mission.'
