[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Flow Control'

$TargetRegistryKeywords = @('*FlowControl')
$TargetDisplayNamePatterns = @('Flow Control')
$DisabledValue = 0
$DefaultValue = 3

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

function Set-AdvancedPropertyValue($Property, [string]$Value) {
    Set-NetAdapterAdvancedProperty `
        -Name $Property.AdapterName `
        -RegistryKeyword $Property.RegistryKeyword `
        -RegistryValue $Value `
        -NoRestart `
        -ErrorAction Stop
}

try {
    switch ($State) {

        'Check' {
            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported Flow Control adapter properties were detected.'
                break
            }

            $disabledCount = @($properties | Where-Object { [string]$_.RegistryValue -eq [string]$DisabledValue }).Count
            $totalCount = @($properties).Count

            if ($disabledCount -eq $totalCount) {
                Out-Result 'Enabled' "Flow Control is disabled on all supported physical network adapters. Disabled properties: $disabledCount/$totalCount."
            }
            elseif ($disabledCount -gt 0) {
                Out-Result 'Enabled' "Flow Control is partially disabled. Disabled properties: $disabledCount/$totalCount."
            }
            else {
                Out-Result 'Disabled' 'Flow Control is enabled or set to driver default on supported physical network adapters.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                throw 'No supported Flow Control adapter properties were detected.'
            }

            foreach ($property in @($properties)) {
                Set-AdvancedPropertyValue $property ([string]$DisabledValue)
            }

            Out-Result 'Enabled' "Flow Control has been disabled on supported physical network adapter properties. Updated properties: $(@($properties).Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported Flow Control adapter properties were detected.'
                break
            }

            foreach ($property in @($properties)) {
                Set-AdvancedPropertyValue $property ([string]$DefaultValue)
            }

            Out-Result 'Disabled' "Flow Control has been restored to the common driver default value. Updated properties: $(@($properties).Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
