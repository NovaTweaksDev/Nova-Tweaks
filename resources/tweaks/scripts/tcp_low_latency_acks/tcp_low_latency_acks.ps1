[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "TCP Low Latency ACKs"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$tcpInterfacesBasePath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces"

$targetValues = @{
  "TcpAckFrequency" = 1
  "TCPNoDelay"      = 1
  "TcpDelAckTicks"  = 0
}

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

function Test-AdapterLowLatencyAcksEnabled($Adapter) {
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

function Test-LowLatencyAcksEnabled {
  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    return $false
  }

  foreach ($adapter in $adapters) {
    if (-not (Test-AdapterLowLatencyAcksEnabled $adapter)) {
      return $false
    }
  }

  return $true
}

function Enable-LowLatencyAcks {
  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    throw "No active physical network adapters detected."
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

function Disable-LowLatencyAcks {
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

function Get-LowLatencyAcksStateMessage {
  $adapters = Get-TargetAdapters

  if (@($adapters).Count -eq 0) {
    return "No active physical network adapters detected."
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
      $valueText = if ($null -eq $value) { "not configured" } else { [string]$value }
      $parts += "$valueName=$valueText"
    }

    $states += "${name}: $($parts -join ', ')"
  }

  return ($states -join "; ")
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $adapters = Get-TargetAdapters

      if (@($adapters).Count -eq 0) {
        Out-Result "Disabled" "No active physical network adapters detected."
        exit 0
      }

      if (Test-LowLatencyAcksEnabled) {
        Out-Result "Enabled" "TCP low latency ACK settings are enabled. $(Get-LowLatencyAcksStateMessage)"
      }
      else {
        Out-Result "Disabled" "TCP low latency ACK settings are not fully enabled. $(Get-LowLatencyAcksStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to enable TCP low latency ACK settings."
      }

      Enable-LowLatencyAcks

      if (Test-LowLatencyAcksEnabled) {
        Out-Result "Enabled" "TCP low latency ACK settings have been enabled. Restart Windows to apply the change reliably."
      }
      else {
        Out-Result "Disabled" "TCP low latency ACK settings were written, but verification failed. $(Get-LowLatencyAcksStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore TCP ACK defaults."
      }

      Disable-LowLatencyAcks

      if (Test-LowLatencyAcksEnabled) {
        Out-Result "Enabled" "TCP low latency ACK settings still appear to be enabled. A policy or another tool may be enforcing them. $(Get-LowLatencyAcksStateMessage)"
      }
      else {
        Out-Result "Disabled" "TCP ACK behavior has been restored to Windows defaults. Restart Windows to apply the change reliably."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
