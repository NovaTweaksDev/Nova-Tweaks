param(
  [string]$Version = $(if ($env:PRESENTMON_VERSION) { $env:PRESENTMON_VERSION } else { 'v2.5.1' }),
  [string]$ExpectedSha256 = $(if ($env:PRESENTMON_SHA256) { $env:PRESENTMON_SHA256 } else { '9BEC3083069F58F911E6A512F4806DB51A27BD096103087BC1D05EF54C80A191' }),
  [string]$LegacyVersion = $(if ($env:PRESENTMON_LEGACY_VERSION) { $env:PRESENTMON_LEGACY_VERSION } else { 'v1.10.0' }),
  [string]$ExpectedLegacySha256 = $(if ($env:PRESENTMON_LEGACY_SHA256) { $env:PRESENTMON_LEGACY_SHA256 } else { 'E57A2F8EE1DE1EF1A5516D875F1B115E881943CD729FE9C5A2F88B1DC79A8A3B' }),
  [ValidateSet('x64', 'x86')]
  [string]$Architecture = 'x64',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\resources\capture\PresentMon'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step {
  param([string]$Message)
  Write-Host "[presentmon] $Message"
}

function Find-PresentMonExecutable {
  param([string]$Directory)

  if ([string]::IsNullOrWhiteSpace($Directory) -or -not (Test-Path -LiteralPath $Directory)) {
    return $null
  }

  $directPath = Join-Path $Directory 'PresentMon.exe'
  if (Test-Path -LiteralPath $directPath -PathType Leaf) {
    $directExecutable = Get-Item -LiteralPath $directPath
    if ($directExecutable.Length -gt 0) {
      return $directExecutable
    }
  }

  return Get-ChildItem -LiteralPath $Directory -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 0 -and $_.Name -match '^PresentMon(?:[-_.].*)?\.exe$' } |
    Sort-Object @{ Expression = { if ($_.Name -match 'x64') { 0 } else { 1 } } }, Name |
    Select-Object -First 1
}

$repoApi = 'https://api.github.com/repos/GameTechDev/PresentMon'
$releaseUri = if ([string]::IsNullOrWhiteSpace($Version)) {
  "$repoApi/releases/latest"
} else {
  "$repoApi/releases/tags/$Version"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$targetPath = Join-Path $OutputDirectory 'PresentMon.exe'
$legacyTargetPath = Join-Path $OutputDirectory 'PresentMonLegacy.exe'
$existingExecutable = Find-PresentMonExecutable -Directory $OutputDirectory
$existingLegacyExecutable = if ((Test-Path -LiteralPath $legacyTargetPath -PathType Leaf) -and ((Get-Item -LiteralPath $legacyTargetPath).Length -gt 0)) {
  Get-Item -LiteralPath $legacyTargetPath
} else {
  $null
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToUpperInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}
$pinnedHash = $ExpectedSha256.Trim().ToUpperInvariant()
$pinnedLegacyHash = $ExpectedLegacySha256.Trim().ToUpperInvariant()
if ($pinnedHash -notmatch '^[0-9A-F]{64}$' -or $pinnedLegacyHash -notmatch '^[0-9A-F]{64}$') {
  throw 'PresentMon pinned SHA256 values must each contain exactly 64 hexadecimal characters.'
}
if ($existingExecutable -and $existingLegacyExecutable) {
  $existingHash = Get-Sha256Hex -Path $existingExecutable.FullName
  $existingLegacyHash = Get-Sha256Hex -Path $existingLegacyExecutable.FullName
  if ($existingHash -eq $pinnedHash -and $existingLegacyHash -eq $pinnedLegacyHash) {
    Write-Step "Reusing pinned PresentMon sidecar at $($existingExecutable.FullName)"
    Write-Step "Reusing pinned legacy fallback at $($existingLegacyExecutable.FullName)"
    exit 0
  }
  if (-not $Force) {
    throw 'Existing PresentMon files do not match the pinned SHA256 values. Refusing to use them.'
  }
}

Write-Step "Resolving release metadata from $releaseUri"
$release = Invoke-RestMethod -Uri $releaseUri -Headers @{ 'User-Agent' = 'Nova-Tweaks-PresentMon-Vendor' }
$asset = $release.assets |
  Where-Object { $_.name -match "^PresentMon-.+-$Architecture\.exe$" } |
  Sort-Object -Property name -Descending |
  Select-Object -First 1

if (-not $asset) {
  throw "No PresentMon $Architecture console executable was found in release $($release.tag_name)."
}

$tempPath = Join-Path $OutputDirectory "$($asset.name).download"
Write-Step "Downloading $($asset.name)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempPath -UseBasicParsing

$actualHash = Get-Sha256Hex -Path $tempPath
if ($pinnedHash -notmatch '^[0-9A-F]{64}$' -or $actualHash -ne $pinnedHash) {
  Remove-Item -LiteralPath $tempPath -Force
  throw "Pinned SHA256 verification failed for $($asset.name)."
}
if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
  $releaseHash = $asset.digest.Substring('sha256:'.Length).ToUpperInvariant()
  if ($actualHash -ne $releaseHash) {
    Remove-Item -LiteralPath $tempPath -Force
    throw "Release-metadata SHA256 verification failed for $($asset.name)."
  }
}
Write-Step "Verified pinned SHA256 $actualHash"

Get-ChildItem -LiteralPath $OutputDirectory -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^PresentMon(?:[-_.].*)?\.exe$' -and $_.FullName -ne $targetPath -and $_.FullName -ne $legacyTargetPath } |
  Remove-Item -Force
Move-Item -LiteralPath $tempPath -Destination $targetPath -Force

if ($Force -or -not ((Test-Path -LiteralPath $legacyTargetPath -PathType Leaf) -and ((Get-Item -LiteralPath $legacyTargetPath).Length -gt 0))) {
  $legacyReleaseUri = "$repoApi/releases/tags/$LegacyVersion"
  Write-Step "Resolving legacy fallback metadata from $legacyReleaseUri"
  $legacyRelease = Invoke-RestMethod -Uri $legacyReleaseUri -Headers @{ 'User-Agent' = 'Nova-Tweaks-PresentMon-Vendor' }
  $legacyAsset = $legacyRelease.assets |
    Where-Object { $_.name -eq "PresentMon-1.10.0-$Architecture.exe" -or $_.name -match "^PresentMon-1\..+-$Architecture\.exe$" } |
    Sort-Object -Property name -Descending |
    Select-Object -First 1

  if (-not $legacyAsset) {
    throw "No legacy PresentMon $Architecture console executable was found in release $($legacyRelease.tag_name)."
  }

  $legacyTempPath = Join-Path $OutputDirectory "$($legacyAsset.name).download"
  Write-Step "Downloading legacy fallback $($legacyAsset.name)"
  Invoke-WebRequest -Uri $legacyAsset.browser_download_url -OutFile $legacyTempPath -UseBasicParsing

  $actualLegacyHash = Get-Sha256Hex -Path $legacyTempPath
  if ($pinnedLegacyHash -notmatch '^[0-9A-F]{64}$' -or $actualLegacyHash -ne $pinnedLegacyHash) {
    Remove-Item -LiteralPath $legacyTempPath -Force
    throw "Pinned legacy SHA256 verification failed for $($legacyAsset.name)."
  }
  if ($legacyAsset.digest -and $legacyAsset.digest.StartsWith('sha256:')) {
    $releaseLegacyHash = $legacyAsset.digest.Substring('sha256:'.Length).ToUpperInvariant()
    if ($actualLegacyHash -ne $releaseLegacyHash) {
      Remove-Item -LiteralPath $legacyTempPath -Force
      throw "Release-metadata legacy SHA256 verification failed for $($legacyAsset.name)."
    }
  }
  Write-Step "Verified pinned legacy SHA256 $actualLegacyHash"

  Move-Item -LiteralPath $legacyTempPath -Destination $legacyTargetPath -Force
}

$versionInfo = @(
  "tag=$($release.tag_name)"
  "asset=$($asset.name)"
  "url=$($asset.browser_download_url)"
  "legacyTag=$LegacyVersion"
  "legacyPath=PresentMonLegacy.exe"
)
$versionInfo | Set-Content -LiteralPath (Join-Path $OutputDirectory 'VERSION.txt') -Encoding UTF8

$licenseUri = "https://raw.githubusercontent.com/GameTechDev/PresentMon/$($release.tag_name)/LICENSE.txt"
$thirdPartyUri = "https://raw.githubusercontent.com/GameTechDev/PresentMon/$($release.tag_name)/THIRD_PARTY.txt"

try {
  Invoke-WebRequest -Uri $licenseUri -OutFile (Join-Path $OutputDirectory 'LICENSE.txt') -UseBasicParsing
  Write-Step 'Downloaded LICENSE.txt'
} catch {
  Write-Step "Could not download LICENSE.txt: $($_.Exception.Message)"
}

try {
  Invoke-WebRequest -Uri $thirdPartyUri -OutFile (Join-Path $OutputDirectory 'THIRD_PARTY.txt') -UseBasicParsing
  Write-Step 'Downloaded THIRD_PARTY.txt'
} catch {
  Write-Step "Could not download THIRD_PARTY.txt: $($_.Exception.Message)"
}

Write-Step "PresentMon sidecar is ready at $targetPath"
