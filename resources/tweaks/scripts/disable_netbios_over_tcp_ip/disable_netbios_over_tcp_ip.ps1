[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable NetBIOS over TCP/IP'

$InterfaceRegistryRoot = 'HKLM:\SYSTEM\CurrentControlSet\Services\NetBT\Parameters\Interfaces'
$ValueName = 'NetbiosOptions'

$DefaultValue = 0
$DisabledValue = 2

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

function Get-NetBtInterfaceKeys {
    if (-not (Test-Path -Path $InterfaceRegistryRoot)) {
        return @()
    }

    return @(
        Get-ChildItem -Path $InterfaceRegistryRoot -ErrorAction Stop |
            Where-Object { $_.PSChildName -like 'Tcpip_*' }
    )
}

function Get-NetbiosOptionValue($Key) {
    try {
        $property = Get-ItemProperty -Path $Key.PSPath -Name $ValueName -ErrorAction Stop
        return [int]$property.$ValueName
    }
    catch {
        return $DefaultValue
    }
}

function Set-NetbiosOptionValue($Key, [int]$Value) {
    $exists = $false

    try {
        Get-ItemProperty -Path $Key.PSPath -Name $ValueName -ErrorAction Stop | Out-Null
        $exists = $true
    }
    catch {
        $exists = $false
    }

    if ($exists) {
        Set-ItemProperty -Path $Key.PSPath -Name $ValueName -Value $Value -ErrorAction Stop
    }
    else {
        New-ItemProperty -Path $Key.PSPath -Name $ValueName -Value $Value -PropertyType DWord -ErrorAction Stop | Out-Null
    }
}

try {
    switch ($State) {

        'Check' {
            $keys = @(Get-NetBtInterfaceKeys)

            if ($keys.Count -eq 0) {
                Out-Result 'Disabled' 'No NetBT TCP/IP interface registry entries were detected.'
                break
            }

            $disabledCount = 0

            foreach ($key in $keys) {
                $currentValue = Get-NetbiosOptionValue -Key $key

                if ($currentValue -eq $DisabledValue) {
                    $disabledCount++
                }
            }

            if ($disabledCount -eq $keys.Count) {
                Out-Result 'Enabled' "NetBIOS over TCP/IP is disabled on all detected interfaces. Disabled interfaces: $disabledCount/$($keys.Count)."
            }
            elseif ($disabledCount -gt 0) {
                Out-Result 'Enabled' "NetBIOS over TCP/IP is partially disabled. Disabled interfaces: $disabledCount/$($keys.Count)."
            }
            else {
                Out-Result 'Disabled' 'NetBIOS over TCP/IP is enabled or using DHCP/default behavior.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $keys = @(Get-NetBtInterfaceKeys)

            if ($keys.Count -eq 0) {
                throw 'No NetBT TCP/IP interface registry entries were detected.'
            }

            foreach ($key in $keys) {
                Set-NetbiosOptionValue -Key $key -Value $DisabledValue
            }

            Out-Result 'Enabled' "NetBIOS over TCP/IP has been disabled on detected interfaces. Updated interfaces: $($keys.Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $keys = @(Get-NetBtInterfaceKeys)

            if ($keys.Count -eq 0) {
                Out-Result 'Disabled' 'No NetBT TCP/IP interface registry entries were detected.'
                break
            }

            foreach ($key in $keys) {
                Set-NetbiosOptionValue -Key $key -Value $DefaultValue
            }

            Out-Result 'Disabled' "NetBIOS over TCP/IP has been restored to DHCP/default behavior. Updated interfaces: $($keys.Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
