param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$Thumbprint,
  [Parameter(Mandatory = $true)][string]$SignTool,
  [string]$TimestampUrl = 'http://time.certum.pl'
)
$ErrorActionPreference = 'Stop'
# Uses the existing Certum/SimplySign certificate in CurrentUser. No exported private key.
$existing = Get-AuthenticodeSignature -LiteralPath $File
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
