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
    tweak   = "Clear Windows Update Cache"
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

  $items = Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop
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
      $serviceNames = @('wuauserv', 'bits')
      $servicesToRestart = @()
      $failures = @()

      try {
        foreach ($name in $serviceNames) {
          $svc = Get-Service -Name $name -ErrorAction Stop
          if ($svc.Status -eq 'Running') {
            $servicesToRestart = @($name) + $servicesToRestart
            Stop-Service -Name $name -ErrorAction Stop
          }
        }

        $downloadPath = Join-Path $env:WINDIR 'SoftwareDistribution\Download'
        $stats = Remove-PathContents -Path $downloadPath
      }
      catch {
        $failures += $_.Exception.Message
      }
      finally {
        foreach ($name in $servicesToRestart) {
          try {
            Start-Service -Name $name -ErrorAction Stop
          }
          catch {
            $failures += "Could not restart ${name}: $($_.Exception.Message)"
          }
        }
      }

      if ($failures.Count -gt 0) {
        throw ($failures -join ' ')
      }

      Out-Result "Enabled" "Windows Update cache cleared. Removed entries: $($stats.Removed); skipped: $($stats.Skipped)"
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
