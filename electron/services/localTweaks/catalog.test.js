const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createTweakCatalog, TweakCatalogError } = require('./catalog');

function createConfig(id) {
  return {
    id,
    name: id,
    description: id,
    technical_details: id,
    profiles: [],
    execution: {
      type: 'powershell',
      script: `${id}.ps1`,
      requires_admin: false,
      timeout_ms: 30000,
      supports_status_detection: true,
      actions: {
        apply: { args: ['-State', 'On'], success_exit_codes: [0], requires_admin: false },
        detect: { args: ['-State', 'Check'], success_exit_codes: [0], requires_admin: false },
        restore: { args: ['-State', 'Off'], success_exit_codes: [0], requires_admin: false }
      }
    }
  };
}

function withCatalogFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tweak-catalog-'));
  const configsDir = path.join(root, 'configs');
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(configsDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  try {
    run({ configsDir, scriptsDir });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('rejects config filenames that do not match the tweak id', () => {
  withCatalogFixture(({ configsDir, scriptsDir }) => {
    fs.writeFileSync(
      path.join(configsDir, 'legacy-name.json'),
      JSON.stringify(createConfig('canonical_name'))
    );

    const catalog = createTweakCatalog({ configsDir, scriptsDir });
    assert.throws(
      () => catalog.listTweaks(),
      (error) => error instanceof TweakCatalogError
        && error.code === 'TWEAK_CONFIG_FILENAME_MISMATCH'
        && error.details.expectedConfigFile === 'canonical_name.json'
    );
  });
});

test('rejects duplicate tweak ids instead of choosing one config silently', () => {
  withCatalogFixture(({ configsDir, scriptsDir }) => {
    const canonicalPath = path.join(configsDir, 'duplicate_id.json');
    fs.writeFileSync(canonicalPath, JSON.stringify(createConfig('duplicate_id')));

    const originalReadDir = fs.readdirSync;
    fs.readdirSync = (directory, options) => directory === configsDir
      ? ['duplicate_id.json', 'duplicate_id.json']
      : originalReadDir(directory, options);
    try {
      const catalog = createTweakCatalog({ configsDir, scriptsDir });
      assert.throws(
        () => catalog.listTweaks(),
        (error) => error instanceof TweakCatalogError && error.code === 'TWEAK_DUPLICATE_ID'
      );
    } finally {
      fs.readdirSync = originalReadDir;
    }
  });
});
