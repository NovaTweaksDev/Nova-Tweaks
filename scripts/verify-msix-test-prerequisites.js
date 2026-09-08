const fs = require('fs');
const path = require('path');
const {
  assertMonitoringRuntimeIntegrity
} = require('../electron/services/monitoring/monitoringIntegrity');
const {
  assertBundledSidecarIntegrity
} = require('../electron/services/security/bundledSidecarIntegrity');
const {
  assertThirdPartyFiles,
  assertThirdPartyLegalFiles,
  assertThirdPartySigningExclusions,
  loadThirdPartyManifest
} = require('./third-party-compliance');
const {
  assertExcludedThirdPartyFiles,
  assertThirdPartySourceTrees
} = require('./third-party-source-compliance');

const root = path.resolve(__dirname, '..');
const signingConfigPath = path.join(root, 'electron', 'generated', 'signing-config.js');
const requiredFiles = [
  'resources/capture/PresentMon/PresentMon.exe',
  'resources/capture/PresentMon/PresentMonLegacy.exe',
  'resources/tools/nova-presentmon-helper/NovaPresentMonHelper.exe',
  'resources/tools/presentmon/PresentMonAPI2Loader.dll',
  'resources/tools/presentmon/Intel-PresentMon.dll',
  'resources/helpers/NovaGameDetector/publish/win-x64/NovaGameDetector.exe',
  'tools/nvidia-display-helper/bin/nvidia-display-helper.exe',
  'tools/nvidia-profile-helper/bin/nvidia-profile-helper.exe',
  'resources/monitoring/LibreHardwareMonitor/patched/LibreHardwareMonitor.exe'
];

function fail(message) {
  console.error(`[msix-preflight] ${message}`);
  process.exit(1);
}

const privateKeyMarkers = [
  Buffer.from('-----BEGIN PRIVATE KEY-----'),
  Buffer.from('-----BEGIN RSA PRIVATE KEY-----'),
  Buffer.from('-----BEGIN EC PRIVATE KEY-----'),
  Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----')
];

function assertNoPrivateKeyContent(targetPath) {
  const stats = fs.lstatSync(targetPath);
  if (stats.isSymbolicLink()) {
    return;
  }
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      assertNoPrivateKeyContent(path.join(targetPath, entry));
    }
    return;
  }
  if (!stats.isFile()) {
    return;
  }

  const contents = fs.readFileSync(targetPath);
  if (privateKeyMarkers.some((marker) => contents.includes(marker))) {
    fail(`Private-key content would be included in the desktop payload: ${path.relative(root, targetPath)}`);
  }
}

if (process.platform !== 'win32') {
  fail('The internal MSIX test build is supported only on Windows.');
}

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile() || fs.statSync(absolutePath).size <= 0) {
    fail(`Required runtime resource is missing or empty: ${relativePath}`);
  }
}
const thirdPartyManifest = loadThirdPartyManifest(root);
assertThirdPartyFiles(root, thirdPartyManifest, 'repositoryPath');
assertThirdPartyLegalFiles(root, thirdPartyManifest);
assertThirdPartySourceTrees(root, thirdPartyManifest, 'repositoryPath');
assertExcludedThirdPartyFiles(root, thirdPartyManifest, 'repositoryPaths');
assertThirdPartySigningExclusions(require('../package.json').build, thirdPartyManifest);


assertMonitoringRuntimeIntegrity(
  path.join(root, 'resources', 'monitoring', 'LibreHardwareMonitor')
);
for (const [policyName, relativeDirectory] of [
  ['presentmon-capture', 'resources/capture/PresentMon'],
  ['presentmon-tools', 'resources/tools/presentmon'],
  ['presentmon-helper', 'resources/tools/nova-presentmon-helper'],
  ['game-detector-x64', 'resources/helpers/NovaGameDetector/publish/win-x64'],
  ['nvidia-display-helper', 'tools/nvidia-display-helper/bin'],
  ['nvidia-profile-helper', 'tools/nvidia-profile-helper/bin']
]) {
  assertBundledSidecarIntegrity(path.join(root, ...relativeDirectory.split('/')), policyName);
}

if (!fs.existsSync(signingConfigPath)) {
  fail('Generated desktop signing configuration is missing. Run npm run build with the public-key configuration first.');
}

delete require.cache[require.resolve(signingConfigPath)];
const signingConfig = require(signingConfigPath);
const artifactPublicKeys = [
  signingConfig.NOVA_ARTIFACT_PUBLIC_KEY,
  ...(Array.isArray(signingConfig.NOVA_ARTIFACT_PUBLIC_KEYS) ? signingConfig.NOVA_ARTIFACT_PUBLIC_KEYS : [])
].map(String).filter(Boolean);
const tweakSignaturesRequired = String(signingConfig.NOVA_REQUIRE_TWEAK_SIGNATURES || '').trim().toLowerCase() === 'true';
const updateSignaturesRequired = String(signingConfig.NOVA_REQUIRE_UPDATE_SIGNATURES || '').trim().toLowerCase() === 'true';
const serializedConfig = fs.readFileSync(signingConfigPath, 'utf8');

if (!artifactPublicKeys.some((publicKey) => publicKey.includes('BEGIN PUBLIC KEY'))) {
  fail('The generated desktop build does not contain a valid artifact root public key.');
}
if (!tweakSignaturesRequired || !updateSignaturesRequired) {
  fail('Remote tweak and update signature enforcement must both be enabled for the MSIX test build.');
}
if (/BEGIN (?:RSA |EC )?PRIVATE KEY/.test(serializedConfig)) {
  fail('A private key was detected in the generated desktop signing configuration.');
}

for (const payloadPath of ['dist', 'electron', 'resources', 'package.json']) {
  const absolutePath = path.join(root, payloadPath);
  if (fs.existsSync(absolutePath)) {
    assertNoPrivateKeyContent(absolutePath);
  }
}

console.log('[msix-preflight] Runtime resources and tweak/update signature verification configuration are ready.');
