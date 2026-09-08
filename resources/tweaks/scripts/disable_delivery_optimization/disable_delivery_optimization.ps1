[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Delivery Optimization"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegPath   = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization"
$ValueName = "DODownloadMode"
$BypassMode = 100
$DisabledModes = @(0, 99, 100)

function Get-RegistryDword([string]$Path, [string]$PropertyName) {
  try {
    $item = Get-ItemProperty -Path $Path -Name $PropertyName -ErrorAction Stop
    return [int]$item.$PropertyName
  }
  catch {
    return $null
  }
}

function Set-RegistryDword([string]$Path, [string]$PropertyName, [int]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $PropertyName `
    -Value $Value `
    -PropertyType DWord `
    -Force | Out-Null
}

function Remove-RegistryValue([string]$Path, [string]$PropertyName) {
  if (Test-Path $Path) {
    try {
      Remove-ItemProperty -Path $Path -Name $PropertyName -ErrorAction Stop
    }
    catch {}
  }
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-DownloadModeMessage([object]$Value) {
  if ($null -eq $Value) {
    return 'DODownloadMode is not configured.'
  }

  switch ([int]$Value) {
    0 { return 'DODownloadMode=0 (HTTP only / no peer-to-peer).' }
    99 { return 'DODownloadMode=99 (Simple mode / no peer-to-peer).' }
    100 { return 'DODownloadMode=100 (Bypass mode).' }
    default { return "DODownloadMode=$Value." }
  }
}

function Test-DeliveryOptimizationDisabled([object]$Value) {
  return ($null -ne $Value -and [int]$Value -in $DisabledModes)
}

try {
  switch ($State) {

    'Check' {
      $value = Get-RegistryDword -Path $RegPath -PropertyName $ValueName

      if (Test-DeliveryOptimizationDisabled $value) {
        Out-Result "Enabled" "Delivery Optimization is disabled or in a non-peering mode. $(Get-DownloadModeMessage $value)"
      }
      else {
        Out-Result "Disabled" "Delivery Optimization is not disabled by this policy. $(Get-DownloadModeMessage $value)"
      }
    }

    'On' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to disable Delivery Optimization.'
      }

      Set-RegistryDword -Path $RegPath -PropertyName $ValueName -Value $BypassMode
      $value = Get-RegistryDword -Path $RegPath -PropertyName $ValueName
      if (Test-DeliveryOptimizationDisabled $value) {
        Out-Result "Enabled" "Delivery Optimization has been disabled. $(Get-DownloadModeMessage $value)"
      }
      else {
        Out-Result "Error" "Delivery Optimization policy was written, but verification failed. $(Get-DownloadModeMessage $value)"
        exit 1
      }
    }

    'Off' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to restore Delivery Optimization.'
      }

      Remove-RegistryValue -Path $RegPath -PropertyName $ValueName
      $value = Get-RegistryDword -Path $RegPath -PropertyName $ValueName
      if (Test-DeliveryOptimizationDisabled $value) {
        Out-Result "Enabled" "Delivery Optimization still appears disabled. A system, domain, or MDM policy may be enforcing it. $(Get-DownloadModeMessage $value)"
      }
      else {
        Out-Result "Disabled" "Delivery Optimization policy has been restored to Windows default behavior."
      }
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
