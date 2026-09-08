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
    tweak   = "Clear Temporary Files"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

function Remove-TempEntries {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $result = [ordered]@{
    Path    = $Path
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
      $paths = @()

      if ($env:TEMP) {
        $paths += $env:TEMP
      }

      if ($env:WINDIR) {
        $paths += (Join-Path $env:WINDIR 'Temp')
      }

      $paths = $paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

      $stats = foreach ($path in $paths) {
        Remove-TempEntries -Path $path
      }

      $totalRemoved = ($stats | Measure-Object -Property Removed -Sum).Sum
      $totalSkipped = ($stats | Measure-Object -Property Skipped -Sum).Sum

      if ($null -eq $totalRemoved) { $totalRemoved = 0 }
      if ($null -eq $totalSkipped) { $totalSkipped = 0 }

      Out-Result "Enabled" "Temporary files cleared. Removed entries: $totalRemoved; skipped: $totalSkipped"
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
