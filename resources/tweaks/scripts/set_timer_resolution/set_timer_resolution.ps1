[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off', 'Daemon')]
  [string]$State = 'Check',
  [string]$Resolution = '0.5',
  [string]$Token = '',
  [string]$StateFile = '',
  [string]$StopFile = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Timer Resolution'
$StorageRoot = Join-Path $env:ProgramData 'NovaTweaks\TimerResolution'
$DefaultStateFile = Join-Path $StorageRoot 'state.json'
$ControlMutexName = 'Global\NovaTweaks_TimerResolution_Control'
$DaemonMutexName = 'Global\NovaTweaks_TimerResolution_Daemon'
$DaemonStartupTimeoutMs = 10000
$DaemonStopTimeoutMs = 7000

function Ensure-TimerInterop {
  if ('NovaTweaks.NativeTimer' -as [type]) {
    return
  }

  Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;

namespace NovaTweaks {
  public static class NativeTimer {
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessPowerThrottlingState {
      public uint Version;
      public uint ControlMask;
      public uint StateMask;
    }

    private const int ProcessPowerThrottling = 4;
    private const uint ProcessPowerThrottlingCurrentVersion = 1;
    private const uint ProcessPowerThrottlingIgnoreTimerResolution = 0x4;

    [DllImport("ntdll.dll")]
    public static extern int NtQueryTimerResolution(out uint MaximumTime, out uint MinimumTime, out uint CurrentTime);

    [DllImport("ntdll.dll")]
    public static extern int NtSetTimerResolution(uint DesiredTime, bool SetResolution, out uint CurrentTime);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessInformation(
      IntPtr process,
      int processInformationClass,
      ref ProcessPowerThrottlingState processInformation,
      uint processInformationSize
    );

    public static int AlwaysHonorTimerResolutionRequests() {
      ProcessPowerThrottlingState state = new ProcessPowerThrottlingState();
      state.Version = ProcessPowerThrottlingCurrentVersion;
      state.ControlMask = ProcessPowerThrottlingIgnoreTimerResolution;
      state.StateMask = 0;
      bool success = SetProcessInformation(
        GetCurrentProcess(),
        ProcessPowerThrottling,
        ref state,
        (uint)Marshal.SizeOf(typeof(ProcessPowerThrottlingState))
      );
      return success ? 0 : Marshal.GetLastWin32Error();
    }
  }
}
"@
}

function Enable-HonoredTimerResolutionRequests {
  Ensure-TimerInterop

  # Windows 11 may ignore requests from fully hidden/non-visible processes
  # unless the process explicitly opts out of that power-throttling policy.
  if ([Environment]::OSVersion.Version.Build -lt 22000) {
    return
  }

  $win32Error = [NovaTweaks.NativeTimer]::AlwaysHonorTimerResolutionRequests()
  if ($win32Error -ne 0) {
    throw "SetProcessInformation(ProcessPowerThrottling) failed (Win32 $win32Error)."
  }
}

function Normalize-ResolutionValue([object]$Value) {
  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return '0.5'
  }

  $normalized = $raw.Trim().Replace(',', '.')
  if ($normalized -eq '1') {
    return '1.0'
  }
  if ($normalized -eq '0.5' -or $normalized -eq '1.0') {
    return $normalized
  }

  [double]$numericValue = 0
  if (-not [double]::TryParse($normalized, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$numericValue)) {
    return '0.5'
  }

  if ($numericValue -ge 0.95) {
    return '1.0'
  }
  return '0.5'
}

function Units-To-Resolution([uint32]$Units) {
  if ($Units -eq 0) {
    return ''
  }

  $value = [Math]::Round($Units / 10000.0, 4)
  return ('{0:0.####}' -f $value)
}

function Get-RequestedUnits([string]$NormalizedResolution) {
  if ($NormalizedResolution -eq '1.0') {
    return [uint32]10000
  }
  return [uint32]5000
}

function Get-ResolutionNumber([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return [double]::NaN
  }

  [double]$numericValue = 0
  if (-not [double]::TryParse($Value.Replace(',', '.'), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$numericValue)) {
    return [double]::NaN
  }

  return $numericValue
}

function Out-Result([string]$Status, [string]$Message = '', [hashtable]$Details = @{}) {
  $payload = @{
    tweak = $TweakName
    status = $Status
    message = $Message
    details = $Details
  }

  $payload | ConvertTo-Json -Compress
}

function Ensure-StorageRoot {
  if (-not (Test-Path $StorageRoot)) {
    New-Item -Path $StorageRoot -ItemType Directory -Force | Out-Null
  }
}

function Resolve-StateFilePath([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) {
    return $DefaultStateFile
  }

  return [System.IO.Path]::GetFullPath($Candidate.Trim())
}

function Resolve-StopFilePath([string]$Candidate, [string]$CurrentToken) {
  if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
    return [System.IO.Path]::GetFullPath($Candidate.Trim())
  }

  if (-not [string]::IsNullOrWhiteSpace($CurrentToken)) {
    return Join-Path $StorageRoot ("stop-{0}.signal" -f $CurrentToken.Trim())
  }

  return Join-Path $StorageRoot 'stop.signal'
}

function Remove-FileSafe([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  try {
    if (Test-Path $Path) {
      Remove-Item -Path $Path -Force -ErrorAction Stop
    }
  } catch {
    # Best effort cleanup.
  }
}

function Read-StateFile([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) {
    return $null
  }

  try {
    $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
  } catch {
    return $null
  }

  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  try {
    return $raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Write-StateFile([string]$Path, [hashtable]$StatePayload) {
  Ensure-StorageRoot
  $json = $StatePayload | ConvertTo-Json -Depth 6
  Set-Content -Path $Path -Value $json -Encoding UTF8
}

function Get-ProcessByPid([object]$PidValue) {
  [int]$resolvedPid = 0
  if (-not [int]::TryParse([string]$PidValue, [ref]$resolvedPid) -or $resolvedPid -le 0) {
    return $null
  }

  return Get-Process -Id $resolvedPid -ErrorAction SilentlyContinue
}

function Get-TimerCapabilities {
  Ensure-TimerInterop

  [uint32]$maximum = 0
  [uint32]$minimum = 0
  [uint32]$current = 0
  $statusCode = [NovaTweaks.NativeTimer]::NtQueryTimerResolution([ref]$maximum, [ref]$minimum, [ref]$current)
  if ($statusCode -ne 0) {
    throw "NtQueryTimerResolution failed (NTSTATUS 0x$('{0:X8}' -f ($statusCode -band 0xFFFFFFFF)))."
  }

  $finest = [Math]::Min($maximum, $minimum)
  $coarsest = [Math]::Max($maximum, $minimum)

  return @{
    FinestUnits = [uint32]$finest
    CoarsestUnits = [uint32]$coarsest
    CurrentUnits = [uint32]$current
    FinestResolution = Units-To-Resolution ([uint32]$finest)
    CoarsestResolution = Units-To-Resolution ([uint32]$coarsest)
    CurrentResolution = Units-To-Resolution ([uint32]$current)
  }
}

function Resolve-TargetResolution([string]$RequestedResolution) {
  $caps = Get-TimerCapabilities
  $normalizedRequest = Normalize-ResolutionValue $RequestedResolution
  $requestedUnits = Get-RequestedUnits $normalizedRequest
  [uint32]$selectedUnits = $requestedUnits

  if ($selectedUnits -lt $caps.FinestUnits) {
    $selectedUnits = $caps.FinestUnits
  }
  if ($selectedUnits -gt $caps.CoarsestUnits) {
    $selectedUnits = $caps.CoarsestUnits
  }

  return @{
    RequestedResolution = $normalizedRequest
    RequestedUnits = [uint32]$requestedUnits
    SelectedUnits = [uint32]$selectedUnits
    FinestUnits = [uint32]$caps.FinestUnits
    CoarsestUnits = [uint32]$caps.CoarsestUnits
    CurrentUnits = [uint32]$caps.CurrentUnits
  }
}

function Stop-ActiveDaemon([psobject]$StatePayload, [string]$StatePath) {
  $resolvedStatePath = Resolve-StateFilePath $StatePath
  $resolvedStopPath = Resolve-StopFilePath $StatePayload.stopFile $StatePayload.token
  $process = Get-ProcessByPid $StatePayload.pid

  if (-not $process) {
    Remove-FileSafe $resolvedStatePath
    Remove-FileSafe $resolvedStopPath
    return
  }

  try {
    Set-Content -Path $resolvedStopPath -Value ((Get-Date).ToString('o')) -Encoding UTF8
  } catch {
    # Graceful signal best effort.
  }

  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  while ($stopwatch.ElapsedMilliseconds -lt $DaemonStopTimeoutMs) {
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      break
    }
    Start-Sleep -Milliseconds 180
  }

  $process = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if ($process) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
    } catch {
      # Best effort termination.
    }
  }

  Remove-FileSafe $resolvedStatePath
  Remove-FileSafe $resolvedStopPath
}

function Get-ActiveState([string]$StatePath) {
  $resolvedStatePath = Resolve-StateFilePath $StatePath
  $statePayload = Read-StateFile $resolvedStatePath
  if (-not $statePayload) {
    return $null
  }

  $process = Get-ProcessByPid $statePayload.pid
  if (-not $process) {
    $resolvedStopPath = Resolve-StopFilePath $statePayload.stopFile $statePayload.token
    Remove-FileSafe $resolvedStatePath
    Remove-FileSafe $resolvedStopPath
    return $null
  }

  return $statePayload
}

function Wait-ForDaemonState([string]$ExpectedToken, [string]$StatePath) {
  $timeoutWatch = [Diagnostics.Stopwatch]::StartNew()

  while ($timeoutWatch.ElapsedMilliseconds -lt $DaemonStartupTimeoutMs) {
    $statePayload = Read-StateFile $StatePath
    if ($statePayload -and [string]$statePayload.token -eq $ExpectedToken) {
      $process = Get-ProcessByPid $statePayload.pid
      if ($process) {
        return $statePayload
      }
    }

    Start-Sleep -Milliseconds 160
  }

  return $null
}

function Start-TimerResolutionDaemon([string]$RequestedResolution, [string]$StatePath, [string]$StopPath, [string]$CurrentToken) {
  $scriptPath = [System.IO.Path]::GetFullPath($PSCommandPath)
  $quotedScriptPath = '"' + $scriptPath + '"'
  $quotedStatePath = '"' + $StatePath + '"'
  $quotedStopPath = '"' + $StopPath + '"'

  $arguments = @(
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', $quotedScriptPath,
    '-State', 'Daemon',
    '-Resolution', $RequestedResolution,
    '-Token', $CurrentToken,
    '-StateFile', $quotedStatePath,
    '-StopFile', $quotedStopPath
  )

  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $arguments | Out-Null
}

function Invoke-DaemonMode {
  Ensure-StorageRoot
  $resolvedStatePath = Resolve-StateFilePath $StateFile
  $resolvedToken = if ([string]::IsNullOrWhiteSpace($Token)) { [Guid]::NewGuid().ToString('N') } else { $Token.Trim() }
  $resolvedStopPath = Resolve-StopFilePath $StopFile $resolvedToken
  [uint32]$setUnits = 0
  $daemonLock = $null
  $daemonLockAcquired = $false
  $statePayload = $null

  try {
    $daemonLock = New-Object System.Threading.Mutex($false, $DaemonMutexName)
    $daemonLockAcquired = $daemonLock.WaitOne(0, $false)
    if (-not $daemonLockAcquired) {
      exit 1
    }

    Remove-FileSafe $resolvedStopPath

    Enable-HonoredTimerResolutionRequests
    $target = Resolve-TargetResolution -RequestedResolution $Resolution
    [uint32]$currentAfterSet = 0
    $setUnits = [uint32]$target.SelectedUnits

    $setStatus = [NovaTweaks.NativeTimer]::NtSetTimerResolution($setUnits, $true, [ref]$currentAfterSet)
    if ($setStatus -ne 0) {
      throw "NtSetTimerResolution(Set=true) failed (NTSTATUS 0x$('{0:X8}' -f ($setStatus -band 0xFFFFFFFF)))."
    }

    # Give Windows enough time to apply visibility/power-throttling policy,
    # then verify the effective system value rather than trusting the setter.
    Start-Sleep -Milliseconds 800
    Enable-HonoredTimerResolutionRequests
    $verifiedCaps = Get-TimerCapabilities
    if ([uint32]$verifiedCaps.CurrentUnits -gt $setUnits) {
      throw "Requested timer resolution is not effective (requested $($target.RequestedResolution) ms, current $($verifiedCaps.CurrentResolution) ms)."
    }
    $selectedResolution = Units-To-Resolution $setUnits

    $statePayload = @{
      pid = $PID
      token = $resolvedToken
      requestedResolution = $target.RequestedResolution
      selectedResolution = $selectedResolution
      currentResolution = $verifiedCaps.CurrentResolution
      effective = $true
      fallbackApplied = [Math]::Abs((Get-ResolutionNumber $selectedResolution) - (Get-ResolutionNumber $target.RequestedResolution)) -gt 0.0001
      requestedUnits = [uint32]$target.RequestedUnits
      selectedUnits = [uint32]$setUnits
      stateFile = $resolvedStatePath
      stopFile = $resolvedStopPath
      startedAt = (Get-Date).ToString('o')
      heartbeatAt = (Get-Date).ToString('o')
    }

    Write-StateFile -Path $resolvedStatePath -StatePayload $statePayload

    $tick = 0
    while (-not (Test-Path $resolvedStopPath)) {
      Start-Sleep -Milliseconds 400
      $tick += 1
      if ($tick -ge 5) {
        $tick = 0
        Enable-HonoredTimerResolutionRequests
        $currentCaps = Get-TimerCapabilities
        if ([uint32]$currentCaps.CurrentUnits -gt $setUnits) {
          # A power-policy transition can invalidate the effective request while
          # leaving this process alive. Reassert it once before treating the
          # daemon as failed so an existing session can recover by itself.
          [uint32]$currentAfterReassert = 0
          $reassertStatus = [NovaTweaks.NativeTimer]::NtSetTimerResolution($setUnits, $true, [ref]$currentAfterReassert)
          if ($reassertStatus -ne 0) {
            throw "NtSetTimerResolution reassert failed (NTSTATUS 0x$('{0:X8}' -f ($reassertStatus -band 0xFFFFFFFF)))."
          }
          Start-Sleep -Milliseconds 120
          $currentCaps = Get-TimerCapabilities
          if ([uint32]$currentCaps.CurrentUnits -gt $setUnits) {
            throw "Timer resolution is no longer effective (requested $($statePayload.requestedResolution) ms, current $($currentCaps.CurrentResolution) ms)."
          }
        }
        $statePayload.currentResolution = $currentCaps.CurrentResolution
        $statePayload.effective = $true
        $statePayload.heartbeatAt = (Get-Date).ToString('o')
        Write-StateFile -Path $resolvedStatePath -StatePayload $statePayload
      }
    }

    exit 0
  } catch {
    exit 1
  } finally {
    if ($setUnits -gt 0) {
      try {
        [uint32]$currentAfterReset = 0
        [void][NovaTweaks.NativeTimer]::NtSetTimerResolution($setUnits, $false, [ref]$currentAfterReset)
      } catch {
        # Best effort cleanup.
      }
    }

    Remove-FileSafe $resolvedStatePath
    Remove-FileSafe $resolvedStopPath

    if ($daemonLockAcquired -and $daemonLock) {
      try { [void]$daemonLock.ReleaseMutex() } catch {}
    }
    if ($daemonLock) {
      $daemonLock.Dispose()
    }
  }
}

if ($State -eq 'Daemon') {
  Invoke-DaemonMode
}

$controlMutex = $null
$controlLockAcquired = $false

try {
  Ensure-TimerInterop
  Ensure-StorageRoot

  $controlMutex = New-Object System.Threading.Mutex($false, $ControlMutexName)
  $controlLockAcquired = $controlMutex.WaitOne(10000, $false)
  if (-not $controlLockAcquired) {
    throw 'Failed to acquire timer-resolution control lock.'
  }

  $resolvedStatePath = Resolve-StateFilePath $StateFile
  $activeState = Get-ActiveState -StatePath $resolvedStatePath
  $currentCaps = Get-TimerCapabilities

  switch ($State) {
    'Check' {
      if (-not $activeState) {
        Out-Result 'Disabled' '' @{
          selectedResolution = ''
          currentResolution = $currentCaps.CurrentResolution
          fallbackApplied = $false
          requestedResolution = ''
        }
        break
      }


      [uint32]$activeSelectedUnits = 0
      $activeUnitsValid = [uint32]::TryParse([string]$activeState.selectedUnits, [ref]$activeSelectedUnits) -and $activeSelectedUnits -gt 0
      $daemonReportedResolution = Get-ResolutionNumber ([string]$activeState.currentResolution)
      $daemonEffectiveFlag = $false
      if ($activeState.PSObject.Properties['effective']) {
        $daemonEffectiveFlag = [bool]$activeState.effective
      }
      $daemonReportsEffective = (
        $activeUnitsValid -and
        $daemonEffectiveFlag -and
        -not [double]::IsNaN($daemonReportedResolution) -and
        $daemonReportedResolution -le (($activeSelectedUnits / 10000.0) + 0.0001)
      )
      if (-not $daemonReportsEffective -or [uint32]$currentCaps.CurrentUnits -gt $activeSelectedUnits) {
        Out-Result 'Disabled' 'The timer-resolution daemon is running, but its requested resolution is not effective.' @{
          selectedResolution = ''
          currentResolution = $currentCaps.CurrentResolution
          fallbackApplied = $false
          requestedResolution = [string]$activeState.requestedResolution
        }
        break
      }

      Out-Result 'Enabled' '' @{
        selectedResolution = [string]$activeState.selectedResolution
        currentResolution = $currentCaps.CurrentResolution
        fallbackApplied = [bool]$activeState.fallbackApplied
        requestedResolution = [string]$activeState.requestedResolution
      }
    }

    'On' {
      $requestedResolution = Normalize-ResolutionValue $Resolution

      if ($activeState) {
        $activeSelected = Normalize-ResolutionValue $activeState.selectedResolution
        [uint32]$activeSelectedUnits = 0
        $activeUnitsValid = [uint32]::TryParse([string]$activeState.selectedUnits, [ref]$activeSelectedUnits) -and $activeSelectedUnits -gt 0
        $daemonReportedResolution = Get-ResolutionNumber ([string]$activeState.currentResolution)
        $daemonEffectiveFlag = $false
        if ($activeState.PSObject.Properties['effective']) {
          $daemonEffectiveFlag = [bool]$activeState.effective
        }
        $daemonReportsEffective = (
          $daemonEffectiveFlag -and
          -not [double]::IsNaN($daemonReportedResolution) -and
          $daemonReportedResolution -le (($activeSelectedUnits / 10000.0) + 0.0001)
        )
        $activeRequestIsEffective = $activeUnitsValid -and $daemonReportsEffective -and [uint32]$currentCaps.CurrentUnits -le $activeSelectedUnits
        if ($activeSelected -eq $requestedResolution -and $activeRequestIsEffective) {
          Out-Result 'Enabled' '' @{
            selectedResolution = [string]$activeState.selectedResolution
            currentResolution = $currentCaps.CurrentResolution
            fallbackApplied = [bool]$activeState.fallbackApplied
            requestedResolution = [string]$activeState.requestedResolution
          }
          break
        }

        # Do not reuse a live-but-ineffective daemon. This state can remain
        # after Windows power policy changes and would otherwise make every
        # retry return a false success before the desktop postcondition fails.
        Stop-ActiveDaemon -StatePayload $activeState -StatePath $resolvedStatePath
      }

      $tokenValue = [Guid]::NewGuid().ToString('N')
      $resolvedStopPath = Resolve-StopFilePath $StopFile $tokenValue
      Remove-FileSafe $resolvedStopPath

      Start-TimerResolutionDaemon -RequestedResolution $requestedResolution -StatePath $resolvedStatePath -StopPath $resolvedStopPath -CurrentToken $tokenValue
      $readyState = Wait-ForDaemonState -ExpectedToken $tokenValue -StatePath $resolvedStatePath
      if (-not $readyState) {
        $staleState = Read-StateFile $resolvedStatePath
        if ($staleState) {
          Stop-ActiveDaemon -StatePayload $staleState -StatePath $resolvedStatePath
        }
        throw 'Timer-resolution daemon did not report ready state in time.'
      }

      $currentCaps = Get-TimerCapabilities

      [uint32]$readySelectedUnits = 0
      if (-not [uint32]::TryParse([string]$readyState.selectedUnits, [ref]$readySelectedUnits) -or $readySelectedUnits -eq 0 -or [uint32]$currentCaps.CurrentUnits -gt $readySelectedUnits) {
        Stop-ActiveDaemon -StatePayload $readyState -StatePath $resolvedStatePath
        throw "Timer-resolution postcondition failed (requested $requestedResolution ms, current $($currentCaps.CurrentResolution) ms)."
      }

      Out-Result 'Enabled' '' @{
        selectedResolution = [string]$readyState.selectedResolution
        currentResolution = $currentCaps.CurrentResolution
        fallbackApplied = [bool]$readyState.fallbackApplied
        requestedResolution = [string]$readyState.requestedResolution
      }
    }

    'Off' {
      if ($activeState) {
        Stop-ActiveDaemon -StatePayload $activeState -StatePath $resolvedStatePath
      } else {
        Remove-FileSafe $resolvedStatePath
      }

      $currentCaps = Get-TimerCapabilities
      Out-Result 'Disabled' '' @{
        selectedResolution = ''
        currentResolution = $currentCaps.CurrentResolution
        fallbackApplied = $false
        requestedResolution = ''
      }
    }
  }

  exit 0
} catch {
  Out-Result 'Error' $_.Exception.Message @{
    selectedResolution = ''
    currentResolution = ''
    fallbackApplied = $false
    requestedResolution = Normalize-ResolutionValue $Resolution
  }
  exit 1
} finally {
  if ($controlLockAcquired -and $controlMutex) {
    try { [void]$controlMutex.ReleaseMutex() } catch {}
  }
  if ($controlMutex) {
    $controlMutex.Dispose()
  }
}
