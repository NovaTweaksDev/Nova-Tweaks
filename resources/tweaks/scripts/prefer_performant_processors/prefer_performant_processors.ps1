[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Prefer Performant Processors"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$SubGroup = "SUB_PROCESSOR"
$Setting  = "SCHEDPOLICY"

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
    return $null
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
      if ($null -eq $current) {
        Out-Result "Disabled" "Processor scheduling policy is not available on this system or power plan."
      }
      elseif (($current.AC -eq 2) -and ($current.DC -eq 2)) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-SettingValue 2
      Out-Result "Enabled"
    }

    'Off' {
      Set-SettingValue 5
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
