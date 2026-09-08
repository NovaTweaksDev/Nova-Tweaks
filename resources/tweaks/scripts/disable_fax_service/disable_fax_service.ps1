[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Fax Service"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$ServiceName = "Fax"

function Get-ServiceState {
  $registryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
  if (-not (Test-Path $registryPath)) {
    return [PSCustomObject]@{
      Name      = $ServiceName
      State     = "NotInstalled"
      StartMode = "Disabled"
    }
  }

  $startValue = (Get-ItemProperty -Path $registryPath -Name Start -ErrorAction Stop).Start
  $startMode = switch ([int]$startValue) {
    2 { "Auto" }
    3 { "Manual" }
    4 { "Disabled" }
    default { "Unknown" }
  }
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

  [PSCustomObject]@{
    Name      = $ServiceName
    State     = if ($service) { [string]$service.Status } else { "Unknown" }
    StartMode = $startMode
  }
}

try {
  switch ($State) {

    'Check' {
      $service = Get-ServiceState

      if ($service.StartMode -eq 'Disabled') {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
      Set-Service  -Name $ServiceName -StartupType Disabled

      Out-Result "Enabled"
    }

    'Off' {
      Set-Service  -Name $ServiceName -StartupType Manual
      Start-Service -Name $ServiceName -ErrorAction SilentlyContinue

      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
