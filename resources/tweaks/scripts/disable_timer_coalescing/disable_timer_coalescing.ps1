[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Timer Coalescing"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager'
$ValueName    = 'CoalescingTimerInterval'

function Get-TimerCoalescingDisabled {
  if (-not (Test-Path $RegistryPath)) {
    throw "Registry path not found: $RegistryPath"
  }

  $value = Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue

  if ($null -eq $value) {
    return $false
  }

  return ([int]$value.$ValueName -eq 0)
}

function Set-TimerCoalescingDisabled {
  if (-not (Test-Path $RegistryPath)) {
    throw "Registry path not found: $RegistryPath"
  }

  New-ItemProperty -Path $RegistryPath -Name $ValueName -PropertyType DWord -Value 0 -Force | Out-Null
}

function Restore-TimerCoalescingDefault {
  if (-not (Test-Path $RegistryPath)) {
    throw "Registry path not found: $RegistryPath"
  }

  if (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-TimerCoalescingDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-TimerCoalescingDisabled
      Out-Result "Enabled" "Experimental registry setting applied; reboot recommended"
    }

    'Off' {
      Restore-TimerCoalescingDefault
      Out-Result "Disabled" "Default behavior restored; reboot recommended"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
