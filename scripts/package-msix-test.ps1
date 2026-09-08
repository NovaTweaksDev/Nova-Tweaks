param(
  [string]$Version = $env:NOVA_MSIX_VERSION,
  [switch]$LocalSigned
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = '0.9.0.0'
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
  throw 'NOVA_MSIX_VERSION must use four numeric parts, for example 0.9.0.0.'
}
$versionParts = $Version.Split('.') | ForEach-Object { [int]$_ }
if ($versionParts | Where-Object { $_ -lt 0 -or $_ -gt 65535 }) {
  throw 'Every NOVA_MSIX_VERSION part must be between 0 and 65535.'
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'dist-msix-test'))
$payloadRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot 'unpacked\win-unpacked'))
$stagingRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot 'staging'))
$verifyRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot 'verify'))
$packageFileName = if ($LocalSigned) {
  "NovaTweaks-MSIX-Test-$Version-signed-x64.msix"
} else {
  "NovaTweaks-MSIX-Test-$Version-x64.msix"
}
$packagePath = [IO.Path]::GetFullPath((Join-Path $outputRoot $packageFileName))
$iconPath = [IO.Path]::GetFullPath((Join-Path $repoRoot 'resources\pictures\logo\logo.ico'))

function Assert-OutputChildPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = $outputRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the MSIX output directory: $resolved"
  }
}

function Reset-OutputDirectory([string]$Path) {
  Assert-OutputChildPath $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function New-SquareAsset([string]$Destination, [int]$Size) {
  $icon = New-Object System.Drawing.Icon -ArgumentList @($iconPath, $Size, $Size)
  $source = $icon.ToBitmap()
  $canvas = New-Object System.Drawing.Bitmap -ArgumentList @($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, $Size, $Size)
    $canvas.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $source.Dispose()
    $icon.Dispose()
  }
}

function New-WideAsset([string]$Destination) {
  $width = 310
  $height = 150
  $logoSize = 110
  $icon = New-Object System.Drawing.Icon -ArgumentList @($iconPath, $logoSize, $logoSize)
  $source = $icon.ToBitmap()
  $canvas = New-Object System.Drawing.Bitmap -ArgumentList @($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0B1220'))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, [int](($width - $logoSize) / 2), [int](($height - $logoSize) / 2), $logoSize, $logoSize)
    $canvas.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $source.Dispose()
    $icon.Dispose()
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $payloadRoot 'NovaTweaks.exe') -PathType Leaf)) {
  throw "Electron directory payload was not found at $payloadRoot."
}
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "Nova Tweaks icon was not found at $iconPath."
}

Add-Type -AssemblyName System.Drawing
Reset-OutputDirectory $stagingRoot
$stagingAppRoot = Join-Path $stagingRoot 'app'
$assetsRoot = Join-Path $stagingRoot 'Assets'
New-Item -ItemType Directory -Path $stagingAppRoot -Force | Out-Null
New-Item -ItemType Directory -Path $assetsRoot -Force | Out-Null
Copy-Item -Path (Join-Path $payloadRoot '*') -Destination $stagingAppRoot -Recurse -Force

New-SquareAsset (Join-Path $assetsRoot 'StoreLogo.png') 50
New-SquareAsset (Join-Path $assetsRoot 'Square150x150Logo.png') 150
New-SquareAsset (Join-Path $assetsRoot 'Square44x44Logo.png') 44
New-WideAsset (Join-Path $assetsRoot 'Wide310x150Logo.png')

$publisher = if ($LocalSigned) {
  'CN=Nova Tweaks Internal Test'
} else {
  'CN=AppModelSamples, OID.2.25.311729368913984317654407730594956997722=1'
}
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity
    Name="NovaTweaks.InternalTest"
    ProcessorArchitecture="x64"
    Publisher="$publisher"
    Version="$Version" />
  <Properties>
    <DisplayName>Nova Tweaks MSIX Test</DisplayName>
    <PublisherDisplayName>Nova Tweaks</PublisherDisplayName>
    <Description>Internal Nova Tweaks MSIX compatibility build.</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-US" />
    <Resource Language="de-DE" />
    <Resource Language="fr-FR" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="allowElevation" />
  </Capabilities>
  <Applications>
    <Application Id="NovaTweaks" Executable="app\NovaTweaks.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        BackgroundColor="#0B1220"
        DisplayName="Nova Tweaks MSIX Test"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Description="Internal Nova Tweaks MSIX compatibility build.">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
</Package>
"@
[IO.File]::WriteAllText((Join-Path $stagingRoot 'AppxManifest.xml'), $manifest, (New-Object Text.UTF8Encoding($false)))

$windowsKitsBin = 'C:\Program Files (x86)\Windows Kits\10\bin'
$makeAppx = Get-ChildItem -LiteralPath $windowsKitsBin -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\makeappx\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $makeAppx) {
  throw 'Windows SDK MakeAppx.exe (x64) was not found.'
}

Assert-OutputChildPath $packagePath
if (Test-Path -LiteralPath $packagePath) {
  Remove-Item -LiteralPath $packagePath -Force
}

Write-Host "[msix] Packing $packagePath"
& $makeAppx pack /o /d $stagingRoot /p $packagePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "MakeAppx failed with exit code $LASTEXITCODE."
}

if ($LocalSigned) {
  $windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $windowsPrincipal = [Security.Principal.WindowsPrincipal]::new($windowsIdentity)
  if (-not $windowsPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The locally signed MSIX build must run from an administrative PowerShell because it trusts the public test certificate in LocalMachine\TrustedPeople.'
  }

  $certificateSubject = 'CN=Nova Tweaks Internal Test'
  $certificate = Get-ChildItem -Path Cert:\CurrentUser\My |
    Where-Object {
      $_.Subject -eq $certificateSubject -and
      $_.HasPrivateKey -and
      $_.NotAfter -gt (Get-Date).AddDays(7)
    } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if (-not $certificate) {
    Write-Host '[msix] Creating a local CurrentUser test-signing certificate (no certificate file is exported).'
    $certificate = New-SelfSignedCertificate `
      -Type Custom `
      -Subject $certificateSubject `
      -FriendlyName 'Nova Tweaks Internal MSIX Test' `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -KeyAlgorithm RSA `
      -KeyLength 2048 `
      -HashAlgorithm SHA256 `
      -KeyUsage DigitalSignature `
      -KeyExportPolicy NonExportable `
      -NotAfter (Get-Date).AddYears(1) `
      -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
  }

  $trustedPeople = New-Object Security.Cryptography.X509Certificates.X509Store('TrustedPeople', 'LocalMachine')
  try {
    $trustedPeople.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $trustedCertificate = $trustedPeople.Certificates.Find(
      [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $certificate.Thumbprint,
      $false
    )
    if ($trustedCertificate.Count -eq 0) {
      $trustedPeople.Add($certificate)
    }
  } finally {
    $trustedPeople.Close()
  }

  $signTool = Get-ChildItem -LiteralPath $windowsKitsBin -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $signTool) {
    throw 'Windows SDK SignTool.exe (x64) was not found.'
  }

  Write-Host "[msix] Signing with local certificate $($certificate.Thumbprint)"
  & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $packagePath
  if ($LASTEXITCODE -ne 0) {
    throw "SignTool failed with exit code $LASTEXITCODE."
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $packagePath
  if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
    throw 'The signed package does not contain the expected local test signature.'
  }
}

Reset-OutputDirectory $verifyRoot
& $makeAppx unpack /o /p $packagePath /d $verifyRoot
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx verification unpack failed with exit code $LASTEXITCODE."
}

$verificationMode = if ($LocalSigned) { 'signed' } else { 'unsigned' }
& node (Join-Path $repoRoot 'scripts\verify-msix-test-package.js') $verifyRoot $Version $verificationMode
if ($LASTEXITCODE -ne 0) {
  throw 'MSIX content verification failed.'
}

$packageKind = if ($LocalSigned) { 'locally signed' } else { 'unsigned' }
Write-Host "[msix] Internal $packageKind test package created: $packagePath"
