[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Jumbo Packet'

$TargetRegistryKeywords = @('*JumboPacket')
$TargetDisplayNamePatterns = @('Jumbo Packet', 'Jumbo Frame', 'Jumbo')
$StandardFrameValue = 1514
$FallbackDisabledValue = 0

function Out-Result([string]$Status, [string]$Message = '') {
    @{
        tweak = $TweakName
        status = $Status
        message = $Message
    } | ConvertTo-Json -Compress
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
                    $_.InterfaceDescription -notmatch 'Virtual|VPN|TAP|TUN|Loopback|Bluetooth|Hyper-V|VMware|VirtualBox|Npcap|Wireshark'
                }
        )
    }
    catch {
        return @()
    }
}

function Get-TargetProperties {
    $results = @()

    foreach ($adapter in @(Get-TargetAdapters)) {
        try {
            $properties = Get-NetAdapterAdvancedProperty -Name $adapter.Name -ErrorAction Stop

            foreach ($property in @($properties)) {
                $matchesKeyword = $TargetRegistryKeywords -contains $property.RegistryKeyword
                $matchesDisplay = $false

                foreach ($pattern in $TargetDisplayNamePatterns) {
                    if ($property.DisplayName -match $pattern) {
                        $matchesDisplay = $true
                        break
                    }
                }

                if ($matchesKeyword -or $matchesDisplay) {
                    $results += [PSCustomObject]@{
                        AdapterName = $adapter.Name
                        InterfaceGuid = [string]$adapter.InterfaceGuid
                        DisplayName = [string]$property.DisplayName
                        RegistryKeyword = [string]$property.RegistryKeyword
                        RegistryValue = [string]$property.RegistryValue
                        DisplayValue = [string]$property.DisplayValue
                    }
                }
            }
        }
        catch {
            # Ignore unsupported adapters.
        }
    }

    return @($results)
}

function Test-JumboDisabled($Property) {
    $registryValue = [string]$Property.RegistryValue
    $displayValue = [string]$Property.DisplayValue

    if ($registryValue -eq [string]$StandardFrameValue) {
        return $true
    }

    if ($registryValue -eq [string]$FallbackDisabledValue) {
        return $true
    }

    if ($displayValue -match 'Disabled|Off|1514') {
        return $true
    }

    return $false
}

function Set-JumboDisabled($Property) {
    try {
        Set-NetAdapterAdvancedProperty `
            -Name $Property.AdapterName `
            -RegistryKeyword $Property.RegistryKeyword `
            -RegistryValue ([string]$StandardFrameValue) `
            -NoRestart `
            -ErrorAction Stop
        return
    }
    catch {
        # Try fallback value below.
    }

    try {
        Set-NetAdapterAdvancedProperty `
            -Name $Property.AdapterName `
            -RegistryKeyword $Property.RegistryKeyword `
            -RegistryValue ([string]$FallbackDisabledValue) `
            -NoRestart `
            -ErrorAction Stop
        return
    }
    catch {
        # Try display value below.
    }

    Set-NetAdapterAdvancedProperty `
        -Name $Property.AdapterName `
        -RegistryKeyword $Property.RegistryKeyword `
        -DisplayValue 'Disabled' `
        -NoRestart `
        -ErrorAction Stop
}

try {
    switch ($State) {

        'Check' {
            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported Jumbo Packet adapter properties were detected.'
                break
            }

            $disabledCount = @($properties | Where-Object { Test-JumboDisabled $_ }).Count
            $totalCount = @($properties).Count

            if ($disabledCount -eq $totalCount) {
                Out-Result 'Enabled' "Jumbo Packet is disabled on all supported physical network adapters. Disabled properties: $disabledCount/$totalCount."
            }
            elseif ($disabledCount -gt 0) {
                Out-Result 'Enabled' "Jumbo Packet is partially disabled. Disabled properties: $disabledCount/$totalCount."
            }
            else {
                Out-Result 'Disabled' 'Jumbo Packet appears to be enabled on supported physical network adapters.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                throw 'No supported Jumbo Packet adapter properties were detected.'
            }

            foreach ($property in @($properties)) {
                Set-JumboDisabled $property
            }

            Out-Result 'Enabled' "Jumbo Packet has been disabled on supported physical network adapter properties. Updated properties: $(@($properties).Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported Jumbo Packet adapter properties were detected.'
                break
            }

            foreach ($property in @($properties)) {
                Set-JumboDisabled $property
            }

            Out-Result 'Disabled' "Jumbo Packet has been restored to standard Ethernet frame size on supported physical network adapter properties. Updated properties: $(@($properties).Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
