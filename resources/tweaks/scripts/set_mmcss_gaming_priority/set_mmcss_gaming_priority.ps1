[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',

  [string]$Selection = '',

  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Set MMCSS Gaming Priority'
$RegPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games'

$DefaultSelection = 'Windows Default'

$Profiles = @{
  'Windows Default' = @{
    'GPU Priority'        = @{ Type = 'DWord'; Value = 8 }
    'Priority'            = @{ Type = 'DWord'; Value = 6 }
    'Scheduling Category' = @{ Type = 'String'; Value = 'High' }
    'SFIO Priority'       = @{ Type = 'String'; Value = 'Normal' }
  }

  'Balanced Gaming' = @{
    'GPU Priority'        = @{ Type = 'DWord'; Value = 8 }
    'Priority'            = @{ Type = 'DWord'; Value = 6 }
    'Scheduling Category' = @{ Type = 'String'; Value = 'High' }
    'SFIO Priority'       = @{ Type = 'String'; Value = 'High' }
  }

  'Aggressive Gaming' = @{
    'GPU Priority'        = @{ Type = 'DWord'; Value = 8 }
    'Priority'            = @{ Type = 'DWord'; Value = 8 }
    'Scheduling Category' = @{ Type = 'String'; Value = 'High' }
    'SFIO Priority'       = @{ Type = 'String'; Value = 'High' }
  }
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
    }
  }

  $result | ConvertTo-Json -Compress
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-RegPath {
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }
}

function Resolve-RequestedSelection([string]$RequestedSelection) {
  $normalized = [string]$RequestedSelection

  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required.'
  }

  $normalized = $normalized.Trim()

  if (-not $Profiles.ContainsKey($normalized)) {
    throw "Unsupported MMCSS gaming priority selection: $normalized"
  }

  return $normalized
}

function Get-CurrentValues {
  $current = @{}

  if (-not (Test-Path $RegPath)) {
    return $current
  }

  $item = Get-ItemProperty -Path $RegPath -ErrorAction Stop

  foreach ($valueName in @('GPU Priority', 'Priority', 'Scheduling Category', 'SFIO Priority')) {
    $value = $null

    if ($item.PSObject.Properties.Name -contains $valueName) {
      $value = $item.$valueName
    }

    $current[$valueName] = $value
  }

  return $current
}

function Test-ProfileMatch([hashtable]$CurrentValues, [hashtable]$ProfileValues) {
  foreach ($valueName in $ProfileValues.Keys) {
    if (-not $CurrentValues.ContainsKey($valueName)) {
      return $false
    }

    $currentValue = $CurrentValues[$valueName]
    $expectedValue = $ProfileValues[$valueName].Value

    if ("$currentValue" -ne "$expectedValue") {
      return $false
    }
  }

  return $true
}

function Get-DetectedSelection {
  $current = Get-CurrentValues

  if ($current.Count -eq 0) {
    return ''
  }

  foreach ($profileName in $Profiles.Keys) {
    if (Test-ProfileMatch -CurrentValues $current -ProfileValues $Profiles[$profileName]) {
      return $profileName
    }
  }

  return ''
}

function Apply-Profile([string]$ProfileName) {
  Ensure-RegPath

  $profile = $Profiles[$ProfileName]

  foreach ($valueName in $profile.Keys) {
    $entry = $profile[$valueName]

    if ($entry.Type -eq 'DWord') {
      New-ItemProperty -Path $RegPath -Name $valueName -Value ([int]$entry.Value) -PropertyType DWord -Force | Out-Null
      continue
    }

    if ($entry.Type -eq 'String') {
      New-ItemProperty -Path $RegPath -Name $valueName -Value ([string]$entry.Value) -PropertyType String -Force | Out-Null
      continue
    }

    throw "Unsupported registry value type for '$valueName': $($entry.Type)"
  }
}

try {
  switch ($State) {
    'Check' {
      $detectedSelection = Get-DetectedSelection

      if ($detectedSelection) {
        Out-Result 'Enabled' '' $detectedSelection
      } else {
        Out-Result 'Disabled' 'MMCSS gaming priority profile does not match a known Nova Tweaks preset.'
      }
    }

    'On' {
      if (-not (Test-IsAdmin)) {
        throw 'Administrator privileges are required to apply this tweak.'
      }

      $resolvedSelection = Resolve-RequestedSelection $Selection
      Apply-Profile $resolvedSelection

      Out-Result 'Enabled' 'MMCSS gaming priority profile applied. A reboot is recommended.' $resolvedSelection
    }

    'Off' {
      if (-not (Test-IsAdmin)) {
        throw 'Administrator privileges are required to restore this tweak.'
      }

      Apply-Profile $DefaultSelection

      Out-Result 'Disabled' 'MMCSS gaming priority profile restored to Windows default. A reboot is recommended.' $DefaultSelection
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
