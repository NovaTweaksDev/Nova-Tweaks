[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Superfetch"; status = $status; message = $message } | ConvertTo-Json -Compress
}

try {
  switch ($State) {
    'Check' {
      $svc = Get-CimInstance Win32_Service -Filter "Name='SysMain'"
      if (-not $svc) { throw "Service 'SysMain' not found." }
      if ($svc.StartMode -eq 'Disabled') { Out-Result "Enabled" } else { Out-Result "Disabled" }
    }
    'On' {
      Stop-Service SysMain -Force -ErrorAction SilentlyContinue
      Set-Service SysMain -StartupType Disabled
      Out-Result "Enabled"
    }
    'Off' {
      Set-Service SysMain -StartupType Automatic
      Start-Service SysMain -ErrorAction SilentlyContinue
      Out-Result "Disabled"
    }
  }
  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
