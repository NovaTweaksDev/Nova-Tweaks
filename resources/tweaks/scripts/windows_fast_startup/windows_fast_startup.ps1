[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status,[string]$message="") {
  @{ tweak = "Windows Fast Startup"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegPath           = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power"
$ValueName         = "HiberbootEnabled"
$HibernateRegPath  = "HKLM:\SYSTEM\CurrentControlSet\Control\Power"

# ================= Helpers =================

function Get-RegistryDword([string]$Path,[string]$PropertyName) {
  try {
    $item = Get-ItemProperty -Path $Path -Name $PropertyName -ErrorAction Stop
    return [int]$item.$PropertyName
  }
  catch {
    return $null
  }
}

function Set-RegistryDword([string]$Path,[string]$PropertyName,[int]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  Set-ItemProperty `
    -Path $Path `
    -Name $PropertyName `
    -Value $Value `
    -Force | Out-Null
}

function Test-HibernateEnabled {
  $hibernateEnabled = Get-RegistryDword -Path $HibernateRegPath -PropertyName "HibernateEnabled"
  return ($hibernateEnabled -eq 1)
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $hiberbootEnabled = Get-RegistryDword -Path $RegPath -PropertyName $ValueName
      $hibernateEnabled = Test-HibernateEnabled

      if (($hiberbootEnabled -eq 1) -and $hibernateEnabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      powercfg /hibernate on | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to enable hibernation."
      }

      Set-RegistryDword -Path $RegPath -PropertyName $ValueName -Value 1

      Out-Result "Enabled" "Takes effect after next shutdown"
    }

    'Off' {

      Set-RegistryDword -Path $RegPath -PropertyName $ValueName -Value 0

      Out-Result "Disabled" "Takes effect after next shutdown"
    }

  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
