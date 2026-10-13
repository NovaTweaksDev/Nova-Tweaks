const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { signingContentSha256 } = require('./pe-signing-content');
const policy = require('./store-redistribution-policy.json');

function prepareStoreSigning(root, sign, hashes) {
  const stage = path.join(root, '.cache', 'store-signing');
  const monitoring = require('../electron/services/monitoring/monitoringIntegrity');
  monitoring.assertMonitoringRuntimeIntegrity(path.join(root, 'resources/monitoring/LibreHardwareMonitor'), monitoring.EXPECTED_CRITICAL_RUNTIME_SHA256);
  require('../electron/services/security/bundledSidecarIntegrity')
    .assertBundledSidecarIntegrity(path.join(root, 'resources/capture/PresentMon'), 'presentmon-capture');
  for (const entry of policy.files) {
    for (const license of entry.licenseFiles) {
      if (!fs.statSync(path.join(root, license)).isFile() || !fs.readFileSync(path.join(root, license)).length) {
        throw new Error('Redistribution license record missing: ' + license);
      }
    }
  }
  fs.rmSync(stage, { recursive: true, force: true });
  const resources = ['resources/monitoring', 'resources/capture/PresentMon'];
  for (const resource of resources) fs.cpSync(path.join(root, resource), path.join(stage, resource), { recursive: true });
  fs.cpSync(path.join(root, 'node_modules/electron/dist'), path.join(stage, 'electron'), { recursive: true });
  const fullHashes = {};
  const evidence = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'third-party-components.json'), 'utf8'));
  for (const entry of policy.files) {
    const source = path.join(root, entry.source);
    const original = fs.readFileSync(source);
    const originalSha256 = crypto.createHash('sha256').update(original).digest('hex');
    if (originalSha256 !== entry.sha256 || signingContentSha256(original) !== entry.contentSha256) {
      throw new Error('Store redistribution source changed: ' + entry.path);
    }
    const target = path.join(stage, entry.staged);
    const signature = sign(target); // Signer refuses any pre-existing certificate.
    const signed = fs.readFileSync(target);
    if (signingContentSha256(signed) !== entry.contentSha256) throw new Error('Signing changed PE content: ' + entry.path);
    const signedSha256 = crypto.createHash('sha256').update(signed).digest('hex');
    fullHashes[entry.path] = signedSha256;
    const component = manifest.components.find(component => component.packagedPath === entry.path);
    if (component) {
      component.originalSha256 = component.sha256;
      component.originalAuthenticode = component.authenticode;
      component.sha256 = signedSha256.toUpperCase();
      component.authenticode = signature;
      if (component.applicationAssemblySha256) component.applicationAssemblySha256 = component.sha256;
      component.verification += ' Store distribution adds verified Nova Authenticode; original SHA-256 and signature status are retained separately. Executable content is unchanged.';
    }
    evidence.push({ path: entry.path, originalSha256, signedSha256, contentSha256: entry.contentSha256 });
  }
  hashes['monitoring-runtime'] = monitoring.computeCriticalRuntimeSha256(path.join(stage, 'resources/monitoring/LibreHardwareMonitor'));
  hashes['presentmon-capture'] = require('../electron/services/security/bundledSidecarIntegrity')
    .computeSidecarSha256(path.join(stage, 'resources/capture/PresentMon'), 'presentmon-capture');
  hashes['third-party-files'] = fullHashes;
  fs.writeFileSync(path.join(stage, 'signing-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  fs.writeFileSync(path.join(stage, 'third-party-components.json'), JSON.stringify(manifest, null, 2) + '\n');
}
module.exports = { prepareStoreSigning };
