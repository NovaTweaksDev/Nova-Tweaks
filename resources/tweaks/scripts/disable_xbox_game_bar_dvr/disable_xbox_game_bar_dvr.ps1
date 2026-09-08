[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Xbox Game Bar & DVR"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Set-DWord([string]$Path, [string]$ValueName, [int]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $ValueName `
    -PropertyType DWord `
    -Value $Value `
    -Force | Out-Null
}

function Get-DWord([string]$Path, [string]$ValueName) {
  if (Test-Path $Path) {
    try {
      return (Get-ItemProperty -Path $Path -Name $ValueName -ErrorAction Stop).$ValueName
    }
    catch {
      return $null
    }
  }
  return $null
}

try {

  switch ($State) {

    'Check' {

      $appCapture = Get-DWord 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled'
      $gameDvr    = Get-DWord 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled'
      $gameBar    = Get-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'GameBarEnabled'
      $policy     = Get-DWord 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' 'AllowGameDVR'

      $isDisabled =
        ($appCapture -eq 0) -and
        ($gameDvr -eq 0) -and
        ($gameBar -eq 0) -and
        ($policy -eq 0)

      if ($isDisabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      # Disable (user level)
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled' 0
      Set-DWord 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled' 0
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'GameBarEnabled' 0
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'ShowStartupPanel' 0
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'UseNexusForGameBarEnabled' 0

      # Disable (policy level)
      Set-DWord 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' 'AllowGameDVR' 0
      Set-DWord 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Game Recording and Broadcasting' 'Enabled' 0

      Out-Result "Enabled"
    }

    'Off' {

      # Enable (user level)
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled' 1
      Set-DWord 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled' 1
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'GameBarEnabled' 1
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'ShowStartupPanel' 1
      Set-DWord 'HKCU:\SOFTWARE\Microsoft\GameBar' 'UseNexusForGameBarEnabled' 1

      # Remove policies
      Remove-Item 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' -Recurse -ErrorAction SilentlyContinue
      Remove-Item 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Game Recording and Broadcasting' -Recurse -ErrorAction SilentlyContinue

      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
