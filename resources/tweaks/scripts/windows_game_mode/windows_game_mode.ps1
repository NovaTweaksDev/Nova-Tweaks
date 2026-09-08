[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Windows Game Mode"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$gamebarpath = "HKCU:\SOFTWARE\Microsoft\GameBar"

# ================= Functions =================

function Get-Value([string]$Path, [string]$Name) {

  if (-not (Test-Path $Path)) { return $null }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-Value([string]$Path, [string]$Name, [int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  Set-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -Force | Out-Null
}

function Apply-UserSettings {

  Start-Process `
    -FilePath "rundll32.exe" `
    -ArgumentList "user32.dll,UpdatePerUserSystemParameters 1, True" `
    -WindowStyle Hidden | Out-Null
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $allowAuto = Get-Value $gamebarpath "AllowAutoGameMode"
      $autoMode  = Get-Value $gamebarpath "AutoGameModeEnabled"

      $enabled =
        ($allowAuto -eq 1) -and
        ($autoMode -eq 1)

      if ($enabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-Value $gamebarpath "AllowAutoGameMode" 1
      Set-Value $gamebarpath "AutoGameModeEnabled" 1

      Apply-UserSettings

      Out-Result "Enabled"
    }

    'Off' {

      Set-Value $gamebarpath "AllowAutoGameMode" 0
      Set-Value $gamebarpath "AutoGameModeEnabled" 0

      Apply-UserSettings

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
