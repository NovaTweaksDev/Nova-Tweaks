param(
  [ValidateSet('On','Off','Check')]
  [string]$State = 'Check',
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'

$RegistryPath = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
$ValueName = 'DirectXUserGlobalSettings'
$SettingName = 'SwapEffectUpgradeEnable'

function Get-CurrentSettingsValue {
  if (-not (Test-Path -LiteralPath $RegistryPath)) {
    return $null
  }

  try {
    $Property = Get-ItemProperty -LiteralPath $RegistryPath -Name $ValueName -ErrorAction Stop
    return [string]$Property.$ValueName
  }
  catch [System.Management.Automation.PSArgumentException] {
    return $null
  }
  catch [System.Management.Automation.ItemNotFoundException] {
    return $null
  }
}

function Set-WindowedOptimizationState {
  param(
    [ValidateSet(0,1)]
    [int]$Value
  )

  if (-not (Test-Path -LiteralPath $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  $CurrentValue = Get-CurrentSettingsValue
  $Entries = New-Object System.Collections.Generic.List[string]

  if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {
    foreach ($Entry in ($CurrentValue -split ';')) {
      $TrimmedEntry = $Entry.Trim()

      if ([string]::IsNullOrWhiteSpace($TrimmedEntry)) {
        continue
      }

      if ($TrimmedEntry -match ('^(?i)' + [regex]::Escape($SettingName) + '=')) {
        continue
      }

      $Entries.Add($TrimmedEntry)
    }
  }

  $Entries.Add("$SettingName=$Value")
  $NewValue = (($Entries -join ';') + ';')

  New-ItemProperty -Path $RegistryPath -Name $ValueName -Value $NewValue -PropertyType String -Force | Out-Null
}

try {
  switch ($State) {
    'On' {
      Set-WindowedOptimizationState -Value 1

      if (-not $Silent) {
        Write-Output 'Windowed game optimizations enabled.'
      }
    }

    'Off' {
      Set-WindowedOptimizationState -Value 0

      if (-not $Silent) {
        Write-Output 'Windowed game optimizations disabled.'
      }
    }

    'Check' {
      # Detection is intentionally read-only. Do not create or modify registry values here.
      $CurrentValue = Get-CurrentSettingsValue

      if ([string]::IsNullOrWhiteSpace($CurrentValue)) {
        Write-Output 'UNKNOWN'
        exit 0
      }

      $Match = [regex]::Match(
        $CurrentValue,
        '(?i)(?:^|;)\s*SwapEffectUpgradeEnable\s*=\s*([01])\s*(?:;|$)'
      )

      if (-not $Match.Success) {
        Write-Output 'UNKNOWN'
      }
      elseif ($Match.Groups[1].Value -eq '1') {
        Write-Output 'ENABLED'
      }
      elseif ($Match.Groups[1].Value -eq '0') {
        Write-Output 'DISABLED'
      }
      else {
        Write-Output 'UNKNOWN'
      }
    }
  }

  exit 0
}
catch {
  if (-not $Silent) {
    Write-Error $_.Exception.Message
  }

  exit 1
}
