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
    tweak   = "Clear Font Cache"
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
      $serviceNames = @('FontCache', 'FontCache3.0.0.0')
      $servicesToRestart = @()

      foreach ($name in $serviceNames) {
        $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($null -ne $svc) {
          if ($svc.Status -ne 'Stopped') {
            Stop-Service -Name $name -Force -ErrorAction Stop
            $servicesToRestart += $name
          }
          else {
            $servicesToRestart += $name
          }
        }
      }

      Start-Sleep -Milliseconds 800

      $stats = @()
      $stats += Remove-PathContents -Path (Join-Path $env:WINDIR 'ServiceProfiles\LocalService\AppData\Local\FontCache')

      $fntCacheDat = Join-Path $env:WINDIR 'System32\FNTCACHE.DAT'
      if (Test-Path -LiteralPath $fntCacheDat) {
        try {
          Remove-Item -LiteralPath $fntCacheDat -Force -ErrorAction Stop
          $stats += [pscustomobject]@{ Removed = 1; Skipped = 0 }
        }
        catch {
          $stats += [pscustomobject]@{ Removed = 0; Skipped = 1 }
        }
      }
      else {
        $stats += [pscustomobject]@{ Removed = 0; Skipped = 0 }
      }

      foreach ($name in $servicesToRestart | Select-Object -Unique) {
        Start-Service -Name $name -ErrorAction SilentlyContinue
      }

      $totalRemoved = ($stats | Measure-Object -Property Removed -Sum).Sum
      $totalSkipped = ($stats | Measure-Object -Property Skipped -Sum).Sum

      if ($null -eq $totalRemoved) { $totalRemoved = 0 }
      if ($null -eq $totalSkipped) { $totalSkipped = 0 }

      Out-Result "Enabled" "Font cache cleared. Removed entries: $totalRemoved; skipped: $totalSkipped"
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
