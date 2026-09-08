[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Shared Experiences"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$systemPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System"
$valueName = "EnableCdp"

# EnableCdp:
# 0 = Connected Devices Platform / Shared Experiences disabled by policy
# 1 = Enabled by policy
# Not configured = Windows default behavior

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

function Test-SharedExperiencesDisabled {
  $value = Get-Value $systemPolicyPath $valueName
  return ($value -eq 0)
}

function Get-SharedExperiencesStateMessage {
  $value = Get-Value $systemPolicyPath $valueName

  if ($null -eq $value) {
    return "$valueName is not configured."
  }

  return "$valueName=$value"
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-SharedExperiencesDisabled) {
        Out-Result "Enabled" "Shared Experiences are disabled by policy. $(Get-SharedExperiencesStateMessage)"
      }
      else {
        Out-Result "Disabled" "Shared Experiences are not disabled by this policy. $(Get-SharedExperiencesStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable Shared Experiences."
      }

      Set-DWord $systemPolicyPath $valueName 0

      if (Test-SharedExperiencesDisabled) {
        Out-Result "Enabled" "Shared Experiences have been disabled."
      }
      else {
        Out-Result "Disabled" "The policy was written, but verification failed. $(Get-SharedExperiencesStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore Shared Experiences behavior."
      }

      Remove-Value $systemPolicyPath $valueName

      if (Test-SharedExperiencesDisabled) {
        Out-Result "Enabled" "Shared Experiences still appear to be disabled. A system, domain, or MDM policy may be enforcing this setting. $(Get-SharedExperiencesStateMessage)"
      }
      else {
        Out-Result "Disabled" "Shared Experiences behavior has been restored to Windows default."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
