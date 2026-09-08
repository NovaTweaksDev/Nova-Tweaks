const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { canonicalJson, verifySignedPayload } = require('../security/artifactVerifier');
const {
  buildSignedPayload,
  createRemoteTweakArtifactCache,
  sha256Hex
} = require('./remoteTweakArtifactCache');

function createFixture(options = {}) {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-remote-tweak-cache-'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const cache = createRemoteTweakArtifactCache({
    cacheRoot,
    getAppVersion: () => '1.0.0',
    verifySignature: ({ payload, signature }) => verifySignedPayload({ payload, signature, publicKey })
  });

  function artifact(overrides = {}) {
    const content = overrides.content ?? 'Write-Output "ok"';
    const base = {
      tweakId: 'windows_game_mode',
      artifactVersion: '2026.07.10.1',
      scriptFileName: 'windows_game_mode.ps1',
      sha256: sha256Hex(content),
      allowedActions: ['Check', 'Off', 'On'],
      allowedParameters: [],
      requiresAdmin: true,
      requiresReboot: false,
      minimumAppVersion: '',
      expiresAt: '',
      revoked: false,
      content,
      ...overrides
    };
    const signedPayload = buildSignedPayload(base);
    return {
      ...base,
      signedPayload,
      signature: crypto.sign(null, Buffer.from(canonicalJson(signedPayload), 'utf8'), privateKey).toString('base64')
    };
  }

  return { artifact, cache, cacheRoot };
}

test('stores a valid signed remote tweak download atomically in its versioned cache directory', async () => {
  const fixture = createFixture();
  const stored = await fixture.cache.storeArtifact(fixture.artifact());

  assert.equal(stored.artifactVersion, '2026.07.10.1');
  assert.equal(stored.scriptRelativePath, 'windows_game_mode/2026.07.10.1/script.ps1');
  assert.ok(fs.existsSync(path.join(fixture.cacheRoot, 'windows_game_mode', '2026.07.10.1', 'script.ps1')));
  assert.ok(fs.existsSync(path.join(fixture.cacheRoot, 'windows_game_mode', '2026.07.10.1', 'metadata.json')));
});

test('rejects a download whose content does not match its SHA-256', async () => {
  const fixture = createFixture();
  assert.throws(
    () => fixture.cache.storeArtifact(fixture.artifact({ sha256: '0'.repeat(64) })),
    (error) => error?.code === 'REMOTE_TWEAK_SCRIPT_HASH_MISMATCH'
  );
});

test('cleans abandoned temporary download files at startup', () => {
  const fixture = createFixture();
  const orphan = path.join(fixture.cacheRoot, 'windows_game_mode', '.tmp-orphan');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'script.ps1'), 'partial', 'utf8');

  fixture.cache.cleanupTemporaryFiles();
  assert.equal(fs.existsSync(orphan), false);
});

test('reuses a previously validated cache version instead of overwriting it', async () => {
  const fixture = createFixture();
  const artifact = fixture.artifact();
  await fixture.cache.storeArtifact(artifact);
  const storedAgain = await fixture.cache.storeArtifact(artifact);

  assert.equal(storedAgain.sha256, artifact.sha256);
  assert.equal(fs.readFileSync(path.join(fixture.cacheRoot, 'windows_game_mode', '2026.07.10.1', 'script.ps1'), 'utf8'), artifact.content);
});

test('rejects a server response that attempts to reuse an artifact version for different content', async () => {
  const fixture = createFixture();
  await fixture.cache.storeArtifact(fixture.artifact());
  await assert.rejects(
    () => fixture.cache.storeArtifact(fixture.artifact({ content: 'Write-Output "different"' })),
    (error) => error?.code === 'REMOTE_TWEAK_ARTIFACT_VERSION_CONFLICT'
  );
});

test('rejects a locally manipulated cached script immediately before execution', async () => {
  const fixture = createFixture();
  await fixture.cache.storeArtifact(fixture.artifact());
  fs.writeFileSync(path.join(fixture.cacheRoot, 'windows_game_mode', '2026.07.10.1', 'script.ps1'), 'Write-Output "tampered"', 'utf8');

  await assert.rejects(
    async () => fixture.cache.validateForExecution('windows_game_mode', '2026.07.10.1', 'On'),
    (error) => error?.code === 'integrity_failed'
  );
});

test('rejects locally manipulated signed metadata immediately before execution', async () => {
  const fixture = createFixture();
  await fixture.cache.storeArtifact(fixture.artifact());
  const metadataPath = path.join(fixture.cacheRoot, 'windows_game_mode', '2026.07.10.1', 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadata.requiresAdmin = false;
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  assert.throws(
    () => fixture.cache.validateForExecution('windows_game_mode', '2026.07.10.1', 'On'),
    (error) => error?.code === 'REMOTE_TWEAK_SIGNATURE_METADATA_MISMATCH'
  );
});

test('rejects a valid artifact when verified with the wrong public key', () => {
  const fixture = createFixture();
  const wrongKeys = crypto.generateKeyPairSync('ed25519');
  const wrongPublicKey = wrongKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const wrongKeyCache = createRemoteTweakArtifactCache({
    cacheRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-remote-tweak-wrong-key-')),
    getAppVersion: () => '1.0.0',
    verifySignature: ({ payload, signature }) => verifySignedPayload({ payload, signature, publicKey: wrongPublicKey })
  });

  assert.throws(
    () => wrongKeyCache.storeArtifact(fixture.artifact()),
    (error) => error?.code === 'REMOTE_TWEAK_SCRIPT_SIGNATURE_INVALID'
  );
});

test('rejects invalid tweak IDs and unknown artifact actions', async () => {
  const fixture = createFixture();
  assert.throws(
    () => fixture.cache.storeArtifact(fixture.artifact({ tweakId: '../outside' })),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_ID'
  );
  await fixture.cache.storeArtifact(fixture.artifact());
  await assert.rejects(
    async () => fixture.cache.validateForExecution('windows_game_mode', '2026.07.10.1', 'Execute'),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_ACTION'
  );
});

test('serializes two simultaneous downloads of the same artifact version', async () => {
  const fixture = createFixture();
  const artifact = fixture.artifact();
  const [left, right] = await Promise.all([
    fixture.cache.storeArtifact(artifact),
    fixture.cache.storeArtifact(artifact)
  ]);

  assert.equal(left.scriptRelativePath, right.scriptRelativePath);
  assert.equal(fs.readdirSync(path.join(fixture.cacheRoot, 'windows_game_mode')).filter((name) => name.startsWith('.tmp-')).length, 0);
});

test('uses only a valid, unexpired cached artifact for offline execution', async () => {
  const fixture = createFixture();
  await fixture.cache.storeArtifact(fixture.artifact());
  const cached = fixture.cache.getLatestValidArtifact('windows_game_mode', { action: 'On' });
  assert.equal(cached.artifactVersion, '2026.07.10.1');

  const expired = fixture.artifact({ artifactVersion: '2026.07.10.2', expiresAt: '2000-01-01T00:00:00.000Z' });
  assert.throws(
    () => fixture.cache.storeArtifact(expired),
    (error) => error?.code === 'REMOTE_TWEAK_ARTIFACT_EXPIRED'
  );
});

test('marks a cached version unusable when a signed server revocation is received', async () => {
  const fixture = createFixture();
  await fixture.cache.storeArtifact(fixture.artifact());
  fixture.cache.markArtifactRevoked(fixture.artifact({ revoked: true }));

  assert.throws(
    () => fixture.cache.getLatestValidArtifact('windows_game_mode', { action: 'On' }),
    (error) => error?.code === 'REMOTE_TWEAK_ARTIFACT_REVOKED'
  );
});
