param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',
  [ValidateSet('x64')]
  [string]$Platform = 'x64'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$build = Join-Path $root "build-$Platform"
$bin = Join-Path $root 'bin'

$cachePath = Join-Path $build 'CMakeCache.txt'
if (Test-Path -LiteralPath $cachePath -PathType Leaf) {
  $cachedHome = Get-Content -LiteralPath $cachePath |
    Where-Object { $_ -like 'CMAKE_HOME_DIRECTORY:INTERNAL=*' } |
    Select-Object -First 1
  $cachedRoot = if ($cachedHome) { ($cachedHome -split '=', 2)[1] } else { '' }
  if ($cachedRoot -and ([IO.Path]::GetFullPath($cachedRoot) -ne $root)) {
    Write-Host "Removing copied CMake cache from $cachedRoot"
    Remove-Item -LiteralPath $build -Recurse -Force
  }
}

cmake -S $root -B $build -A $Platform
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed with exit code $LASTEXITCODE." }
cmake --build $build --config $Configuration
if ($LASTEXITCODE -ne 0) { throw "CMake build failed with exit code $LASTEXITCODE." }

New-Item -ItemType Directory -Path $bin -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $build "$Configuration\NovaAdminBrokerHost.exe") -Destination (Join-Path $bin 'NovaAdminBrokerHost.exe') -Force
Write-Host "Built $bin\NovaAdminBrokerHost.exe"
