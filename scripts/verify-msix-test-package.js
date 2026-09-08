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
  loadThirdPartyManifest
} = require('./third-party-compliance');
const {
  assertExcludedThirdPartyFiles,
  assertThirdPartySourceTrees
} = require('./third-party-source-compliance');
const asar = require('@electron/asar');

const unpackedRoot = path.resolve(process.argv[2] || '');
const expectedVersion = String(process.argv[3] || '0.9.0.0').trim();
const verificationMode = String(process.argv[4] || 'unsigned').trim().toLowerCase();
const expectedPublisher = verificationMode === 'signed'
  ? 'CN=Nova Tweaks Internal Test'
  : 'CN=AppModelSamples, OID.2.25.311729368913984317654407730594956997722=1';

function fail(message) {
  console.error(`[msix-verify] ${message}`);
  process.exit(1);
}

function requireFile(relativePath) {
  const absolutePath = path.join(unpackedRoot, ...relativePath.split('/'));
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile() || fs.statSync(absolutePath).size <= 0) {
    fail(`Packaged file is missing or empty: ${relativePath}`);
  }
  return absolutePath;
}

const manifestPath = requireFile('AppxManifest.xml');
const manifest = fs.readFileSync(manifestPath, 'utf8');
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tagHasAttribute(tagName, attributeName, value) {
  const expression = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*\\b${escapeRegExp(attributeName)}="${escapeRegExp(value)}"`,
    's'
  );
  return expression.test(manifest);
}

const manifestChecks = [
  [tagHasAttribute('Identity', 'Name', 'NovaTweaks.InternalTest'), 'test package identity'],
  [
    tagHasAttribute(
      'Identity',
      'Publisher',
      expectedPublisher
    ),
    verificationMode === 'signed' ? 'local test publisher' : 'reserved unsigned-package publisher OID'
  ],
  [tagHasAttribute('Identity', 'Version', expectedVersion), 'MSIX version'],
  [tagHasAttribute('Identity', 'ProcessorArchitecture', 'x64'), 'x64 architecture'],
  [tagHasAttribute('Application', 'EntryPoint', 'Windows.FullTrustApplication'), 'full-trust entry point'],
  [tagHasAttribute('TargetDeviceFamily', 'MinVersion', '10.0.19041.0'), 'minimum Windows version'],
  [tagHasAttribute('rescap:Capability', 'Name', 'runFullTrust'), 'runFullTrust capability'],
  [tagHasAttribute('rescap:Capability', 'Name', 'allowElevation'), 'allowElevation capability']
];

for (const [matches, label] of manifestChecks) {
  if (!matches) {
    fail(`Manifest does not contain the expected ${label}.`);
  }
}

requireFile('app/NovaTweaks.exe');
requireFile('app/resources/capture/PresentMon/PresentMon.exe');
requireFile('app/resources/capture/PresentMon/PresentMonLegacy.exe');
requireFile('app/resources/tools/nova-presentmon-helper/NovaPresentMonHelper.exe');
requireFile('app/resources/tools/presentmon/PresentMonAPI2Loader.dll');
requireFile('app/resources/tools/presentmon/Intel-PresentMon.dll');
requireFile('app/resources/helpers/NovaGameDetector/publish/win-x64/NovaGameDetector.exe');
requireFile('app/resources/tools/nvidia-display-helper/bin/nvidia-display-helper.exe');
requireFile('app/resources/tools/nvidia-profile-helper/bin/nvidia-profile-helper.exe');
requireFile('app/resources/resources/monitoring/LibreHardwareMonitor/patched/LibreHardwareMonitor.exe');
const packagedAppRoot = path.join(unpackedRoot, 'app');
const thirdPartyManifest = loadThirdPartyManifest(packagedAppRoot);
assertThirdPartyFiles(packagedAppRoot, thirdPartyManifest, 'packagedPath');
assertThirdPartyLegalFiles(packagedAppRoot, thirdPartyManifest);
assertThirdPartySourceTrees(packagedAppRoot, thirdPartyManifest, 'packagedPath');
assertExcludedThirdPartyFiles(packagedAppRoot, thirdPartyManifest, 'packagedPaths');

assertMonitoringRuntimeIntegrity(
  path.join(
    unpackedRoot,
    'app',
    'resources',
    'resources',
    'monitoring',
    'LibreHardwareMonitor'
  )
);
for (const [policyName, relativeDirectory] of [
  ['presentmon-capture', 'capture/PresentMon'],
  ['presentmon-tools', 'tools/presentmon'],
  ['presentmon-helper', 'tools/nova-presentmon-helper'],
  ['game-detector-x64', 'helpers/NovaGameDetector/publish/win-x64'],
  ['nvidia-display-helper', 'tools/nvidia-display-helper/bin'],
  ['nvidia-profile-helper', 'tools/nvidia-profile-helper/bin']
]) {
  assertBundledSidecarIntegrity(
    path.join(unpackedRoot, 'app', 'resources', ...relativeDirectory.split('/')),
    policyName
  );
}

const asarPath = requireFile('app/resources/app.asar');
let signingConfig;
try {
  signingConfig = asar.extractFile(
    asarPath,
    path.join('electron', 'generated', 'signing-config.js')
  ).toString('utf8');
} catch (error) {
  fail(`Unable to read the embedded signing configuration: ${error.message}`);
}

if (
  !signingConfig.includes('BEGIN PUBLIC KEY') ||
  !signingConfig.includes('NOVA_REQUIRE_TWEAK_SIGNATURES') ||
  !signingConfig.includes('NOVA_REQUIRE_UPDATE_SIGNATURES')
) {
  fail('Embedded tweak/update signature verification configuration is incomplete.');
}
if (/BEGIN (?:RSA |EC )?PRIVATE KEY/.test(signingConfig)) {
  fail('A private key was detected inside app.asar.');
}

console.log('[msix-verify] Manifest, runtime resources and embedded tweak/update signing configuration are valid.');
