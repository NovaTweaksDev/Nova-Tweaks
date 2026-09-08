[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Minimum CPU State"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$SUB_PROCESSOR = "54533251-82be-4824-96c1-47b60b740d00"
$MIN_PROC      = "893dee8e-2bef-41e0-89c6-b55d0929964c"

# ================= Helpers =================

function Get-MinCpuState {

  $out = powercfg -query SCHEME_CURRENT $SUB_PROCESSOR $MIN_PROC | Out-String

  $match = [regex]::Match($out,'Current AC Power Setting Index:\s+0x([0-9a-f]+)','IgnoreCase')

  if ($match.Success) {
    return [convert]::ToInt32($match.Groups[1].Value,16)
  }

  throw "Unable to determine Minimum CPU State."
}

function Set-MinCpuState([int]$Value) {

  powercfg -setacvalueindex SCHEME_CURRENT $SUB_PROCESSOR $MIN_PROC $Value | Out-Null
  powercfg -setdcvalueindex SCHEME_CURRENT $SUB_PROCESSOR $MIN_PROC $Value | Out-Null

  powercfg -setactive SCHEME_CURRENT | Out-Null
}

# ================= Execution =================

try {

  switch ($State) {

    'Check' {

      $value = Get-MinCpuState

      if ($value -eq 100) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {

      Set-MinCpuState 100

      Out-Result "Enabled"
    }

    'Off' {

      Set-MinCpuState 5

      Out-Result "Disabled"
    }

  }

  exit 0
}
catch {

  Out-Result "Error" $_.Exception.Message
  exit 1
}
