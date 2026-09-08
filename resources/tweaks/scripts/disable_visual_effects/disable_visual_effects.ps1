[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status,[string]$message="") {
  @{ tweak="Disable Visual Effects"; status=$status; message=$message } | ConvertTo-Json -Compress
}

$RegTransparency  = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
$RegTaskbar       = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
$RegVisualFX      = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"
$RegWinMetrics    = "HKCU:\Control Panel\Desktop\WindowMetrics"
$RegAccessibility = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Accessibility"

# ================= Helpers =================

function Get-Value($Path,$Name) {

  if (-not (Test-Path $Path)) { return $null }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch { return $null }
}

function Set-DWord($Path,$Name,$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  Set-ItemProperty -Path $Path -Name $Name -Value $Value -Force | Out-Null
}

function Restart-Explorer {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Process explorer
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $fx  = Get-Value $RegVisualFX "VisualFXSetting"
      $ani = Get-Value $RegWinMetrics "MinAnimate"

      if (($fx -eq 2) -and ($ani -eq "0")) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-DWord $RegTransparency  "EnableTransparency" 0
      Set-DWord $RegTaskbar       "TaskbarAnimations" 0
      Set-DWord $RegVisualFX      "VisualFXSetting" 2
      Set-DWord $RegAccessibility "Animation" 0

      if (-not (Test-Path $RegWinMetrics)) { New-Item -Path $RegWinMetrics -Force | Out-Null }
      Set-ItemProperty $RegWinMetrics -Name "MinAnimate" -Value "0"

      Restart-Explorer

      Out-Result "Enabled"
    }

    'Off' {

      Set-DWord $RegTransparency  "EnableTransparency" 1
      Set-DWord $RegTaskbar       "TaskbarAnimations" 1
      Set-DWord $RegVisualFX      "VisualFXSetting" 0
      Set-DWord $RegAccessibility "Animation" 1

      if (-not (Test-Path $RegWinMetrics)) { New-Item -Path $RegWinMetrics -Force | Out-Null }
      Set-ItemProperty $RegWinMetrics -Name "MinAnimate" -Value "1"

      Restart-Explorer

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
