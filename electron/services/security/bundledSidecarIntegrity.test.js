const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  SIDECAR_POLICIES,
  assertBundledSidecarIntegrity,
  computeSidecarSha256
} = require('./bundledSidecarIntegrity');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const CHECKED_IN_SIDECARS = {
  'game-detector-x64': path.join(
    PROJECT_ROOT,
    'resources',
    'helpers',
    'NovaGameDetector',
    'publish',
    'win-x64'
  ),
  'nvidia-display-helper': path.join(
    PROJECT_ROOT,
    'tools',
    'nvidia-display-helper',
    'bin'
  ),
  'nvidia-profile-helper': path.join(
    PROJECT_ROOT,
    'tools',
    'nvidia-profile-helper',
    'bin'
  ),
  'presentmon-capture': path.join(PROJECT_ROOT, 'resources', 'capture', 'PresentMon'),
  'presentmon-helper': path.join(PROJECT_ROOT, 'resources', 'tools', 'nova-presentmon-helper'),
  'presentmon-tools': path.join(PROJECT_ROOT, 'resources', 'tools', 'presentmon')
};

test('all checked-in executable sidecar sets match their pinned digest', () => {
  for (const [policyName, directoryPath] of Object.entries(CHECKED_IN_SIDECARS)) {
    assert.equal(
      computeSidecarSha256(directoryPath, policyName),
      SIDECAR_POLICIES[policyName].expectedSha256,
      policyName
    );
  }
});

test('rejects a changed or additional binary in a sidecar set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-sidecar-integrity-'));
  try {
    fs.writeFileSync(path.join(root, 'PresentMon.exe'), 'modern');
    fs.writeFileSync(path.join(root, 'PresentMonLegacy.exe'), 'legacy');
    const expected = computeSidecarSha256(root, 'presentmon-capture');
    assert.equal(
      assertBundledSidecarIntegrity(root, 'presentmon-capture', expected),
      true
    );

    fs.writeFileSync(path.join(root, 'injected.dll'), 'injected');
    assert.throws(
      () => assertBundledSidecarIntegrity(root, 'presentmon-capture', expected),
      { code: 'BUNDLED_SIDECAR_INTEGRITY_INVALID' }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
