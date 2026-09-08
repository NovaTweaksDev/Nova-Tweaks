[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Touchpad While Mouse Is Connected"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-TouchpadMouseDisconnectApplied {
  $path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad'

  if (-not (Test-Path $path)) {
    throw "Precision Touchpad registry path not found. This tweak requires a Windows Precision Touchpad."
  }

  $value = Get-ItemProperty -Path $path -Name LeaveOnWithMouse -ErrorAction SilentlyContinue

  if ($null -eq $value) {
    throw "LeaveOnWithMouse value not found. This device may not support the required Precision Touchpad setting."
  }

  return ([int]$value.LeaveOnWithMouse -eq 0)
}

function Set-TouchpadMouseDisconnect([int]$value) {
  $path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad'

  if (-not (Test-Path $path)) {
    throw "Precision Touchpad registry path not found. This tweak requires a Windows Precision Touchpad."
  }

  New-ItemProperty -Path $path -Name LeaveOnWithMouse -PropertyType DWord -Value $value -Force | Out-Null
}

try {
  switch ($State) {

    'Check' {
      $applied = Get-TouchpadMouseDisconnectApplied

      if ($applied) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-TouchpadMouseDisconnect 0
      Out-Result "Enabled" "Precision Touchpad setting applied"
    }

    'Off' {
      Set-TouchpadMouseDisconnect 1
      Out-Result "Disabled" "Precision Touchpad setting restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
