[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Network Throttling"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$systemProfilePath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile"
$valueName = "NetworkThrottlingIndex"
$disabledValue = [uint32]4294967295 # 0xFFFFFFFF

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

function Set-DWord([string]$Path, [string]$Name, [uint32]$Value) {

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

function Test-NetworkThrottlingDisabled {
  $value = Get-Value $systemProfilePath $valueName

  if ($null -eq $value) {
    return $false
  }

  return ([uint32]$value -eq $disabledValue)
}

function Get-NetworkThrottlingStateMessage {
  $value = Get-Value $systemProfilePath $valueName

  if ($null -eq $value) {
    return "$valueName is not configured."
  }

  $hexValue = "0x{0:X8}" -f ([uint32]$value)
  return "$valueName=$value ($hexValue)"
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-NetworkThrottlingDisabled) {
        Out-Result "Enabled" "Network throttling is disabled. $(Get-NetworkThrottlingStateMessage)"
      }
      else {
        Out-Result "Disabled" "Network throttling is not disabled by this tweak. $(Get-NetworkThrottlingStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable network throttling."
      }

      Set-DWord $systemProfilePath $valueName $disabledValue

      if (Test-NetworkThrottlingDisabled) {
        Out-Result "Enabled" "Network throttling has been disabled. Restart Windows to apply the change reliably."
      }
      else {
        Out-Result "Disabled" "The registry value was written, but verification failed. $(Get-NetworkThrottlingStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore network throttling behavior."
      }

      Remove-Value $systemProfilePath $valueName

      if (Test-NetworkThrottlingDisabled) {
        Out-Result "Enabled" "Network throttling still appears to be disabled. A system policy or another tool may be enforcing it. $(Get-NetworkThrottlingStateMessage)"
      }
      else {
        Out-Result "Disabled" "Network throttling behavior has been restored to Windows default. Restart Windows to apply the change reliably."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
