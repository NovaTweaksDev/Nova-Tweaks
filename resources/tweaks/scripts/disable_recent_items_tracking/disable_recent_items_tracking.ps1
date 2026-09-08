[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "", $details = $null) {
  $result = @{
    tweak   = "Disable Recent Items Tracking"
    status  = $status
    message = $message
  }

  if ($null -ne $details) {
    $result.details = $details
  }

  $result | ConvertTo-Json -Compress -Depth 5
}

$RegistryValues = @(
  @{
    Path          = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
    Name          = "Start_TrackDocs"
    DisabledValue = 0
    EnabledValue  = 1
    Description   = "Tracks and displays recently opened documents in Start and Jump Lists."
  },
  @{
    Path          = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer"
    Name          = "ShowRecent"
    DisabledValue = 0
    EnabledValue  = 1
    Description   = "Shows recently used files in File Explorer."
  },
  @{
    Path          = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
    Name          = "NoRecentDocsHistory"
    DisabledValue = 1
    EnabledValue  = 0
    Description   = "Policy value that disables recent documents history tracking."
  }
)

function Get-DwordValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  $property = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue

  if ($null -eq $property -or -not ($property.PSObject.Properties.Name -contains $Name)) {
    return $null
  }

  return [int]$property.$Name
}

function Set-DwordValue([string]$Path, [string]$Name, [int]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  $property = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue

  if ($null -ne $property -and $property.PSObject.Properties.Name -contains $Name) {
    Set-ItemProperty -Path $Path -Name $Name -Value $Value
  }
  else {
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
  }
}

function Get-RecentItemsTrackingState {
  $states = foreach ($entry in $RegistryValues) {
    $currentValue = Get-DwordValue -Path $entry.Path -Name $entry.Name

    [PSCustomObject]@{
      Path          = $entry.Path
      Name          = $entry.Name
      Value         = $currentValue
      DisabledValue = $entry.DisabledValue
      EnabledValue  = $entry.EnabledValue
      IsDisabled    = ($null -ne $currentValue -and $currentValue -eq [int]$entry.DisabledValue)
      Description   = $entry.Description
    }
  }

  return $states
}

function Set-RecentItemsTrackingState([bool]$Disable) {
  foreach ($entry in $RegistryValues) {
    $targetValue = if ($Disable) { [int]$entry.DisabledValue } else { [int]$entry.EnabledValue }
    Set-DwordValue -Path $entry.Path -Name $entry.Name -Value $targetValue
  }
}

try {
  switch ($State) {

    'Check' {
      $states = Get-RecentItemsTrackingState
      $allDisabled = @($states | Where-Object { $_.IsDisabled -eq $false }).Count -eq 0

      if ($allDisabled) {
        Out-Result "Enabled" "Recent items tracking is disabled for the current user." $states
      }
      else {
        Out-Result "Disabled" "Recent items tracking is not fully disabled for the current user." $states
      }
    }

    'On' {
      Set-RecentItemsTrackingState -Disable $true
      $states = Get-RecentItemsTrackingState
      Out-Result "Enabled" "Recent items tracking has been disabled for the current user." $states
    }

    'Off' {
      Set-RecentItemsTrackingState -Disable $false
      $states = Get-RecentItemsTrackingState
      Out-Result "Disabled" "Recent items tracking has been restored for the current user." $states
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
