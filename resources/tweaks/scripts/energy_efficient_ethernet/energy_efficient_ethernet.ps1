[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status,[string]$message="") {
  @{ tweak="Energy Efficient Ethernet"; status=$status; message=$message } | ConvertTo-Json -Compress
}

$eeeDisplayNamePatterns = @(
  '^Energy Efficient Ethernet$',
  '^Energieeffizientes Ethernet$',
  '\bEEE\b'
)

$eeeOffValues = @('Off','Disabled','Aus','Deaktiviert')
$eeeOnValues  = @('On','Enabled','Ein','Aktiviert')

# ================= Helpers =================

function Get-EeeProperties {

  $props = Get-NetAdapterAdvancedProperty -Name "*" -ErrorAction SilentlyContinue

  $props | Where-Object {
    foreach ($pat in $eeeDisplayNamePatterns) {
      if ($_.DisplayName -match $pat) { return $true }
    }
    return $false
  }
}

function Get-EeeState {

  $targets = Get-EeeProperties

  if (-not $targets) {
    return "Unavailable"
  }

  foreach ($t in $targets) {
    if ($eeeOffValues -contains $t.DisplayValue) {
      return "Disabled"
    }
  }

  return "Enabled"
}

function Set-EeeState([string]$DesiredState) {

  $targets = Get-EeeProperties

  if (-not $targets) {
    throw "No Energy Efficient Ethernet property found."
  }

  foreach ($t in $targets) {

    $setValues = if ($DesiredState -eq "Off") { $eeeOffValues } else { $eeeOnValues }

    foreach ($v in $setValues) {
      try {
        Set-NetAdapterAdvancedProperty `
          -Name $t.Name `
          -DisplayName $t.DisplayName `
          -DisplayValue $v `
          -NoRestart `
          -ErrorAction Stop

        break
      }
      catch {}
    }
  }
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $eeeState = Get-EeeState

      if ($eeeState -eq "Disabled") {
        Out-Result "Enabled"
      }
      elseif ($eeeState -eq "Unavailable") {
        Out-Result "Disabled" "No Energy Efficient Ethernet property found."
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-EeeState "Off"

      Out-Result "Enabled"
    }

    'Off' {

      Set-EeeState "On"

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
