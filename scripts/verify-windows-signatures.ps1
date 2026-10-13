param(
  [Parameter(Mandatory = $true)][string]$Root,
  [ValidateSet('Audit', 'Stable', 'Store')][string]$Mode = 'Audit',
  [string]$ExpectedThumbprint,
  [string]$SignTool,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-NovaPeFile([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  try {
    if ($stream.Length -lt 64) { return $false }
    $reader = [IO.BinaryReader]::new($stream)
    if ($reader.ReadUInt16() -ne 0x5A4D) { return $false }
    $stream.Position = 60
    $offset = $reader.ReadInt32()
    if ($offset -lt 64 -or $offset -gt $stream.Length - 4) { return $false }
    $stream.Position = $offset
    return $reader.ReadUInt32() -eq 0x00004550
  } finally { $stream.Dispose() }
}

function Find-NovaSignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $found = @(Get-ChildItem -Path "$sdk\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName)
  if ($found.Count -eq 0) { throw 'Install Windows SDK SignTool; validation cannot be skipped.' }
  return $found[-1].FullName
}

function Invoke-NovaSignatureAudit {
  $directory = (Resolve-Path -LiteralPath $Root).Path
  if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package root cannot be a reparse point.' }
  $policy = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-pe-policy.json') -Raw | ConvertFrom-Json
  $redistributionPolicy = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'store-redistribution-policy.json') -Raw | ConvertFrom-Json
  if ($Mode -ne 'Audit') {
    if ($ExpectedThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'An explicit Nova publisher certificate thumbprint is required.' }
    if (-not $SignTool) { $SignTool = Find-NovaSignTool }
  }
  $records = [Collections.Generic.List[object]]::new()
  $failures = [Collections.Generic.List[string]]::new()
  # Reject reparse points before recursion; never follow an external directory.
  $queue = [Collections.Generic.Queue[string]]::new()
  $queue.Enqueue($directory)
  while ($queue.Count -gt 0) {
    foreach ($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point in package: $($item.Name)" }
      if ($item.PSIsContainer) { $queue.Enqueue($item.FullName); continue }
      if (-not (Test-NovaPeFile $item.FullName)) { continue }
      $relative = $item.FullName.Substring($directory.Length).TrimStart('\', '/').Replace('\', '/')
      $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
      $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $novaOwned = $policy.novaFiles -contains $item.Name -or $item.Name -match '^NovaTweaks-(?:.*-)?Setup-.*\.exe$' -or $item.Name -eq 'Uninstall Nova Tweaks.exe'
      $chainSubjects = @()
      $publisher = $null
      $thumbprint = $null
      if ($signature.SignerCertificate) {
        $publisher = $signature.SignerCertificate.Subject
        $thumbprint = $signature.SignerCertificate.Thumbprint
        $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
        try {
          $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
          $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(15)
          $null = $chain.Build($signature.SignerCertificate)
          $chainSubjects = @($chain.ChainElements | ForEach-Object { $_.Certificate.Subject })
        } finally { $chain.Dispose() }
      }
      $policyPath = $relative -replace '^win-unpacked/', ''
      $upstreamException = @($policy.unsignedUpstream | Where-Object { $_.path -eq $policyPath -and $_.sha256 -eq $hash }).Count -eq 1
      $redistributed = $false
      if ($Mode -eq 'Store' -and -not $novaOwned -and -not $upstreamException -and $signature.Status -eq 'Valid' -and $thumbprint -eq $ExpectedThumbprint -and $signature.TimeStamperCertificate) {
        $approved = @($redistributionPolicy.files | Where-Object { $_.path -eq $policyPath })
        if ($approved.Count -eq 1) {
          $contentHash = & node (Join-Path $PSScriptRoot 'pe-signing-content.js') $item.FullName
          if ($LASTEXITCODE -ne 0) { throw 'Redistribution PE content inspection failed.' }
          $redistributed = $contentHash -eq $approved[0].contentSha256
        }
      }
      $record = [ordered]@{
        path = $relative; sha256 = $hash; owner = $(if ($novaOwned) { 'Nova' } else { 'Third-party' })
        status = [string]$signature.Status; publisher = $publisher; thumbprint = $thumbprint
        timestampAuthority = $(if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null })
        certificateChain = $chainSubjects; unsignedUpstreamException = $upstreamException
        redistributedByNova = $redistributed
      }
      $records.Add([pscustomobject]$record)
      if ($Mode -eq 'Audit') { continue }
      if (-not $novaOwned -and -not $upstreamException -and -not $redistributed) {
        $failures.Add("$relative : unexpected upstream bytes or publisher signature"); continue
      }
      if ($signature.Status -ne 'Valid') {
        if ($Mode -eq 'Stable' -and -not $novaOwned -and $signature.Status -eq 'NotSigned' -and $upstreamException) { continue }
        $failures.Add("$relative : $($signature.Status)"); continue
      }
      if ($novaOwned -and ($thumbprint -ne $ExpectedThumbprint -or -not $signature.TimeStamperCertificate)) {
        $failures.Add("$relative : unexpected publisher or missing timestamp"); continue
      }
      & $SignTool verify /pa /all /tw $item.FullName | Out-Null
      if ($LASTEXITCODE -ne 0) { $failures.Add("$relative : SignTool verification failed") }
    }
  }
  if ($records.Count -eq 0) { throw 'No executable PE files found; wrong package root.' }
  $report = [ordered]@{ schemaVersion = 1; mode = $Mode; checkedAtUtc = [DateTime]::UtcNow.ToString('o'); files = @($records.ToArray()); failures = @($failures.ToArray()) }
  if ($ReportPath) { $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8 }
  if ($failures.Count -gt 0) { throw "Signature validation blocked: $($failures -join '; ')" }
  return $report
}

if ($MyInvocation.InvocationName -ne '.') {
  try { Invoke-NovaSignatureAudit | ConvertTo-Json -Depth 8 } catch { Write-Error $_; exit 1 }
}
