[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Fixed Pagefile Size"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$Pagefile = "C:\pagefile.sys"

# ================= Helpers =================

function Get-RecommendedPagefileSize {
  $totalRamBytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
  $totalRamGB    = [math]::Round($totalRamBytes / 1GB, 0)

  [uint32]$initialMB = 0
  [uint32]$maximumMB = 0

  if ($totalRamGB -le 8) {
    $initialMB = 12288
    $maximumMB = 12288
  }
  elseif ($totalRamGB -le 16) {
    $initialMB = 8192
    $maximumMB = 8192
  }
  elseif ($totalRamGB -le 32) {
    $initialMB = 4096
    $maximumMB = 4096
  }
  else {
    $initialMB = 2048
    $maximumMB = 2048
  }

  [PSCustomObject]@{
    TotalRamGB = [int]$totalRamGB
    InitialMB  = [uint32]$initialMB
    MaximumMB  = [uint32]$maximumMB
  }
}

function Get-PagefileState {
  $computerSystem = Get-CimInstance Win32_ComputerSystem
  $settings       = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue

  $target = $settings | Where-Object { $_.Name -eq $Pagefile }

  [PSCustomObject]@{
    AutomaticManaged = [bool]$computerSystem.AutomaticManagedPagefile
    Exists           = ($null -ne $target)
    InitialSize      = if ($null -ne $target) { [uint32]$target.InitialSize } else { $null }
    MaximumSize      = if ($null -ne $target) { [uint32]$target.MaximumSize } else { $null }
  }
}

function Set-FixedPagefile([string]$PagefilePath, [uint32]$InitialSizeMB, [uint32]$MaximumSizeMB) {
  $computerSystem = Get-CimInstance Win32_ComputerSystem
  $computerSystem.AutomaticManagedPagefile = $false
  $null = Set-CimInstance -InputObject $computerSystem

  $existing = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $PagefilePath }

  if ($null -eq $existing) {
    $null = New-CimInstance -ClassName Win32_PageFileSetting -Property @{
      Name        = $PagefilePath
      InitialSize = $InitialSizeMB
      MaximumSize = $MaximumSizeMB
    }
  }
  else {
    $existing.InitialSize = $InitialSizeMB
    $existing.MaximumSize = $MaximumSizeMB
    $null = Set-CimInstance -InputObject $existing
  }
}

function Set-SystemManagedPagefile {
  $existing = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue

  if ($null -ne $existing) {
    $existing | Remove-CimInstance
  }

  $computerSystem = Get-CimInstance Win32_ComputerSystem
  $computerSystem.AutomaticManagedPagefile = $true
  $null = Set-CimInstance -InputObject $computerSystem
}

# ================= Execution =================

try {
  $recommended = Get-RecommendedPagefileSize

  switch ($State) {

    'Check' {
      $current = Get-PagefileState

      $isFixedConfigured =
        (-not $current.AutomaticManaged) -and
        $current.Exists -and
        ($current.InitialSize -eq $recommended.InitialMB) -and
        ($current.MaximumSize -eq $recommended.MaximumMB)

      if ($isFixedConfigured) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-FixedPagefile -PagefilePath $Pagefile -InitialSizeMB $recommended.InitialMB -MaximumSizeMB $recommended.MaximumMB

      Out-Result "Enabled" "Reboot recommended"
    }

    'Off' {
      Set-SystemManagedPagefile

      Out-Result "Disabled" "Reboot recommended"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
