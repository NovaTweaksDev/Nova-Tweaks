[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Create Gaming DSCP QoS Policy'

$PolicyPrefix = 'NovaTweaks Gaming DSCP'
$PolicyStore = 'PersistentStore'
$DscpValue = 46

$TargetExecutables = @(
    'FortniteClient-Win64-Shipping.exe',
    'VALORANT-Win64-Shipping.exe',
    'cs2.exe',
    'RocketLeague.exe',
    'r5apex.exe',
    'Overwatch.exe',
    'cod.exe'
)

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

function Get-ExpectedPolicyNames {
    $names = @()

    foreach ($exe in $TargetExecutables) {
        $names += "$PolicyPrefix - $exe"
    }

    return @($names)
}

function Get-GamingQosPolicies {
    try {
        return @(
            Get-NetQosPolicy -PolicyStore $PolicyStore -ErrorAction Stop |
                Where-Object { $_.Name -like "$PolicyPrefix*" }
        )
    }
    catch {
        try {
            return @(
                Get-NetQosPolicy -ErrorAction Stop |
                    Where-Object { $_.Name -like "$PolicyPrefix*" }
            )
        }
        catch {
            return @()
        }
    }
}

function Remove-QosPolicyByName([string]$Name) {
    try {
        Remove-NetQosPolicy -Name $Name -PolicyStore $PolicyStore -Confirm:$false -ErrorAction Stop
        return
    }
    catch {
        Remove-NetQosPolicy -Name $Name -Confirm:$false -ErrorAction Stop
    }
}

function New-GamingQosPolicy([string]$Executable) {
    $policyName = "$PolicyPrefix - $Executable"

    $existing = @(Get-GamingQosPolicies | Where-Object { $_.Name -eq $policyName })

    foreach ($policy in $existing) {
        Remove-QosPolicyByName -Name $policy.Name
    }

    New-NetQosPolicy `
        -Name $policyName `
        -PolicyStore $PolicyStore `
        -AppPathNameMatchCondition $Executable `
        -IPProtocolMatchCondition UDP `
        -NetworkProfile All `
        -DSCPAction $DscpValue `
        -ErrorAction Stop | Out-Null
}

try {
    switch ($State) {

        'Check' {
            $expectedNames = @(Get-ExpectedPolicyNames)
            $existingPolicies = @(Get-GamingQosPolicies)
            $existingNames = @($existingPolicies | Select-Object -ExpandProperty Name -Unique)

            $matchedCount = 0

            foreach ($name in $expectedNames) {
                if ($existingNames -contains $name) {
                    $matchedCount++
                }
            }

            if ($matchedCount -eq $expectedNames.Count) {
                Out-Result 'Enabled' "Gaming DSCP QoS policies are present. Policies detected: $matchedCount/$($expectedNames.Count). DSCP value: $DscpValue."
            }
            elseif ($matchedCount -gt 0) {
                Out-Result 'Enabled' "Gaming DSCP QoS policies are partially present. Policies detected: $matchedCount/$($expectedNames.Count)."
            }
            else {
                Out-Result 'Disabled' 'No Nova Tweaks gaming DSCP QoS policies were detected.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            foreach ($exe in $TargetExecutables) {
                New-GamingQosPolicy -Executable $exe
            }

            Out-Result 'Enabled' "Gaming DSCP QoS policies have been created for $($TargetExecutables.Count) game executables using DSCP $DscpValue."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $policies = @(Get-GamingQosPolicies)

            if ($policies.Count -eq 0) {
                Out-Result 'Disabled' 'No Nova Tweaks gaming DSCP QoS policies were detected.'
                break
            }

            foreach ($policy in $policies) {
                Remove-QosPolicyByName -Name $policy.Name
            }

            Out-Result 'Disabled' "Gaming DSCP QoS policies have been removed. Removed policies: $($policies.Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
