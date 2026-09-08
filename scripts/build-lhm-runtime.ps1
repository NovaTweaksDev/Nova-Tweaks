$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = Join-Path $projectRoot 'resources\monitoring\LibreHardwareMonitor'
$projectPath = Join-Path $sourceRoot 'LibreHardwareMonitor\LibreHardwareMonitor.csproj'
$buildOutput = Join-Path $sourceRoot 'bin\Release\net8.0-windows\win-x64'
$runtimeOutput = Join-Path $sourceRoot 'patched'
$excludedInstaller = Join-Path $sourceRoot 'LibreHardwareMonitor\Resources\PawnIO_setup.exe'

if (Test-Path -LiteralPath $excludedInstaller) {
  throw 'PawnIO_setup.exe must not be present in the distributable source tree.'
}

& dotnet build $projectPath `
  --configuration Release `
  --framework net8.0-windows `
  --runtime win-x64 `
  -p:Platform=x64
if ($LASTEXITCODE -ne 0) {
  throw "LibreHardwareMonitor build failed with exit code $LASTEXITCODE."
}

$runtimeExtensions = @('.config', '.dll', '.exe', '.json')
$builtFiles = @(Get-ChildItem -LiteralPath $buildOutput -File | Where-Object {
  $runtimeExtensions -contains $_.Extension.ToLowerInvariant()
})
if (-not ($builtFiles.Name -contains 'LibreHardwareMonitor.exe')) {
  throw 'LibreHardwareMonitor.exe was not produced by the build.'
}

New-Item -ItemType Directory -Path $runtimeOutput -Force | Out-Null
foreach ($file in $builtFiles) {
  Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $runtimeOutput $file.Name) -Force
}

$assemblyPath = Join-Path $runtimeOutput 'LibreHardwareMonitor.dll'
$assemblyBytes = [IO.File]::ReadAllBytes($assemblyPath)
$assemblyText = [Text.Encoding]::Unicode.GetString($assemblyBytes)
if ($assemblyText.Contains('PawnIO_setup.exe')) {
  throw 'The rebuilt LibreHardwareMonitor assembly still embeds PawnIO_setup.exe.'
}

Write-Host "LibreHardwareMonitor runtime rebuilt without PawnIO_setup.exe: $runtimeOutput"
