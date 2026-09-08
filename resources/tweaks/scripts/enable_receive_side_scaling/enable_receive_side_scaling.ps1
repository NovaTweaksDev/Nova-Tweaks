[CmdletBinding()]
param(
    [ValidateSet('Check','On','Off')]
    [string]$State = 'Check',

    [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Enable Receive Side Scaling'

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
                    $_.InterfaceDescription -notmatch 'Virtual|VPN|TAP|TUN|Loopback|Bluetooth|Hyper-V|VMware|VirtualBox'
                }
        )
    }
    catch {
        return @()
    }
}

function Get-RssCapableAdapters {
    param(
        [array]$Adapters
    )

    $rssAdapters = @()

    foreach ($adapter in @($Adapters)) {
        try {
            $rss = Get-NetAdapterRss -Name $adapter.Name -ErrorAction Stop
            $rssAdapters += [PSCustomObject]@{
                Name = $adapter.Name
                Enabled = [bool]$rss.Enabled
            }
        }
        catch {
            # Adapter does not expose RSS support.
        }
    }

    return @($rssAdapters)
}

try {
    switch ($State) {

        'Check' {
            $adapters = Get-TargetAdapters
            $rssAdapters = Get-RssCapableAdapters -Adapters $adapters

            if (@($rssAdapters).Count -eq 0) {
                Out-Result 'Disabled' 'No supported physical network adapters with Receive Side Scaling were detected.'
                break
            }

            $enabledCount = @($rssAdapters | Where-Object { $_.Enabled -eq $true }).Count
            $totalCount = @($rssAdapters).Count

            if ($enabledCount -eq $totalCount) {
                Out-Result 'Enabled' "Receive Side Scaling is enabled on all supported physical network adapters. Enabled adapters: $enabledCount/$totalCount."
            }
            elseif ($enabledCount -gt 0) {
                Out-Result 'Enabled' "Receive Side Scaling is partially enabled. Enabled adapters: $enabledCount/$totalCount."
            }
            else {
                Out-Result 'Disabled' 'Receive Side Scaling is disabled on all supported physical network adapters.'
            }
        }

        'On' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $adapters = Get-TargetAdapters
            $rssAdapters = Get-RssCapableAdapters -Adapters $adapters

            if (@($rssAdapters).Count -eq 0) {
                throw 'No supported physical network adapters with Receive Side Scaling were detected.'
            }

            foreach ($adapter in @($rssAdapters)) {
                Enable-NetAdapterRss -Name $adapter.Name -ErrorAction Stop
            }

            Out-Result 'Enabled' "Receive Side Scaling has been enabled on supported physical network adapters. Updated adapters: $(@($rssAdapters).Count)."
        }

        'Off' {
            if (-not (Test-IsAdministrator)) {
                throw 'Administrator privileges are required.'
            }

            $adapters = Get-TargetAdapters
            $rssAdapters = Get-RssCapableAdapters -Adapters $adapters

            foreach ($adapter in @($rssAdapters)) {
                Disable-NetAdapterRss -Name $adapter.Name -ErrorAction Stop
            }

            Out-Result 'Disabled' "Receive Side Scaling has been disabled on supported physical network adapters. Updated adapters: $(@($rssAdapters).Count)."
        }
    }

    exit 0
}
catch {
    Out-Result 'Error' $_.Exception.Message
    exit 1
}
