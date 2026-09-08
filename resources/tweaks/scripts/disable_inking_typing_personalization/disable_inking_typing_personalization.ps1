[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Inking & Typing Personalization"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\TextInput'
$ValueName = 'AllowLinguisticDataCollection'

function Get-InkingTypingPersonalizationDisabled {
  if (-not (Test-Path $RegistryPath)) {
    return $false
  }

  $value = Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
  if ($null -eq $value) {
    return $false
  }

  return ([int]$value.$ValueName -eq 0)
}

function Set-InkingTypingPersonalizationDisabled {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $RegistryPath -Name $ValueName -PropertyType DWord -Value 0 -Force | Out-Null
}

function Restore-InkingTypingPersonalizationDefault {
  if (Test-Path $RegistryPath) {
    if (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
    }
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-InkingTypingPersonalizationDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-InkingTypingPersonalizationDisabled
      Out-Result "Enabled"
    }

    'Off' {
      Restore-InkingTypingPersonalizationDefault
      Out-Result "Disabled" "Default inking and typing personalization behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
