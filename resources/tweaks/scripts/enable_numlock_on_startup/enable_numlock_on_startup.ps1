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
    tweak   = "Enable NumLock on Startup"
    status  = $status
    message = $message
  }

  if ($null -ne $details) {
    $result.details = $details
  }

  $result | ConvertTo-Json -Compress -Depth 4
}

$RegistryTargets = @(
  @{
    Name = "CurrentUser"
    Path = "HKCU:\Control Panel\Keyboard"
  },
  @{
    Name = "DefaultLogonProfile"
    Path = "Registry::HKEY_USERS\.DEFAULT\Control Panel\Keyboard"
  }
)

function Get-NumLockValue([string]$Path) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  $item = Get-ItemProperty -Path $Path -Name "InitialKeyboardIndicators" -ErrorAction SilentlyContinue

  if ($null -eq $item) {
    return $null
  }

  return [string]$item.InitialKeyboardIndicators
}

function Test-NumLockEnabled([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  return ($Value -eq "2" -or $Value -eq "2147483650")
}

function Get-NumLockState {
  $states = foreach ($target in $RegistryTargets) {
    $value = Get-NumLockValue -Path $target.Path

    [PSCustomObject]@{
      Name    = $target.Name
      Path    = $target.Path
      Value   = $value
      Enabled = Test-NumLockEnabled -Value $value
    }
  }

  return @($states)
}

function Set-NumLockState([string]$Value) {
  foreach ($target in $RegistryTargets) {
    if (-not (Test-Path $target.Path)) {
      New-Item -Path $target.Path -Force | Out-Null
    }

    New-ItemProperty `
      -Path $target.Path `
      -Name "InitialKeyboardIndicators" `
      -Value $Value `
      -PropertyType String `
      -Force | Out-Null
  }
}

try {
  switch ($State) {
    'Check' {
      $states = Get-NumLockState
      $allEnabled = @($states | Where-Object { $_.Enabled -eq $false }).Count -eq 0

      if ($allEnabled) {
        Out-Result "Enabled" "NumLock is configured to be enabled on startup and sign-in." $states
      } else {
        Out-Result "Disabled" "NumLock is not fully configured for startup and sign-in." $states
      }
    }

    'On' {
      Set-NumLockState -Value "2"
      $states = Get-NumLockState
      Out-Result "Enabled" "NumLock startup behavior has been enabled." $states
    }

    'Off' {
      Set-NumLockState -Value "0"
      $states = Get-NumLockState
      Out-Result "Disabled" "NumLock startup behavior has been disabled." $states
    }
  }

  exit 0
} catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
