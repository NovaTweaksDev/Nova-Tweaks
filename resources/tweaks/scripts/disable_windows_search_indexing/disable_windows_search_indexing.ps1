[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Windows Search Indexing"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$ServiceName = "WSearch"

function Get-ServiceState {
  $service = Get-CimInstance Win32_Service -Filter "Name='WSearch'" -ErrorAction Stop

  [PSCustomObject]@{
    Name      = $service.Name
    State     = $service.State
    StartMode = $service.StartMode
  }
}

function Set-ServiceState([string]$Name, [string]$StartupType, [string]$Action) {
  Set-Service -Name $Name -StartupType $StartupType

  $svc = Get-Service -Name $Name -ErrorAction Stop

  if ($Action -eq "Stop" -and $svc.Status -ne "Stopped") {
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
  }

  if ($Action -eq "Start" -and $svc.Status -ne "Running") {
    Start-Service -Name $Name -ErrorAction SilentlyContinue
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
      Set-ServiceState -Name $ServiceName -StartupType "Disabled" -Action "Stop"
      Out-Result "Enabled"
    }

    'Off' {
      Set-ServiceState -Name $ServiceName -StartupType "Automatic" -Action "Start"
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
