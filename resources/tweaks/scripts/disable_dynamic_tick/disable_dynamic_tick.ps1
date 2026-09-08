[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Dynamic Tick"; status = $status; message = $message } | ConvertTo-Json -Compress
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

      if ($bcd -match '(?im)^\s*disabledynamictick\s+Yes\s*$') {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      & bcdedit /set disabledynamictick yes | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to enable 'disabledynamictick'. Administrator privileges may be required."
      }

      Out-Result "Enabled"
    }

    'Off' {
      & bcdedit /deletevalue disabledynamictick 2>$null | Out-Null

      if ($LASTEXITCODE -ne 0) {
        & bcdedit /set disabledynamictick no | Out-Null
        if ($LASTEXITCODE -ne 0) {
          throw "Failed to disable 'disabledynamictick'. Administrator privileges may be required."
        }
      }

      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
