[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Set Threaded DPC Processing'

$RegistryPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl'
$ValueName = 'ThreadDpcEnable'

$EnabledValue = 1
$DefaultValue = 0

function Out-Result([string]$Status, [string]$Message = '') {
    @{
        tweak = $TweakName
        status = $Status
        message = $Message
    } | ConvertTo-Json -Compress
}

function Get-CurrentValue {
    if (-not (Test-Path $RegistryPath)) {
        return $null
    }

    try {
        return (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop).$ValueName
    }
    catch {
        return $null
    }
}

function Set-RegistryValue([int]$Value) {
    if (-not (Test-Path $RegistryPath)) {
        New-Item -Path $RegistryPath -Force | Out-Null
    }

    New-ItemProperty `
        -Path $RegistryPath `
        -Name $ValueName `
        -Value $Value `
        -PropertyType DWord `
        -Force | Out-Null
}

try {
    switch ($State) {

        'Check' {
            $currentValue = Get-CurrentValue

            if ($currentValue -eq $EnabledValue) {
                Out-Result 'Enabled' 'Threaded DPC processing is enabled.'
            }
            else {
                Out-Result 'Disabled' 'Threaded DPC processing is disabled or set to default.'
            }
        }

        'On' {
            Set-RegistryValue $EnabledValue

            Out-Result 'Enabled' 'Threaded DPC processing has been enabled. A reboot is required.'
        }

        'Off' {
            Set-RegistryValue $DefaultValue

            Out-Result 'Disabled' 'Threaded DPC processing has been restored to the Windows default configuration. A reboot is required.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
