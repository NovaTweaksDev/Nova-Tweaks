[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Automatic Optional Updates"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$windowsUpdatePolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"

# Main documented policy value for Windows Update optional content.
$allowOptionalContentName = "AllowOptionalContent"

# Compatibility value shown in some Windows Update policy mappings.
$setAllowOptionalContentName = "SetAllowOptionalContent"

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

function Test-AutomaticOptionalUpdatesDisabled {
  $allowValue = Get-Value $windowsUpdatePolicyPath $allowOptionalContentName
  $setValue   = Get-Value $windowsUpdatePolicyPath $setAllowOptionalContentName

  return (($allowValue -eq 0) -and ($setValue -eq 0))
}

function Get-OptionalUpdatesStateMessage {
  $allowValue = Get-Value $windowsUpdatePolicyPath $allowOptionalContentName
  $setValue   = Get-Value $windowsUpdatePolicyPath $setAllowOptionalContentName

  $allowText = if ($null -eq $allowValue) { "not configured" } else { [string]$allowValue }
  $setText   = if ($null -eq $setValue) { "not configured" } else { [string]$setValue }

  return "$allowOptionalContentName=$allowText, $setAllowOptionalContentName=$setText"
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-AutomaticOptionalUpdatesDisabled) {
        Out-Result "Enabled" "Automatic optional updates are disabled. $(Get-OptionalUpdatesStateMessage)"
      }
      else {
        Out-Result "Disabled" "Automatic optional updates are not explicitly disabled by this tweak. $(Get-OptionalUpdatesStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable automatic optional updates."
      }

      Set-DWord $windowsUpdatePolicyPath $allowOptionalContentName 0
      Set-DWord $windowsUpdatePolicyPath $setAllowOptionalContentName 0

      if (Test-AutomaticOptionalUpdatesDisabled) {
        Out-Result "Enabled" "Automatic optional updates have been disabled."
      }
      else {
        Out-Result "Disabled" "The policy was written, but verification failed. $(Get-OptionalUpdatesStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore optional update behavior."
      }

      Remove-Value $windowsUpdatePolicyPath $allowOptionalContentName
      Remove-Value $windowsUpdatePolicyPath $setAllowOptionalContentName

      if (Test-AutomaticOptionalUpdatesDisabled) {
        Out-Result "Enabled" "Optional update policy still appears to be enforced. A system, domain, or MDM policy may be controlling this setting. $(Get-OptionalUpdatesStateMessage)"
      }
      else {
        Out-Result "Disabled" "Optional update behavior has been restored to Windows default."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
