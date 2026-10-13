param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$Thumbprint,
  [Parameter(Mandatory = $true)][string]$SignTool,
  [switch]$UnsignedRedistribution,
  [string]$ReportPath,
  [string]$TimestampUrl = 'http://time.certum.pl'
)
$ErrorActionPreference = 'Stop'
# Uses the existing Certum/SimplySign certificate in CurrentUser. No exported private key.
$existing = Get-AuthenticodeSignature -LiteralPath $File
if ($UnsignedRedistribution -and $existing.Status -ne 'NotSigned') {
  throw 'Redistribution signing accepts unsigned files only; existing signatures are preserved.'
}
if ($existing.SignerCertificate -and $existing.SignerCertificate.Thumbprint -ne $Thumbprint) {
  throw 'Refusing to replace another publisher signature.'
}
& $SignTool sign /sha1 $Thumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $File
if ($LASTEXITCODE -ne 0) { throw 'Certum/SimplySign signing failed.' }
$signature = Get-AuthenticodeSignature -LiteralPath $File
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint -or -not $signature.TimeStamperCertificate) {
  throw 'Signed Nova file failed publisher/timestamp validation.'
}
& $SignTool verify /pa /all /tw $File
if ($LASTEXITCODE -ne 0) { throw 'SignTool verification failed.' }
if ($ReportPath) {
  $record = @{ status = [string]$signature.Status; subject = $signature.SignerCertificate.Subject; thumbprint = $signature.SignerCertificate.Thumbprint }
  [IO.File]::WriteAllText($ReportPath, ($record | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
