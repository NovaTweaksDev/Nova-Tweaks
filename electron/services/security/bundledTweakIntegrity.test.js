const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const manifest = require('../../generated/bundled-tweaks-manifest');
const {
  assertBundledTweakContent,
  assertBundledTweakIntegrity
} = require('./bundledTweakIntegrity');

const projectRoot = path.join(__dirname, '..', '..', '..');
const tweaksRoot = path.join(projectRoot, 'resources', 'tweaks');

test('checked-in tweak JSON and PowerShell files match the generated local manifest', () => {
  const result = assertBundledTweakIntegrity(tweaksRoot, manifest);
  assert.equal(result.ok, true);
  assert.equal(result.fileCount, Object.keys(manifest.files).length);
  assert.match(result.rootHash, /^[a-f0-9]{64}$/);
});

test('rejects modified and additional bundled tweak resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tweak-integrity-'));
  try {
    fs.cpSync(tweaksRoot, root, { recursive: true });
    const relativePath = Object.keys(manifest.files).find((entry) => entry.endsWith('.json'));
    const absolutePath = path.join(root, ...relativePath.split('/'));
    fs.appendFileSync(absolutePath, ' ');
    assert.throws(() => assertBundledTweakIntegrity(root, manifest), {
      code: 'BUNDLED_TWEAK_CONTENT_MISMATCH'
    });

    assert.throws(
      () => assertBundledTweakContent(relativePath, fs.readFileSync(absolutePath), manifest),
      { code: 'BUNDLED_TWEAK_CONTENT_MISMATCH' }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
