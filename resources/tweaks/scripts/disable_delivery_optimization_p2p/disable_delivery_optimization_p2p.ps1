[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Delivery Optimization P2P'

$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization'
$ValueName = 'DODownloadMode'

$DisabledP2PValue = 0

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

function Remove-RegistryValue {
    if (-not (Test-Path $RegistryPath)) {
        return
    }

    try {
        Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
    }
    catch {
        # Value does not exist or was already removed.
    }
}

try {
    switch ($State) {

        'Check' {
            $currentValue = Get-CurrentValue

            if ($currentValue -eq 0) {
                Out-Result 'Enabled' 'Delivery Optimization P2P is disabled. Download Mode is set to HTTP only / no peering.'
            }
            elseif ($currentValue -eq 99) {
                Out-Result 'Enabled' 'Delivery Optimization P2P is disabled by Simple download mode.'
            }
            elseif ($currentValue -in @(1, 2, 3)) {
                Out-Result 'Disabled' "Delivery Optimization P2P may be active. Current Download Mode: $currentValue."
            }
            else {
                Out-Result 'Disabled' 'Delivery Optimization P2P is not explicitly disabled by policy.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-RegistryValue $DisabledP2PValue

            Out-Result 'Enabled' 'Delivery Optimization P2P has been disabled. Download Mode is now set to HTTP only / no peering.'
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Remove-RegistryValue

            Out-Result 'Disabled' 'Delivery Optimization P2P policy has been removed. Windows default behavior has been restored.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
