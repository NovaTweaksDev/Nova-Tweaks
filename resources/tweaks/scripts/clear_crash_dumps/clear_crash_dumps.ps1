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
    tweak   = "Clear Crash Dumps"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

function Remove-MatchingFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Filter
  )

  $result = [ordered]@{
    Removed = 0
    Skipped = 0
  }

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]$result
  }

  $files = Get-ChildItem -LiteralPath $Path -Filter $Filter -Force -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    try {
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
      $result.Removed++
    }
    catch {
      $result.Skipped++
    }
  }

  return [pscustomobject]$result
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      $stats = @()

      $memoryDumpPath = Join-Path $env:WINDIR 'MEMORY.DMP'
      if (Test-Path -LiteralPath $memoryDumpPath) {
        try {
          Remove-Item -LiteralPath $memoryDumpPath -Force -ErrorAction Stop
          $stats += [pscustomobject]@{ Removed = 1; Skipped = 0 }
        }
        catch {
          $stats += [pscustomobject]@{ Removed = 0; Skipped = 1 }
        }
      }
      else {
        $stats += [pscustomobject]@{ Removed = 0; Skipped = 0 }
      }

      $stats += Remove-MatchingFiles -Path (Join-Path $env:WINDIR 'Minidump') -Filter '*.dmp'

      $totalRemoved = ($stats | Measure-Object -Property Removed -Sum).Sum
      $totalSkipped = ($stats | Measure-Object -Property Skipped -Sum).Sum

      if ($null -eq $totalRemoved) { $totalRemoved = 0 }
      if ($null -eq $totalSkipped) { $totalSkipped = 0 }

      Out-Result "Enabled" "Crash dumps cleared. Removed files: $totalRemoved; skipped: $totalSkipped"
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
