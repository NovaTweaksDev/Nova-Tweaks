const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const { assertBundledTweakIntegrity } = require('../electron/services/security/bundledTweakIntegrity');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function readGeneratedJson(archive, entry) {
  const source = asar.extractFile(archive, entry.split('/').join(path.sep)).toString('utf8');
  const match = source.match(/module\.exports\s*=\s*([\s\S]*);\s*$/);
  if (!match) throw new Error(`Invalid generated module: ${entry}`);
  return JSON.parse(match[1]);
}
function artifactName(profile, version) {
  return `NovaTweaks-${profile === 'stable' ? '' : profile + '-'}Setup-${version}-x64.exe`;
}
function validateRelease(directory, expectedProfile, { requireInstaller = true, expectedCommit, requireClean = false } = {}) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'release-build.json'), 'utf8'));
  const pkg = require('../package.json');
  if (metadata.version !== pkg.version || metadata.profile !== expectedProfile || !/^[a-f0-9]{40}$/.test(metadata.commit)) {
    throw new Error('Release version, profile or provenance mismatch.');
  }
  if (expectedCommit && metadata.commit !== expectedCommit) throw new Error('Release does not match the selected source commit.');
  if (requireClean && metadata.sourceDirty !== false) throw new Error('Publication requires a build from clean reviewed source.');
  const archive = path.join(directory, 'win-unpacked', 'resources', 'app.asar');
  asar.uncache(archive);
  const profile = readGeneratedJson(archive, 'electron/generated/build-profile.js');
  const expected = require('./build-profile').PROFILES[expectedProfile];
  if (!expected || profile.name !== expectedProfile || profile.store !== expected.store || profile.signed !== expected.signed || profile.localTest !== expected.localTest) {
    throw new Error('Embedded build profile does not match the release variant.');
  }
  const embeddedPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (embeddedPackage.version !== pkg.version) throw new Error('Embedded application version mismatch.');
  const signingConfig = readGeneratedJson(archive, 'electron/generated/signing-config.js');
  if (signingConfig.NOVA_LOCAL_TEST_BUILD !== expected.localTest) throw new Error('Unexpected unsigned broker bypass.');
  for (const entry of asar.listPackage(archive)) {
    if (/\.(?:pfx|p12|key|pem)$|(?:^|\/)\.env(?:\.|$)/i.test(entry.replace(/\\/g, '/'))) throw new Error('Secret file in application archive.');
  }
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(JSON.stringify(signingConfig))) throw new Error('Private key in generated public configuration.');
  const tweakManifest = readGeneratedJson(archive, 'electron/generated/bundled-tweaks-manifest.js');
  assertBundledTweakIntegrity(path.join(directory, 'win-unpacked', 'resources', 'tweaks'), tweakManifest);
  if (expected.store) {
    for (const id of Object.keys(require('../electron/services/tweaks/storeTweakPolicy.json').exclusions)) {
      if (Object.keys(tweakManifest.files).some((file) => file === `configs/${id}.json` || file.startsWith(`scripts/${id}/`))) {
        throw new Error(`Excluded Store resource embedded: ${id}`);
      }
    }
  }
  if (requireInstaller) {
    const installers = fs.readdirSync(directory).filter((file) => /\.exe$/i.test(file));
    const expectedName = artifactName(expectedProfile, pkg.version);
    if (installers.length !== 1 || installers[0] !== expectedName) throw new Error('Unexpected installer name or count.');
    metadata.installerSha256 = hashFile(path.join(directory, expectedName));
    metadata.installer = expectedName;
  }
  return metadata;
}
function verifyChecksum(directory, artifact) {
  const expected = `${hashFile(path.join(directory, artifact))}  ${artifact}\n`;
  if (fs.readFileSync(path.join(directory, 'checksums.txt'), 'utf8') !== expected) throw new Error('Final installer checksum mismatch.');
}
if (require.main === module) {
  const directory = path.resolve(process.argv[2] || '');
  const profile = process.argv[3];
  const result = validateRelease(directory, profile, { expectedCommit: process.env.NOVA_RELEASE_COMMIT, requireClean: true });
  verifyChecksum(directory, result.installer);
  console.log(`Validated ${profile} release ${result.version} (${result.commit}).`);
}
module.exports = { hashFile, readGeneratedJson, validateRelease, verifyChecksum, artifactName };
