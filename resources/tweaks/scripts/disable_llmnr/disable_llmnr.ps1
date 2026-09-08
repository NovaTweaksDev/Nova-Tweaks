[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable LLMNR"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient'
$ValueName = 'EnableMulticast'

function Get-LlmnrDisabled {
  if (-not (Test-Path $RegistryPath)) {
    return $false
  }

  $value = Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
  if ($null -eq $value) {
    return $false
  }

  return ([int]$value.$ValueName -eq 0)
}

function Set-LlmnrDisabled {
  if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
  }

  New-ItemProperty -Path $RegistryPath -Name $ValueName -PropertyType DWord -Value 0 -Force | Out-Null
}

function Restore-LlmnrDefault {
  if (Test-Path $RegistryPath) {
    if (Get-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue) {
      Remove-ItemProperty -Path $RegistryPath -Name $ValueName -ErrorAction Stop
    }
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-LlmnrDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-LlmnrDisabled
      Out-Result "Enabled"
    }

    'Off' {
      Restore-LlmnrDefault
      Out-Result "Disabled" "Default LLMNR behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
