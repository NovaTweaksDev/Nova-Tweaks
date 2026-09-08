[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Automatic Restart After Updates"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$windowsUpdateAuPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
$valueName = "NoAutoRebootWithLoggedOnUsers"

# ================= Helpers =================

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Value([string]$Path, [string]$Name) {

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-DWord([string]$Path, [string]$Name, [int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -PropertyType DWord `
    -Force | Out-Null
}

function Remove-Value([string]$Path, [string]$Name) {

  if (Test-Path $Path) {
    try {
      Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
    }
    catch {}
  }
}

function Test-AutoRestartDisabled {
  $value = Get-Value $windowsUpdateAuPath $valueName
  return ($value -eq 1)
}

function Get-AutoRestartStateMessage {
  $value = Get-Value $windowsUpdateAuPath $valueName

  if ($null -eq $value) {
    return "$valueName is not configured."
  }

  return "$valueName=$value"
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-AutoRestartDisabled) {
        Out-Result "Enabled" "Automatic restart after updates is disabled while a user is signed in. $(Get-AutoRestartStateMessage)"
      }
      else {
        Out-Result "Disabled" "Automatic restart after updates is not disabled by this policy. $(Get-AutoRestartStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable automatic restart after updates."
      }

      Set-DWord $windowsUpdateAuPath $valueName 1

      if (Test-AutoRestartDisabled) {
        Out-Result "Enabled" "Automatic restart after updates has been disabled while a user is signed in."
      }
      else {
        Out-Result "Disabled" "The policy was written, but verification failed. $(Get-AutoRestartStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore automatic restart behavior."
      }

      Remove-Value $windowsUpdateAuPath $valueName

      if (Test-AutoRestartDisabled) {
        Out-Result "Enabled" "Automatic restart policy still appears to be enabled. A system, domain, or MDM policy may be enforcing it. $(Get-AutoRestartStateMessage)"
      }
      else {
        Out-Result "Disabled" "Automatic restart behavior has been restored to Windows default."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
