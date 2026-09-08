[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Enable DNS over HTTPS (DoH)"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$KnownDohServers = @(
  @{ Address = '1.1.1.1';           Template = 'https://cloudflare-dns.com/dns-query' },
  @{ Address = '1.0.0.1';           Template = 'https://cloudflare-dns.com/dns-query' },
  @{ Address = '8.8.8.8';           Template = 'https://dns.google/dns-query' },
  @{ Address = '8.8.4.4';           Template = 'https://dns.google/dns-query' },
  @{ Address = '9.9.9.9';           Template = 'https://dns.quad9.net/dns-query' },
  @{ Address = '149.112.112.112';   Template = 'https://dns.quad9.net/dns-query' }
)

function Get-ActiveDnsServerAddresses {
  $servers = @()

  $dnsInfo = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.ServerAddresses -and $_.ServerAddresses.Count -gt 0
  }

  foreach ($entry in $dnsInfo) {
    foreach ($server in $entry.ServerAddresses) {
      if ($server -and $server -match '^\d{1,3}(\.\d{1,3}){3}$') {
        $servers += $server
      }
    }
  }

  $servers | Sort-Object -Unique
}

function Get-KnownDohConfig([string]$serverAddress) {
  Get-DnsClientDohServerAddress -ServerAddress $serverAddress -ErrorAction SilentlyContinue
}

function Ensure-DohServer([string]$serverAddress, [string]$template) {
  $existing = Get-KnownDohConfig $serverAddress

  if ($null -eq $existing) {
    Add-DnsClientDohServerAddress -ServerAddress $serverAddress -DohTemplate $template -AllowFallbackToUdp $false -AutoUpgrade $true | Out-Null
  }
  else {
    Set-DnsClientDohServerAddress -ServerAddress $serverAddress -DohTemplate $template -AllowFallbackToUdp $false -AutoUpgrade $true | Out-Null
  }
}

function Disable-DohServerAutoUpgrade([string]$serverAddress, [string]$template) {
  $existing = Get-KnownDohConfig $serverAddress

  if ($null -ne $existing) {
    Set-DnsClientDohServerAddress -ServerAddress $serverAddress -DohTemplate $template -AllowFallbackToUdp $false -AutoUpgrade $false | Out-Null
  }
}

function Get-DohApplied {
  $activeServers = Get-ActiveDnsServerAddresses

  if (-not $activeServers -or $activeServers.Count -eq 0) {
    return $false
  }

  foreach ($server in $activeServers) {
    $config = Get-KnownDohConfig $server
    if ($null -ne $config -and $config.AutoUpgrade) {
      return $true
    }
  }

  return $false
}

try {
  switch ($State) {

    'Check' {
      $applied = Get-DohApplied

      if ($applied) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      foreach ($server in $KnownDohServers) {
        Ensure-DohServer -serverAddress $server.Address -template $server.Template
      }

      if (Get-DohApplied) {
        Out-Result "Enabled" "DoH enabled for compatible active DNS servers"
      }
      else {
        Out-Result "Enabled" "Known DoH servers configured; effect requires a compatible active DNS server"
      }
    }

    'Off' {
      foreach ($server in $KnownDohServers) {
        Disable-DohServerAutoUpgrade -serverAddress $server.Address -template $server.Template
      }

      Out-Result "Disabled" "DoH auto-upgrade disabled for configured public providers"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
