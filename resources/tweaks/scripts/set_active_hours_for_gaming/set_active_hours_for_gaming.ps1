[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [string]$Selection = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Set Active Hours for Gaming'
$DefaultSelection = 'Windows Managed (Default)'
$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'

$ActiveHoursPresets = @{
  'Windows Managed (Default)' = @{ Start = $null; End = $null }
  'Daytime Gaming (12:00 - 00:00)' = @{ Start = 12; End = 0 }
  'Evening Gaming (16:00 - 02:00)' = @{ Start = 16; End = 2 }
  'Night Gaming (18:00 - 04:00)' = @{ Start = 18; End = 4 }
  'Streaming / Workday (10:00 - 22:00)' = @{ Start = 10; End = 22 }
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

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegistryValue([string]$Name) {
  if (-not (Test-Path $RegistryPath)) {
    return $null
  }

  try {
    return (Get-ItemProperty -Path $RegistryPath -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-RegistryDword([string]$Name, [int]$Value) {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $RegistryPath -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
}

function Remove-RegistryValue([string]$Name) {
  if (-not (Test-Path $RegistryPath)) {
    return
  }

  try {
    Remove-ItemProperty -Path $RegistryPath -Name $Name -ErrorAction Stop
  }
  catch {
    # Value is already absent.
  }
}

function Resolve-RequestedSelection([string]$RequestedSelection) {
  $normalized = [string]$RequestedSelection
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required.'
  }

  $normalized = $normalized.Trim()
  if (-not $ActiveHoursPresets.ContainsKey($normalized)) {
    throw "Unsupported active hours selection: $normalized"
  }

  return $normalized
}

function Get-DetectedSelection {
  $setActiveHours = Get-RegistryValue 'SetActiveHours'
  $start = Get-RegistryValue 'ActiveHoursStart'
  $end = Get-RegistryValue 'ActiveHoursEnd'

  if (($null -eq $setActiveHours) -and ($null -eq $start) -and ($null -eq $end)) {
    return $DefaultSelection
  }

  if (($setActiveHours -ne 1) -or ($null -eq $start) -or ($null -eq $end)) {
    return ''
  }

  foreach ($presetName in $ActiveHoursPresets.Keys) {
    if ($presetName -eq $DefaultSelection) {
      continue
    }

    $preset = $ActiveHoursPresets[$presetName]
    if (([int]$start -eq [int]$preset.Start) -and ([int]$end -eq [int]$preset.End)) {
      return $presetName
    }
  }

  return "Custom ($([int]$start):00 - $([int]$end):00)"
}

function Apply-Selection([string]$SelectedPreset) {
  if ($SelectedPreset -eq $DefaultSelection) {
    Remove-RegistryValue 'SetActiveHours'
    Remove-RegistryValue 'ActiveHoursStart'
    Remove-RegistryValue 'ActiveHoursEnd'
    return
  }

  $preset = $ActiveHoursPresets[$SelectedPreset]
  Set-RegistryDword 'SetActiveHours' 1
  Set-RegistryDword 'ActiveHoursStart' ([int]$preset.Start)
  Set-RegistryDword 'ActiveHoursEnd' ([int]$preset.End)
}

try {
  switch ($State) {
    'Check' {
      $detectedSelection = Get-DetectedSelection
      if ($detectedSelection -eq $DefaultSelection) {
        Out-Result 'Disabled' 'Windows active hours are managed by Windows default behavior.' $detectedSelection
      }
      elseif ($detectedSelection) {
        Out-Result 'Enabled' '' $detectedSelection
      }
      else {
        Out-Result 'Disabled' 'Windows active hours are not fully configured by policy.'
      }
    }

    'On' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to configure Windows Update active hours.'
      }

      $resolvedSelection = Resolve-RequestedSelection $Selection
      Apply-Selection $resolvedSelection

      if ($resolvedSelection -eq $DefaultSelection) {
        Out-Result 'Disabled' 'Windows active hours have been restored to Windows managed defaults.' $resolvedSelection
        exit 0
      }

      $detectedSelection = Get-DetectedSelection
      if ($detectedSelection -eq $resolvedSelection) {
        Out-Result 'Enabled' '' $resolvedSelection
      }
      else {
        Out-Result 'Error' "Active hours were written, but verification detected '$detectedSelection'." $detectedSelection
        exit 1
      }
    }

    'Off' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required to restore Windows Update active hours.'
      }

      Apply-Selection $DefaultSelection
      Out-Result 'Disabled' 'Windows active hours have been restored to Windows managed defaults.' $DefaultSelection
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
