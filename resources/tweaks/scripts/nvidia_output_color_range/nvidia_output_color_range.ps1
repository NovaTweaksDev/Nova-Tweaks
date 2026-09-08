[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [string]$Selection = '',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'NVIDIA Output Color Range'
$ExpectedHelperSha256 = '442591A2A83667E078878B6F819CC079E4B213A5BA6169467D0AF190D6A41CB0'
$StateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nova Tweaks\state'
$StatePath = Join-Path $StateDirectory 'nvidia_output_color_range.json'

function Out-Result([string]$Status, [string]$Message = '', [hashtable]$Details = @{}) {
  @{
    tweak = $TweakName
    status = $Status
    message = $Message
    details = $Details
  } | ConvertTo-Json -Compress
}

function Resolve-HelperPath {
  $candidateList = New-Object 'System.Collections.Generic.List[string]'

  function Add-HelperCandidate([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
      return
    }

    try {
      $resolved = [System.IO.Path]::GetFullPath($PathValue)
      if (-not $candidateList.Contains($resolved)) {
        [void]$candidateList.Add($resolved)
      }
    }
    catch {
      # Ignore malformed optional paths.
    }
  }

  foreach ($root in @(
    $env:NOVA_TWEAKS_RESOURCES_PATH,
    $env:NOVA_TWEAKS_APP_PATH,
    $env:NOVA_TWEAKS_BACKEND_ROOT
  )) {
    if ([string]::IsNullOrWhiteSpace($root)) {
      continue
    }

    Add-HelperCandidate (Join-Path $root 'tools\nvidia-display-helper\bin\nvidia-display-helper.exe')
    Add-HelperCandidate (Join-Path $root 'resources\tools\nvidia-display-helper\bin\nvidia-display-helper.exe')
  }

  foreach ($root in @(
    (Join-Path $PSScriptRoot '..\..\..\Nova-Tweaks'),
    (Join-Path $PSScriptRoot '..\..\..'),
    (Join-Path $PSScriptRoot '..\..\..\..')
  )) {
    Add-HelperCandidate (Join-Path $root 'tools\nvidia-display-helper\bin\nvidia-display-helper.exe')
    Add-HelperCandidate (Join-Path $root 'resources\tools\nvidia-display-helper\bin\nvidia-display-helper.exe')
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    foreach ($appDir in @('Nova Tweaks', 'nova-tweaks')) {
      Add-HelperCandidate (Join-Path $env:LOCALAPPDATA "Programs\$appDir\resources\tools\nvidia-display-helper\bin\nvidia-display-helper.exe")
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    Add-HelperCandidate (Join-Path $env:ProgramFiles 'Nova Tweaks\resources\tools\nvidia-display-helper\bin\nvidia-display-helper.exe')
  }

  foreach ($candidate in $candidateList.ToArray()) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $actualSha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToUpperInvariant()
      if ($actualSha256 -eq $ExpectedHelperSha256) {
        return $candidate
      }
    }
  }

  throw 'A trusted nvidia-display-helper.exe was not found.'
}

function Invoke-DisplayHelper([string]$HelperPath, [string[]]$Arguments) {
  $output = @(& $HelperPath @Arguments 2>&1)
  $exitCode = $LASTEXITCODE
  $lines = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })

  if ($exitCode -ne 0) {
    $message = if ($lines.Count -gt 0) { $lines[-1] } else { "Helper failed with exit code $exitCode." }
    throw $message
  }

  $jsonLine = @($lines | Where-Object { $_.StartsWith('{') }) | Select-Object -Last 1
  if (-not $jsonLine) {
    throw 'The NVIDIA display helper returned no structured result.'
  }

  return $jsonLine | ConvertFrom-Json
}

function Resolve-Selection([string]$Value) {
  switch ($Value.Trim().ToLowerInvariant()) {
    'auto' { return 'Auto' }
    'full' { return 'Full' }
    'limited' { return 'Limited' }
    default { throw 'Selection must be Auto, Full, or Limited.' }
  }
}

function Convert-SelectionToHelperValue([string]$Value) {
  $resolved = Resolve-Selection $Value
  if ($resolved -eq 'Auto') {
    throw 'Auto cannot be applied through the public NVIDIA color-control API on this driver. Use "Use default color settings" in NVIDIA Control Panel.'
  }
  return $resolved.ToLowerInvariant()
}

function Save-OriginalState($Current) {
  if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
    return
  }

  New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
  $temporaryPath = "$StatePath.tmp"
  @{
    display = [string]$Current.display
    displayId = [uint32]$Current.displayId
    value = Resolve-Selection ([string]$Current.value)
    selectionPolicy = [string]$Current.selectionPolicy
    capturedAt = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
}

function Get-ColorDetails($Current) {
  return @{
    selectedOption = Resolve-Selection ([string]$Current.value)
    display = [string]$Current.display
    displayId = [uint32]$Current.displayId
    selectionPolicy = [string]$Current.selectionPolicy
  }
}

try {
  $helperPath = Resolve-HelperPath

  switch ($State) {
    'Check' {
      $current = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
        'get-output-color-range',
        '--display',
        'primary'
      )
      Out-Result 'Enabled' '' (Get-ColorDetails $current)
    }

    'On' {
      $resolvedSelection = Resolve-Selection $Selection
      $current = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
        'get-output-color-range',
        '--display',
        'primary'
      )
      if ((Resolve-Selection ([string]$current.value)) -eq $resolvedSelection) {
        $applied = $current
      }
      else {
        Save-OriginalState -Current $current
        $applied = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
          'set-output-color-range',
          '--display',
          'primary',
          '--value',
          (Convert-SelectionToHelperValue $resolvedSelection)
        )
      }
      Out-Result 'Enabled' '' (Get-ColorDetails $applied)
    }

    'Off' {
      $current = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
        'get-output-color-range',
        '--display',
        'primary'
      )
      $hasSavedState = Test-Path -LiteralPath $StatePath -PathType Leaf

      if (-not $hasSavedState) {
        if ((Resolve-Selection ([string]$current.value)) -ne 'Auto') {
          throw 'No original output color range was captured. Select the desired range explicitly.'
        }
        $restored = $current
        $restoreSource = 'unchangedAutomaticState'
      }
      else {
        $saved = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        if (-not ($saved.PSObject.Properties.Name -contains 'value')) {
          throw 'The captured NVIDIA output color state is invalid.'
        }

        $restoreSelection = Resolve-Selection ([string]$saved.value)
        $restorePolicy = if ($saved.PSObject.Properties.Name -contains 'selectionPolicy') {
          [string]$saved.selectionPolicy
        }
        else {
          ''
        }

        if ($restoreSelection -eq 'Auto' -or $restorePolicy -eq 'BestQuality') {
          throw 'The original NVIDIA BestQuality/Auto policy cannot be restored through the public NVIDIA color-control API on this driver. Select "Use default color settings" in NVIDIA Control Panel.'
        }

        $currentSelection = Resolve-Selection ([string]$current.value)
        if ($currentSelection -eq $restoreSelection -and [string]$current.selectionPolicy -eq 'User') {
          $restored = $current
        }
        else {
          $restored = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
            'set-output-color-range',
            '--display',
            'primary',
            '--value',
            (Convert-SelectionToHelperValue $restoreSelection)
          )
        }
        $restoreSource = 'capturedOriginal'
      }

      if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
        Remove-Item -LiteralPath $StatePath -Force
      }

      $details = Get-ColorDetails $restored
      $details.restoreSource = $restoreSource
      Out-Result 'Disabled' '' $details
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message @{
    code = 'NVIDIA_OUTPUT_COLOR_RANGE_FAILED'
    selectedOption = ''
  }
  exit 1
}
