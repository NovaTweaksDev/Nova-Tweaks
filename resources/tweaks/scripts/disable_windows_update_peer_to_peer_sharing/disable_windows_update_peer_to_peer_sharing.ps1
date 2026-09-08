[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Windows Update Peer-to-Peer Sharing"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$deliveryOptimizationPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization"
$downloadModeName = "DODownloadMode"

# Delivery Optimization download modes:
# 0  = HTTP only / no peer-to-peer
# 1  = LAN peering
# 2  = Group peering
# 3  = Internet peering
# 99 = Simple mode / no peer-to-peer
$peerlessDownloadMode = 0

# ================= Helpers =================

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Value([string]$Path, [string]$Name) {

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-DWord([string]$Path, [string]$Name, [int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -PropertyType DWord `
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

function Get-DownloadModeValue {
  return Get-Value $deliveryOptimizationPolicyPath $downloadModeName
}

function Test-PeerToPeerSharingDisabled {
  $value = Get-DownloadModeValue

  return (($value -eq 0) -or ($value -eq 99))
}

function Test-ConfiguredByThisTweak {
  $value = Get-DownloadModeValue

  return ($value -eq $peerlessDownloadMode)
}

function Get-DownloadModeDescription([object]$Value) {

  if ($null -eq $Value) {
    return "not configured"
  }

  switch ([int]$Value) {
    0  { return "0 - HTTP only / peer-to-peer disabled" }
    1  { return "1 - LAN peer-to-peer enabled" }
    2  { return "2 - Group peer-to-peer enabled" }
    3  { return "3 - Internet peer-to-peer enabled" }
    99 { return "99 - Simple mode / peer-to-peer disabled" }
    default { return "$Value - unknown or custom mode" }
  }
}

function Get-DeliveryOptimizationStateMessage {
  $value = Get-DownloadModeValue
  $description = Get-DownloadModeDescription $value

  return "$downloadModeName=$description"
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-PeerToPeerSharingDisabled) {
        Out-Result "Enabled" "Windows Update peer-to-peer sharing is disabled. $(Get-DeliveryOptimizationStateMessage)"
      }
      else {
        Out-Result "Disabled" "Windows Update peer-to-peer sharing is not disabled by this policy. $(Get-DeliveryOptimizationStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable Windows Update peer-to-peer sharing."
      }

      Set-DWord $deliveryOptimizationPolicyPath $downloadModeName $peerlessDownloadMode

      if (Test-ConfiguredByThisTweak) {
        Out-Result "Enabled" "Windows Update peer-to-peer sharing has been disabled."
      }
      else {
        Out-Result "Disabled" "The policy was written, but verification failed. $(Get-DeliveryOptimizationStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore Delivery Optimization peer-to-peer behavior."
      }

      Remove-Value $deliveryOptimizationPolicyPath $downloadModeName

      if (Test-PeerToPeerSharingDisabled) {
        Out-Result "Enabled" "Delivery Optimization still appears to be in a non-peering mode. A system, domain, or MDM policy may be enforcing it. $(Get-DeliveryOptimizationStateMessage)"
      }
      else {
        Out-Result "Disabled" "Delivery Optimization download mode has been restored to Windows default behavior."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
