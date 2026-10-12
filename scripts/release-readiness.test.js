const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { PROFILES, resolveBuildProfile } = require('./build-profile');
const { artifactName, validateRelease, verifyChecksum } = require('./validate-release');
const { writeChecksum } = require('./write-release-checksum');
const { formatDistributionNotes } = require('./release-notes');
const { auditTweaks, renderAudit } = require('./audit-store-tweaks');
const root = path.resolve(__dirname, '..');

test('release profiles reject unknown variants and conflicting unsigned broker bypasses', () => {
  for (const name of ['stable', 'store', 'candidate', 'store-candidate']) {
    assert.throws(() => resolveBuildProfile({ NOVA_BUILD_PROFILE: name, NOVA_LOCAL_TEST_BUILD: 'true' }), /conflicts/);
    assert.equal(resolveBuildProfile({ NOVA_BUILD_PROFILE: name }).localTest, false);
  }
  assert.throws(() => resolveBuildProfile({ NOVA_BUILD_PROFILE: '../stable' }));
  assert.notEqual(artifactName('preview', '1.0.4'), artifactName('stable', '1.0.4'));
  assert.notEqual(artifactName('store', '1.0.4'), artifactName('stable', '1.0.4'));
});

test('Store exclusion is compiled into main-process policy and cannot be undone by an environment flag', () => {
  const source = fs.readFileSync(path.join(root, 'electron/services/tweaks/blockedSecurityTweaks.js'), 'utf8');
  for (const store of [false, true]) {
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, process: { env: { NOVA_BUILD_PROFILE: store ? 'local' : 'store' } },
      require: (name) => name.endsWith('build-profile') ? { store } : require('../electron/services/tweaks/storeTweakPolicy.json')
    });
    for (const id of Object.keys(require('../electron/services/tweaks/storeTweakPolicy.json').exclusions)) {
      assert.equal(module.exports.isBlockedSecurityTweakId(id), store);
      assert.equal(module.exports.isBlockedSecurityTweakScriptName(id + '/' + id + '.ps1'), store);
    }
    assert.equal(module.exports.isBlockedSecurityTweakId('update_defender_signatures'), false);
  }
});

test('every current tweak has a source-backed review and Store review cannot silently go stale', () => {
  const rows = auditTweaks();
  assert.equal(rows.length, fs.readdirSync(path.join(root, 'resources/tweaks/configs')).filter((name) => name.endsWith('.json')).length);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  for (const row of rows) assert.match(row.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/STORE_TWEAK_REVIEW.md'), 'utf8').replace(/\r\n/g, '\n'), renderAudit());
});

test('Store catalog and direct privileged requests reject exclusions before any execution', async () => {
  if (!require('../electron/generated/build-profile').store) return;
  const { createTweakCatalog } = require('../electron/services/localTweaks/catalog');
  const catalog = createTweakCatalog();
  const { createDefaultOperationHandler } = require('../electron/services/admin/adminBrokerWorker');
  const handler = createDefaultOperationHandler({
    app: { isPackaged: false, getAppPath: () => root, getVersion: () => '1.0.4' }
  });
  try {
    for (const id of Object.keys(require('../electron/services/tweaks/storeTweakPolicy.json').exclusions)) {
      assert.ok(!catalog.listTweaks().some((item) => item.id === id));
      await assert.rejects(handler.handle('tweak.execute', {
        artifact: { signedPayload: { tweakId: id } }, trustMode: 'bundled-integrity',
        action: 'On', params: { State: 'On', Silent: true }
      }), { code: 'TWEAK_BLOCKED_BY_SECURITY_POLICY' });
    }
    await assert.rejects(handler.handle('tweak.execute', {
      artifact: { tweakId: 'fixture' }, action: 'On', params: {}
    }), { code: 'TWEAK_BLOCKED_BY_SECURITY_POLICY' });
  } finally { handler.dispose(); }
});

async function packageFixture(t, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-release-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const archive = path.join(directory, 'win-unpacked/resources/app.asar');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  function write(file, data) {
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  const profile = { name, ...PROFILES[name] };
  write('package.json', JSON.stringify({ version: require('../package.json').version }));
  write('electron/generated/build-profile.js', 'module.exports = ' + JSON.stringify(profile) + ';\n');
  write('electron/generated/signing-config.js', 'module.exports = ' + JSON.stringify({ NOVA_LOCAL_TEST_BUILD: profile.localTest }) + ';\n');
  const tweakRoot = path.join(directory, 'win-unpacked/resources/tweaks');
  fs.mkdirSync(tweakRoot, { recursive: true });
  fs.writeFileSync(path.join(tweakRoot, 'fixture.txt'), 'unchanged');
  const sha256 = crypto.createHash('sha256').update('unchanged').digest('hex');
  write('electron/generated/bundled-tweaks-manifest.js', 'module.exports = ' + JSON.stringify({ schemaVersion: 1, files: { 'fixture.txt': { sha256, size: 9 } } }) + ';\n');
  await asar.createPackage(source, archive);
  const metadata = { version: require('../package.json').version, profile: name, commit: 'a'.repeat(40), sourceDirty: false };
  fs.writeFileSync(path.join(directory, 'release-build.json'), JSON.stringify(metadata));
  const installer = artifactName(name, metadata.version);
  fs.writeFileSync(path.join(directory, installer), 'test installer bytes');
  return { directory, source, archive, write, installer, metadata };
}

test('publication rejects a signed-looking candidate, wrong source commit, tampered checksum and modified resources', async (t) => {
  const f = await packageFixture(t, 'candidate');
  assert.throws(() => validateRelease(f.directory, 'stable'), /mismatch/);
  assert.throws(() => validateRelease(f.directory, 'candidate', { expectedCommit: 'b'.repeat(40) }), /source commit/);
  validateRelease(f.directory, 'candidate', { expectedCommit: f.metadata.commit });
  fs.writeFileSync(path.join(f.directory, 'release-build.json'), JSON.stringify({ ...f.metadata, sourceDirty: true }));
  assert.throws(() => validateRelease(f.directory, 'candidate', { requireClean: true }), /clean reviewed source/);
  fs.writeFileSync(path.join(f.directory, 'release-build.json'), JSON.stringify(f.metadata));
  writeChecksum(f.directory, f.installer);
  verifyChecksum(f.directory, f.installer);
  fs.appendFileSync(path.join(f.directory, f.installer), 'changed after signing');
  assert.throws(() => verifyChecksum(f.directory, f.installer), /checksum mismatch/);
  assert.throws(() => writeChecksum(f.directory, '../outside.exe'), /Invalid/);
  fs.appendFileSync(path.join(f.directory, 'win-unpacked/resources/tweaks/fixture.txt'), 'tamper');
  assert.throws(() => validateRelease(f.directory, 'candidate'), { code: 'BUNDLED_TWEAK_CONTENT_MISMATCH' });
});

test('publication rejects embedded secret files and local-test identity in a Stable package', async (t) => {
  const f = await packageFixture(t, 'stable');
  f.write('.env', 'TEST_SECRET=fixture');
  await asar.createPackage(f.source, f.archive);
  assert.throws(() => validateRelease(f.directory, 'stable'), /Secret file/);
  fs.rmSync(path.join(f.source, '.env'));
  f.write('electron/generated/signing-config.js', 'module.exports = {"NOVA_LOCAL_TEST_BUILD":true};\n');
  await asar.createPackage(f.source, f.archive);
  assert.throws(() => validateRelease(f.directory, 'stable'), /broker bypass/);
});

test('release notes cannot claim signing from absent or failed evidence', () => {
  assert.throws(() => formatDistributionNotes('Changes', 'stable', {}), /report/);
  assert.match(formatDistributionNotes('Changes', 'preview', {}), /Unsigned preview/);
  const report = { mode: 'Stable', failures: [], files: [{ owner: 'Nova', status: 'NotSigned' }] };
  assert.throws(() => formatDistributionNotes('Changes', 'stable', report), /incomplete/);
});

test('stable tags cannot publish and publication requires protected signing, final signature checks and explicit intent', () => {
  const candidate = fs.readFileSync(path.join(root, '.github/workflows/release-windows.yml'), 'utf8');
  assert.doesNotMatch(candidate, /gh release create|contents: write|dist:local/);
  const publish = fs.readFileSync(path.join(root, '.github/workflows/publish-signed-windows.yml'), 'utf8');
  assert.match(publish, /environment: nova-signing/);
  assert.match(publish, /self-hosted, Windows, X64, nova-signing/);
  assert.match(publish, /if: inputs.publish && inputs.variant == 'stable'/);
  assert.ok(publish.indexOf('verify-windows-signatures.ps1') < publish.indexOf('gh release create'));
  assert.match(publish, /default: false/);
});

test('installer keeps the existing Windows identity and per-user data preservation', () => {
  const build = require('../package.json').build;
  assert.equal(build.appId, 'de.novatweaks.desktop');
  assert.equal(build.nsis.guid, 'b7139bf8-d59a-5795-b95b-57eeb1dbd620');
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.packElevateHelper, false);
  assert.equal(build.win.requestedExecutionLevel, 'asInvoker');
  assert.match(fs.readFileSync(path.join(root, 'scripts/installer-hooks.nsh'), 'utf8'), /IfNot.*isUpdated/);
});

test('validated replacement is retained and a failed copy preserves the previous release', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-retention-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'dist-release');
  const source = path.join(directory, 'validated');
  fs.mkdirSync(path.join(output, 'last-working'), { recursive: true });
  fs.writeFileSync(path.join(output, 'last-working', 'installer.exe'), 'last working');
  const { promoteValidatedRelease } = require('./retain-release-output');
  assert.throws(() => promoteValidatedRelease(path.join(directory, 'missing'), 'stable', output));
  assert.equal(fs.readFileSync(path.join(output, 'last-working', 'installer.exe'), 'utf8'), 'last working');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'installer.exe'), 'validated replacement');
  const selected = promoteValidatedRelease(source, 'stable', output);
  assert.deepEqual(fs.readdirSync(output), [path.basename(selected)]);
  assert.equal(fs.readFileSync(path.join(selected, 'installer.exe'), 'utf8'), 'validated replacement');
  assert.throws(() => promoteValidatedRelease(selected, 'stable', output), /outside/);
});

test('Windows signature gate rejects an unsigned Nova PE instead of accepting an empty report', { skip: process.platform !== 'win32' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pe-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = Buffer.alloc(128);
  binary.writeUInt16LE(0x5a4d); binary.writeInt32LE(64, 60); binary.writeUInt32LE(0x4550, 64);
  fs.writeFileSync(path.join(directory, 'NovaTweaks.exe'), binary);
  assert.throws(() => execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/verify-windows-signatures.ps1'),
    '-Root', directory, '-Mode', 'Stable', '-ExpectedThumbprint', '0'.repeat(40), '-SignTool', 'unused.exe'
  ], { env: require('./windows-powershell-env').windowsPowerShellEnv(), windowsHide: true, stdio: 'pipe' }),
  (error) => error.status === 1 && /Signature validation blocked/.test(error.stderr.toString()));
});
