[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Advertising ID"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\AdvertisingInfo'
$ValueName = 'DisabledByGroupPolicy'

function Get-AdvertisingIdDisabled {
  if (-not (Test-Path $RegistryPath)) {
    return $false
  }

  $value = Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
  if ($null -eq $value) {
    return $false
  }

  return ([int]$value.$ValueName -eq 1)
}

function Set-AdvertisingIdDisabled {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $RegistryPath -Name $ValueName -PropertyType DWord -Value 1 -Force | Out-Null
}

function Restore-AdvertisingIdDefault {
  if (Test-Path $RegistryPath) {
    if (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
    }
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-AdvertisingIdDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-AdvertisingIdDisabled
      Out-Result "Enabled"
    }

    'Off' {
      Restore-AdvertisingIdDefault
      Out-Result "Disabled" "Default advertising ID behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
