[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',

  [string]$Selection = '',

  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Set Gaming Network Responsiveness'

$RegistryPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile'
$ValueName = 'SystemResponsiveness'

$DefaultSelection = 'Windows Default'

$ResponsivenessPresets = @{
  'Gaming / Low Latency' = 0
  'Windows Default' = 20
  'Background Friendly' = 40
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

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CurrentValue {
  if (-not (Test-Path $RegistryPath)) {
    return $null
  }

  try {
    return (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop).$ValueName
  }
  catch {
    return $null
  }
}

function Resolve-SelectionFromValue([object]$CurrentValue) {
  if ($null -eq $CurrentValue) {
    return $DefaultSelection
  }

  foreach ($presetName in $ResponsivenessPresets.Keys) {
    if ([int]$ResponsivenessPresets[$presetName] -eq [int]$CurrentValue) {
      return $presetName
    }
  }

  return ''
}

function Resolve-RequestedSelection([string]$RequestedSelection) {
  $normalized = [string]$RequestedSelection

  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Selection parameter is required.'
  }

  $normalized = $normalized.Trim()

  if (-not $ResponsivenessPresets.ContainsKey($normalized)) {
    throw "Unsupported responsiveness selection: $normalized"
  }

  return $normalized
}

function Set-RegistryValue([int]$Value) {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty `
    -Path $RegistryPath `
    -Name $ValueName `
    -Value $Value `
    -PropertyType DWord `
    -Force | Out-Null
}

try {
  switch ($State) {

    'Check' {
      $currentValue = Get-CurrentValue
      $detectedSelection = Resolve-SelectionFromValue $currentValue

      if ($detectedSelection) {
        if ($detectedSelection -eq $DefaultSelection) {
          Out-Result 'Disabled' 'Windows default network responsiveness profile is active.' $detectedSelection
        }
        else {
          Out-Result 'Enabled' 'A custom network responsiveness profile is active.' $detectedSelection
        }
      }
      else {
        Out-Result 'Disabled' 'Unknown or custom SystemResponsiveness value detected.'
      }
    }

    'On' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required.'
      }

      $resolvedSelection = Resolve-RequestedSelection $Selection
      $targetValue = [int]$ResponsivenessPresets[$resolvedSelection]

      Set-RegistryValue $targetValue

      Out-Result 'Enabled' "Network responsiveness profile has been set to $resolvedSelection. A reboot is recommended." $resolvedSelection
    }

    'Off' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required.'
      }

      $defaultValue = [int]$ResponsivenessPresets[$DefaultSelection]

      Set-RegistryValue $defaultValue

      Out-Result 'Disabled' 'Network responsiveness profile has been restored to the Windows default configuration. A reboot is recommended.' $DefaultSelection
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
