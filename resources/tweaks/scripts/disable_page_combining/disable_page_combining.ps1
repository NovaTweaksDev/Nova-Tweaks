[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Page Combining"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Test-SysMainDisabled {
  try {
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='SysMain'" -ErrorAction Stop
    return $null -ne $service -and [string]$service.StartMode -eq 'Disabled'
  }
  catch {
    return $false
  }
}

function Get-PageCombiningEnabled {
  if (Test-SysMainDisabled) {
    return $false
  }

  $mm = Get-MMAgent

  if ($null -eq $mm) {
    throw "Failed to query MMAgent configuration."
  }

  return [bool]$mm.PageCombining
}

function Set-PageCombining([string]$Mode) {
  if ($Mode -eq "Disable") {
    if (Test-SysMainDisabled) {
      return $false
    }

    Disable-MMAgent -PageCombining | Out-Null
  }
  else {
    if (Test-SysMainDisabled) {
      throw "Page Combining cannot be enabled while the SysMain service is disabled. Nova Tweaks did not change the SysMain service configuration."
    }

    Enable-MMAgent -PageCombining | Out-Null
  }

  return $true
}

try {
  switch ($State) {

    'Check' {
      $enabled = Get-PageCombiningEnabled

      if (-not $enabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      $changed = Set-PageCombining "Disable"
      if (Get-PageCombiningEnabled) {
        throw "Windows still reports Page Combining as enabled after the change."
      }

      if ($changed) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Enabled" "Page Combining is already inactive because the SysMain service is disabled."
      }
    }

    'Off' {
      Set-PageCombining "Enable"
      if (-not (Get-PageCombiningEnabled)) {
        throw "Windows still reports Page Combining as disabled after the change."
      }
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
