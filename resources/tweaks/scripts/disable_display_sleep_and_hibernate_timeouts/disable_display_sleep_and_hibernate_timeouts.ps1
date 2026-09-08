[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = "Disable Display, Sleep and Hibernate Timeouts"; status = $status; message = $message } | ConvertTo-Json -Compress
}

$SUB_SLEEP     = "238c9fa8-0aad-41ed-83f4-97be242c8f20"
$STANDBYIDLE   = "29f6c1db-86da-48c5-9fdb-f2b67b1f44da"
$HIBERNATEIDLE = "9d7815a6-7ee4-497e-8888-515a05f02364"
$SUB_VIDEO     = "7516b95f-f776-4464-8c53-06167f40cc99"
$VIDEOIDLE     = "3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e"

# Fallback / Restore values (seconds)
$FallbackDisplayAC   = 900
$FallbackDisplayDC   = 300
$FallbackSleepAC     = 1800
$FallbackSleepDC     = 900
$FallbackHibernateAC = 10800
$FallbackHibernateDC = 10800

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

function Get-PowerSettingCurrentIndices([string]$SubGroupGuid, [string]$SettingGuid) {
  $output = @(powercfg -query SCHEME_CURRENT $SubGroupGuid $SettingGuid)
  $values = @()

  foreach ($line in $output) {
    if ($line -match '0x([0-9a-fA-F]+)\s*$') {
      $values += [Convert]::ToInt32($Matches[1], 16)
    }
  }

  if ($values.Count -lt 2) {
    throw "Failed to read current power setting values for $SettingGuid."
  }

  [PSCustomObject]@{
    AC = [int]$values[$values.Count - 2]
    DC = [int]$values[$values.Count - 1]
  }
}

function Set-PowerSettingIndices(
  [string]$SubGroupGuid,
  [string]$SettingGuid,
  [int]$ACValue,
  [int]$DCValue
) {
  Invoke-PowerCfg -Arguments @(
    "-setacvalueindex", "SCHEME_CURRENT", $SubGroupGuid, $SettingGuid, [string]$ACValue
  )

  Invoke-PowerCfg -Arguments @(
    "-setdcvalueindex", "SCHEME_CURRENT", $SubGroupGuid, $SettingGuid, [string]$DCValue
  )
}

function Apply-CurrentPowerScheme {
  Invoke-PowerCfg -Arguments @("-setactive", "SCHEME_CURRENT")
}

function Get-CurrentTimeoutState {
  $display = Get-PowerSettingCurrentIndices -SubGroupGuid $SUB_VIDEO -SettingGuid $VIDEOIDLE
  $sleep   = Get-PowerSettingCurrentIndices -SubGroupGuid $SUB_SLEEP -SettingGuid $STANDBYIDLE
  $hiber   = Get-PowerSettingCurrentIndices -SubGroupGuid $SUB_SLEEP -SettingGuid $HIBERNATEIDLE

  [PSCustomObject]@{
    DisplayAC   = [int]$display.AC
    DisplayDC   = [int]$display.DC
    SleepAC     = [int]$sleep.AC
    SleepDC     = [int]$sleep.DC
    HibernateAC = [int]$hiber.AC
    HibernateDC = [int]$hiber.DC
  }
}

function Set-TimeoutState(
  [int]$DisplayAC,
  [int]$DisplayDC,
  [int]$SleepAC,
  [int]$SleepDC,
  [int]$HibernateAC,
  [int]$HibernateDC
) {
  Set-PowerSettingIndices -SubGroupGuid $SUB_VIDEO -SettingGuid $VIDEOIDLE    -ACValue $DisplayAC   -DCValue $DisplayDC
  Set-PowerSettingIndices -SubGroupGuid $SUB_SLEEP -SettingGuid $STANDBYIDLE   -ACValue $SleepAC     -DCValue $SleepDC
  Set-PowerSettingIndices -SubGroupGuid $SUB_SLEEP -SettingGuid $HIBERNATEIDLE -ACValue $HibernateAC -DCValue $HibernateDC

  Apply-CurrentPowerScheme
}

try {
  switch ($State) {

    'Check' {
      $current = Get-CurrentTimeoutState

      $isDisabled =
        ($current.DisplayAC -eq 0) -and
        ($current.DisplayDC -eq 0) -and
        ($current.SleepAC -eq 0) -and
        ($current.SleepDC -eq 0) -and
        ($current.HibernateAC -eq 0) -and
        ($current.HibernateDC -eq 0)

      if ($isDisabled) {
        Out-Result "Enabled"
      }
      else {
        Out-Result "Disabled"
      }
    }

    'On' {
      Set-TimeoutState `
        -DisplayAC 0 `
        -DisplayDC 0 `
        -SleepAC 0 `
        -SleepDC 0 `
        -HibernateAC 0 `
        -HibernateDC 0

      Out-Result "Enabled"
    }

    'Off' {
      Set-TimeoutState `
        -DisplayAC $FallbackDisplayAC `
        -DisplayDC $FallbackDisplayDC `
        -SleepAC $FallbackSleepAC `
        -SleepDC $FallbackSleepDC `
        -HibernateAC $FallbackHibernateAC `
        -HibernateDC $FallbackHibernateDC

      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
