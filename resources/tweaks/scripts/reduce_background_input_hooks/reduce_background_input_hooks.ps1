[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Reduce Background Input Hooks"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Ensure-RegistryPath([string]$path) {
  if (-not (Test-Path $path)) {
    New-Item -Path $path -Force | Out-Null
  }
}

function Get-BackgroundHooksReduced {
  $gameDvrPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR'
  $gameConfigPath = 'HKCU:\System\GameConfigStore'

  $appCaptureEnabled = 1
  $gameDvrEnabled = 1

  if (Test-Path $gameDvrPath) {
    $v = Get-ItemProperty -Path $gameDvrPath -Name AppCaptureEnabled -ErrorAction SilentlyContinue
    if ($null -ne $v) {
      $appCaptureEnabled = [int]$v.AppCaptureEnabled
    }
  }

  if (Test-Path $gameConfigPath) {
    $v = Get-ItemProperty -Path $gameConfigPath -Name GameDVR_Enabled -ErrorAction SilentlyContinue
    if ($null -ne $v) {
      $gameDvrEnabled = [int]$v.GameDVR_Enabled
    }
  }

  return ($appCaptureEnabled -eq 0 -and $gameDvrEnabled -eq 0)
}

function Set-BackgroundHooksReduced([bool]$enabled) {
  $gameDvrPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR'
  $gameConfigPath = 'HKCU:\System\GameConfigStore'

  Ensure-RegistryPath $gameDvrPath
  Ensure-RegistryPath $gameConfigPath

  if ($enabled) {
    New-ItemProperty -Path $gameDvrPath -Name AppCaptureEnabled -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $gameConfigPath -Name GameDVR_Enabled -PropertyType DWord -Value 0 -Force | Out-Null
  }
  else {
    New-ItemProperty -Path $gameDvrPath -Name AppCaptureEnabled -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $gameConfigPath -Name GameDVR_Enabled -PropertyType DWord -Value 1 -Force | Out-Null
  }
}

try {
  switch ($State) {

    'Check' {
      $applied = Get-BackgroundHooksReduced

      if ($applied) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-BackgroundHooksReduced $true
      Out-Result "Enabled" "Game DVR background capture disabled"
    }

    'Off' {
      Set-BackgroundHooksReduced $false
      Out-Result "Disabled" "Game DVR background capture restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
