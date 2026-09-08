[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [int]$Value = -1,
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'NVIDIA Digital Vibrance'
$ExpectedHelperSha256 = '442591A2A83667E078878B6F819CC079E4B213A5BA6169467D0AF190D6A41CB0'
$StateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nova Tweaks\state'
$StatePath = Join-Path $StateDirectory 'nvidia_digital_vibrance.json'

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

function Save-OriginalValue($Current) {
  if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
    return
  }

  New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
  $temporaryPath = "$StatePath.tmp"
  @{
    display = [string]$Current.display
    value = [int]$Current.value
    capturedAt = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
}

try {
  $helperPath = Resolve-HelperPath

  switch ($State) {
    'Check' {
      $current = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @('get-digital-vibrance', '--display', 'primary')
      Out-Result 'Enabled' '' @{
        currentValue = [int]$current.value
        defaultValue = [int]$current.defaultValue
        display = [string]$current.display
      }
    }

    'On' {
      if ($Value -lt 0 -or $Value -gt 100) {
        throw 'Value must be an integer from 0 through 100.'
      }

      $current = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @('get-digital-vibrance', '--display', 'primary')
      Save-OriginalValue -Current $current
      $applied = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
        'set-digital-vibrance',
        '--display',
        'primary',
        '--value',
        $Value.ToString([Globalization.CultureInfo]::InvariantCulture)
      )

      Out-Result 'Enabled' '' @{
        currentValue = [int]$applied.value
        defaultValue = [int]$applied.defaultValue
        display = [string]$applied.display
      }
    }

    'Off' {
      $current = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @('get-digital-vibrance', '--display', 'primary')
      $restoreValue = [int]$current.defaultValue
      $restoreSource = 'driverDefault'

      if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
        $saved = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        if ($null -ne $saved.value -and [int]$saved.value -ge 0 -and [int]$saved.value -le 100) {
          $restoreValue = [int]$saved.value
          $restoreSource = 'capturedOriginal'
        }
      }

      $restored = Invoke-DisplayHelper -HelperPath $helperPath -Arguments @(
        'set-digital-vibrance',
        '--display',
        'primary',
        '--value',
        $restoreValue.ToString([Globalization.CultureInfo]::InvariantCulture)
      )

      if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
        Remove-Item -LiteralPath $StatePath -Force
      }

      Out-Result 'Disabled' '' @{
        currentValue = [int]$restored.value
        defaultValue = [int]$restored.defaultValue
        display = [string]$restored.display
        restoreSource = $restoreSource
      }
    }
  }

  exit 0
}
catch {
  Out-Result 'Error' $_.Exception.Message @{
    code = 'NVIDIA_DIGITAL_VIBRANCE_FAILED'
  }
  exit 1
}
