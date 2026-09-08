[CmdletBinding()]
param(
  [string]$Configuration = "Release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildDir = Join-Path $root "build"
$binDir = Join-Path $root "bin"

$cachePath = Join-Path $buildDir "CMakeCache.txt"
if (Test-Path -LiteralPath $cachePath -PathType Leaf) {
  $cachedHome = Get-Content -LiteralPath $cachePath |
    Where-Object { $_ -like 'CMAKE_HOME_DIRECTORY:INTERNAL=*' } |
    Select-Object -First 1
  $cachedRoot = if ($cachedHome) { ($cachedHome -split '=', 2)[1] } else { '' }
  if ($cachedRoot -and ([IO.Path]::GetFullPath($cachedRoot) -ne [IO.Path]::GetFullPath($root))) {
    Write-Host "Removing copied CMake cache from $cachedRoot"
    Remove-Item -LiteralPath $buildDir -Recurse -Force
  }
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  throw "cmake not found in PATH."
}

cmake -S $root -B $buildDir | Out-Host
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed with exit code $LASTEXITCODE." }
cmake --build $buildDir --config $Configuration | Out-Host
if ($LASTEXITCODE -ne 0) { throw "CMake build failed with exit code $LASTEXITCODE." }

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
