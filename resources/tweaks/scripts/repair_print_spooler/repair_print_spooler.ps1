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
    tweak   = "Repair Print Spooler"
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
      $service = Get-Service -Name 'Spooler' -ErrorAction Stop

      Set-Service -Name 'Spooler' -StartupType Automatic -ErrorAction Stop

      if ($service.Status -eq 'Running') {
        Restart-Service -Name 'Spooler' -Force -ErrorAction Stop
      }
      else {
        Start-Service -Name 'Spooler' -ErrorAction Stop
      }

      Out-Result "Enabled" "Print Spooler repaired and restarted"
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
