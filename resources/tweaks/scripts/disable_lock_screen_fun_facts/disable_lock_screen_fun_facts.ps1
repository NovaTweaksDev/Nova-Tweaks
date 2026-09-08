[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Lock Screen Fun Facts"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$ContentDeliveryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
$OverlayValueName = 'RotatingLockScreenOverlayEnabled'
$SubscribedContentValueName = 'SubscribedContent-338387Enabled'

function Get-DWordValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  $value = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $value) {
    return $null
  }

  return $value.$Name
}

function Set-DWordValue([string]$Path, [string]$Name, [int]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }

  New-ItemProperty -Path $Path -Name $Name -PropertyType DWord -Value $Value -Force | Out-Null
}

function Remove-DWordValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) {
    return
  }

  if (Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
  }
}

function Get-LockScreenFunFactsDisabled {
  $overlay = Get-DWordValue $ContentDeliveryPath $OverlayValueName
  $subscribedContent = Get-DWordValue $ContentDeliveryPath $SubscribedContentValueName

  return ([int]$overlay -eq 0) -and ([int]$subscribedContent -eq 0)
}

try {
  switch ($State) {
    'Check' {
      if (Get-LockScreenFunFactsDisabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-DWordValue $ContentDeliveryPath $OverlayValueName 0
      Set-DWordValue $ContentDeliveryPath $SubscribedContentValueName 0
      Out-Result "Enabled"
    }

    'Off' {
      Remove-DWordValue $ContentDeliveryPath $OverlayValueName
      Remove-DWordValue $ContentDeliveryPath $SubscribedContentValueName
      Out-Result "Disabled" "Default lock screen content behavior restored"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
