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
    tweak   = "Run DISM RestoreHealth"
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
      $dismPath = Join-Path $env:WINDIR 'System32\Dism.exe'
      if (-not (Test-Path -LiteralPath $dismPath)) {
        throw "DISM executable not found"
      }

      $rawOutput = & $dismPath '/Online' '/Cleanup-Image' '/RestoreHealth' 2>&1
      $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
      $outputLines = @(
        $rawOutput |
          ForEach-Object { ("$_" -replace "`0", "").TrimEnd() } |
          Where-Object { $_ -and $_.Trim() }
      )
      $summaryLine = $outputLines | Where-Object {
        $_ -match '(?i)component store|repairable|repaired|operation completed successfully'
      } | Select-Object -Last 1
      $summary = if ($summaryLine) {
        $summaryLine
      } else {
        "DISM RestoreHealth completed"
      }
      $details = @{
        command = "DISM /Online /Cleanup-Image /RestoreHealth"
        exitCode = $exitCode
        output = ($outputLines -join [Environment]::NewLine)
        outputLines = $outputLines
      }

      switch ($exitCode) {
        0 {
          Out-Result "Enabled" $summary $details
        }

        3010 {
          Out-Result "Enabled" "$summary (restart recommended)" $details
        }

        default {
          $adminRequired = $outputLines | Where-Object {
            $_ -match '(?i)elevated permissions|required|administrator'
          } | Select-Object -First 1
          $errorMessage = if ($adminRequired) {
            "Administrator rights are required to run DISM RestoreHealth"
          } else {
            "DISM exited with code $exitCode"
          }

          Out-Result "Error" $errorMessage $details
          exit 1
        }
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
