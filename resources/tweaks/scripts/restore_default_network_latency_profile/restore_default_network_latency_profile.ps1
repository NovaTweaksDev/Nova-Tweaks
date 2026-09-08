[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Restore Default Network Latency Profile"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$systemProfilePath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile"
$tcpInterfacesBasePath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces"

$defaultSystemProfileValues = @{
  "NetworkThrottlingIndex" = 10
  "SystemResponsiveness"   = 20
}

$tcpLatencyOverrideValues = @(
  "TcpAckFrequency",
  "TCPNoDelay",
  "TcpDelAckTicks"
)

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

function Get-TargetAdapters {
  try {
    return @(
      Get-NetAdapter -ErrorAction Stop |
        Where-Object {
          $_.HardwareInterface -eq $true -and
          $_.Status -ne "Disabled" -and
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

function Test-SystemProfileDefaultsApplied {

  foreach ($name in $defaultSystemProfileValues.Keys) {
    $currentValue = Get-Value $systemProfilePath $name
    $expectedValue = [int]$defaultSystemProfileValues[$name]

    if ($currentValue -ne $expectedValue) {
      return $false
    }
  }

  return $true
}

function Test-TcpLatencyOverridesRemoved {
  $adapters = Get-TargetAdapters

  foreach ($adapter in $adapters) {
    $path = Get-AdapterTcpRegistryPath $adapter

    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) {
      continue
    }

    foreach ($name in $tcpLatencyOverrideValues) {
      $currentValue = Get-Value $path $name

      if ($null -ne $currentValue) {
        return $false
      }
    }
  }

  return $true
}

function Test-DefaultNetworkLatencyProfileApplied {
  return ((Test-SystemProfileDefaultsApplied) -and (Test-TcpLatencyOverridesRemoved))
}

function Apply-DefaultNetworkLatencyProfile {
  foreach ($name in $defaultSystemProfileValues.Keys) {
    Set-DWord $systemProfilePath $name ([int]$defaultSystemProfileValues[$name])
  }

  $adapters = Get-TargetAdapters

  foreach ($adapter in $adapters) {
    $path = Get-AdapterTcpRegistryPath $adapter

    if ([string]::IsNullOrWhiteSpace($path)) {
      continue
    }

    foreach ($name in $tcpLatencyOverrideValues) {
      Remove-Value $path $name
    }
  }
}

function Get-NetworkLatencyProfileStateMessage {
  $parts = @()

  foreach ($name in $defaultSystemProfileValues.Keys) {
    $value = Get-Value $systemProfilePath $name
    $valueText = if ($null -eq $value) { "not configured" } else { [string]$value }
    $parts += "$name=$valueText"
  }

  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    $parts += "TCP adapters=no active physical adapters detected"
  }
  else {
    $adapterStates = @()

    foreach ($adapter in $adapters) {
      $adapterName = [string]$adapter.Name
      $path = Get-AdapterTcpRegistryPath $adapter

      if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) {
        $adapterStates += "${adapterName}: TCP interface registry path not found"
        continue
      }

      $values = @()

      foreach ($name in $tcpLatencyOverrideValues) {
        $value = Get-Value $path $name
        $valueText = if ($null -eq $value) { "not configured" } else { [string]$value }
        $values += "$name=$valueText"
      }

      $adapterStates += "${adapterName}: $($values -join ', ')"
    }

    $parts += "TCP overrides=[$($adapterStates -join '; ')]"
  }

  return ($parts -join ", ")
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-DefaultNetworkLatencyProfileApplied) {
        Out-Result "Enabled" "Default network latency profile is applied. $(Get-NetworkLatencyProfileStateMessage)"
      }
      else {
        Out-Result "Disabled" "Default network latency profile is not fully applied. $(Get-NetworkLatencyProfileStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore the default network latency profile."
      }

      Apply-DefaultNetworkLatencyProfile

      if (Test-DefaultNetworkLatencyProfileApplied) {
        Out-Result "Enabled" "Default network latency profile has been restored. Restart Windows to apply all changes reliably."
      }
      else {
        Out-Result "Disabled" "Default network latency profile was applied, but verification failed. $(Get-NetworkLatencyProfileStateMessage)"
      }
    }

    'Off' {

      Out-Result "Disabled" "This is a restore action. Off state does not apply another tuning profile."
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
