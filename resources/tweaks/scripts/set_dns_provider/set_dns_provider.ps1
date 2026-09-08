[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [string]$Selection = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Set DNS Provider'
$AutomaticSelection = 'Automatic (DHCP)'
$DnsPresets = @{
  'Automatic (DHCP)' = @()
  'Cloudflare (1.1.1.1 / 1.0.0.1)' = @('1.1.1.1', '1.0.0.1')
  'Google (8.8.8.8 / 8.8.4.4)' = @('8.8.8.8', '8.8.4.4')
  'Quad9 (9.9.9.9 / 149.112.112.112)' = @('9.9.9.9', '149.112.112.112')
}

function Out-Result([string]$Status, [string]$Message = '', [string]$SelectedOption = '') {
  $result = @{
    tweak = $TweakName
    status = $Status
    message = $Message
  }

  if ($SelectedOption) {
    $result.details = @{
      selectedOption = $SelectedOption
      selected_option = $SelectedOption
    }
  }

  $result | ConvertTo-Json -Compress
}

function Normalize-AddressList([object]$Servers) {
  if ($null -eq $Servers) {
    return @()
  }

  $values = @()
  foreach ($entry in @($Servers)) {
    $value = [string]$entry
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $values += $value.Trim()
    }
  }

  return @($values | Sort-Object -Unique)
}

function Get-TargetAdapters {
  try {
    return @(
      Get-NetAdapter -ErrorAction Stop |
        Where-Object {
          $_.Status -eq 'Up' -and
          $_.HardwareInterface -eq $true -and
          $_.InterfaceDescription -notmatch 'Virtual|VPN|TAP|TUN|Loopback|Bluetooth|Hyper-V|VMware|VirtualBox|Npcap|Wireshark'
        } |
        ForEach-Object {
          [PSCustomObject]@{
            Name = [string]$_.Name
            InterfaceGuid = [string]$_.InterfaceGuid
            InterfaceIndex = [int]$_.ifIndex
          }
        }
    )
  }
  catch {
    try {
      return @(
        Get-CimInstance Win32_NetworkAdapter -ErrorAction Stop |
          Where-Object {
            $_.PhysicalAdapter -eq $true -and
            $_.NetEnabled -eq $true -and
            -not [string]::IsNullOrWhiteSpace([string]$_.GUID) -and
            $_.Description -notmatch 'Virtual|VPN|TAP|TUN|Loopback|Bluetooth|Hyper-V|VMware|VirtualBox|Npcap|Wireshark'
          } |
          ForEach-Object {
            $adapterName = [string]$_.NetConnectionID
            if ([string]::IsNullOrWhiteSpace($adapterName)) {
              $adapterName = [string]$_.Name
            }

            [PSCustomObject]@{
              Name = $adapterName
              InterfaceGuid = [string]$_.GUID
              InterfaceIndex = [int]$_.InterfaceIndex
            }
          }
      )
    }
    catch {
      return @()
    }
  }
}

function Get-AdapterNameServerValue($Adapter) {
  $interfaceGuid = [string]$Adapter.InterfaceGuid
  if ([string]::IsNullOrWhiteSpace($interfaceGuid)) {
    return $null
  }

  $registryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$interfaceGuid"
  if (-not (Test-Path $registryPath)) {
    return $null
  }

  try {
    $properties = Get-ItemProperty -Path $registryPath -ErrorAction Stop
    $nameServerProperty = $properties.PSObject.Properties['NameServer']
    if ($null -eq $nameServerProperty) {
      return ''
    }

    $rawValue = $nameServerProperty.Value
  } catch {
    return $null
  }

  if ($rawValue -is [array]) {
    return ($rawValue -join ',').Trim()
  }

  return ([string]$rawValue).Trim()
}

function Split-ServerAddresses([object]$Servers) {
  $addresses = @()

  foreach ($entry in @($Servers)) {
    foreach ($part in ([string]$entry -split '[,; ]+')) {
      if (-not [string]::IsNullOrWhiteSpace($part)) {
        $addresses += $part.Trim()
      }
    }
  }

  return @($addresses)
}

function Resolve-SelectionFromAddresses([object]$Servers) {
  $addresses = Split-ServerAddresses $Servers
  $normalizedCandidate = Normalize-AddressList $addresses
  if (@($normalizedCandidate).Count -eq 0) {
    return ''
  }

  foreach ($presetName in $DnsPresets.Keys) {
    if ($presetName -eq $AutomaticSelection) {
      continue
    }

    $presetAddresses = Normalize-AddressList $DnsPresets[$presetName]
    if (@($normalizedCandidate).Count -ne @($presetAddresses).Count) {
      continue
    }

    $same = $true
    for ($i = 0; $i -lt @($normalizedCandidate).Count; $i++) {
      if ($normalizedCandidate[$i] -ne $presetAddresses[$i]) {
        $same = $false
        break
      }
    }

    if ($same) {
      return $presetName
    }
  }

  return ''
}

function Resolve-SelectionFromNameServer([string]$NameServerValue) {
  if ([string]::IsNullOrWhiteSpace($NameServerValue)) {
    return $AutomaticSelection
  }

  return (Resolve-SelectionFromAddresses $NameServerValue)
}

function Get-AdapterDnsServerAddresses($Adapter) {
  $interfaceIndex = 0
  try {
    $interfaceIndex = [int]$Adapter.InterfaceIndex
  }
  catch {
    $interfaceIndex = 0
  }

  if ($interfaceIndex -le 0) {
    return @()
  }

  try {
    $dnsObject = Get-DnsClientServerAddress -InterfaceIndex $interfaceIndex -AddressFamily IPv4 -ErrorAction Stop
    return @(Split-ServerAddresses $dnsObject.ServerAddresses)
  }
  catch {
    return @()
  }
}

function Resolve-SelectionFromAdapter($Adapter) {
  $nameServerValue = Get-AdapterNameServerValue $Adapter

  if ($null -ne $nameServerValue -and -not [string]::IsNullOrWhiteSpace($nameServerValue)) {
    $registrySelection = Resolve-SelectionFromAddresses $nameServerValue
    if ($registrySelection) {
      return $registrySelection
    }
  }

  $dnsClientSelection = Resolve-SelectionFromAddresses (Get-AdapterDnsServerAddresses $Adapter)
  if ($dnsClientSelection) {
    return $dnsClientSelection
  }

  if ($null -ne $nameServerValue -and [string]::IsNullOrWhiteSpace($nameServerValue)) {
    return $AutomaticSelection
  }

  return ''
}

function Get-DetectedSelection($Adapters) {
  if (@($Adapters).Count -eq 0) {
    return ''
  }

  $detected = @()

  foreach ($adapter in @($Adapters)) {
    $selection = Resolve-SelectionFromAdapter $adapter
    if ($selection) {
      $detected += $selection
    }
  }

  if (@($detected).Count -eq 0) {
    return ''
  }

  $uniqueSelections = @($detected | Sort-Object -Unique)
  if (@($uniqueSelections).Count -ne 1) {
    return ''
  }

  return $uniqueSelections[0]
}

function Resolve-RequestedSelection([string]$RequestedSelection) {
  $normalized = [string]$RequestedSelection
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required.'
  }

  $normalized = $normalized.Trim()
  if (-not $DnsPresets.ContainsKey($normalized)) {
    throw "Unsupported DNS selection: $normalized"
  }

  return $normalized
}

function Apply-SelectionToAdapters($Adapters, [string]$SelectedPreset) {
  foreach ($adapter in @($Adapters)) {
    $interfaceIndex = [int]$adapter.InterfaceIndex
    $ipv4DnsObject = Get-DnsClientServerAddress -InterfaceIndex $interfaceIndex -AddressFamily IPv4 -ErrorAction Stop

    if ($SelectedPreset -eq $AutomaticSelection) {
      Set-DnsClientServerAddress -InputObject $ipv4DnsObject -ResetServerAddresses -ErrorAction Stop
      continue
    }

    $serverAddresses = $DnsPresets[$SelectedPreset]
    Set-DnsClientServerAddress -InputObject $ipv4DnsObject -ServerAddresses $serverAddresses -ErrorAction Stop
  }
}

try {
  switch ($State) {
    'Check' {
      $adapters = Get-TargetAdapters
      if (@($adapters).Count -eq 0) {
        Out-Result 'Disabled' 'No active physical adapters detected.'
        break
      }

      $detectedSelection = Get-DetectedSelection $adapters
      if ($detectedSelection) {
        Out-Result 'Enabled' '' $detectedSelection
      } else {
        Out-Result 'Disabled'
      }
    }

    'On' {
      $adapters = Get-TargetAdapters
      if (@($adapters).Count -eq 0) {
        throw 'No active physical adapters detected.'
      }

      $resolvedSelection = Resolve-RequestedSelection $Selection
      Apply-SelectionToAdapters $adapters $resolvedSelection

      $detectedSelection = Get-DetectedSelection $adapters
      if ($detectedSelection -eq $resolvedSelection) {
        Out-Result 'Enabled' '' $resolvedSelection
      }
      else {
        $message = if ($detectedSelection) {
          "DNS provider was written, but verification detected '$detectedSelection'."
        }
        else {
          'DNS provider was written, but verification could not detect the selected provider.'
        }
        Out-Result 'Disabled' $message $resolvedSelection
      }
    }

    'Off' {
      $adapters = Get-TargetAdapters
      if (@($adapters).Count -gt 0) {
        Apply-SelectionToAdapters $adapters $AutomaticSelection
      }
      Out-Result 'Disabled' '' $AutomaticSelection
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
