[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = "Nova Tweaks Efficiency Power Plan"
$PlanName  = "Nova Tweaks Efficiency"

function Out-Result([string]$status, [string]$message = "") {
  @{ tweak = $TweakName; status = $status; message = $message } | ConvertTo-Json -Compress
}

$guidUltimate = "e9a42b02-d5df-448d-aa00-03f14749eb61"
$guidHigh     = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
$guidBalanced = "381b4222-f694-41f0-9685-ff5bb260df2e"

$SUB_PROCESSOR = "54533251-82be-4824-96c1-47b60b740d00"

$MIN_PROC    = "893dee8e-2bef-41e0-89c6-b55d0929964c"
$MAX_PROC    = "bc5038f7-23e0-4960-96da-33abaf5935ec"
$COOLING_POL = "94d3a615-a899-4ac5-ae2b-e4d8f634367f"
$BOOST_MODE  = "be337238-0d82-4146-a960-4f3749d470c7"
$EPP         = "36687f9e-e3a5-4dbf-b1dc-15eb381c6863"
$PARK_MIN    = "0cc5b647-c1df-4637-891a-dec35c318583"
$PARK_MAX    = "ea062031-0e34-4ff1-9b6d-eb1059334028"

$valMinProc = 5
$valMaxProc = 85
$valEpp     = 80
$valCooling = 0
$valBoost   = 1
$valParkMin = 10
$valParkMax = 50

function Get-ProcessorName {
  try {
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name
    if ([string]::IsNullOrWhiteSpace($cpu)) { return "Unknown Processor" }
    $clean = ($cpu -replace '\(R\)|\(TM\)|\(tm\)|\(r\)', '' -replace '\s+', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($clean)) { return "Unknown Processor" }
    return $clean
  }
  catch {
    return "Unknown Processor"
  }
}

function Get-PlanDescription {
  $cpuName = Get-ProcessorName
  return "$cpuName - Efficiency-focused profile with lower power usage, reduced heat output and improved idle behavior."
}

function Get-PlanSchemeGuid {
  $lines = powercfg /list
  foreach ($line in $lines) {
    $mName = [regex]::Match($line, '\((.+?)\)')
    if (-not $mName.Success) { continue }
    if ($mName.Groups[1].Value -ne $PlanName) { continue }
    $mGuid = [regex]::Match($line, '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', 'IgnoreCase')
    if ($mGuid.Success) { return $mGuid.Value }
  }
  return $null
}

function Get-ActiveSchemeGuid {
  $out = powercfg /getactivescheme | Out-String
  $m = [regex]::Match($out, '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', 'IgnoreCase')
  if ($m.Success) { return $m.Value }
  throw "Unable to determine active power scheme."
}

function Duplicate-Scheme([string]$baseGuid) {
  $out = powercfg -duplicatescheme $baseGuid | Out-String
  $m = [regex]::Match($out, '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', 'IgnoreCase')
  if (-not $m.Success) { throw "Could not parse duplicated scheme GUID." }
  return $m.Value
}

function Unhide-ProcessorAttributes {
  powercfg -attributes SUB_PROCESSOR $COOLING_POL -ATTRIB_HIDE | Out-Null
  powercfg -attributes SUB_PROCESSOR $BOOST_MODE  -ATTRIB_HIDE | Out-Null
  powercfg -attributes SUB_PROCESSOR $EPP         -ATTRIB_HIDE | Out-Null
  powercfg -attributes SUB_PROCESSOR $PARK_MIN    -ATTRIB_HIDE | Out-Null
  powercfg -attributes SUB_PROCESSOR $PARK_MAX    -ATTRIB_HIDE | Out-Null
}

function Apply-PlanSettings([string]$schemeGuid) {
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $MIN_PROC    $valMinProc | Out-Null
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $MAX_PROC    $valMaxProc | Out-Null
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $EPP         $valEpp     | Out-Null
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $COOLING_POL $valCooling | Out-Null
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $BOOST_MODE  $valBoost   | Out-Null
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $PARK_MIN    $valParkMin | Out-Null
  powercfg -setacvalueindex $schemeGuid $SUB_PROCESSOR $PARK_MAX    $valParkMax | Out-Null

  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $MIN_PROC    $valMinProc | Out-Null
  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $MAX_PROC    $valMaxProc | Out-Null
  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $EPP         $valEpp     | Out-Null
  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $COOLING_POL $valCooling | Out-Null
  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $BOOST_MODE  $valBoost   | Out-Null
  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $PARK_MIN    $valParkMin | Out-Null
  powercfg -setdcvalueindex $schemeGuid $SUB_PROCESSOR $PARK_MAX    $valParkMax | Out-Null
}

try {
  switch ($State) {
    'Check' {
      $active = Get-ActiveSchemeGuid
      $plan   = Get-PlanSchemeGuid
      if ($plan -and ($active -eq $plan)) { Out-Result "Enabled" } else { Out-Result "Disabled" }
    }

    'On' {
      $exists = Get-PlanSchemeGuid
      $planDescription = Get-PlanDescription

      if ($exists) {
        powercfg -changename $exists $PlanName $planDescription | Out-Null
        Unhide-ProcessorAttributes
        Apply-PlanSettings $exists
        powercfg /setactive $exists | Out-Null
      }
      else {
        $baseGuid = if (powercfg /list | Select-String -SimpleMatch $guidBalanced) { $guidBalanced } else { $guidHigh }
        $newGuid = Duplicate-Scheme $baseGuid

        powercfg -changename $newGuid $PlanName $planDescription | Out-Null
        Unhide-ProcessorAttributes
        Apply-PlanSettings $newGuid
        powercfg /setactive $newGuid | Out-Null
      }

      Out-Result "Enabled"
    }

    'Off' {
      powercfg /setactive $guidBalanced | Out-Null
      Out-Result "Disabled"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
