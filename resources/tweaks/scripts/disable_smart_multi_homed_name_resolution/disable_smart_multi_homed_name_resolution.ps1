[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Smart Multi-Homed Name Resolution"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient'
$ValueName = 'DisableSmartNameResolution'

function Get-SmartMultiHomedDisabled {
  if (-not (Test-Path $RegistryPath)) {
    return $false
  }

  $value = Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
  if ($null -eq $value) {
    return $false
  }

  return ([int]$value.$ValueName -eq 1)
}

function Set-SmartMultiHomedDisabled {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $RegistryPath -Name $ValueName -PropertyType DWord -Value 1 -Force | Out-Null
}

function Restore-SmartMultiHomedDefault {
  if (Test-Path $RegistryPath) {
    if (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
    }
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-SmartMultiHomedDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-SmartMultiHomedDisabled
      Out-Result "Enabled"
    }

    'Off' {
      Restore-SmartMultiHomedDefault
      Out-Result "Disabled" "Default smart multi-homed behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
