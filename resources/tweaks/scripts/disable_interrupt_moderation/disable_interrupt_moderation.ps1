[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Interrupt Moderation"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$standardKeyword = "*InterruptModeration"
$disabledValue = 0
$enabledValue  = 1

# ================= Helpers =================

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-TargetAdapters {
  try {
    return @(
      Get-NetAdapter -ErrorAction Stop |
        Where-Object {
          $_.HardwareInterface -eq $true -and
          $_.Status -ne 'Disabled'
        }
    )
  }
  catch {
    return @()
  }
}

function Get-InterruptModerationProperty($Adapter) {
  try {
    $properties = Get-NetAdapterAdvancedProperty -Name $Adapter.Name -ErrorAction Stop

    $property = $properties | Where-Object {
      $_.RegistryKeyword -eq $standardKeyword
    } | Select-Object -First 1

    if ($null -ne $property) {
      return $property
    }

    $property = $properties | Where-Object {
      $_.DisplayName -eq "Interrupt Moderation"
    } | Select-Object -First 1

    return $property
  }
  catch {
    return $null
  }
}

function Get-SupportedAdapters {
  $supported = @()

  foreach ($adapter in Get-TargetAdapters) {
    $property = Get-InterruptModerationProperty $adapter

    if ($null -ne $property) {
      $supported += [PSCustomObject]@{
        Adapter  = $adapter
        Property = $property
      }
    }
  }

  return @($supported)
}

function Test-PropertyDisabled($Property) {
  if ($null -eq $Property) {
    return $false
  }

  $registryValue = [string]$Property.RegistryValue
  $displayValue  = [string]$Property.DisplayValue

  if ($registryValue -eq "0") {
    return $true
  }

  if ($displayValue -match "Disabled|Deaktiviert|Désactivé|Desactive") {
    return $true
  }

  return $false
}

function Test-InterruptModerationDisabled {
  $items = Get-SupportedAdapters

  if (@($items).Count -eq 0) {
    return $false
  }

  foreach ($item in $items) {
    if (-not (Test-PropertyDisabled $item.Property)) {
      return $false
    }
  }

  return $true
}

function Set-InterruptModeration([bool]$Disabled) {
  $items = Get-SupportedAdapters

  if (@($items).Count -eq 0) {
    throw "No supported physical network adapter exposes Interrupt Moderation."
  }

  $targetValue = if ($Disabled) { $disabledValue } else { $enabledValue }

  foreach ($item in $items) {
    $adapterName = [string]$item.Adapter.Name

    try {
      Set-NetAdapterAdvancedProperty `
        -Name $adapterName `
        -RegistryKeyword $standardKeyword `
        -RegistryValue $targetValue `
        -NoRestart `
        -ErrorAction Stop | Out-Null
    }
    catch {
      try {
        $displayValue = if ($Disabled) { "Disabled" } else { "Enabled" }

        Set-NetAdapterAdvancedProperty `
          -Name $adapterName `
          -DisplayName "Interrupt Moderation" `
          -DisplayValue $displayValue `
          -NoRestart `
          -ErrorAction Stop | Out-Null
      }
      catch {
        throw "Failed to configure Interrupt Moderation on adapter '$adapterName'. $($_.Exception.Message)"
      }
    }
  }
}

function Get-InterruptModerationStateMessage {
  $items = Get-SupportedAdapters

  if (@($items).Count -eq 0) {
    return "No supported physical network adapter exposes Interrupt Moderation."
  }

  $states = @()

  foreach ($item in $items) {
    $adapterName = [string]$item.Adapter.Name
    $registryValue = [string]$item.Property.RegistryValue
    $displayValue = [string]$item.Property.DisplayValue

    if ([string]::IsNullOrWhiteSpace($displayValue)) {
      $displayValue = "Unknown"
    }

    $states += "${adapterName}: RegistryValue=$registryValue, DisplayValue=$displayValue"
  }

  return ($states -join "; ")
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $items = Get-SupportedAdapters

      if (@($items).Count -eq 0) {
        Out-Result "Disabled" "No supported physical network adapter exposes Interrupt Moderation."
        exit 0
      }

      if (Test-InterruptModerationDisabled) {
        Out-Result "Enabled" "Interrupt Moderation is disabled on supported adapters. $(Get-InterruptModerationStateMessage)"
      }
      else {
        Out-Result "Disabled" "Interrupt Moderation is not disabled on all supported adapters. $(Get-InterruptModerationStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable Interrupt Moderation."
      }

      Set-InterruptModeration -Disabled $true

      if (Test-InterruptModerationDisabled) {
        Out-Result "Enabled" "Interrupt Moderation has been disabled on supported adapters."
      }
      else {
        Out-Result "Disabled" "Interrupt Moderation was configured, but verification failed. $(Get-InterruptModerationStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore Interrupt Moderation."
      }

      Set-InterruptModeration -Disabled $false

      if (Test-InterruptModerationDisabled) {
        Out-Result "Enabled" "Interrupt Moderation still appears to be disabled. A driver, policy, or adapter limitation may be preventing the restore. $(Get-InterruptModerationStateMessage)"
      }
      else {
        Out-Result "Disabled" "Interrupt Moderation has been restored to enabled on supported adapters."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
