#requires -Version 5.1

[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off')]
  [string]$State = 'Check',

  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$tcpInterfacesBasePath = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces'

$targetValues = @{
  'TCPNoDelay'      = 1
  'TcpAckFrequency' = 1
}

function Out-Result([string]$status, [string]$message = '') {
  @{ tweak = 'Disable Nagle Algorithm'; status = $status; message = $message } | ConvertTo-Json -Compress
}

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
          $_.Status -ne 'Disabled' -and
          -not [string]::IsNullOrWhiteSpace([string]$_.InterfaceGuid)
        }
    )
  }
  catch {
    return @()
  }
}

function Get-AdapterTcpRegistryPath($Adapter) {
  $interfaceGuid = [string]$Adapter.InterfaceGuid

  if ([string]::IsNullOrWhiteSpace($interfaceGuid)) {
    return $null
  }

  return "$tcpInterfacesBasePath\$interfaceGuid"
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

function Test-AdapterNagleDisabled($Adapter) {
  $path = Get-AdapterTcpRegistryPath $Adapter

  if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) {
    return $false
  }

  foreach ($name in $targetValues.Keys) {
    $currentValue = Get-Value $path $name
    $expectedValue = [int]$targetValues[$name]

    if ($currentValue -ne $expectedValue) {
      return $false
    }
  }

  return $true
}

function Test-NagleTweakEnabled {
  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    return $false
  }

  foreach ($adapter in $adapters) {
    if (-not (Test-AdapterNagleDisabled $adapter)) {
      return $false
    }
  }

  return $true
}

function Enable-NagleTweak {
  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    throw 'No active physical network adapters detected.'
  }

  foreach ($adapter in $adapters) {
    $path = Get-AdapterTcpRegistryPath $adapter

    if ([string]::IsNullOrWhiteSpace($path)) {
      continue
    }

    foreach ($name in $targetValues.Keys) {
      Set-DWord $path $name ([int]$targetValues[$name])
    }
  }
}

function Disable-NagleTweak {
  $adapters = Get-TargetAdapters

  foreach ($adapter in $adapters) {
    $path = Get-AdapterTcpRegistryPath $adapter

    if ([string]::IsNullOrWhiteSpace($path)) {
      continue
    }

    foreach ($name in $targetValues.Keys) {
      Remove-Value $path $name
    }
  }
}

function Get-NagleTweakStateMessage {
  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    return 'No active physical network adapters detected.'
  }

  $states = @()

  foreach ($adapter in $adapters) {
    $name = [string]$adapter.Name
    $path = Get-AdapterTcpRegistryPath $adapter

    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) {
      $states += "${name}: TCP interface registry path not found"
      continue
    }

    $parts = @()

    foreach ($valueName in $targetValues.Keys) {
      $value = Get-Value $path $valueName
      $valueText = if ($null -eq $value) { 'not configured' } else { [string]$value }
      $parts += "$valueName=$valueText"
    }

    $states += "${name}: $($parts -join ', ')"
  }

  return ($states -join '; ')
}

try {
  switch ($State) {
    'Check' {
      $adapters = Get-TargetAdapters

      if (@($adapters).Count -eq 0) {
        Out-Result 'Disabled' 'No active physical network adapters detected.'
        exit 0
      }

      if (Test-NagleTweakEnabled) {
        Out-Result 'Enabled' "Nagle-related TCP latency settings are enabled for active adapters. $(Get-NagleTweakStateMessage)"
      }
      else {
        Out-Result 'Disabled' "Nagle-related TCP latency settings are not fully enabled. $(Get-NagleTweakStateMessage)"
      }
    }

    'On' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to disable the Nagle algorithm.'
      }

      Enable-NagleTweak

      if (Test-NagleTweakEnabled) {
        Out-Result 'Enabled' 'Nagle-related TCP latency settings have been enabled. Restart Windows to apply the change reliably.'
      }
      else {
        Out-Result 'Disabled' "Nagle-related TCP latency settings were written, but verification failed. $(Get-NagleTweakStateMessage)"
      }
    }

    'Off' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to restore Nagle defaults.'
      }

      Disable-NagleTweak

      if (Test-NagleTweakEnabled) {
        Out-Result 'Enabled' "Nagle-related TCP latency settings still appear to be enabled. A policy or another tool may be enforcing them. $(Get-NagleTweakStateMessage)"
      }
      else {
        Out-Result 'Disabled' 'Nagle-related TCP latency settings have been restored to Windows defaults. Restart Windows to apply the change reliably.'
      }
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
