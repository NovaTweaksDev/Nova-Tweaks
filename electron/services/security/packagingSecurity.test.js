const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const {
  assertPackagedAsarEntries
} = require(path.join(__dirname, '..', '..', '..', 'scripts', 'after-pack'));

test('desktop packaging locks code loading to an integrity-checked ASAR', () => {
  const packageMetadata = require(path.join(__dirname, '..', '..', '..', 'package.json'));
  const fuses = packageMetadata?.build?.electronFuses || {};

  assert.equal(fuses.runAsNode, false);
  assert.equal(fuses.enableCookieEncryption, true);
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(fuses.enableNodeCliInspectArguments, false);
  assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(fuses.onlyLoadAppFromAsar, true);
  assert.equal(fuses.grantFileProtocolExtraPrivileges, false);

  const packagedFiles = packageMetadata?.build?.files || [];
  assert.ok(packagedFiles.includes('electron/**/*.js'));
  assert.ok(packagedFiles.includes('!electron/**/*.test.js'));
  assert.ok(packagedFiles.includes('!electron/launcher.js'));
  assert.ok(packagedFiles.includes('!node_modules/**/*'));
  assert.ok(!packagedFiles.includes('electron/**/*'));
});

test('release packaging rejects development content in the generated ASAR', () => {
  const required = [
    '/dist/index.html',
    '/electron/main.js',
    '/electron/preload.js',
    '/electron/generated/signing-config.js'
  ];

  assert.doesNotThrow(() => assertPackagedAsarEntries(required));
  for (const forbiddenEntry of [
    '/electron/main.test.js',
    '/electron/launcher.js',
    '/electron/types.ts',
    '/node_modules/example/index.js'
  ]) {
    assert.throws(
      () => assertPackagedAsarEntries([...required, forbiddenEntry]),
      /forbidden development entry/
    );
  }
  assert.throws(
    () => assertPackagedAsarEntries(required.filter((entry) => entry !== '/electron/preload.js')),
    /missing required runtime entry/
  );
});
