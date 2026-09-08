[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "", [hashtable]$details = @{}) {
  @{ tweak = "Disable Network Adapter Power Saving"; status = $status; message = $message; details = $details } | ConvertTo-Json -Compress
}

$networkClassKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
$disablePowerSavingValue = 24

function Get-PhysicalAdapters {
  @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription })
}

function Get-ObjectPropertyValue($object, [string]$propertyName, $fallback = $null) {
  if ($null -eq $object -or -not $propertyName) {
    return $fallback
  }

  $property = $object.PSObject.Properties[$propertyName]
  if ($null -eq $property) {
    return $fallback
  }

  return $property.Value
}

function Get-AdapterRegistryKeys {
  $adapters = @(Get-PhysicalAdapters)
  if ($adapters.Count -eq 0) {
    return @()
  }

  $netCfgIds = @{}
  $driverDescriptions = @{}
  foreach ($adapter in $adapters) {
    $netCfgIds[[string]$adapter.InterfaceGuid] = $true
    $driverDescriptions[[string]$adapter.InterfaceDescription] = $true
  }

  @(Get-ChildItem $networkClassKey -ErrorAction SilentlyContinue | Where-Object {
    $props = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
    if (-not $props) { return $false }
    $netCfgId = [string](Get-ObjectPropertyValue $props 'NetCfgInstanceId' "")
    $driverDesc = [string](Get-ObjectPropertyValue $props 'DriverDesc' "")
    return ($netCfgId -and $netCfgIds.ContainsKey($netCfgId)) -or ($driverDesc -and $driverDescriptions.ContainsKey($driverDesc))
  })
}

function Test-KeyDisabled($key) {
  $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
  $value = [int](Get-ObjectPropertyValue $props 'PnPCapabilities' 0)
  return (($value -band $disablePowerSavingValue) -eq $disablePowerSavingValue)
}

function Set-KeyPowerSaving([bool]$disabled) {
  $keys = @(Get-AdapterRegistryKeys)
  $changed = 0

  foreach ($key in $keys) {
    $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    $current = [int](Get-ObjectPropertyValue $props 'PnPCapabilities' 0)
    $next = if ($disabled) { ($current -bor $disablePowerSavingValue) } else { ($current -band (-bnot $disablePowerSavingValue)) }
    if ($next -ne $current) {
      New-ItemProperty -LiteralPath $key.PSPath -Name 'PnPCapabilities' -PropertyType DWord -Value $next -Force | Out-Null
      $changed += 1
    }
  }

  return @{ matched = $keys.Count; changed = $changed }
}

function Invoke-NetAdapterPowerCmdlet([bool]$disabled) {
  $cmdlet = if ($disabled) { 'Disable-NetAdapterPowerManagement' } else { 'Enable-NetAdapterPowerManagement' }
  if (-not (Get-Command $cmdlet -ErrorAction SilentlyContinue)) {
    return
  }

  foreach ($adapter in Get-PhysicalAdapters) {
    try {
      & $cmdlet -Name $adapter.Name -ErrorAction SilentlyContinue | Out-Null
    }
    catch {}
  }
}

function Test-AllowComputerTurnOffDisabled($value) {
  if ($null -eq $value) {
    return $false
  }

  if ($value -is [bool]) {
    return -not $value
  }

  $normalized = ([string]$value).Trim().ToLowerInvariant()
  if ($normalized -match '^(disabled|deaktiviert|off|aus|false|0|no|nein)$') {
    return $true
  }

  return $false
}

function Get-NetAdapterPowerManagementStates {
  if (-not (Get-Command Get-NetAdapterPowerManagement -ErrorAction SilentlyContinue)) {
    return @()
  }

  $states = @()
  foreach ($adapter in Get-PhysicalAdapters) {
    try {
      $state = Get-NetAdapterPowerManagement -Name $adapter.Name -ErrorAction Stop
      $allowOff = Get-ObjectPropertyValue $state 'AllowComputerToTurnOffDevice' $null
      if ($null -ne $allowOff) {
        $states += [PSCustomObject]@{
          Name = $adapter.Name
          Disabled = Test-AllowComputerTurnOffDisabled $allowOff
          RawValue = [string]$allowOff
        }
      }
    }
    catch {}
  }

  return @($states)
}

try {
  $keys = @(Get-AdapterRegistryKeys)
  $powerStates = @(Get-NetAdapterPowerManagementStates)

  switch ($State) {
    'Check' {
      if ($keys.Count -gt 0) {
        $disabled = @($keys | Where-Object { Test-KeyDisabled $_ }).Count
        $status = if ($disabled -eq $keys.Count) { "Enabled" } else { "Disabled" }
        Out-Result $status "" @{ matched = $keys.Count; disabled = $disabled; source = "registry" }
        break
      }

      if ($powerStates.Count -gt 0) {
        $disabled = @($powerStates | Where-Object { $_.Disabled }).Count
        $status = if ($disabled -eq $powerStates.Count) { "Enabled" } else { "Disabled" }
        Out-Result $status "" @{ matched = $powerStates.Count; disabled = $disabled; source = "netadapter_power_management" }
        break
      }

      Out-Result "Disabled" "No physical network adapter power-management entries were found." @{ matched = 0; disabled = 0; source = "none" }
    }

    'On' {
      if ($keys.Count -eq 0 -and $powerStates.Count -eq 0) {
        throw "No physical network adapter power-management entries were found."
      }

      $result = Set-KeyPowerSaving $true
      Invoke-NetAdapterPowerCmdlet $true
      $nextKeys = @(Get-AdapterRegistryKeys)
      $disabled = @($nextKeys | Where-Object { Test-KeyDisabled $_ }).Count
      if ($nextKeys.Count -gt 0 -and $disabled -eq $nextKeys.Count) {
        Out-Result "Enabled" "Network adapter power saving disabled. Reconnecting the adapter or rebooting may be required for every driver to refresh." $result
      } else {
        Out-Result "Disabled" "Network adapter power saving was updated, but verification did not detect it on every adapter." @{ matched = $nextKeys.Count; disabled = $disabled; changed = $result.changed }
      }
    }

    'Off' {
      if ($keys.Count -eq 0 -and $powerStates.Count -eq 0) {
        throw "No physical network adapter power-management entries were found."
      }

      $result = Set-KeyPowerSaving $false
      Invoke-NetAdapterPowerCmdlet $false
      Out-Result "Disabled" "Network adapter power saving restored." $result
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
