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
    tweak   = "Clear DirectX Shader Cache"
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

  [pscustomobject]$result
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      $shaderCachePath = Join-Path $env:LOCALAPPDATA 'D3DSCache'
      $stats = Remove-PathContents -Path $shaderCachePath

      Out-Result "Enabled" "DirectX shader cache cleared. Removed entries: $($stats.Removed); skipped: $($stats.Skipped)"
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
