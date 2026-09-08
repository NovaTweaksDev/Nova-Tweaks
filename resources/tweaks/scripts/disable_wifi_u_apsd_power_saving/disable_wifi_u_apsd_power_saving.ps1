[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable WiFi U-APSD Power Saving'

$TargetRegistryKeywordPatterns = @(
    'UAPSD',
    'U-APSD',
    'WMMPowerSave',
    'WmmPowerSave',
    'WMMPS',
    'WMM.*Power'
)

$TargetDisplayNamePatterns = @(
    'U-APSD',
    'UAPSD',
    'WMM Power Save',
    'WMM Power Saving',
    'WMM-PS',
    'WiFi Multimedia Power Save'
)

$DisabledRegistryValues = @('0')
$EnabledRegistryValues = @('1')

$DisabledDisplayValues = @('Disabled', 'Off', 'Disable')
$EnabledDisplayValues = @('Enabled', 'On', 'Enable')

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

function Get-WifiAdapters {
    try {
        return @(
            Get-NetAdapter -ErrorAction Stop |
                Where-Object {
                    $_.HardwareInterface -eq $true -and
                    $_.Status -ne 'Disabled' -and
                    (
                        $_.Name -match 'Wi-Fi|WiFi|WLAN|Wireless' -or
                        $_.InterfaceDescription -match 'Wi-Fi|WiFi|WLAN|Wireless|802\.11'
                    ) -and
                    $_.InterfaceDescription -notmatch 'Virtual|VPN|TAP|TUN|Loopback|Hyper-V|VMware|VirtualBox|Npcap|Wireshark'
                }
        )
    }
    catch {
        return @()
    }
}

function Get-TargetProperties {
    $results = @()

    foreach ($adapter in @(Get-WifiAdapters)) {
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
    $registryValue = ([string]$Property.RegistryValue).Trim()
    $displayValue = ([string]$Property.DisplayValue).Trim()

    if ($DisabledRegistryValues -contains $registryValue) {
        return $true
    }

    foreach ($value in $DisabledDisplayValues) {
        if ($displayValue -eq $value) {
            return $true
        }
    }

    return $false
}

function Set-PropertyDisabled($Property) {
    $errors = @()

    foreach ($displayValue in @($DisabledDisplayValues)) {
        try {
            Set-NetAdapterAdvancedProperty `
                -Name $Property.AdapterName `
                -RegistryKeyword $Property.RegistryKeyword `
                -DisplayValue $displayValue `
                -NoRestart `
                -ErrorAction Stop

            return
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    foreach ($registryValue in @($DisabledRegistryValues)) {
        try {
            Set-NetAdapterAdvancedProperty `
                -Name $Property.AdapterName `
                -RegistryKeyword $Property.RegistryKeyword `
                -RegistryValue $registryValue `
                -NoRestart `
                -ErrorAction Stop

            return
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    throw "Failed to disable U-APSD on adapter '$($Property.AdapterName)'. $($errors -join ' ')"
}

function Set-PropertyEnabled($Property) {
    $errors = @()

    foreach ($displayValue in @($EnabledDisplayValues)) {
        try {
            Set-NetAdapterAdvancedProperty `
                -Name $Property.AdapterName `
                -RegistryKeyword $Property.RegistryKeyword `
                -DisplayValue $displayValue `
                -NoRestart `
                -ErrorAction Stop

            return
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    foreach ($registryValue in @($EnabledRegistryValues)) {
        try {
            Set-NetAdapterAdvancedProperty `
                -Name $Property.AdapterName `
                -RegistryKeyword $Property.RegistryKeyword `
                -RegistryValue $registryValue `
                -NoRestart `
                -ErrorAction Stop

            return
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    throw "Failed to restore U-APSD on adapter '$($Property.AdapterName)'. $($errors -join ' ')"
}

try {
    switch ($State) {

        'Check' {
            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported WiFi U-APSD power-saving property was detected.'
                break
            }

            $disabledCount = @($properties | Where-Object { Test-PropertyDisabled $_ }).Count
            $totalCount = @($properties).Count

            if ($disabledCount -eq $totalCount) {
                Out-Result 'Enabled' "WiFi U-APSD power saving is disabled on all supported wireless adapter properties. Disabled properties: $disabledCount/$totalCount."
            }
            elseif ($disabledCount -gt 0) {
                Out-Result 'Enabled' "WiFi U-APSD power saving is partially disabled. Disabled properties: $disabledCount/$totalCount."
            }
            else {
                Out-Result 'Disabled' 'WiFi U-APSD power saving is enabled or set to driver default.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                throw 'No supported WiFi U-APSD power-saving property was detected.'
            }

            foreach ($property in @($properties)) {
                Set-PropertyDisabled $property
            }

            Out-Result 'Enabled' "WiFi U-APSD power saving has been disabled. Updated properties: $(@($properties).Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $properties = Get-TargetProperties

            if (@($properties).Count -eq 0) {
                Out-Result 'Disabled' 'No supported WiFi U-APSD power-saving property was detected.'
                break
            }

            foreach ($property in @($properties)) {
                Set-PropertyEnabled $property
            }

            Out-Result 'Disabled' "WiFi U-APSD power saving has been restored to the common driver default enabled state. Updated properties: $(@($properties).Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
