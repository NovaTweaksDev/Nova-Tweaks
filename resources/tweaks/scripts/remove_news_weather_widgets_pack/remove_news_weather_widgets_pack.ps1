[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Remove News / Weather / Widgets Pack"; status = $status; message = $message } | ConvertTo-Json -Compress
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$Patterns = @(
  '*BingNews*',
  '*MicrosoftNews*',
  '*BingWeather*',
  '*Client.WebExperience*'
)

function Test-Match([string]$value, [string[]]$patterns) {
  foreach ($pattern in $patterns) {
    if ($value -like $pattern) {
      return $true
    }
  }

  return $false
}

function Get-InstalledMatches([string[]]$patterns) {
  try {
    $packages = if (Test-IsAdministrator) {
      Get-AppxPackage -AllUsers -ErrorAction Stop
    }
    else {
      Get-AppxPackage -ErrorAction Stop
    }
  }
  catch {
    return @()
  }

  $matches = foreach ($pkg in $packages) {
    if (Test-Match $pkg.Name $patterns) {
      $pkg
    }
  }

  return $matches | Sort-Object PackageFullName -Unique
}

function Get-ProvisionedMatches([string[]]$patterns) {
  if (-not (Test-IsAdministrator)) {
    return @()
  }

  try {
    $packages = Get-AppxProvisionedPackage -Online -ErrorAction Stop
  }
  catch {
    return @()
  }

  $matches = foreach ($pkg in $packages) {
    if ((Test-Match $pkg.DisplayName $patterns) -or (Test-Match $pkg.PackageName $patterns)) {
      $pkg
    }
  }

  return $matches | Sort-Object PackageName -Unique
}

try {
  switch ($State) {
    'Check' {
      $installedCount = @(Get-InstalledMatches -patterns $Patterns).Count
      $provisionedCount = @(Get-ProvisionedMatches -patterns $Patterns).Count
      $totalCount = $installedCount + $provisionedCount

      if ($totalCount -eq 0) {
        Out-Result "Enabled" "No matching news, weather, or widgets packages were found"
      }
      else {
        Out-Result "Disabled" "$totalCount matching package(s) detected"
      }

      exit 0
    }

    'Off' {
      Out-Result "Disabled" "Restore is not supported for this one-shot action"
      exit 0
    }
  }

  if (-not (Test-IsAdministrator)) {
    throw "Administrator privileges are required to remove news, weather, and widgets packages."
  }

  $removedInstalled = 0
  $removedProvisioned = 0
  $errors = New-Object System.Collections.Generic.List[string]

  $installed = Get-InstalledMatches -patterns $Patterns
  foreach ($pkg in $installed) {
    try {
      Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop
      $removedInstalled++
    }
    catch {
      try {
        Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
        $removedInstalled++
      }
      catch {
        $errors.Add("$($pkg.Name): $($_.Exception.Message)")
      }
    }
  }

  $provisioned = Get-ProvisionedMatches -patterns $Patterns
  foreach ($pkg in $provisioned) {
    try {
      Remove-AppxProvisionedPackage -Online -PackageName $pkg.PackageName -ErrorAction Stop | Out-Null
      $removedProvisioned++
    }
    catch {
      $errors.Add("$($pkg.DisplayName): $($_.Exception.Message)")
    }
  }

  $totalRemoved = $removedInstalled + $removedProvisioned

  if ($totalRemoved -eq 0 -and $errors.Count -gt 0) {
    throw ($errors -join ' | ')
  }

  if ($totalRemoved -eq 0) {
    Out-Result "Enabled" "No matching news, weather, or widgets packages were found"
  }
  elseif ($errors.Count -gt 0) {
    Out-Result "Enabled" "Removed $removedInstalled installed package(s) and $removedProvisioned provisioned package(s). Some entries could not be removed."
  }
  else {
    Out-Result "Enabled" "Removed $removedInstalled installed package(s) and $removedProvisioned provisioned package(s)"
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
