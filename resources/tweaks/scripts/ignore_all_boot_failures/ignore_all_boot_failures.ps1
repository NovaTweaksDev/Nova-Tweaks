[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Ignore All Boot Failures"; status = $status; message = $message } | ConvertTo-Json -Compress
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

      if ($bcd -match '(?im)^\s*bootstatuspolicy\s+IgnoreAllFailures\s*$') {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      & bcdedit /set '{current}' bootstatuspolicy IgnoreAllFailures | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to set boot status policy to IgnoreAllFailures. Administrator privileges may be required."
      }

      Out-Result "Enabled" "Reboot required"
    }

    'Off' {
      & bcdedit /deletevalue '{current}' bootstatuspolicy 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to remove boot status policy override. Administrator privileges may be required."
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
