[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable App Launch Tracking"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$ValueName = 'Start_TrackProgs'

function Get-AppLaunchTrackingDisabled {
  if (-not (Test-Path $RegistryPath)) {
    return $false
  }

  $value = Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
  if ($null -eq $value) {
    return $false
  }

  return ([int]$value.$ValueName -eq 0)
}

function Set-AppLaunchTrackingDisabled {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $RegistryPath -Name $ValueName -PropertyType DWord -Value 0 -Force | Out-Null
}

function Restore-AppLaunchTrackingDefault {
  if (Test-Path $RegistryPath) {
    if (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
    }
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-AppLaunchTrackingDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-AppLaunchTrackingDisabled
      Out-Result "Enabled"
    }

    'Off' {
      Restore-AppLaunchTrackingDefault
      Out-Result "Disabled" "Default app launch tracking behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
