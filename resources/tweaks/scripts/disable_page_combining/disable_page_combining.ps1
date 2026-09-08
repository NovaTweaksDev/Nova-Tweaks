[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Page Combining"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-PageCombiningEnabled {
  $mm = Get-MMAgent

  if ($null -eq $mm) {
    throw "Failed to query MMAgent configuration."
  }

  return [bool]$mm.PageCombining
}

function Set-PageCombining([string]$Mode) {
  if ($Mode -eq "Disable") {
    Disable-MMAgent -PageCombining | Out-Null
  }
  else {
    Enable-MMAgent -PageCombining | Out-Null
  }
}

try {
  switch ($State) {

    'Check' {
      $enabled = Get-PageCombiningEnabled

      if (-not $enabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-PageCombining "Disable"
      Out-Result "Enabled"
    }

    'Off' {
      Set-PageCombining "Enable"
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
