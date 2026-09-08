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
    tweak   = "Rebuild Search Index"
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
      $service = Get-Service -Name 'WSearch' -ErrorAction Stop
      Set-Service -Name 'WSearch' -StartupType Automatic -ErrorAction SilentlyContinue

      if ($service.Status -ne 'Stopped') {
        Stop-Service -Name 'WSearch' -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 800
      }

      $indexPath = Join-Path $env:ProgramData 'Microsoft\Search\Data\Applications\Windows'
      $stats = Remove-PathContents -Path $indexPath

      Start-Service -Name 'WSearch' -ErrorAction Stop

      Out-Result "Enabled" "Search index rebuild started. Removed entries: $($stats.Removed); skipped: $($stats.Skipped)"
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
