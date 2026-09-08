[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{
    tweak   = "Clear Standby Memory"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

$cs = @"
using System;
using System.Runtime.InteropServices;

public static class Native {
  [DllImport("ntdll.dll")]
  public static extern int NtSetSystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength);

  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern bool OpenProcessToken(IntPtr ProcessHandle, UInt32 DesiredAccess, out IntPtr TokenHandle);

  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out LUID lpLuid);

  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern bool AdjustTokenPrivileges(
      IntPtr TokenHandle,
      bool DisableAllPrivileges,
      ref TOKEN_PRIVILEGES NewState,
      int BufferLength,
      IntPtr PreviousState,
      IntPtr ReturnLength
  );

  [DllImport("kernel32.dll")]
  public static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr hObject);

  public const UInt32 TOKEN_ADJUST_PRIVILEGES = 0x0020;
  public const UInt32 TOKEN_QUERY = 0x0008;
  public const UInt32 SE_PRIVILEGE_ENABLED = 0x0002;

  [StructLayout(LayoutKind.Sequential)]
  public struct LUID {
    public UInt32 LowPart;
    public Int32 HighPart;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct LUID_AND_ATTRIBUTES {
    public LUID Luid;
    public UInt32 Attributes;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct TOKEN_PRIVILEGES {
    public UInt32 PrivilegeCount;
    public LUID_AND_ATTRIBUTES Privileges;
  }

  public static void EnablePrivilege(string privName) {
    IntPtr hToken;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out hToken))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

    try {
      LUID luid;
      if (!LookupPrivilegeValue(null, privName, out luid))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

      TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
      tp.PrivilegeCount = 1;
      tp.Privileges = new LUID_AND_ATTRIBUTES();
      tp.Privileges.Luid = luid;
      tp.Privileges.Attributes = SE_PRIVILEGE_ENABLED;

      if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    finally {
      CloseHandle(hToken);
    }
  }
}
"@

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      Add-Type -TypeDefinition $cs -ErrorAction Stop

      [Native]::EnablePrivilege("SeProfileSingleProcessPrivilege")

      $p = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
      try {
        [Runtime.InteropServices.Marshal]::WriteInt32($p, 4)
        $status = [Native]::NtSetSystemInformation(0x50, $p, 4)
      }
      finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($p)
      }

      if ($status -ne 0) {
        $hex = ('0x{0:X8}' -f ([uint32]$status))
        throw "NtSetSystemInformation failed. NTSTATUS=$hex"
      }

      Out-Result "Enabled" "Standby memory cleared"
    }

    'Off' {
      Out-Result "Disabled" "One-shot action; nothing to revert"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
