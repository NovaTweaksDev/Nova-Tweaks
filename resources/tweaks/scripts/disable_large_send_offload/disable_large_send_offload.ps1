[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Large Send Offload"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$standardKeywords = @(
  "*LsoV2IPv4",
  "*LsoV2IPv6",
  "*LsoV1IPv4"
)

$displayNamePatterns = @(
  "Large Send Offload",
  "Large Send Offload V2",
  "LSO"
)

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
          $_.Status -ne "Disabled"
        }
    )
  }
  catch {
    return @()
  }
}

function Get-LsoProperties($Adapter) {
  $result = @()

  try {
    $properties = Get-NetAdapterAdvancedProperty -Name $Adapter.Name -ErrorAction Stop

    foreach ($property in $properties) {
      $keyword = [string]$property.RegistryKeyword
      $displayName = [string]$property.DisplayName

      if ($standardKeywords -contains $keyword) {
        $result += $property
        continue
      }

      foreach ($pattern in $displayNamePatterns) {
        if ($displayName -like "*$pattern*") {
          $result += $property
          break
        }
      }
    }
  }
  catch {}

  return @($result)
}

function Get-SupportedAdapters {
  $supported = @()

  foreach ($adapter in Get-TargetAdapters) {
    $properties = Get-LsoProperties $adapter

    if (@($properties).Count -gt 0) {
      $supported += [PSCustomObject]@{
        Adapter    = $adapter
        Properties = $properties
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

  if ($displayValue -match "Disabled|Deaktiviert|Désactivé|Desactive|Off|Aus") {
    return $true
  }

  return $false
}

function Test-LargeSendOffloadDisabled {
  $items = Get-SupportedAdapters

  if (@($items).Count -eq 0) {
    return $false
  }

  foreach ($item in $items) {
    foreach ($property in @($item.Properties)) {
      if (-not (Test-PropertyDisabled $property)) {
        return $false
      }
    }
  }

  return $true
}

function Set-LargeSendOffload([bool]$Disabled) {
  $items = Get-SupportedAdapters

  if (@($items).Count -eq 0) {
    throw "No supported physical network adapter exposes Large Send Offload."
  }

  $targetValue = if ($Disabled) { $disabledValue } else { $enabledValue }

  foreach ($item in $items) {
    $adapterName = [string]$item.Adapter.Name

    foreach ($property in @($item.Properties)) {
      $keyword = [string]$property.RegistryKeyword
      $displayName = [string]$property.DisplayName

      try {
        Set-NetAdapterAdvancedProperty `
          -Name $adapterName `
          -RegistryKeyword $keyword `
          -RegistryValue $targetValue `
          -NoRestart `
          -ErrorAction Stop | Out-Null
      }
      catch {
        try {
          $displayValue = if ($Disabled) { "Disabled" } else { "Enabled" }

          Set-NetAdapterAdvancedProperty `
            -Name $adapterName `
            -DisplayName $displayName `
            -DisplayValue $displayValue `
            -NoRestart `
            -ErrorAction Stop | Out-Null
        }
        catch {
          throw "Failed to configure '$displayName' on adapter '$adapterName'. $($_.Exception.Message)"
        }
      }
    }
  }
}

function Get-LargeSendOffloadStateMessage {
  $items = Get-SupportedAdapters

  if (@($items).Count -eq 0) {
    return "No supported physical network adapter exposes Large Send Offload."
  }

  $states = @()

  foreach ($item in $items) {
    $adapterName = [string]$item.Adapter.Name
    $propertyStates = @()

    foreach ($property in @($item.Properties)) {
      $displayName = [string]$property.DisplayName
      $registryKeyword = [string]$property.RegistryKeyword
      $registryValue = [string]$property.RegistryValue
      $displayValue = [string]$property.DisplayValue

      if ([string]::IsNullOrWhiteSpace($displayValue)) {
        $displayValue = "Unknown"
      }

      $propertyStates += "$displayName ($registryKeyword): RegistryValue=$registryValue, DisplayValue=$displayValue"
    }

    $states += "${adapterName}: $($propertyStates -join ', ')"
  }

  return ($states -join "; ")
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $items = Get-SupportedAdapters

      if (@($items).Count -eq 0) {
        Out-Result "Disabled" "No supported physical network adapter exposes Large Send Offload."
        exit 0
      }

      if (Test-LargeSendOffloadDisabled) {
        Out-Result "Enabled" "Large Send Offload is disabled on supported adapters. $(Get-LargeSendOffloadStateMessage)"
      }
      else {
        Out-Result "Disabled" "Large Send Offload is not disabled on all supported adapters. $(Get-LargeSendOffloadStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable Large Send Offload."
      }

      Set-LargeSendOffload -Disabled $true

      if (Test-LargeSendOffloadDisabled) {
        Out-Result "Enabled" "Large Send Offload has been disabled on supported adapters."
      }
      else {
        Out-Result "Disabled" "Large Send Offload was configured, but verification failed. $(Get-LargeSendOffloadStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore Large Send Offload."
      }

      Set-LargeSendOffload -Disabled $false

      if (Test-LargeSendOffloadDisabled) {
        Out-Result "Enabled" "Large Send Offload still appears to be disabled. A driver, policy, or adapter limitation may be preventing the restore. $(Get-LargeSendOffloadStateMessage)"
      }
      else {
        Out-Result "Disabled" "Large Send Offload has been restored to enabled on supported adapters."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
