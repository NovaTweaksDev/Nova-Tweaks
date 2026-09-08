const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  assertThirdPartyFiles,
  assertThirdPartyLegalFiles,
  loadThirdPartyManifest
} = require('./third-party-compliance');
const {
  assertExcludedThirdPartyFiles,
  assertThirdPartySourceTrees
} = require('./third-party-source-compliance');

function assertAuthenticodeSignature(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Signed broker executable is missing: ${filePath}`);
  }
  const command = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:NOVA_SIGNED_FILE',
    'if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) { exit 17 }'
  ].join('; ');
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, NOVA_SIGNED_FILE: filePath },
    windowsHide: true,
    stdio: 'pipe'
  });
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32' || context.packager.config?.win?.signAndEditExecutable === false) return;
  const thirdPartyManifest = loadThirdPartyManifest(context.packager.projectDir);
  assertThirdPartyFiles(context.appOutDir, thirdPartyManifest, 'packagedPath');
  assertThirdPartyLegalFiles(context.appOutDir, thirdPartyManifest);
  assertThirdPartySourceTrees(context.appOutDir, thirdPartyManifest, 'packagedPath');
  assertExcludedThirdPartyFiles(context.appOutDir, thirdPartyManifest, 'packagedPaths');

  assertAuthenticodeSignature(path.join(
    context.appOutDir,
    'resources',
    'tools',
    'nova-admin-broker',
    'NovaAdminBrokerHost.exe'
  ));
};
