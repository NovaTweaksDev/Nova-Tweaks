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
    tweak   = "Clear Delivery Optimization Cache"
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
      if (-not (Get-Command -Name Delete-DeliveryOptimizationCache -ErrorAction SilentlyContinue)) {
        throw "Delete-DeliveryOptimizationCache cmdlet is not available on this system"
      }

      Delete-DeliveryOptimizationCache -Force -IncludePinnedFiles -ErrorAction Stop
      Out-Result "Enabled" "Delivery Optimization cache cleared"
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
