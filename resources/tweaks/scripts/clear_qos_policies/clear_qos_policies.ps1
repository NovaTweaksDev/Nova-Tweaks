[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Clear QoS Policies'

$PolicyStore = 'PersistentStore'

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

function Get-LocalQosPolicies {
    try {
        return @(Get-NetQosPolicy -PolicyStore $PolicyStore -ErrorAction Stop)
    }
    catch {
        return @(Get-NetQosPolicy -ErrorAction Stop)
    }
}

function Remove-LocalQosPolicy([string]$Name) {
    try {
        Remove-NetQosPolicy -Name $Name -PolicyStore $PolicyStore -Confirm:$false -ErrorAction Stop
        return
    }
    catch {
        Remove-NetQosPolicy -Name $Name -Confirm:$false -ErrorAction Stop
    }
}

try {
    switch ($State) {

        'Check' {
            $policies = @(Get-LocalQosPolicies)

            if ($policies.Count -eq 0) {
                Out-Result 'Enabled' 'No local QoS policies were detected in the persistent policy store.'
            }
            else {
                Out-Result 'Disabled' "Local QoS policies are present. Policies detected: $($policies.Count)."
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $policies = @(Get-LocalQosPolicies)

            if ($policies.Count -eq 0) {
                Out-Result 'Enabled' 'No local QoS policies were detected in the persistent policy store.'
                break
            }

            foreach ($policy in $policies) {
                Remove-LocalQosPolicy -Name $policy.Name
            }

            Out-Result 'Enabled' "Local QoS policies have been cleared. Removed policies: $($policies.Count)."
        }

        'Off' {
            Out-Result 'Disabled' 'This is a cleanup action. Off cannot restore previously removed QoS policies.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
