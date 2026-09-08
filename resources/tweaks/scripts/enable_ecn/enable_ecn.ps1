[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Enable ECN"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-EcnEnabled {
  try {
    $setting = Get-NetTCPSetting -SettingName Internet -ErrorAction Stop
    return ($setting.EcnCapability.ToString() -eq 'Enabled')
  }
  catch {
    return $false
  }
}

function Set-EcnState([bool]$enabled) {
  $value = if ($enabled) { 'Enabled' } else { 'Disabled' }
  Set-NetTCPSetting -SettingName Internet -EcnCapability $value -ErrorAction Stop | Out-Null
}

try {
  switch ($State) {
    'Check' {
      if (Get-EcnEnabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-EcnState $true
      if (Get-EcnEnabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled" "ECN was written, but verification failed."
      }
    }

    'Off' {
      Set-EcnState $false
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
