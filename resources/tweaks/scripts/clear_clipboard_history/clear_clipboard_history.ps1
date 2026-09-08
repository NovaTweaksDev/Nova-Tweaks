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
    tweak   = "Clear Clipboard History"
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
      Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
      $null = [Windows.ApplicationModel.DataTransfer.Clipboard, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime]

      $historyCleared = [Windows.ApplicationModel.DataTransfer.Clipboard]::ClearHistory()
      if (-not $historyCleared) {
        throw "Clipboard history could not be cleared"
      }

      try {
        cmd.exe /c "echo off | clip" | Out-Null
      }
      catch {
      }

      Out-Result "Enabled" "Clipboard history cleared"
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
