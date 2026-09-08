[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [string]$Selection = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Limit Windows Update Download Bandwidth'
$DefaultSelection = 'Windows Managed Default'

$BandwidthPresets = @{
  'Windows Managed Default'       = @{ Percent = $null }
  'Light Limit 75 Percent'        = @{ Percent = 75 }
  'Balanced Limit 50 Percent'     = @{ Percent = 50 }
  'Gaming Balanced 25 Percent'    = @{ Percent = 25 }
  'Competitive Gaming 10 Percent' = @{ Percent = 10 }
}

$BandwidthAliases = @{
  'Windows Managed (Default)' = 'Windows Managed Default'
  'Light Limit (75%)' = 'Light Limit 75 Percent'
  'Balanced Limit (50%)' = 'Balanced Limit 50 Percent'
  'Gaming Balanced (25%)' = 'Gaming Balanced 25 Percent'
  'Competitive Gaming (10%)' = 'Competitive Gaming 10 Percent'
}

$deliveryOptimizationPolicyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization'
$backgroundPercentName = 'DOPercentageMaxBackgroundBandwidth'
$foregroundPercentName = 'DOPercentageMaxForegroundBandwidth'
$legacyBackgroundLimitName = 'DOMaxBackgroundDownloadBandwidth'
$legacyForegroundLimitName = 'DOMaxForegroundDownloadBandwidth'

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

# ================= Helpers =================

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Value([string]$Path, [string]$Name) {

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-DWord([string]$Path, [string]$Name, [int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -PropertyType DWord `
    -Force | Out-Null
}

function Remove-Value([string]$Path, [string]$Name) {

  if (Test-Path $Path) {
    try {
      Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
    }
    catch {}
  }
}

function Resolve-RequestedSelection([string]$RequestedSelection) {
  $normalized = [string]$RequestedSelection

  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required.'
  }

  $normalized = $normalized.Trim()
  if ($BandwidthAliases.ContainsKey($normalized)) {
    $normalized = $BandwidthAliases[$normalized]
  }

  if (-not $BandwidthPresets.ContainsKey($normalized)) {
    throw "Unsupported bandwidth selection: $normalized"
  }

  return $normalized
}

function Get-DetectedSelection {
  $backgroundLimit = Get-Value $deliveryOptimizationPolicyPath $backgroundPercentName
  $foregroundLimit = Get-Value $deliveryOptimizationPolicyPath $foregroundPercentName

  if (($null -eq $backgroundLimit) -and ($null -eq $foregroundLimit)) {
    $backgroundLimit = Get-Value $deliveryOptimizationPolicyPath $legacyBackgroundLimitName
    $foregroundLimit = Get-Value $deliveryOptimizationPolicyPath $legacyForegroundLimitName
  }

  if (($null -eq $backgroundLimit) -and ($null -eq $foregroundLimit)) {
    return $DefaultSelection
  }

  foreach ($presetName in $BandwidthPresets.Keys) {
    if ($presetName -eq $DefaultSelection) {
      continue
    }

    $percent = [int]$BandwidthPresets[$presetName].Percent

    if (($backgroundLimit -eq $percent) -and ($foregroundLimit -eq $percent)) {
      return $presetName
    }
  }

  if (($null -ne $backgroundLimit) -or ($null -ne $foregroundLimit)) {
    return "Custom (Background: $backgroundLimit%, Foreground: $foregroundLimit%)"
  }

  return ''
}

function Apply-BandwidthSelection([string]$SelectedPreset) {
  if ($SelectedPreset -eq $DefaultSelection) {
    Remove-Value $deliveryOptimizationPolicyPath $backgroundPercentName
    Remove-Value $deliveryOptimizationPolicyPath $foregroundPercentName
    Remove-Value $deliveryOptimizationPolicyPath $legacyBackgroundLimitName
    Remove-Value $deliveryOptimizationPolicyPath $legacyForegroundLimitName
    return
  }

  $percent = [int]$BandwidthPresets[$SelectedPreset].Percent

  if ($percent -lt 1 -or $percent -gt 100) {
    throw "Invalid bandwidth percentage for preset '$SelectedPreset'. Value must be between 1 and 100."
  }

  Set-DWord $deliveryOptimizationPolicyPath $backgroundPercentName $percent
  Set-DWord $deliveryOptimizationPolicyPath $foregroundPercentName $percent
  Remove-Value $deliveryOptimizationPolicyPath $legacyBackgroundLimitName
  Remove-Value $deliveryOptimizationPolicyPath $legacyForegroundLimitName
}

function Test-SelectionApplied([string]$SelectedPreset) {
  $detected = Get-DetectedSelection
  return ($detected -eq $SelectedPreset)
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $detectedSelection = Get-DetectedSelection

      if ($detectedSelection -eq $DefaultSelection) {
        Out-Result 'Disabled' 'Windows Update download bandwidth is managed by Windows default behavior.' $detectedSelection
      }
      elseif ($detectedSelection -like 'Custom*') {
        Out-Result 'Enabled' 'Custom Windows Update bandwidth limits are configured.' $detectedSelection
      }
      else {
        Out-Result 'Enabled' '' $detectedSelection
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to limit Windows Update download bandwidth.'
      }

      $resolvedSelection = Resolve-RequestedSelection $Selection

      Apply-BandwidthSelection $resolvedSelection

      if ($resolvedSelection -eq $DefaultSelection) {
        Out-Result 'Disabled' 'Windows Update bandwidth limits have been restored to Windows managed defaults.' $resolvedSelection
        exit 0
      }

      if (Test-SelectionApplied $resolvedSelection) {
        Out-Result 'Enabled' '' $resolvedSelection
      }
      else {
        $detectedSelection = Get-DetectedSelection
        Out-Result 'Error' "Bandwidth limits were written, but verification failed. Detected selection: $detectedSelection" $detectedSelection
        exit 1
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to restore Windows Update bandwidth defaults.'
      }

      Apply-BandwidthSelection $DefaultSelection

      $detectedSelection = Get-DetectedSelection

      if ($detectedSelection -eq $DefaultSelection) {
        Out-Result 'Disabled' 'Windows Update bandwidth limits have been restored to Windows managed defaults.' $DefaultSelection
      }
      else {
        Out-Result 'Enabled' "Bandwidth limits still appear to be configured. A system, domain, or MDM policy may be enforcing this setting." $detectedSelection
      }
    }

  }

  exit 0
}
catch {

  Out-Result 'Error' $_.Exception.Message
  exit 1
}
