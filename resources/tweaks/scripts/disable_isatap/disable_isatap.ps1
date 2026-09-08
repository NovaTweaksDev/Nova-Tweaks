[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable ISATAP'

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

function Invoke-Netsh {
    param(
        [string[]]$Arguments
    )

    $output = & netsh @Arguments 2>&1
    $exitCode = $LASTEXITCODE

    return @{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Get-IsatapState {
    $result = Invoke-Netsh -Arguments @('interface', 'isatap', 'show', 'state')

    if ($result.ExitCode -ne 0 -or $null -eq $result.Output) {
        return ''
    }

    $joined = ($result.Output -join "`n")

    if ($joined -match '(?im)^\s*State\s*:\s*(.+?)\s*$') {
        return $Matches[1].Trim()
    }

    if ($joined -match '(?im)^\s*ISATAP State\s*:\s*(.+?)\s*$') {
        return $Matches[1].Trim()
    }

    return $joined.Trim()
}

function Set-IsatapDisabled {
    $result = Invoke-Netsh -Arguments @('interface', 'isatap', 'set', 'state', 'disabled')

    if ($result.ExitCode -ne 0) {
        throw "Failed to disable ISATAP. $($result.Output -join ' ')"
    }
}

function Set-IsatapDefault {
    $result = Invoke-Netsh -Arguments @('interface', 'isatap', 'set', 'state', 'default')

    if ($result.ExitCode -ne 0) {
        throw "Failed to restore ISATAP to the Windows default configuration. $($result.Output -join ' ')"
    }
}

try {
    switch ($State) {

        'Check' {
            $currentState = Get-IsatapState

            if ($currentState -match 'disabled') {
                Out-Result 'Enabled' 'ISATAP is disabled.'
            }
            elseif ([string]::IsNullOrWhiteSpace($currentState)) {
                Out-Result 'Disabled' 'ISATAP state could not be detected.'
            }
            else {
                Out-Result 'Disabled' "ISATAP is not explicitly disabled. Current state: $currentState."
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-IsatapDisabled

            Out-Result 'Enabled' 'ISATAP has been disabled.'
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-IsatapDefault

            Out-Result 'Disabled' 'ISATAP has been restored to the Windows default configuration.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
