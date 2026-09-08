[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Insider Preview Builds"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$windowsUpdatePolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
$previewBuildsPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PreviewBuilds"

$managePreviewBuildsName = "ManagePreviewBuilds"
$branchReadinessLevelName = "BranchReadinessLevel"
$allowBuildPreviewName = "AllowBuildPreview"

# ManagePreviewBuilds:
# 0 = Disable Preview builds
# 1 = Disable Preview builds once the next release is public
# 2 = Enable Preview builds
# 3 = User selection / default

# BranchReadinessLevel:
# 2  = Insider Canary / Fast-style prerelease channel
# 4  = Insider Dev / Slow-style prerelease channel
# 8  = Insider Release Preview channel
# 32 = General Availability Channel

# Legacy AllowBuildPreview:
# 0 = Not allowed
# 1 = Allowed
# 2 = Not configured / default

# ================= Helpers =================

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Value([string]$Path, [string]$Name) {

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
  }
  catch {
    return $null
  }
}

function Set-DWord([string]$Path, [string]$Name, [int]$Value) {

  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty `
    -Path $Path `
    -Name $Name `
    -Value $Value `
    -PropertyType DWord `
    -Force | Out-Null
}

function Remove-Value([string]$Path, [string]$Name) {

  if (Test-Path $Path) {
    try {
      Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
    }
    catch {}
  }
}

function Get-PolicyValueText([object]$Value) {
  if ($null -eq $Value) {
    return "not configured"
  }

  return [string]$Value
}

function Test-InsiderChannelConfigured {
  $branchValue = Get-Value $windowsUpdatePolicyPath $branchReadinessLevelName

  if ($null -eq $branchValue) {
    return $false
  }

  return (@(2, 4, 8) -contains [int]$branchValue)
}

function Test-InsiderPreviewBuildsDisabled {
  $managePreviewBuilds = Get-Value $windowsUpdatePolicyPath $managePreviewBuildsName
  $allowBuildPreview = Get-Value $previewBuildsPolicyPath $allowBuildPreviewName

  $modernPolicyDisabled = ($managePreviewBuilds -eq 0)
  $legacyPolicyDisabled = ($allowBuildPreview -eq 0)
  $insiderChannelConfigured = Test-InsiderChannelConfigured

  return (($modernPolicyDisabled -or $legacyPolicyDisabled) -and (-not $insiderChannelConfigured))
}

function Get-InsiderPreviewStateMessage {
  $managePreviewBuilds = Get-Value $windowsUpdatePolicyPath $managePreviewBuildsName
  $branchReadinessLevel = Get-Value $windowsUpdatePolicyPath $branchReadinessLevelName
  $allowBuildPreview = Get-Value $previewBuildsPolicyPath $allowBuildPreviewName

  $manageText = Get-PolicyValueText $managePreviewBuilds
  $branchText = Get-PolicyValueText $branchReadinessLevel
  $legacyText = Get-PolicyValueText $allowBuildPreview

  return "$managePreviewBuildsName=$manageText, $branchReadinessLevelName=$branchText, $allowBuildPreviewName=$legacyText"
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      if (Test-InsiderPreviewBuildsDisabled) {
        Out-Result "Enabled" "Insider Preview builds are disabled by policy. $(Get-InsiderPreviewStateMessage)"
      }
      else {
        Out-Result "Disabled" "Insider Preview builds are not fully disabled by this tweak. $(Get-InsiderPreviewStateMessage)"
      }
    }

    'On' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to disable Insider Preview builds."
      }

      Set-DWord $windowsUpdatePolicyPath $managePreviewBuildsName 0
      Set-DWord $windowsUpdatePolicyPath $branchReadinessLevelName 32
      Set-DWord $previewBuildsPolicyPath $allowBuildPreviewName 0

      if (Test-InsiderPreviewBuildsDisabled) {
        Out-Result "Enabled" "Insider Preview builds have been disabled and the stable General Availability channel has been selected."
      }
      else {
        Out-Result "Disabled" "The policies were written, but verification failed. $(Get-InsiderPreviewStateMessage)"
      }
    }

    'Off' {

      if (-not (Test-IsAdministrator)) {
        throw "Administrator privileges are required to restore Insider Preview build settings."
      }

      Remove-Value $windowsUpdatePolicyPath $managePreviewBuildsName
      Remove-Value $windowsUpdatePolicyPath $branchReadinessLevelName
      Remove-Value $previewBuildsPolicyPath $allowBuildPreviewName

      if (Test-InsiderPreviewBuildsDisabled) {
        Out-Result "Enabled" "Insider Preview build policies still appear to be enforced. A system, domain, or MDM policy may be controlling this setting. $(Get-InsiderPreviewStateMessage)"
      }
      else {
        Out-Result "Disabled" "Insider Preview build settings have been restored to Windows default behavior."
      }
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
