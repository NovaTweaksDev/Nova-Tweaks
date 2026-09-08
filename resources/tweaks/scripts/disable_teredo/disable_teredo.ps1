[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Teredo'

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

function Get-TeredoState {
    $output = netsh interface teredo show state 2>$null

    if ($LASTEXITCODE -ne 0 -or $null -eq $output) {
        return ''
    }

    $joined = ($output -join "`n")

    if ($joined -match '(?im)^\s*Type\s*:\s*(.+?)\s*$') {
        return $Matches[1].Trim()
    }

    return ''
}

function Set-TeredoDisabled {
    netsh interface teredo set state disabled | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to disable Teredo.'
    }
}

function Set-TeredoDefault {
    netsh interface teredo set state default | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to restore Teredo to the Windows default configuration.'
    }
}

try {
    switch ($State) {

        'Check' {
            $currentState = Get-TeredoState

            if ($currentState -match 'disabled') {
                Out-Result 'Enabled' 'Teredo is disabled.'
            }
            elseif ([string]::IsNullOrWhiteSpace($currentState)) {
                Out-Result 'Disabled' 'Teredo state could not be detected.'
            }
            else {
                Out-Result 'Disabled' "Teredo is not disabled. Current state: $currentState."
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-TeredoDisabled

            Out-Result 'Enabled' 'Teredo has been disabled.'
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-TeredoDefault

            Out-Result 'Disabled' 'Teredo has been restored to the Windows default configuration.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
