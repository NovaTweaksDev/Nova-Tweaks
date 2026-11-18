[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Windows Update Peer-to-Peer Sharing'
$PolicyPath = 'SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization'
$ValueName = 'DODownloadMode'
$PeerlessMode = 0
$LegacyBypassMode = 100
$SimpleMode = 99

function Out-Result([string]$Status, [string]$Message) {
    @{ tweak = $TweakName; status = $Status; message = $Message } | ConvertTo-Json -Compress
}

function Get-DownloadMode {
    $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($PolicyPath)
    if ($null -eq $key) { return $null }

    try {
        $value = $key.GetValue($ValueName)
        if ($null -eq $value) { return $null }
        if ($key.GetValueKind($ValueName) -ne [Microsoft.Win32.RegistryValueKind]::DWord) {
            throw "$ValueName is configured with an unexpected registry value type."
        }
        return $value
    }
    finally {
        $key.Dispose()
    }
}

try {
    switch ($State) {
        'Check' {
            $mode = Get-DownloadMode
            if ($mode -in @($PeerlessMode, $SimpleMode, $LegacyBypassMode)) {
                Out-Result 'Enabled' "A non-peering policy is configured ($ValueName=$mode)."
            }
            else {
                Out-Result 'Disabled' 'A non-peering policy is not configured.'
            }
        }

        'On' {
            # Validate the existing value before replacing it.
            $null = Get-DownloadMode
            $key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($PolicyPath)
            try {
                $key.SetValue($ValueName, $PeerlessMode, [Microsoft.Win32.RegistryValueKind]::DWord)
            }
            finally {
                $key.Dispose()
            }
            if ((Get-DownloadMode) -ne $PeerlessMode) {
                throw 'Could not verify the peer-to-peer policy after writing it.'
            }
            Out-Result 'Enabled' 'Delivery Optimization uses HTTP downloads without peer-to-peer sharing.'
        }

        'Off' {
            $mode = Get-DownloadMode
            if ($mode -in @($PeerlessMode, $LegacyBypassMode)) {
                $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($PolicyPath, $true)
                if ($null -ne $key) {
                    try {
                        $key.DeleteValue($ValueName, $false)
                    }
                    finally {
                        $key.Dispose()
                    }
                }
            }

            $mode = Get-DownloadMode
            if ($mode -in @($PeerlessMode, $SimpleMode, $LegacyBypassMode)) {
                throw "A non-peering policy is still configured ($ValueName=$mode)."
            }
            Out-Result 'Disabled' 'Delivery Optimization is no longer configured in a non-peering mode.'
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
