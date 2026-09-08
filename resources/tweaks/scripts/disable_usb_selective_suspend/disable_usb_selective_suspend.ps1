[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable USB Selective Suspend"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$SUB_USB            = "2a737441-1930-4402-8d77-b2bebba308a3"
$USB_SELECTIVE_SUSP = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226"

function Invoke-PowerCfg {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & powercfg @Arguments | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "powercfg failed (exit code $LASTEXITCODE): powercfg $($Arguments -join ' ')"
  }
}

function Get-USBSelectiveSuspendValue {
  $output = @(powercfg -query SCHEME_CURRENT $SUB_USB $USB_SELECTIVE_SUSP)
  $values = @()

  foreach ($line in $output) {
    if ($line -match '0x([0-9a-fA-F]+)\s*$') {
      $values += [Convert]::ToInt32($Matches[1], 16)
    }
  }

  if ($values.Count -lt 2) {
    throw "Failed to read USB Selective Suspend values."
  }

  [PSCustomObject]@{
    AC = [int]$values[$values.Count - 2]
    DC = [int]$values[$values.Count - 1]
  }
}

function Set-USBSelectiveSuspend([int]$Value) {
  Invoke-PowerCfg -Arguments @(
    "-setacvalueindex", "SCHEME_CURRENT", $SUB_USB, $USB_SELECTIVE_SUSP, [string]$Value
  )

  Invoke-PowerCfg -Arguments @(
    "-setdcvalueindex", "SCHEME_CURRENT", $SUB_USB, $USB_SELECTIVE_SUSP, [string]$Value
  )

  Invoke-PowerCfg -Arguments @("-setactive", "SCHEME_CURRENT")
}

try {
  switch ($State) {

    'Check' {
      $current = Get-USBSelectiveSuspendValue

      if (($current.AC -eq 0) -and ($current.DC -eq 0)) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-USBSelectiveSuspend -Value 0
      Out-Result "Enabled"
    }

    'Off' {
      Set-USBSelectiveSuspend -Value 1
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
