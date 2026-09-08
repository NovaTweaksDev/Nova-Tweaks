[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Consumer Experience"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$cloudContentPolicy = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent"
$cdmPath            = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"

# ================= Helpers =================

function Get-Value([string]$Path,[string]$Name) {

  if (-not (Test-Path $Path)) { return $null }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-DWord([string]$Path,[string]$Name,[int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  Set-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -Force | Out-Null
}

function Remove-Value([string]$Path,[string]$Name) {

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

      $policy  = Get-Value $cloudContentPolicy "DisableWindowsConsumerFeatures"
      $delivery = Get-Value $cdmPath "ContentDeliveryAllowed"
      $suggest  = Get-Value $cdmPath "SystemPaneSuggestionsEnabled"

      $enabled =
        ($policy -eq 1) -and
        ($delivery -eq 0) -and
        ($suggest -eq 0)

      if ($enabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-DWord $cloudContentPolicy "DisableWindowsConsumerFeatures" 1

      Set-DWord $cdmPath "ContentDeliveryAllowed" 0
      Set-DWord $cdmPath "OemPreInstalledAppsEnabled" 0
      Set-DWord $cdmPath "PreInstalledAppsEnabled" 0
      Set-DWord $cdmPath "PreInstalledAppsEverEnabled" 0
      Set-DWord $cdmPath "SilentInstalledAppsEnabled" 0
      Set-DWord $cdmPath "SystemPaneSuggestionsEnabled" 0
      Set-DWord $cdmPath "SubscribedContent-338387Enabled" 0
      Set-DWord $cdmPath "SubscribedContent-338388Enabled" 0
      Set-DWord $cdmPath "SubscribedContent-338389Enabled" 0
      Set-DWord $cdmPath "SubscribedContent-353694Enabled" 0
      Set-DWord $cdmPath "RotatingLockScreenEnabled" 0
      Set-DWord $cdmPath "RotatingLockScreenOverlayEnabled" 0

      Out-Result "Enabled"
    }

    'Off' {

      Remove-Value $cloudContentPolicy "DisableWindowsConsumerFeatures"

      Remove-Value $cdmPath "ContentDeliveryAllowed"
      Remove-Value $cdmPath "OemPreInstalledAppsEnabled"
      Remove-Value $cdmPath "PreInstalledAppsEnabled"
      Remove-Value $cdmPath "PreInstalledAppsEverEnabled"
      Remove-Value $cdmPath "SilentInstalledAppsEnabled"
      Remove-Value $cdmPath "SystemPaneSuggestionsEnabled"
      Remove-Value $cdmPath "SubscribedContent-338387Enabled"
      Remove-Value $cdmPath "SubscribedContent-338388Enabled"
      Remove-Value $cdmPath "SubscribedContent-338389Enabled"
      Remove-Value $cdmPath "SubscribedContent-353694Enabled"
      Remove-Value $cdmPath "RotatingLockScreenEnabled"
      Remove-Value $cdmPath "RotatingLockScreenOverlayEnabled"

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
