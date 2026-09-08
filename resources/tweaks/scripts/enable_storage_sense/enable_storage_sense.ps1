[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Enable Storage Sense'
$StoragePolicyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy'
$StoragePolicyValueName = '01'
$MachinePolicyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\StorageSense'
$MachinePolicyValueName = 'AllowStorageSenseGlobal'

function Out-Result([string]$Status, [string]$Message = '', [hashtable]$Details = @{}) {
  $payload = @{
    tweak = $TweakName
    status = $Status
    message = $Message
    details = $Details
  }

  $payload | ConvertTo-Json -Compress -Depth 6
}

function Ensure-StoragePolicyKey {
  if (-not (Test-Path -Path $StoragePolicyPath)) {
    New-Item -Path $StoragePolicyPath -Force | Out-Null
  }
}

function Get-OptionalRegistryValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -Path $Path)) {
    return $null
  }

  try {
    return Get-ItemPropertyValue -Path $Path -Name $Name -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-StorageSenseState {
  $policyValue = Get-OptionalRegistryValue -Path $MachinePolicyPath -Name $MachinePolicyValueName
  $userValue = Get-OptionalRegistryValue -Path $StoragePolicyPath -Name $StoragePolicyValueName

  $effectiveSource = 'User'
  [int]$effectiveValue = 0

  if ($null -ne $policyValue) {
    $policyInt = [int]$policyValue
    if ($policyInt -eq 0 -or $policyInt -eq 1) {
      $effectiveSource = 'Policy'
      $effectiveValue = $policyInt
    }
  }

  if ($effectiveSource -eq 'User') {
    if ($null -ne $userValue) {
      $effectiveValue = [int]$userValue
    } else {
      $effectiveValue = 0
    }
  }

  return @{
    Enabled = ($effectiveValue -eq 1)
    EffectiveValue = $effectiveValue
    EffectiveSource = $effectiveSource
    UserValue = if ($null -ne $userValue) { [int]$userValue } else { $null }
    PolicyValue = if ($null -ne $policyValue) { [int]$policyValue } else { $null }
  }
}

function Set-StorageSenseUserValue([int]$Value) {
  Ensure-StoragePolicyKey
  New-ItemProperty -Path $StoragePolicyPath -Name $StoragePolicyValueName -PropertyType DWord -Value $Value -Force | Out-Null
}

try {
  switch ($State) {
    'Check' {
      $stateInfo = Get-StorageSenseState
      $checkStatus = 'Disabled'
      if ($stateInfo.Enabled) {
        $checkStatus = 'Enabled'
      }

      Out-Result $checkStatus '' @{
        enabled = $stateInfo.Enabled
        effective_source = $stateInfo.EffectiveSource
        effective_value = $stateInfo.EffectiveValue
        user_value = $stateInfo.UserValue
        policy_value = $stateInfo.PolicyValue
      }
      exit 0
    }

    'On' {
      Set-StorageSenseUserValue -Value 1
      $stateInfo = Get-StorageSenseState

      if (-not $stateInfo.Enabled) {
        if ($stateInfo.EffectiveSource -eq 'Policy' -and $stateInfo.PolicyValue -eq 0) {
          throw 'Storage Sense is disabled by machine policy and cannot be enabled by this tweak.'
        }
        throw 'Failed to enable Storage Sense.'
      }

      $message = if ($stateInfo.EffectiveSource -eq 'Policy') {
        'Storage Sense is enabled by machine policy.'
      } else {
        'Storage Sense enabled.'
      }

      Out-Result 'Enabled' $message @{
        enabled = $stateInfo.Enabled
        effective_source = $stateInfo.EffectiveSource
        effective_value = $stateInfo.EffectiveValue
        user_value = $stateInfo.UserValue
        policy_value = $stateInfo.PolicyValue
      }
      exit 0
    }

    'Off' {
      Set-StorageSenseUserValue -Value 0
      $stateInfo = Get-StorageSenseState

      if ($stateInfo.Enabled) {
        if ($stateInfo.EffectiveSource -eq 'Policy' -and $stateInfo.PolicyValue -eq 1) {
          throw 'Storage Sense is enabled by machine policy and cannot be disabled by this tweak.'
        }
        throw 'Failed to disable Storage Sense.'
      }

      Out-Result 'Disabled' 'Storage Sense disabled.' @{
        enabled = $stateInfo.Enabled
        effective_source = $stateInfo.EffectiveSource
        effective_value = $stateInfo.EffectiveValue
        user_value = $stateInfo.UserValue
        policy_value = $stateInfo.PolicyValue
      }
      exit 0
    }
  }
} catch {
  Out-Result 'Error' $_.Exception.Message @{
    effective_source = ''
    effective_value = $null
  }
  exit 1
}
