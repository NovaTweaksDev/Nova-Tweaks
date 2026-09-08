[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [string]$Selection = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Set TCP Auto-Tuning Level'
$DefaultSelection = 'Normal'
$SelectionToNetsh = @{
  'Normal'     = 'normal'
  'Restricted' = 'restricted'
  'Disabled'   = 'disabled'
}
$NetshToSelection = @{
  'normal'       = 'Normal'
  'restricted'   = 'Restricted'
  'disabled'     = 'Disabled'
  'highlyrestricted' = 'Restricted'
  'experimental' = 'Normal'
}

function Out-Result([string]$Status, [string]$Message = '', [string]$SelectedOption = '') {
  $result = @{
    tweak = $TweakName
    status = $Status
    message = $Message
  }

  if ($SelectedOption) {
    $result.details = @{
      selectedOption = $SelectedOption
      selected_option = $SelectedOption
    }
  }

  $result | ConvertTo-Json -Compress
}

function Resolve-RequestedSelection([string]$RequestedSelection) {
  $normalized = [string]$RequestedSelection
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required.'
  }

  $normalized = $normalized.Trim()
  if (-not $SelectionToNetsh.ContainsKey($normalized)) {
    throw "Unsupported TCP auto-tuning selection: $normalized"
  }

  return $normalized
}

function Normalize-NetshValue([string]$Value) {
  return ([string]$Value).Trim().ToLowerInvariant() -replace '[^a-z]', ''
}

function Get-AutoTuningSelection {
  $output = & netsh int tcp show global 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "netsh int tcp show global failed with exit code $LASTEXITCODE. $($output -join ' ')"
  }

  $line = @($output | Where-Object {
    $_ -match 'Auto.*Tuning.*Level' -or
    $_ -match 'Auto.*Abstimm.*Empfang' -or
    $_ -match 'Autom.*Abstimm.*Empfang'
  } | Select-Object -First 1)

  if (@($line).Count -eq 0) {
    return ''
  }

  $parts = ([string]$line[0]) -split ':', 2
  if ($parts.Count -lt 2) {
    return ''
  }

  $value = Normalize-NetshValue $parts[1]
  if ($NetshToSelection.ContainsKey($value)) {
    return $NetshToSelection[$value]
  }

  return ''
}

function Set-AutoTuningSelection([string]$SelectedOption) {
  $netshValue = $SelectionToNetsh[$SelectedOption]
  $output = & netsh int tcp set global autotuninglevel=$netshValue 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "netsh int tcp set global autotuninglevel=$netshValue failed with exit code $LASTEXITCODE. $($output -join ' ')"
  }
}

try {
  switch ($State) {
    'Check' {
      $detectedSelection = Get-AutoTuningSelection
      if ($detectedSelection) {
        Out-Result 'Enabled' '' $detectedSelection
      } else {
        Out-Result 'Disabled' 'TCP auto-tuning level could not be detected.'
      }
    }

    'On' {
      $resolvedSelection = Resolve-RequestedSelection $Selection
      Set-AutoTuningSelection $resolvedSelection
      Out-Result 'Enabled' '' $resolvedSelection
    }

    'Off' {
      Set-AutoTuningSelection $DefaultSelection
      Out-Result 'Disabled' 'TCP auto-tuning level restored to normal.' $DefaultSelection
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
