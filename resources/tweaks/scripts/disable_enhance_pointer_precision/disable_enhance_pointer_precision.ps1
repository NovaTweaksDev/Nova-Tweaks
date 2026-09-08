[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status,[string]$message="") {
  @{ tweak = "Disable Enhance Pointer Precision"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$RegPath = "HKCU:\Control Panel\Mouse"

# ================= Helpers =================

function Get-Value([string]$Path,[string]$Name) {
  if (-not (Test-Path $Path)) { return $null }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-MouseAccel([string]$Speed,[string]$Threshold1,[string]$Threshold2) {
  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }

  Set-ItemProperty -Path $RegPath -Name "MouseSpeed"      -Value $Speed
  Set-ItemProperty -Path $RegPath -Name "MouseThreshold1" -Value $Threshold1
  Set-ItemProperty -Path $RegPath -Name "MouseThreshold2" -Value $Threshold2

  Start-Process `
    -FilePath "rundll32.exe" `
    -ArgumentList "user32.dll,UpdatePerUserSystemParameters 1, True" `
    -WindowStyle Hidden | Out-Null
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $speed = Get-Value $RegPath "MouseSpeed"
      $t1    = Get-Value $RegPath "MouseThreshold1"
      $t2    = Get-Value $RegPath "MouseThreshold2"

      $disabled =
        ($speed -eq "0") -and
        ($t1 -eq "0") -and
        ($t2 -eq "0")

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-MouseAccel -Speed "0" -Threshold1 "0" -Threshold2 "0"

      Out-Result "Enabled"
    }

    'Off' {

      Set-MouseAccel -Speed "1" -Threshold1 "6" -Threshold2 "10"

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
