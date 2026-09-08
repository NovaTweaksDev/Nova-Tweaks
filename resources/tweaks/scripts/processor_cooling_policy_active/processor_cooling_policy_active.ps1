[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Processor Cooling Policy (Active)"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$SubGroup = "SUB_PROCESSOR"
$Setting  = "94d3a615-a899-4ac5-ae2b-e4d8f634367f"

function Invoke-PowerCfg {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & powercfg @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "powercfg failed (exit code $LASTEXITCODE): powercfg $($Arguments -join ' ')"
  }
}

function Get-SettingValue {
  $output = @(powercfg -query SCHEME_CURRENT $SubGroup $Setting)
  $values = @()

  foreach ($line in $output) {
    if ($line -match '0x([0-9a-fA-F]+)\s*$') {
      $values += [Convert]::ToInt32($Matches[1], 16)
    }
  }

  if ($values.Count -lt 2) {
    throw "Failed to read Processor Cooling Policy values."
  }

  [PSCustomObject]@{
    AC = [int]$values[$values.Count - 2]
    DC = [int]$values[$values.Count - 1]
  }
}

function Set-SettingValue([int]$Value) {
  Invoke-PowerCfg -Arguments @("-setacvalueindex", "SCHEME_CURRENT", $SubGroup, $Setting, [string]$Value)
  Invoke-PowerCfg -Arguments @("-setdcvalueindex", "SCHEME_CURRENT", $SubGroup, $Setting, [string]$Value)
  Invoke-PowerCfg -Arguments @("-setactive", "SCHEME_CURRENT")
}

try {
  switch ($State) {
    'Check' {
      $current = Get-SettingValue
      if (($current.AC -eq 1) -and ($current.DC -eq 1)) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-SettingValue 1
      Out-Result "Enabled"
    }

    'Off' {
      Set-SettingValue 0
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
