[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Memory Compression"; status = $status; message = $message } | ConvertTo-Json -Compress
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

function Get-MemoryCompressionEnabled {
  if (Test-SysMainDisabled) {
    return $false
  }

  $mm = Get-MMAgent

  if ($null -eq $mm) {
    throw "Failed to query MMAgent configuration."
  }

  return [bool]$mm.MemoryCompression
}

function Set-MemoryCompression([string]$Mode) {
  if ($Mode -eq 'Disable') {
    if (Test-SysMainDisabled) {
      return $false
    }

    Disable-MMAgent -MemoryCompression | Out-Null
  }
  else {
    if (Test-SysMainDisabled) {
      throw "Memory Compression cannot be enabled while the SysMain service is disabled. Nova Tweaks did not change the SysMain service configuration."
    }

    Enable-MMAgent -MemoryCompression | Out-Null
  }

  return $true
}

try {
  switch ($State) {

    'Check' {
      $enabled = Get-MemoryCompressionEnabled

      if (-not $enabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      $changed = Set-MemoryCompression "Disable"
      if (Get-MemoryCompressionEnabled) {
        throw "Windows still reports Memory Compression as enabled after the change."
      }

      if ($changed) {
        Out-Result "Enabled" "Reboot required"
      }
      else {
        Out-Result "Enabled" "Memory Compression is already inactive because the SysMain service is disabled."
      }
    }

    'Off' {
      Set-MemoryCompression "Enable" | Out-Null
      if (-not (Get-MemoryCompressionEnabled)) {
        throw "Windows still reports Memory Compression as disabled after the change."
      }
      Out-Result "Disabled" "Reboot required"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
