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
    tweak   = "Rebuild Thumbnails Cache"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

function Remove-MatchingFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Pattern
  )

  $result = [ordered]@{
    Removed = 0
    Skipped = 0
  }

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]$result
  }

  $files = Get-ChildItem -LiteralPath $Path -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like $Pattern }

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
      $explorerPath = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'
      $explorerWasRunning = $false

      $explorerProcess = Get-Process -Name explorer -ErrorAction SilentlyContinue
      if ($null -ne $explorerProcess) {
        $explorerWasRunning = $true
        Stop-Process -Name explorer -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 800
      }

      try {
        $stats = Remove-MatchingFiles -Path $explorerPath -Pattern 'thumbcache*'
      }
      finally {
        if ($explorerWasRunning) {
          Start-Process explorer.exe
        }
      }

      Out-Result "Enabled" "Thumbnails cache rebuilt. Removed files: $($stats.Removed); skipped: $($stats.Skipped)"
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
