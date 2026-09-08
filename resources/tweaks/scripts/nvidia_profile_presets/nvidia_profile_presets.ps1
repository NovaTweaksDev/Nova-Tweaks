[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [string]$Selection = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'NVIDIA Profile Presets'
$ExpectedHelperSha256 = '92C9499657A1C27F8BDB00E71A29A023554851AE36F9C46A51FD4800AAF8D6AA'

function Out-Result([string]$Status, [string]$Message = '', [hashtable]$Details = @{}) {
  $payload = @{
    tweak = $TweakName
    status = $Status
    message = $Message
    details = $Details
  }

  $payload | ConvertTo-Json -Compress
}

function Resolve-HelperPath {
  $candidateList = New-Object 'System.Collections.Generic.List[string]'

  function Add-HelperCandidate([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
      return
    }

    try {
      $resolved = [System.IO.Path]::GetFullPath($PathValue)
      if (-not $candidateList.Contains($resolved)) {
        [void]$candidateList.Add($resolved)
      }
    }
    catch {
      # Ignore malformed optional paths and continue with the remaining candidates.
    }
  }

  foreach ($root in @(
    $env:NOVA_TWEAKS_RESOURCES_PATH,
    $env:NOVA_TWEAKS_APP_PATH,
    $env:NOVA_TWEAKS_BACKEND_ROOT
  )) {
    if ([string]::IsNullOrWhiteSpace($root)) {
      continue
    }

    Add-HelperCandidate (Join-Path $root 'tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe')
    Add-HelperCandidate (Join-Path $root 'resources\tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe')
  }

  foreach ($root in @(
    (Join-Path $PSScriptRoot '..\..'),
    (Join-Path $PSScriptRoot '..\..\..')
  )) {
    Add-HelperCandidate (Join-Path $root 'tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe')
    Add-HelperCandidate (Join-Path $root 'resources\tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe')
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    foreach ($appDir in @('Nova Tweaks', 'nova-tweaks')) {
      Add-HelperCandidate (Join-Path $env:LOCALAPPDATA "Programs\$appDir\resources\tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe")
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    Add-HelperCandidate (Join-Path $env:ProgramFiles 'Nova Tweaks\resources\tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe')
  }

  $candidates = $candidateList.ToArray()

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $actualSha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToUpperInvariant()
      if ($actualSha256 -eq $ExpectedHelperSha256) {
        return $candidate
      }
    }
  }

  throw 'A trusted nvidia-profile-helper.exe was not found.'
}

function Resolve-PresetFromSelection([string]$Value) {
  $normalized = [string]$Value
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required (Competitive, Balanced, Quality, Restore Defaults).'
  }

  $normalized = $normalized.Trim().ToLowerInvariant()
  switch ($normalized) {
    'competitive' { return 'competitive' }
    'balanced' { return 'balanced' }
    'quality' { return 'quality' }
    'restore defaults' { return 'restore-defaults' }
    'restore-defaults' { return 'restore-defaults' }
    'defaults' { return 'restore-defaults' }
    default {
      throw "Unsupported selection: $Value"
    }
  }
}

function Invoke-Helper([string]$HelperPath, [string[]]$Arguments) {
  $output = & $HelperPath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $lines = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
  $primaryLine = if ($lines.Count -gt 0) { $lines[0] } else { '' }
  $warnings = @(
    $lines |
      Where-Object { $_ -like 'WARN:*' } |
      ForEach-Object {
        if ($_.Length -gt 5) {
          $_.Substring(5).Trim()
        }
      } |
      Where-Object { $_ }
  )

  return @{
    exitCode = $exitCode
    lines = $lines
    primaryLine = $primaryLine
    warnings = $warnings
  }
}

try {
  switch ($State) {
    'Check' {
      Out-Result 'Disabled' '' @{
        selectedOption = ''
      }
    }

    'On' {
      $helperPath = Resolve-HelperPath
      $preset = Resolve-PresetFromSelection $Selection
      $args = if ($preset -eq 'restore-defaults') {
        @('restore-defaults')
      } else {
        @('apply', '--preset', $preset)
      }

      $invokeResult = Invoke-Helper -HelperPath $helperPath -Arguments $args
      if ($invokeResult.exitCode -ne 0) {
        $message = if ($invokeResult.primaryLine) {
          $invokeResult.primaryLine
        } else {
          "helper failed with exit code $($invokeResult.exitCode)"
        }
        throw "nvidia-profile-helper failed (exit $($invokeResult.exitCode)): $message"
      }

      $selectedOption = switch ($preset) {
        'competitive' { 'Competitive'; break }
        'balanced' { 'Balanced'; break }
        'quality' { 'Quality'; break }
        default { 'Restore Defaults' }
      }

      $details = @{
        selectedOption = $selectedOption
      }
      if ($preset -eq 'restore-defaults') {
        $details.restoreScope = 'globalAllDefaults'
      }
      if ($preset -ne 'restore-defaults' -and $invokeResult.warnings.Count -gt 0) {
        $details.warningCount = $invokeResult.warnings.Count
        $details.warnings = $invokeResult.warnings
      }

      Out-Result 'Enabled' '' $details
    }

    'Off' {
      $helperPath = Resolve-HelperPath
      $invokeResult = Invoke-Helper -HelperPath $helperPath -Arguments @('restore-defaults')
      if ($invokeResult.exitCode -ne 0) {
        $message = if ($invokeResult.primaryLine) {
          $invokeResult.primaryLine
        } else {
          "helper failed with exit code $($invokeResult.exitCode)"
        }
        throw "nvidia-profile-helper failed (exit $($invokeResult.exitCode)): $message"
      }

      Out-Result 'Disabled' '' @{
        selectedOption = 'Restore Defaults'
        restoreScope = 'globalAllDefaults'
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
