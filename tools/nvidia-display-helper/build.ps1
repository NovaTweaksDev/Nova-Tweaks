[CmdletBinding()]
param(
  [string]$Configuration = "Release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildDir = Join-Path $root "build"
$binDir = Join-Path $root "bin"

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  throw "cmake not found in PATH."
}

cmake -S $root -B $buildDir | Out-Host
cmake --build $buildDir --config $Configuration | Out-Host

$candidate = Join-Path (Join-Path $buildDir $Configuration) "nvidia-display-helper.exe"
if (-not (Test-Path $candidate)) {
  $candidate = Join-Path $buildDir "nvidia-display-helper.exe"
}

if (-not (Test-Path $candidate)) {
  throw "Build succeeded but executable not found."
}

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Copy-Item -Path $candidate -Destination (Join-Path $binDir "nvidia-display-helper.exe") -Force

Write-Host "Built helper:" (Join-Path $binDir "nvidia-display-helper.exe")
