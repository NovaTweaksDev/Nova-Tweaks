[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable 6to4 Tunnel Adapter'

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

function Get-6to4State {
    try {
        if (Get-Command Get-Net6to4Configuration -ErrorAction SilentlyContinue) {
            $config = Get-Net6to4Configuration -ErrorAction Stop
            return [string]$config.State
        }
    }
    catch {
        # Fall back to netsh below.
    }

    try {
        $output = netsh interface 6to4 show state 2>$null

        if ($LASTEXITCODE -ne 0 -or $null -eq $output) {
            return ''
        }

        $joined = ($output -join "`n")

        if ($joined -match '(?im)^\s*State\s*:\s*(.+?)\s*$') {
            return $Matches[1].Trim()
        }

        if ($joined -match '(?im)^\s*6to4 State\s*:\s*(.+?)\s*$') {
            return $Matches[1].Trim()
        }

        return $joined
    }
    catch {
        return ''
    }
}

function Set-6to4StateDisabled {
    try {
        if (Get-Command Set-Net6to4Configuration -ErrorAction SilentlyContinue) {
            Set-Net6to4Configuration -State Disabled -ErrorAction Stop
            return
        }
    }
    catch {
        # Fall back to netsh below.
    }

    netsh interface 6to4 set state state=disabled | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to disable 6to4.'
    }
}

function Set-6to4StateDefault {
    try {
        if (Get-Command Set-Net6to4Configuration -ErrorAction SilentlyContinue) {
            Set-Net6to4Configuration -State Default -ErrorAction Stop
            return
        }
    }
    catch {
        # Fall back to netsh below.
    }

    netsh interface 6to4 set state state=default | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to restore 6to4 to the Windows default configuration.'
    }
}

try {
    switch ($State) {

        'Check' {
            $currentState = Get-6to4State

            if ($currentState -match 'disabled') {
                Out-Result 'Enabled' '6to4 tunneling is disabled.'
            }
            elseif ([string]::IsNullOrWhiteSpace($currentState)) {
                Out-Result 'Disabled' '6to4 state could not be detected.'
            }
            else {
                Out-Result 'Disabled' "6to4 tunneling is not explicitly disabled. Current state: $currentState."
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-6to4StateDisabled

            Out-Result 'Enabled' '6to4 tunneling has been disabled.'
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            Set-6to4StateDefault

            Out-Result 'Disabled' '6to4 tunneling has been restored to the Windows default configuration.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
