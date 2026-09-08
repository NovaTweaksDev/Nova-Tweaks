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
    tweak   = "Clear Windows Error Reporting Files"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

function Remove-PathContents {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $result = [ordered]@{
    Removed = 0
    Skipped = 0
  }

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]$result
  }

  $items = Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    try {
      Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
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
      $paths = @(
        (Join-Path $env:ProgramData  'Microsoft\Windows\WER\ReportArchive'),
        (Join-Path $env:ProgramData  'Microsoft\Windows\WER\ReportQueue'),
        (Join-Path $env:ProgramData  'Microsoft\Windows\WER\ReportCache'),
        (Join-Path $env:ProgramData  'Microsoft\Windows\WER\Temp'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\WER\ReportArchive'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\WER\ReportQueue'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\WER\ReportCache'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\WER\Temp')
      ) | Select-Object -Unique

      $stats = foreach ($path in $paths) {
        Remove-PathContents -Path $path
      }

      $totalRemoved = ($stats | Measure-Object -Property Removed -Sum).Sum
      $totalSkipped = ($stats | Measure-Object -Property Skipped -Sum).Sum

      if ($null -eq $totalRemoved) { $totalRemoved = 0 }
      if ($null -eq $totalSkipped) { $totalSkipped = 0 }

      Out-Result "Enabled" "Windows Error Reporting files cleared. Removed entries: $totalRemoved; skipped: $totalSkipped"
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
