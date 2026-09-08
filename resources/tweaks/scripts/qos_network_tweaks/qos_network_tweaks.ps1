[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "QoS Network Tweaks"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$pschedPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Psched"
$mmPath     = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile"

# ================= Functions =================

function Get-Value([string]$Path, [string]$Name) {

  if (-not (Test-Path $Path)) { return $null }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Test-DWordEquals($Value, [uint32]$Expected) {
  if ($null -eq $Value) {
    return $false
  }

  try {
    return ([uint32]$Value -eq $Expected)
  }
  catch {
    try {
      return ([uint32][int64]$Value -eq $Expected)
    }
    catch {
      return $false
    }
  }
}

function Test-QosTweaksEnabled {
  $limit = Get-Value $pschedPath "NonBestEffortLimit"
  $throt = Get-Value $mmPath "NetworkThrottlingIndex"
  $resp = Get-Value $mmPath "SystemResponsiveness"

  return (
    (Test-DWordEquals $limit 0) -and
    (Test-DWordEquals $throt ([uint32]::MaxValue)) -and
    (Test-DWordEquals $resp 0)
  )
}

function Set-DWord([string]$Path, [string]$Name, [int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $Name `
    -PropertyType DWord `
    -Value $Value `
    -Force | Out-Null
}

function Remove-Value([string]$Path, [string]$Name) {

  if (Test-Path $Path) {
    try {
      Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
    }
    catch {}
  }
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-QosTweaksEnabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-DWord $pschedPath "NonBestEffortLimit" 0
      Set-DWord $mmPath "NetworkThrottlingIndex" 0xFFFFFFFF
      Set-DWord $mmPath "SystemResponsiveness" 0

      if (Test-QosTweaksEnabled) {
        Out-Result "Enabled" "Reboot recommended"
      }
      else {
        Out-Result "Disabled" "QoS values were written, but verification failed. Reboot recommended."
      }
    }

    'Off' {

      Remove-Value $pschedPath "NonBestEffortLimit"
      Remove-Value $mmPath "NetworkThrottlingIndex"
      Remove-Value $mmPath "SystemResponsiveness"

      Out-Result "Disabled" "Reboot recommended"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
