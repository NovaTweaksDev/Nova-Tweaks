[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Green Ethernet'

$TargetRegistryKeywordPatterns = @(
    'EEE',
    'Green',
    'GigaLite',
    'PowerSaving',
    'PowerSave',
    'AutoDisableGigabit'
)

$TargetDisplayNamePatterns = @(
    'Energy Efficient Ethernet',
    'Green Ethernet',
    'Gigabit Lite',
    'Power Saving Mode',
    'System Idle Power Saver',
    'Advanced EEE',
    'Auto Disable Gigabit'
)

$DisabledValue = 0
$DefaultValue = 1

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
                $matchesKeyword = $false
                $matchesDisplay = $false

                foreach ($pattern in $TargetRegistryKeywordPatterns) {
                    if ($property.RegistryKeyword -match $pattern) {
                        $matchesKeyword = $true
                        break
                    }
                }

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

function Test-PropertyDisabled($Property) {
    $registryValue = [string]$Property.RegistryValue
    $displayValue = [string]$Property.DisplayValue

    if ($registryValue -eq [string]$DisabledValue) {
        return $true
    }

    if ($displayValue -match 'Disabled|Off') {
        return $true
    }

    return $false
}

function Set-AdvancedPropertyDisabled($Property) {
    try {
        Set-NetAdapterAdvancedProperty `
            -Name $Property.AdapterName `
            -RegistryKeyword $Property.RegistryKeyword `
            -RegistryValue ([string]$DisabledValue) `
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

function Set-AdvancedPropertyDefault($Property) {
    try {
        Set-NetAdapterAdvancedProperty `
            -Name $Property.AdapterName `
            -RegistryKeyword $Property.RegistryKeyword `
            -RegistryValue ([string]$DefaultValue) `
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
        -DisplayValue 'Enabled' `
        -NoRestart `
        -ErrorAction Stop
}

try {
    switch ($State) {

        'Check' {
            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported Green Ethernet or adapter power-saving properties were detected.'
                break
            }

            $disabledCount = @($properties | Where-Object { Test-PropertyDisabled $_ }).Count
            $totalCount = @($properties).Count

            if ($disabledCount -eq $totalCount) {
                Out-Result 'Enabled' "Green Ethernet related adapter power-saving properties are disabled. Disabled properties: $disabledCount/$totalCount."
            }
            elseif ($disabledCount -gt 0) {
                Out-Result 'Enabled' "Green Ethernet related adapter power-saving properties are partially disabled. Disabled properties: $disabledCount/$totalCount."
            }
            else {
                Out-Result 'Disabled' 'Green Ethernet related adapter power-saving properties are enabled or set to driver default.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                throw 'No supported Green Ethernet or adapter power-saving properties were detected.'
            }

            foreach ($property in @($properties)) {
                Set-AdvancedPropertyDisabled $property
            }

            Out-Result 'Enabled' "Green Ethernet related adapter power-saving properties have been disabled. Updated properties: $(@($properties).Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported Green Ethernet or adapter power-saving properties were detected.'
                break
            }

            foreach ($property in @($properties)) {
                Set-AdvancedPropertyDefault $property
            }

            Out-Result 'Disabled' "Green Ethernet related adapter power-saving properties have been restored to the common driver default value. Updated properties: $(@($properties).Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
