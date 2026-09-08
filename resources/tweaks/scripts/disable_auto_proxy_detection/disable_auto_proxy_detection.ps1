[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Auto Proxy Detection'

$RegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$ValueName = 'AutoDetect'

$DisabledValue = 0
$DefaultValue = 1

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

            if ($currentValue -eq $DisabledValue) {
                Out-Result 'Enabled' 'Automatic proxy detection is disabled for the current user.'
            }
            else {
                Out-Result 'Disabled' 'Automatic proxy detection is enabled or set to Windows default.'
            }
        }

        'On' {
            Set-RegistryValue $DisabledValue

            Out-Result 'Enabled' 'Automatic proxy detection has been disabled for the current user.'
        }

        'Off' {
            Set-RegistryValue $DefaultValue

            Out-Result 'Disabled' 'Automatic proxy detection has been restored to the Windows default configuration.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
