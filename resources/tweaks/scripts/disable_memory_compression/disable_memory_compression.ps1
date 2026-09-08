[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Memory Compression"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-MemoryCompressionEnabled {
  $mm = Get-MMAgent

  if ($null -eq $mm) {
    throw "Failed to query MMAgent configuration."
  }

  return [bool]$mm.MemoryCompression
}

try {
  switch ($State) {

    'Check' {
      $enabled = Get-MemoryCompressionEnabled

      if (-not $enabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Disable-MMAgent -MemoryCompression | Out-Null
      Out-Result "Enabled" "Reboot required"
    }

    'Off' {
      Enable-MMAgent -MemoryCompression | Out-Null
      Out-Result "Disabled" "Reboot required"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
