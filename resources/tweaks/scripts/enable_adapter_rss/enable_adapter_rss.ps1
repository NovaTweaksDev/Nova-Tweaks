[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Enable Adapter RSS'

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

function Get-TargetAdapters {
    try {
        return @(
            Get-NetAdapter -ErrorAction Stop |
                Where-Object {
                    $_.HardwareInterface -eq $true -and
                    $_.Status -ne 'Disabled' -and
                    $_.InterfaceDescription -notmatch 'Virtual|VPN|TAP|TUN|Loopback|Bluetooth|Hyper-V|VMware|VirtualBox|Npcap|Wireshark'
                }
        )
    }
    catch {
        return @()
    }
}

function Get-RssSupportedAdapters {
    $adapters = Get-TargetAdapters
    $result = @()

    foreach ($adapter in @($adapters)) {
        try {
            $rss = Get-NetAdapterRss -Name $adapter.Name -ErrorAction Stop

            $result += [PSCustomObject]@{
                Name = $adapter.Name
                InterfaceDescription = $adapter.InterfaceDescription
                Enabled = [bool]$rss.Enabled
            }
        }
        catch {
            # Adapter or driver does not expose RSS support.
        }
    }

    return @($result)
}

function Enable-RssOnAdapters {
    param(
        [array]$Adapters
    )

    foreach ($adapter in @($Adapters)) {
        Enable-NetAdapterRss -Name $adapter.Name -ErrorAction Stop
    }
}

function Disable-RssOnAdapters {
    param(
        [array]$Adapters
    )

    foreach ($adapter in @($Adapters)) {
        Disable-NetAdapterRss -Name $adapter.Name -ErrorAction Stop
    }
}

try {
    switch ($State) {

        'Check' {
            $rssAdapters = Get-RssSupportedAdapters

            if (@($rssAdapters).Count -eq 0) {
                Out-Result 'Disabled' 'No supported physical network adapters with RSS support were detected.'
                break
            }

            $enabledCount = @($rssAdapters | Where-Object { $_.Enabled -eq $true }).Count
            $totalCount = @($rssAdapters).Count

            if ($enabledCount -eq $totalCount) {
                Out-Result 'Enabled' "Adapter RSS is enabled on all supported physical network adapters. Enabled adapters: $enabledCount/$totalCount."
            }
            elseif ($enabledCount -gt 0) {
                Out-Result 'Enabled' "Adapter RSS is partially enabled. Enabled adapters: $enabledCount/$totalCount."
            }
            else {
                Out-Result 'Disabled' 'Adapter RSS is disabled on all supported physical network adapters.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $rssAdapters = Get-RssSupportedAdapters

            if (@($rssAdapters).Count -eq 0) {
                throw 'No supported physical network adapters with RSS support were detected.'
            }

            Enable-RssOnAdapters -Adapters $rssAdapters

            Out-Result 'Enabled' "Adapter RSS has been enabled on supported physical network adapters. Updated adapters: $(@($rssAdapters).Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $rssAdapters = Get-RssSupportedAdapters

            if (@($rssAdapters).Count -eq 0) {
                Out-Result 'Disabled' 'No supported physical network adapters with RSS support were detected.'
                break
            }

            Disable-RssOnAdapters -Adapters $rssAdapters

            Out-Result 'Disabled' "Adapter RSS has been disabled on supported physical network adapters. Updated adapters: $(@($rssAdapters).Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
