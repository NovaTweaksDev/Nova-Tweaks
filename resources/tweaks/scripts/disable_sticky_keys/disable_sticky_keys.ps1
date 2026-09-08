[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Disable Sticky Keys'
$SPI_GETSTICKYKEYS = [uint32]0x003A
$SPI_SETSTICKYKEYS = [uint32]0x003B
$SPIF_UPDATEINIFILE = [uint32]0x0001
$SPIF_SENDCHANGE = [uint32]0x0002
$SKF_STICKYKEYSON = [uint32]0x0001
$SKF_HOTKEYACTIVE = [uint32]0x0004
$DisableMask = [uint32]($SKF_STICKYKEYSON -bor $SKF_HOTKEYACTIVE)

function Out-Result([string]$Status, [string]$Message = '') {
  @{
    tweak = $TweakName
    status = $Status
    message = $Message
  } | ConvertTo-Json -Compress
}

if (-not ('NovaTweaks.Win32.AccessibilityNativeMethods' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace NovaTweaks.Win32
{
    [StructLayout(LayoutKind.Sequential)]
    public struct StickyKeys
    {
        public uint Size;
        public uint Flags;
    }

    public static class AccessibilityNativeMethods
    {
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SystemParametersInfo(
            uint action,
            uint parameter,
            ref StickyKeys data,
            uint updateFlags);
    }
}
'@
}

function Get-StickyKeysSettings {
  $settings = New-Object NovaTweaks.Win32.StickyKeys
  $settings.Size = [uint32][Runtime.InteropServices.Marshal]::SizeOf($settings)

  $succeeded = [NovaTweaks.Win32.AccessibilityNativeMethods]::SystemParametersInfo(
    $SPI_GETSTICKYKEYS,
    $settings.Size,
    [ref]$settings,
    0
  )
  if (-not $succeeded) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw [ComponentModel.Win32Exception]::new($errorCode, 'Could not read the Sticky Keys settings.')
  }

  return $settings
}

function Set-StickyKeysSettings([NovaTweaks.Win32.StickyKeys]$Settings) {
  $succeeded = [NovaTweaks.Win32.AccessibilityNativeMethods]::SystemParametersInfo(
    $SPI_SETSTICKYKEYS,
    $Settings.Size,
    [ref]$Settings,
    [uint32]($SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE)
  )
  if (-not $succeeded) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw [ComponentModel.Win32Exception]::new($errorCode, 'Could not update the Sticky Keys settings.')
  }
}

try {
  switch ($State) {
    'Check' {
      $settings = Get-StickyKeysSettings
      $disabled = ($settings.Flags -band $DisableMask) -eq 0
      Out-Result $(if ($disabled) { 'Enabled' } else { 'Disabled' })
    }

    'On' {
      $settings = Get-StickyKeysSettings
      $settings.Flags = [uint32]($settings.Flags -band ([uint32]::MaxValue -bxor $DisableMask))
      Set-StickyKeysSettings $settings
      Out-Result 'Enabled'
    }

    'Off' {
      $settings = Get-StickyKeysSettings
      $settings.Flags = [uint32]($settings.Flags -bor $SKF_HOTKEYACTIVE)
      Set-StickyKeysSettings $settings
      Out-Result 'Disabled' 'The five-Shift activation shortcut was restored.'
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message
  exit 1
}
