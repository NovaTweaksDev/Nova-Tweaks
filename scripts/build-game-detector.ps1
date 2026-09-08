param(
  [string]$Configuration = "Release",
  [string[]]$RuntimeIdentifiers = @("win-x64", "win-arm64"),
  [switch]$FrameworkDependent
)

$ErrorActionPreference = "Stop"

$projectPath = Join-Path $PSScriptRoot "..\\resources\\helpers\\NovaGameDetector\\NovaGameDetector.csproj"
$publishRoot = Join-Path $PSScriptRoot "..\\resources\\helpers\\NovaGameDetector\\publish"

if (-not (Test-Path -LiteralPath $projectPath)) {
  throw "NovaGameDetector project file was not found at $projectPath."
}

$dotnetCommand = $null
$dotnetLookup = Get-Command dotnet -ErrorAction SilentlyContinue
if ($dotnetLookup) {
  $dotnetCommand = $dotnetLookup.Source
}
if ([string]::IsNullOrWhiteSpace($dotnetCommand)) {
  $dotnetCandidates = @(
    "C:\Program Files\dotnet\dotnet.exe",
    "C:\Program Files (x86)\dotnet\dotnet.exe"
  )
  foreach ($candidate in $dotnetCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $dotnetCommand = $candidate
      break
    }
  }
}

if ([string]::IsNullOrWhiteSpace($dotnetCommand)) {
  throw "dotnet SDK was not found in PATH. Install .NET 8 SDK before building NovaGameDetector."
}

$resolvedSelfContained = if ($FrameworkDependent.IsPresent) { "false" } else { "true" }
$normalizedRids = @($RuntimeIdentifiers | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($normalizedRids.Count -eq 0) {
  throw "No runtime identifiers were provided."
}

Write-Host "Publishing NovaGameDetector helper..."
Write-Host "  Project       : $projectPath"
Write-Host "  Publish Root  : $publishRoot"
Write-Host "  Config        : $Configuration"
Write-Host "  SelfContained : $resolvedSelfContained"
Write-Host "  Runtimes      : $($normalizedRids -join ', ')"

foreach ($rid in $normalizedRids) {
  $publishDirectory = Join-Path $publishRoot $rid
  Write-Host ""
  Write-Host "Publishing runtime '$rid' to '$publishDirectory'..."

  & $dotnetCommand publish `
    $projectPath `
    -c $Configuration `
    -r $rid `
    --self-contained $resolvedSelfContained `
    -o $publishDirectory `
    /p:PublishSingleFile=false

  if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish for runtime '$rid' failed with exit code $LASTEXITCODE."
  }
}

Write-Host ""
Write-Host "NovaGameDetector publish completed successfully for all runtimes."
