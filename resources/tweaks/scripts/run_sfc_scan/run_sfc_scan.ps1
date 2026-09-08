[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "", [hashtable]$details = $null) {
  $payload = @{
    tweak   = "Run SFC Scan"
    status  = $status
    message = $message
  }

  if ($details) {
    $payload.details = $details
  }

  $payload | ConvertTo-Json -Compress -Depth 8
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      $sfcPath = Join-Path $env:WINDIR 'System32\sfc.exe'
      if (-not (Test-Path -LiteralPath $sfcPath)) {
        throw "SFC executable not found"
      }

      $rawOutput = & $sfcPath '/scannow' 2>&1
      $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
      $outputLines = @(
        $rawOutput |
          ForEach-Object { ("$_" -replace "`0", "").TrimEnd() } |
          Where-Object { $_ -and $_.Trim() }
      )
      $summaryLine = $outputLines | Where-Object {
        $_ -match '(?i)did not find|found corrupt files|successfully repaired|verification'
      } | Select-Object -Last 1
      $summary = if ($summaryLine) {
        $summaryLine
      } else {
        "SFC scan completed"
      }
      $details = @{
        command = "SFC /scannow"
        exitCode = $exitCode
        output = ($outputLines -join [Environment]::NewLine)
        outputLines = $outputLines
      }

      if ($exitCode -ne 0) {
        $adminRequired = $outputLines | Where-Object { $_ -match '(?i)must be an administrator' } | Select-Object -First 1
        $errorMessage = if ($adminRequired) {
          "Administrator rights are required to run SFC scan"
        } else {
          "SFC exited with code $exitCode"
        }

        Out-Result "Error" $errorMessage $details
        exit 1
      }

      Out-Result "Enabled" $summary $details
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
