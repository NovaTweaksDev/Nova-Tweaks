[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status,[string]$message="") {
  @{ tweak="Disable CPU Core Parking"; status=$status; message=$message } | ConvertTo-Json -Compress
}

$SUB_PROCESSOR = "54533251-82be-4824-96c1-47b60b740d00"
$CORE_PARK_MIN = "0cc5b647-c1df-4637-891a-dec35c318583"

# ================= Helpers =================

function Get-CoreParking {

  $out = powercfg -query SCHEME_CURRENT $SUB_PROCESSOR $CORE_PARK_MIN | Out-String

  $match = [regex]::Match($out,'Current AC Power Setting Index:\s+0x([0-9a-f]+)','IgnoreCase')

  if ($match.Success) {
    return [convert]::ToInt32($match.Groups[1].Value,16)
  }

  throw "Unable to determine Core Parking value."
}

function Set-CoreParking([int]$Value) {

  powercfg -setacvalueindex SCHEME_CURRENT $SUB_PROCESSOR $CORE_PARK_MIN $Value | Out-Null
  powercfg -setdcvalueindex SCHEME_CURRENT $SUB_PROCESSOR $CORE_PARK_MIN $Value | Out-Null

  powercfg -setactive SCHEME_CURRENT | Out-Null
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $value = Get-CoreParking

      if ($value -eq 100) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-CoreParking 100

      Out-Result "Enabled"
    }

    'Off' {

      Set-CoreParking 10

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
