[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "", [hashtable]$details = @{}) {
  @{
    tweak   = "Empty Recycle Bin"
    status  = $status
    message = $message
    details = $details
  } | ConvertTo-Json -Compress
}

$Shell32Type = @"
using System;
using System.Runtime.InteropServices;

public static class NovaRecycleBin
{
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHEmptyRecycleBin(IntPtr hwnd, string pszRootPath, uint dwFlags);
}
"@

function Format-HResult([int]$Result) {
  $unsigned = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes($Result), 0)
  return '0x{0:X8}' -f $unsigned
}

function Test-BenignRecycleBinHResult([string]$HResult) {
  $benignResults = @(
    "0x8000FFFF", # Windows Shell may return E_UNEXPECTED for an empty or unavailable recycle bin in non-interactive contexts.
    "0x80070002",
    "0x80070003"
  )
  return $benignResults -contains $HResult
}

function Get-FileSystemDriveRoots {
  $roots = New-Object 'System.Collections.Generic.List[string]'

  try {
    Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction Stop |
      Where-Object { $_.DriveType -in @(2, 3) -and -not [string]::IsNullOrWhiteSpace($_.DeviceID) } |
      ForEach-Object {
        $root = "$($_.DeviceID)\"
        if ((Test-Path -LiteralPath $root) -and -not $roots.Contains($root)) {
          [void]$roots.Add($root)
        }
      }
  }
  catch {
    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
      ForEach-Object {
        $root = $_.Root
        if (-not [string]::IsNullOrWhiteSpace($root) -and (Test-Path -LiteralPath $root) -and -not $roots.Contains($root)) {
          [void]$roots.Add($root)
        }
      }
  }

  return $roots.ToArray()
}

function Invoke-ShellEmptyRecycleBin([string]$RootPath = $null) {
  if (-not ([System.Management.Automation.PSTypeName]'NovaRecycleBin').Type) {
    Add-Type -TypeDefinition $Shell32Type -ErrorAction Stop
  }

  $noConfirmation = 0x00000001
  $noProgressUi = 0x00000002
  $noSound = 0x00000004
  $flags = [uint32]($noConfirmation -bor $noProgressUi -bor $noSound)
  $apiRootPath = if ([string]::IsNullOrWhiteSpace($RootPath)) { $null } else { $RootPath }
  $result = [NovaRecycleBin]::SHEmptyRecycleBin([IntPtr]::Zero, $apiRootPath, $flags)
  $hresult = Format-HResult $result

  if ($result -eq 0) {
    return @{
      method = "SHEmptyRecycleBin"
      rootPath = $apiRootPath
      hresult = $hresult
      noOp = $false
      ok = $true
    }
  }

  if (Test-BenignRecycleBinHResult $hresult) {
    return @{
      method = "SHEmptyRecycleBin"
      rootPath = $apiRootPath
      hresult = $hresult
      noOp = $true
      ok = $true
      warning = "Windows Shell returned non-fatal HRESULT $hresult"
    }
  }

  throw "SHEmptyRecycleBin failed with HRESULT $hresult"
}

function Test-BenignRecycleBinException([System.Management.Automation.ErrorRecord]$ErrorRecord) {
  $message = $ErrorRecord.Exception.Message
  return $message -match 'cannot find the path|path specified|does not exist|0x80070002|0x80070003|0x8000FFFF'
}

function Invoke-ClearRecycleBinFallback([string[]]$DriveRoots) {
  $attempts = @()
  $warnings = @()

  if (-not (Get-Command -Name Clear-RecycleBin -ErrorAction SilentlyContinue)) {
    return @{
      attempts = $attempts
      warnings = @("Clear-RecycleBin fallback is not available on this system.")
      successCount = 0
    }
  }

  foreach ($root in $DriveRoots) {
    $letter = ([System.IO.Path]::GetPathRoot($root)).TrimEnd('\').TrimEnd(':')
    if ([string]::IsNullOrWhiteSpace($letter)) {
      continue
    }

    try {
      Clear-RecycleBin -DriveLetter $letter -Force -ErrorAction Stop
      $attempts += @{
        method = "Clear-RecycleBin"
        rootPath = $root
        ok = $true
      }
    }
    catch {
      $warning = "Clear-RecycleBin fallback skipped $root. $($_.Exception.Message)"
      $warnings += $warning
      $attempts += @{
        method = "Clear-RecycleBin"
        rootPath = $root
        ok = $false
        warning = $warning
      }

      if (-not (Test-BenignRecycleBinException $_)) {
        continue
      }
    }
  }

  return @{
    attempts = $attempts
    warnings = $warnings
    successCount = @($attempts | Where-Object { $_.ok }).Count
  }
}

function Invoke-EmptyRecycleBin {
  $driveRoots = @(Get-FileSystemDriveRoots)
  $attempts = @()
  $warnings = @()

  foreach ($root in $driveRoots) {
    try {
      $attempt = Invoke-ShellEmptyRecycleBin -RootPath $root
      $attempts += $attempt
      if ($attempt.ContainsKey('warning') -and $attempt.warning) {
        $warnings += "$root $($attempt.warning)"
      }
    }
    catch {
      $warning = "SHEmptyRecycleBin skipped $root. $($_.Exception.Message)"
      $warnings += $warning
      $attempts += @{
        method = "SHEmptyRecycleBin"
        rootPath = $root
        ok = $false
        warning = $warning
      }
    }
  }

  if ($driveRoots.Count -eq 0) {
    try {
      $attempt = Invoke-ShellEmptyRecycleBin
      $attempts += $attempt
      if ($attempt.ContainsKey('warning') -and $attempt.warning) {
        $warnings += $attempt.warning
      }
    }
    catch {
      $warning = "SHEmptyRecycleBin global fallback failed. $($_.Exception.Message)"
      $warnings += $warning
      $attempts += @{
        method = "SHEmptyRecycleBin"
        rootPath = $null
        ok = $false
        warning = $warning
      }
    }
  }

  $successCount = @($attempts | Where-Object { $_.ok }).Count
  if ($successCount -eq 0) {
    $fallback = Invoke-ClearRecycleBinFallback -DriveRoots $driveRoots
    $attempts += @($fallback.attempts)
    $warnings += @($fallback.warnings)
    $successCount = @($attempts | Where-Object { $_.ok }).Count
  }

  return @{
    method = "SHEmptyRecycleBin"
    driveRoots = $driveRoots
    attempts = $attempts
    warningCount = $warnings.Count
    warnings = $warnings
    successCount = $successCount
    noOp = $successCount -eq 0
  }
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      $result = Invoke-EmptyRecycleBin
      $message = if ($result.warningCount -gt 0) {
        "Recycle Bin cleanup completed with warnings"
      } elseif ($result.noOp) {
        "Recycle Bin was already empty or unavailable"
      } else {
        "Recycle Bin emptied"
      }

      Out-Result "Enabled" $message $result
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
