const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  assertThirdPartyFiles,
  assertThirdPartyLegalFiles,
  assertThirdPartySigningExclusions,
  loadThirdPartyManifest
} = require(path.join(__dirname, '..', '..', '..', 'scripts', 'third-party-compliance'));
const {
  assertExcludedThirdPartyFiles,
  assertThirdPartySourceTrees
} = require(path.join(__dirname, '..', '..', '..', 'scripts', 'third-party-source-compliance'));

const projectDirectory = path.join(__dirname, '..', '..', '..');

test('checked-in third-party binaries and original legal files match the compliance manifest', () => {
  const manifest = loadThirdPartyManifest(projectDirectory);
  assert.equal(manifest.components.length, 3);
  assert.deepEqual(
    manifest.components.map((component) => component.fileName).sort(),
    ['LibreHardwareMonitor.exe', 'PresentMon.exe', 'PresentMonLegacy.exe'].sort()
  );
  assertThirdPartyFiles(projectDirectory, manifest, 'repositoryPath');
  assertThirdPartyLegalFiles(projectDirectory, manifest);
  assertThirdPartySourceTrees(projectDirectory, manifest, 'repositoryPath');
  assertExcludedThirdPartyFiles(projectDirectory, manifest, 'repositoryPaths');
});

test('Windows packaging excludes every third-party executable from Nova signing', () => {
  const manifest = loadThirdPartyManifest(projectDirectory);
  const packageMetadata = require(path.join(projectDirectory, 'package.json'));
  assert.doesNotThrow(() => assertThirdPartySigningExclusions(packageMetadata.build, manifest));
  const extraFiles = packageMetadata.build.extraFiles || [];
  for (const expectedSource of [
    'LICENSE',
    'TRADEMARKS.MD',
    'THIRD-PARTY-NOTICES.md',
    'third-party-components.json',
    'licenses',
    'resources/monitoring/LibreHardwareMonitor'
  ]) {
    assert.ok(extraFiles.some((entry) => entry.from === expectedSource));
  }
});

test('third-party hash verification rejects a modified binary', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-third-party-'));
  try {
    const binaryPath = path.join(temporaryDirectory, 'vendor.exe');
    fs.writeFileSync(binaryPath, 'modified vendor payload');
    assert.throws(
      () => assertThirdPartyFiles(temporaryDirectory, {
        components: [{
          fileName: 'vendor.exe',
          repositoryPath: 'vendor.exe',
          sha256: '0'.repeat(64)
        }]
      }, 'repositoryPath'),
      /hash mismatch/
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
