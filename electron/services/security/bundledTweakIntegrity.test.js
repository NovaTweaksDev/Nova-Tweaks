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

function copyVariantResources(root) {
  for (const file of Object.keys(manifest.files)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(tweaksRoot, ...file.split('/')), target);
  }
}

test('checked-in tweak JSON and PowerShell files match the generated local manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-variant-integrity-'));
  let result;
  try {
    copyVariantResources(root);
    result = assertBundledTweakIntegrity(root, manifest);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  assert.equal(result.ok, true);
  assert.equal(result.fileCount, Object.keys(manifest.files).length);
  assert.match(result.rootHash, /^[a-f0-9]{64}$/);
});

test('rejects modified and additional bundled tweak resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tweak-integrity-'));
  try {
    copyVariantResources(root);
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
    fs.writeFileSync(absolutePath, fs.readFileSync(path.join(tweaksRoot, ...relativePath.split('/'))));
    fs.writeFileSync(path.join(root, 'unexpected.ps1'), 'unexpected');
    assert.throws(() => assertBundledTweakIntegrity(root, manifest), {
      code: 'BUNDLED_TWEAK_FILE_SET_MISMATCH'
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
