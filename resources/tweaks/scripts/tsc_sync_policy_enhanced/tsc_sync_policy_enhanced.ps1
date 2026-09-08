[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "TSC Sync Policy (Enhanced)"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-BcdOutput {
  $output = & bcdedit /enum '{current}' 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to query boot configuration. Administrator privileges may be required."
  }
  return ($output | Out-String)
}

try {
  switch ($State) {

    'Check' {
      $bcd = Get-BcdOutput

      if ($bcd -match '(?im)^\s*tscsyncpolicy\s+Enhanced\s*$') {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      & bcdedit /set '{current}' tscsyncpolicy Enhanced | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to set 'tscsyncpolicy' to Enhanced. Administrator privileges may be required."
      }

      Out-Result "Enabled" "Reboot required"
    }

    'Off' {
      & bcdedit /deletevalue '{current}' tscsyncpolicy 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to remove 'tscsyncpolicy'. Administrator privileges may be required."
      }

      Out-Result "Disabled" "Reboot required"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
