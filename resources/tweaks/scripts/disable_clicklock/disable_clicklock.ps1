[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off')]
  [string]$State = 'Check',

  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('NovaClickLockNativeMethods' -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NovaClickLockNativeMethods
{
    [DllImport(
        "user32.dll",
        EntryPoint = "SystemParametersInfoW",
        SetLastError = true
    )]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetSystemParametersInfo(
        uint uiAction,
        uint uiParam,
        out int pvParam,
        uint fWinIni
    );

    [DllImport(
        "user32.dll",
        EntryPoint = "SystemParametersInfoW",
        SetLastError = true
    )]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetSystemParametersInfo(
        uint uiAction,
        uint uiParam,
        IntPtr pvParam,
        uint fWinIni
    );
}
"@
}

$SPI_GETMOUSECLICKLOCK = 0x101E
$SPI_SETMOUSECLICKLOCK = 0x101F

$SPIF_UPDATEINIFILE = 0x01
$SPIF_SENDCHANGE    = 0x02
$SPIF_FLAGS         = $SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE

function Out-Result {
  param(
    [Parameter(Mandatory)]
    [string]$Status,

    [string]$Message = ''
  )

  @{
    id      = 'disable_clicklock'
    tweak   = 'Disable ClickLock'
    status  = $Status
    message = $Message
  } | ConvertTo-Json -Compress
}

function Get-ClickLockEnabled {
  $value = 0

  $success = [NovaClickLockNativeMethods]::GetSystemParametersInfo(
    $SPI_GETMOUSECLICKLOCK,
    0,
    [ref]$value,
    0
  )

  if (-not $success) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "Failed to query ClickLock state. Win32 error: $errorCode"
  }

  return ($value -ne 0)
}

function Set-ClickLockEnabled {
  param(
    [Parameter(Mandatory)]
    [bool]$Enabled
  )

  # Wichtig:
  # SPI_SETMOUSECLICKLOCK erwartet den BOOL-Wert direkt in pvParam,
  # nicht einen Zeiger auf eine Integer-Variable.
  $nativeValue = if ($Enabled) {
    [IntPtr]::new(1)
  }
  else {
    [IntPtr]::Zero
  }

  $success = [NovaClickLockNativeMethods]::SetSystemParametersInfo(
    $SPI_SETMOUSECLICKLOCK,
    0,
    $nativeValue,
    $SPIF_FLAGS
  )

  if (-not $success) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "Failed to apply ClickLock setting. Win32 error: $errorCode"
  }

  # Ergebnis direkt überprüfen
  $actualState = Get-ClickLockEnabled

  if ($actualState -ne $Enabled) {
    throw "ClickLock state verification failed."
  }
}

try {
  switch ($State) {
    'Check' {
      if (Get-ClickLockEnabled) {
        Out-Result -Status 'Disabled' -Message 'ClickLock is enabled.'
      }
      else {
        Out-Result -Status 'Enabled' -Message 'ClickLock is disabled.'
      }
    }

    'On' {
      # Tweak ON = ClickLock deaktivieren
      Set-ClickLockEnabled -Enabled $false

      Out-Result `
        -Status 'Enabled' `
        -Message 'ClickLock was disabled successfully.'
    }

    'Off' {
      # Tweak OFF = ClickLock wieder aktivieren
      Set-ClickLockEnabled -Enabled $true

      Out-Result `
        -Status 'Disabled' `
        -Message 'ClickLock was enabled again.'
    }
  }

  exit 0
}
catch {
  Out-Result -Status 'Error' -Message $_.Exception.Message
  exit 1
}
