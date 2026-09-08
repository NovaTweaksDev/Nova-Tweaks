[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'NVIDIA Shader Cache'

function Out-Result([string]$Status, [string]$Message = '', [hashtable]$Details = @{}) {
  $payload = @{
    tweak = $TweakName
    status = $Status
    message = $Message
    details = $Details
  }

  $payload | ConvertTo-Json -Compress
}

function Get-ShaderCachePaths {
  $paths = @(
    (Join-Path $env:ProgramData 'NVIDIA Corporation\NV_Cache'),
    (Join-Path $env:LOCALAPPDATA 'NVIDIA\DXCache'),
    (Join-Path $env:LOCALAPPDATA 'NVIDIA\GLCache'),
    (Join-Path $env:LOCALAPPDATA 'NVIDIA\NV_Cache'),
    (Join-Path $env:LOCALAPPDATA 'NVIDIA\ComputeCache'),
    (Join-Path $env:LOCALAPPDATA 'NVIDIA Corporation\NV_Cache')
  )

  @(
    $paths |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      ForEach-Object { [System.IO.Path]::GetFullPath($_) } |
      Select-Object -Unique
  )
}

function Get-PathStats([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return @{
      fileCount = 0
      totalBytes = [int64]0
    }
  }

  $files = @(
    Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue
  )
  $sum = 0
  if ($files.Count -gt 0) {
    $measurement = $files | Measure-Object -Property Length -Sum
    if ($null -ne $measurement -and $null -ne $measurement.Sum) {
      $sum = $measurement.Sum
    }
  }

  return @{
    fileCount = $files.Count
    totalBytes = [int64]$sum
  }
}

function Remove-ChildWithRetry([string]$Path, [int]$Attempts = 5, [int]$DelayMs = 250) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      if (-not (Test-Path -LiteralPath $Path)) {
        return
      }

      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    }
    catch {
      if ($attempt -eq $Attempts) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMs
    }
  }
}

function Clear-ShaderCachePath([string]$Path) {
  $result = @{
    path = $Path
    existed = $false
    beforeFiles = 0
    beforeBytes = [int64]0
    afterFiles = 0
    afterBytes = [int64]0
    removedFiles = 0
    removedBytes = [int64]0
    failures = @()
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    return $result
  }

  $result.existed = $true
  $before = Get-PathStats -Path $Path
  $result.beforeFiles = $before.fileCount
  $result.beforeBytes = $before.totalBytes

  $children = @(
    Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  )

  foreach ($child in $children) {
    try {
      Remove-ChildWithRetry -Path $child.FullName
    }
    catch {
      $result.failures += "Could not delete '$($child.FullName)': $($_.Exception.Message)"
    }
  }

  $after = Get-PathStats -Path $Path
  $result.afterFiles = $after.fileCount
  $result.afterBytes = $after.totalBytes
  $result.removedFiles = [Math]::Max(0, $result.beforeFiles - $result.afterFiles)
  $result.removedBytes = [Math]::Max([int64]0, $result.beforeBytes - $result.afterBytes)

  if ($result.afterFiles -gt 0) {
    $result.failures += "Path '$Path' still contains $($result.afterFiles) file(s) after cleanup."
  }

  return $result
}

try {
  switch ($State) {
    'Check' {
      $paths = Get-ShaderCachePaths
      $existing = @($paths | Where-Object { Test-Path -LiteralPath $_ })

      Out-Result 'Disabled' '' @{
        configuredPaths = $paths.Count
        existingPaths = $existing.Count
      }
    }

    'On' {
      $paths = Get-ShaderCachePaths
      $results = @()

      foreach ($path in $paths) {
        $results += Clear-ShaderCachePath -Path $path
      }

      $totalRemovedFiles = 0
      $totalRemovedBytes = [int64]0
      $totalRemainingFiles = 0
      foreach ($entry in $results) {
        $totalRemovedFiles += [int]$entry.removedFiles
        $totalRemovedBytes += [int64]$entry.removedBytes
        $totalRemainingFiles += [int]$entry.afterFiles
      }

      $allFailures = @(
        $results |
          ForEach-Object { $_.failures } |
          Where-Object { $_ }
      )

      $details = @{
        removedFiles = [int]$totalRemovedFiles
        removedBytes = [int64]$totalRemovedBytes
        remainingFiles = [int]$totalRemainingFiles
        scannedPaths = $paths.Count
        touchedPaths = @($results | Where-Object { $_.existed }).Count
      }

      if ($allFailures.Count -gt 0) {
        $warningPreview = @($allFailures | Select-Object -First 8)
        $details.warningCount = $allFailures.Count
        $details.warnings = $warningPreview
        $details.hiddenWarningCount = [Math]::Max(0, $allFailures.Count - $warningPreview.Count)
        Out-Result 'Enabled' 'NVIDIA shader cache cleaned with warnings (some files were locked).' $details
      }
      else {
        Out-Result 'Enabled' 'NVIDIA shader cache cleaned.' $details
      }
    }

    'Off' {
      Out-Result 'Disabled' '' @{
        action = 'none'
      }
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message @{
    selectedOption = ''
  }
  exit 1
}
