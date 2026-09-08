[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable PCIe Link State Power Management"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$SUBGROUP = "SUB_PCIEXPRESS"
$SETTING  = "ASPM"

function Get-PCIeLinkState {
  $out = powercfg -query SCHEME_CURRENT $SUBGROUP $SETTING | Out-String

  $match = [regex]::Match($out, 'Current AC Power Setting Index:\s+0x([0-9a-f]+)', 'IgnoreCase')
  if ($match.Success) {
    return [Convert]::ToInt32($match.Groups[1].Value, 16)
  }

  throw "Unable to determine PCIe Link State Power Management value."
}

function Set-PCIeLinkState([int]$Value) {
  powercfg -setacvalueindex SCHEME_CURRENT $SUBGROUP $SETTING $Value | Out-Null
  powercfg -setdcvalueindex SCHEME_CURRENT $SUBGROUP $SETTING $Value | Out-Null
  powercfg -setactive SCHEME_CURRENT | Out-Null
}

try {
  switch ($State) {

    'Check' {
      $value = Get-PCIeLinkState

      if ($value -eq 0) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-PCIeLinkState 0
      Out-Result "Enabled"
    }

    'Off' {
      Set-PCIeLinkState 1
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
