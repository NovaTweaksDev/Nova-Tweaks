[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeMethods {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(
    uint uiAction,
    uint uiParam,
    UIntPtr pvParam,
    uint fWinIni
  );
}
"@

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Pointer Trails"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Get-PointerTrailsDisabled {
  $path = 'HKCU:\Control Panel\Mouse'
  $value = (Get-ItemProperty -Path $path -Name MouseTrails -ErrorAction Stop).MouseTrails
  return ([int]$value -le 1)
}

function Set-PointerTrails([uint32]$trailCount) {
  $SPI_SETMOUSETRAILS = 0x005D
  $SPIF_UPDATEINIFILE = 0x01
  $SPIF_SENDCHANGE    = 0x02

  $ok = [NativeMethods]::SystemParametersInfo(
    $SPI_SETMOUSETRAILS,
    $trailCount,
    [UIntPtr]::Zero,
    ($SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE)
  )

  if (-not $ok) {
    throw "Failed to apply pointer trails setting."
  }
}

try {
  switch ($State) {

    'Check' {
      $disabled = Get-PointerTrailsDisabled

      if ($disabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-PointerTrails 0
      Out-Result "Enabled"
    }

    'Off' {
      Set-PointerTrails 7
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
