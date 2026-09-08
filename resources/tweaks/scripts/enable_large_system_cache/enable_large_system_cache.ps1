[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Enable Large System Cache"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegPath   = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management"
$ValueName = "LargeSystemCache"

function Get-RegistryDword([string]$Path, [string]$PropertyName) {
  try {
    $item = Get-ItemProperty -Path $Path -Name $PropertyName -ErrorAction Stop
    return [int]$item.$PropertyName
  }
  catch {
    return $null
  }
}

function Set-RegistryDword([string]$Path, [string]$PropertyName, [int]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  Set-ItemProperty -Path $Path -Name $PropertyName -Value $Value -Force | Out-Null
}

try {
  switch ($State) {
    'Check' {
      $value = Get-RegistryDword -Path $RegPath -PropertyName $ValueName
      if ($value -eq 1) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-RegistryDword -Path $RegPath -PropertyName $ValueName -Value 1
      Out-Result "Enabled" "Reboot recommended"
    }

    'Off' {
      Set-RegistryDword -Path $RegPath -PropertyName $ValueName -Value 0
      Out-Result "Disabled" "Reboot recommended"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
