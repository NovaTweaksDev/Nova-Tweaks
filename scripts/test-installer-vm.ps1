param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$UpgradeFrom,
  [ValidateSet('Stable', 'Store')][string]$Profile = 'Stable',
  [string]$ToolsPath,
  [switch]$IsolatedVM,
  [string]$ExpectedThumbprint = 'DA86DBDAF373FFCA4E4469475C16A894CA42CFE4',
  [string]$ReportPath = 'installer-vm-results.json'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$machine = Get-CimInstance Win32_ComputerSystem
if (-not $IsolatedVM -or $machine.Model -notmatch 'Virtual|VMware|KVM|QEMU|HVM') {
  throw 'Use a disposable Windows VM with a snapshot and pass -IsolatedVM. Never run on a production PC.'
}
if ($ToolsPath) {
  $taskTestToolsPath = (Resolve-Path -LiteralPath $ToolsPath).Path
  foreach ($taskTool in @('node.exe', 'signtool.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskTestToolsPath $taskTool))) { throw 'Test tools missing.' }
  }
  $env:PATH = $taskTestToolsPath + ';' + $env:PATH
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version.' }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Find-Installation {
  return @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ItemProperty -LiteralPath $_.PSPath
  } | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'Nova Tweaks' })
}
if ((Find-Installation).Count -ne 0) { throw 'Use a clean VM snapshot without an existing Nova installation.' }
function Assert-SignedInstaller([string]$File) {
  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint -or -not $signature.TimeStamperCertificate) {
    throw 'Use the exact validated, signed installer for VM acceptance tests.'
  }
}
function Run-Installer([string]$File, [string]$Arguments) {
  $child = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait
  if ($child.ExitCode -ne 0) { throw "Installer failed with exit code $($child.ExitCode)." }
}
$installRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Nova-Installer-VM-Test'))
if (Test-Path -LiteralPath $installRoot) { throw 'VM test directory already exists; restore the snapshot.' }
$tasksBefore = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like '*Nova*' } | ForEach-Object { $_.TaskPath + $_.TaskName })
Assert-SignedInstaller $Installer
if ($UpgradeFrom) {
  Assert-SignedInstaller $UpgradeFrom
  Run-Installer $UpgradeFrom "/S /currentuser /D=$installRoot"
}
Run-Installer $Installer "/S /currentuser /D=$installRoot"
$registration = Find-Installation
if ($registration.Count -ne 1 -or $registration[0].DisplayVersion -ne $Version -or -not $registration[0].Publisher) {
  throw 'Expected exactly one registered product with the selected version and publisher.'
}
$app = Join-Path $installRoot 'NovaTweaks.exe'
if (-not (Test-Path -LiteralPath $app)) { throw 'Application missing at selected install path.' }
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Nova Tweaks.lnk'
if (-not (Test-Path -LiteralPath $shortcut)) { throw 'Start Menu shortcut missing.' }
$taskSavedModulePath = $env:PSModulePath
try {
  Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
  & powershell.exe -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'verify-windows-signatures.ps1') -Root $installRoot -Mode $Profile -ExpectedThumbprint $ExpectedThumbprint | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Installed payload signature validation failed.' }
} finally { $env:PSModulePath = $taskSavedModulePath }
$userData = Join-Path $env:APPDATA 'Nova Tweaks'
New-Item -ItemType Directory -Path $userData -Force | Out-Null
$sentinel = Join-Path $userData 'installer-vm-preservation-test.txt'
Set-Content -LiteralPath $sentinel 'retain user settings and backups'
# Simulates the Electron CurrentUser login item; verifies that uninstall removes it.
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -LiteralPath $runKey -Name 'Nova Tweaks' -Value ('"' + $app + '" --hidden') -PropertyType String -Force | Out-Null
$uninstaller = Join-Path $installRoot 'Uninstall Nova Tweaks.exe'
Assert-SignedInstaller $uninstaller
Run-Installer $uninstaller '/S /currentuser'
Start-Sleep -Seconds 2
if ((Find-Installation).Count -ne 0 -or (Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $shortcut)) {
  throw 'Program files, uninstall registration or shortcut remained.'
}
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall deleted user data.' }
if (Get-ItemPropertyValue -LiteralPath $runKey -Name 'Nova Tweaks' -ErrorAction SilentlyContinue) { throw 'Nova login item remained.' }
$tasksAfter = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like '*Nova*' } | ForEach-Object { $_.TaskPath + $_.TaskName })
if (@($tasksAfter | Where-Object { $_ -notin $tasksBefore }).Count -gt 0) { throw 'New Nova scheduled task remained after uninstall.' }
[ordered]@{
  status = 'passed'; windowsVersion = [Environment]::OSVersion.Version.ToString()
  profile = $Profile
  version = $Version; installerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
  upgradeTested = [bool]$UpgradeFrom; checkedAtUtc = [DateTime]::UtcNow.ToString('o')
  manualChecksPending = @('No visual setup dialogs', 'Normal launch without UAC', 'Real broker UAC approval', 'Hardware sensors', 'Windows 10/11 compatibility')
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
