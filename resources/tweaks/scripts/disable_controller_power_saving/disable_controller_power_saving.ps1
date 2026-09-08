[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Controller Power Saving"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-ControllerCandidates {
  $devices = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
    $name = $_.FriendlyName
    $name -and (
      $name -match 'controller' -or
      $name -match 'xbox' -or
      $name -match 'gamepad' -or
      $name -match 'wireless controller' -or
      $name -match 'hid-compliant game controller'
    )
  }

  $devices | Sort-Object InstanceId -Unique
}

function Get-DeviceParamPaths([string]$instanceId) {
  $escaped = $instanceId -replace '#', '\'
  $base = "HKLM:\SYSTEM\CurrentControlSet\Enum\$escaped"
  @(
    "$base\Device Parameters",
    $base
  )
}

function Get-PowerManagedControllerValues {
  $devices = Get-ControllerCandidates
  $results = @()

  foreach ($device in $devices) {
    foreach ($path in Get-DeviceParamPaths $device.InstanceId) {
      if (Test-Path $path) {
        $prop = Get-ItemProperty -Path $path -Name EnhancedPowerManagementEnabled -ErrorAction SilentlyContinue
        if ($null -ne $prop) {
          $results += [pscustomobject]@{
            FriendlyName = $device.FriendlyName
            InstanceId   = $device.InstanceId
            Path         = $path
            Value        = [int]$prop.EnhancedPowerManagementEnabled
          }
        }
      }
    }
  }

  $results
}

try {
  switch ($State) {

    'Check' {
      $entries = Get-PowerManagedControllerValues

      if (-not $entries -or $entries.Count -eq 0) {
        Out-Result "Disabled" "No supported controller power-management entries found"
      }
      elseif (($entries | Where-Object { $_.Value -ne 0 }).Count -eq 0) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      $entries = Get-PowerManagedControllerValues

      if (-not $entries -or $entries.Count -eq 0) {
        Out-Result "Error" "No supported controller power-management entries found"
        exit 1
      }

      foreach ($entry in $entries) {
        New-ItemProperty -Path $entry.Path -Name EnhancedPowerManagementEnabled -PropertyType DWord -Value 0 -Force | Out-Null
      }

      Out-Result "Enabled" "Controller power saving disabled where supported"
    }

    'Off' {
      $entries = Get-PowerManagedControllerValues

      if (-not $entries -or $entries.Count -eq 0) {
        Out-Result "Error" "No supported controller power-management entries found"
        exit 1
      }

      foreach ($entry in $entries) {
        New-ItemProperty -Path $entry.Path -Name EnhancedPowerManagementEnabled -PropertyType DWord -Value 1 -Force | Out-Null
      }

      Out-Result "Disabled" "Controller power saving restored where supported"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
