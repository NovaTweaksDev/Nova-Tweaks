[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Xbox Services"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$XboxServices = @(
  "XboxGipSvc",
  "XboxNetApiSvc",
  "XblAuthManager",
  "XblGameSave",
  "XboxSvc"
)

function Get-ExistingXboxServices {
  $services = foreach ($name in $XboxServices) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc) {
      [PSCustomObject]@{
        Name      = $svc.Name
        State     = $svc.Status.ToString()
        StartMode = $svc.StartType.ToString()
      }
    }
  }

  return @($services)
}

function Set-ServiceState([string]$Name, [string]$StartupType, [string]$Action) {
  Set-Service -Name $Name -StartupType $StartupType

  $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $svc) {
    return
  }

  if ($Action -eq "Stop" -and $svc.Status -ne "Stopped") {
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
  }
  elseif ($Action -eq "Start" -and $svc.Status -ne "Running") {
    Start-Service -Name $Name -ErrorAction SilentlyContinue
  }
}

try {
  switch ($State) {

    'Check' {
      $services = Get-ExistingXboxServices

      if (@($services).Count -eq 0) {
        Out-Result "Enabled" "No Xbox services found"
      }
      elseif (@($services | Where-Object { $_.StartMode -ne 'Disabled' }).Count -eq 0) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      $services = Get-ExistingXboxServices

      if (@($services).Count -eq 0) {
        Out-Result "Enabled" "No Xbox services found"
      }
      else {
        foreach ($svc in $services) {
          Set-ServiceState -Name $svc.Name -StartupType "Disabled" -Action "Stop"
        }

        Out-Result "Enabled"
      }
    }

    'Off' {
      $services = Get-ExistingXboxServices

      if (@($services).Count -eq 0) {
        Out-Result "Disabled" "No Xbox services found"
      }
      else {
        foreach ($svc in $services) {
          Set-ServiceState -Name $svc.Name -StartupType "Manual" -Action "Start"
        }

        Out-Result "Disabled"
      }
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
