[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off')]
  [string]$State = 'Check',
  [ValidateSet('Maps only', 'Mixed Reality only', '3D apps only', 'All listed apps')]
  [string]$Selection = 'All listed apps',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Remove Legacy Microsoft Apps Pack'
$DefaultSelection = 'All listed apps'
$MarkerPath = 'HKCU:\Software\NovaTweaks\OneShotSelections'
$MarkerName = 'removelegacymicrosoftappspack'

function Out-Result([string]$Status, [string]$Message = '', [hashtable]$Details = @{}) {
  @{
    tweak = $TweakName
    status = $Status
    message = $Message
    details = $Details
  } | ConvertTo-Json -Compress -Depth 8
}

function Test-Match([string]$Value, [string[]]$Patterns) {
  foreach ($pattern in $Patterns) {
    if ($Value -like $pattern) {
      return $true
    }
  }

  return $false
}

function Get-SelectionPatterns([string]$ModeSelection) {
  switch ($ModeSelection) {
    'Maps only' {
      return @(
        '*WindowsMaps*'
      )
    }

    'Mixed Reality only' {
      return @(
        '*MixedReality*'
      )
    }

    '3D apps only' {
      return @(
        '*MSPaint*',
        '*3DBuilder*',
        '*Print3D*',
        '*View3D*'
      )
    }

    'All listed apps' {
      return @(
        '*WindowsMaps*',
        '*MixedReality*',
        '*MSPaint*',
        '*3DBuilder*',
        '*Print3D*',
        '*View3D*'
      )
    }
  }
}

function Get-InstalledMatches([string[]]$Patterns) {
  $packages = Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue
  $matches = foreach ($pkg in $packages) {
    if (Test-Match -Value $pkg.Name -Patterns $Patterns) {
      $pkg
    }
  }

  return @($matches | Sort-Object PackageFullName -Unique)
}

function Get-ProvisionedMatches([string[]]$Patterns) {
  $packages = Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue
  $matches = foreach ($pkg in $packages) {
    if ((Test-Match -Value $pkg.DisplayName -Patterns $Patterns) -or (Test-Match -Value $pkg.PackageName -Patterns $Patterns)) {
      $pkg
    }
  }

  return @($matches | Sort-Object PackageName -Unique)
}

function Ensure-MarkerKey {
  if (-not (Test-Path -Path $MarkerPath)) {
    New-Item -Path $MarkerPath -Force | Out-Null
  }
}

function Set-SelectionMarker([string]$SelectedOption) {
  Ensure-MarkerKey
  New-ItemProperty -Path $MarkerPath -Name $MarkerName -PropertyType String -Value $SelectedOption -Force | Out-Null
}

function Get-SelectionMarker {
  if (-not (Test-Path -Path $MarkerPath)) {
    return ''
  }

  try {
    $value = Get-ItemPropertyValue -Path $MarkerPath -Name $MarkerName -ErrorAction Stop
    $normalized = [string]$value
    if ([string]::IsNullOrWhiteSpace($normalized)) {
      return ''
    }
    return $normalized.Trim()
  } catch {
    return ''
  }
}

function Clear-SelectionMarker {
  if (-not (Test-Path -Path $MarkerPath)) {
    return
  }

  try {
    Remove-ItemProperty -Path $MarkerPath -Name $MarkerName -ErrorAction Stop
  } catch {
    # Marker may not exist. Ignore.
  }
}

function Build-SelectionDetails([string]$SelectedOption, [hashtable]$Extra = @{}) {
  return @{
    selectedOption = $SelectedOption
    selected_option = $SelectedOption
    selection = $SelectedOption
    extra = $Extra
  }
}

function Invoke-Removal([string]$ModeSelection) {
  $patterns = Get-SelectionPatterns -ModeSelection $ModeSelection
  $removedInstalled = 0
  $removedProvisioned = 0
  $errors = New-Object System.Collections.Generic.List[string]

  $installed = Get-InstalledMatches -Patterns $patterns
  foreach ($pkg in $installed) {
    try {
      Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop
      $removedInstalled += 1
    } catch {
      try {
        Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
        $removedInstalled += 1
      } catch {
        $errors.Add("$($pkg.Name): $($_.Exception.Message)")
      }
    }
  }

  $provisioned = Get-ProvisionedMatches -Patterns $patterns
  foreach ($pkg in $provisioned) {
    try {
      Remove-AppxProvisionedPackage -Online -PackageName $pkg.PackageName -ErrorAction Stop | Out-Null
      $removedProvisioned += 1
    } catch {
      $errors.Add("$($pkg.DisplayName): $($_.Exception.Message)")
    }
  }

  return @{
    selection = $ModeSelection
    removed_installed = $removedInstalled
    removed_provisioned = $removedProvisioned
    total_removed = ($removedInstalled + $removedProvisioned)
    errors = @($errors)
  }
}

try {
  switch ($State) {
    'Check' {
      $storedSelection = Get-SelectionMarker
      if ([string]::IsNullOrWhiteSpace($storedSelection)) {
        Out-Result 'Disabled' '' (Build-SelectionDetails -SelectedOption '' -Extra @{
          has_marker = $false
          default_selection = $DefaultSelection
        })
      } else {
        Out-Result 'Enabled' '' (Build-SelectionDetails -SelectedOption $storedSelection -Extra @{
          has_marker = $true
        })
      }
      exit 0
    }

    'On' {
      $result = Invoke-Removal -ModeSelection $Selection
      $totalRemoved = [int]$result.total_removed
      $errors = @($result.errors)
      $hadErrors = $errors.Count -gt 0

      if ($totalRemoved -eq 0 -and $hadErrors) {
        throw ($errors -join ' | ')
      }

      Set-SelectionMarker -SelectedOption $Selection

      if ($totalRemoved -eq 0) {
        Out-Result 'Enabled' "No matching packages were found for selection: $Selection" (Build-SelectionDetails -SelectedOption $Selection -Extra $result)
      } elseif ($hadErrors) {
        Out-Result 'Enabled' "Selection '$Selection' removed $($result.removed_installed) installed package(s) and $($result.removed_provisioned) provisioned package(s). Some entries could not be removed." (Build-SelectionDetails -SelectedOption $Selection -Extra $result)
      } else {
        Out-Result 'Enabled' "Selection '$Selection' removed $($result.removed_installed) installed package(s) and $($result.removed_provisioned) provisioned package(s)." (Build-SelectionDetails -SelectedOption $Selection -Extra $result)
      }

      exit 0
    }

    'Off' {
      Clear-SelectionMarker
      Out-Result 'Disabled' 'Selection marker reset. Removed packages cannot be restored by this tweak.' (Build-SelectionDetails -SelectedOption '' -Extra @{
        reset = $true
      })
      exit 0
    }
  }
} catch {
  Out-Result 'Error' $_.Exception.Message (Build-SelectionDetails -SelectedOption '' -Extra @{
    failed_state = $State
  })
  exit 1
}
