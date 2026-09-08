[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Activity History"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System'
$ValueNames = @(
  'EnableActivityFeed',
  'PublishUserActivities',
  'UploadUserActivities'
)

function Get-ActivityHistoryDisabled {
  if (-not (Test-Path $RegistryPath)) {
    return $false
  }

  $values = Get-ItemProperty -Path $RegistryPath -ErrorAction SilentlyContinue
  if ($null -eq $values) {
    return $false
  }

  foreach ($valueName in $ValueNames) {
    if ($null -eq $values.PSObject.Properties[$valueName]) {
      return $false
    }

    if ([int]$values.$valueName -ne 0) {
      return $false
    }
  }

  return $true
}

function Set-ActivityHistoryDisabled {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  foreach ($valueName in $ValueNames) {
    New-ItemProperty -Path $RegistryPath -Name $valueName -PropertyType DWord -Value 0 -Force | Out-Null
  }
}

function Restore-ActivityHistoryDefault {
  if (Test-Path $RegistryPath) {
    foreach ($valueName in $ValueNames) {
      if (Get-ItemProperty -Path $RegistryPath -Name $valueName -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $RegistryPath -Name $valueName -ErrorAction Stop
      }
    }
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-ActivityHistoryDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-ActivityHistoryDisabled
      Out-Result "Enabled"
    }

    'Off' {
      Restore-ActivityHistoryDefault
      Out-Result "Disabled" "Default activity history behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
