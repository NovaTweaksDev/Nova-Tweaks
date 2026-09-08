[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Hardware Accelerated GPU Scheduling"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$path  = "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers"
$kName = "HwSchMode"

# ================= Helpers =================

function Get-Value([string]$Path,[string]$Name) {

  if (-not (Test-Path $Path)) { return $null }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-DWord([string]$Path,[string]$Name,[int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  Set-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -Force | Out-Null
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $value = Get-Value $path $kName

      if ($value -eq 2) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-DWord $path $kName 2

      Out-Result "Enabled" "Reboot required"
    }

    'Off' {

      Set-DWord $path $kName 1

      Out-Result "Disabled" "Reboot required"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
