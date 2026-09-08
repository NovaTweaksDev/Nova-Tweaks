[CmdletBinding()]
param(
  [ValidateSet("Debug", "Release", "RelWithDebInfo", "MinSizeRel")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $root "..\..")
$buildDir = Join-Path (Join-Path $root "build") $Platform
$binDir = Join-Path $root "bin"
$bundleDir = Join-Path $repoRoot "resources\tools\nova-presentmon-helper"
$presentMonSdkDir = Join-Path $repoRoot "resources\tools\presentmon"

# Some host environments expose both PATH and Path. MSBuild treats that
# duplicate as a fatal CL.exe launch error, so normalize it before CMake.
$pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
if ([string]::IsNullOrWhiteSpace($pathValue)) {
  $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
}
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")
if (-not [string]::IsNullOrWhiteSpace($pathValue)) {
  [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  throw "cmake not found in PATH. Install CMake or use the Visual Studio CMake integration."
}

foreach ($required in @("PresentMonAPI.h", "PresentMonAPI2Loader.dll", "PresentMonAPI2Loader.lib", "Intel-PresentMon.dll")) {
  $requiredPath = Join-Path $presentMonSdkDir $required
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Missing PresentMon SDK file: $requiredPath"
  }
}

cmake -S $root -B $buildDir -A $Platform -DPRESENTMON_SDK_DIR="$presentMonSdkDir" | Out-Host
cmake --build $buildDir --config $Configuration | Out-Host

$candidate = Join-Path (Join-Path $buildDir $Configuration) "NovaPresentMonHelper.exe"
if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
  $candidate = Join-Path $buildDir "NovaPresentMonHelper.exe"
}

if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
  throw "Build succeeded but NovaPresentMonHelper.exe was not found."
}

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

Copy-Item -LiteralPath $candidate -Destination (Join-Path $binDir "NovaPresentMonHelper.exe") -Force
Copy-Item -LiteralPath $candidate -Destination (Join-Path $bundleDir "NovaPresentMonHelper.exe") -Force

Write-Host "Built helper:" (Join-Path $binDir "NovaPresentMonHelper.exe")
Write-Host "Bundled helper:" (Join-Path $bundleDir "NovaPresentMonHelper.exe")
