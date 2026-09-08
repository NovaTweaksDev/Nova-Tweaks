[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{
    tweak   = "Run Windows Update Troubleshooter"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      try {
        Start-Process 'ms-settings:troubleshoot' -ErrorAction Stop
        Out-Result "Enabled" "Troubleshoot settings opened; run the Windows Update troubleshooter"
      }
      catch {
        Start-Process 'ms-settings:' -ErrorAction Stop
        Out-Result "Enabled" "Windows Settings opened; go to System > Troubleshoot > Other troubleshooters > Windows Update"
      }
    }

    'Off' {
      Out-Result "Disabled" "One-shot action; nothing to revert"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
