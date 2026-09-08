const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { canonicalJson, getPublicKeyId } = require('./artifactVerifier');
const { createSigningManifestStore } = require('./signingManifest');

function fixture() {
  const keys = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const keyId = getPublicKeyId(keys.publicKey);
  const signedPayload = {
    kind: 'nova-signing-manifest',
    schemaVersion: 1,
    keyId,
    issuedAt: '2026-07-18T10:00:00.000Z',
    expiresAt: '2026-07-19T10:00:00.000Z',
    activeKeyIds: [keyId],
    revokedKeyIds: ['sha256:' + 'a'.repeat(64)],
    revokedTweakArtifacts: [{ tweakId: 'safe_test', artifactVersion: '2' }]
  };
  const manifest = {
    ...signedPayload,
    signature: crypto.sign(null, Buffer.from(canonicalJson(signedPayload)), keys.privateKey).toString('base64'),
    signedPayload
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-signing-manifest-'));
  return {
    keys,
    manifest,
    root,
    store: createSigningManifestStore({
      filePath: path.join(root, 'manifest.json'),
      getPublicKeys: () => [keys.publicKey],
      now: () => new Date('2026-07-18T11:00:00.000Z')
    })
  };
}

test('persists a valid signed manifest and blocks revoked targets', () => {
  const value = fixture();
  value.store.accept(value.manifest);
  assert.throws(() => value.store.assertNotRevoked({ keyId: 'sha256:' + 'a'.repeat(64) }), { code: 'SIGNING_KEY_REVOKED' });
  assert.throws(() => value.store.assertNotRevoked({ keyId: 'sha256:' + 'b'.repeat(64) }), { code: 'SIGNING_KEY_NOT_ACTIVE' });
  assert.throws(() => value.store.assertNotRevoked({ tweakId: 'safe_test', artifactVersion: '2' }), { code: 'REMOTE_TWEAK_ARTIFACT_REVOKED' });
  fs.rmSync(value.root, { recursive: true, force: true });
});

test('rejects a manifest signed by an untrusted key', () => {
  const value = fixture();
  value.manifest.signature = Buffer.from('invalid').toString('base64');
  assert.throws(() => value.store.accept(value.manifest), { code: 'SIGNING_MANIFEST_SIGNATURE_INVALID' });
  fs.rmSync(value.root, { recursive: true, force: true });
});

test('rejects newer manifests signed by a previously revoked root key', () => {
  const value = fixture();
  const replacementKeys = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const replacementKeyId = getPublicKeyId(replacementKeys.publicKey);
  value.store = createSigningManifestStore({
    filePath: path.join(value.root, 'manifest.json'),
    getPublicKeys: () => [value.keys.publicKey, replacementKeys.publicKey],
    now: () => new Date('2026-07-18T11:00:00.000Z')
  });
  const revokedRootPayload = {
    ...value.manifest.signedPayload,
    keyId: replacementKeyId,
    activeKeyIds: [replacementKeyId],
    revokedKeyIds: [value.manifest.keyId]
  };
  value.store.accept({
    ...revokedRootPayload,
    signature: crypto.sign(null, Buffer.from(canonicalJson(revokedRootPayload)), replacementKeys.privateKey).toString('base64'),
    signedPayload: revokedRootPayload
  });

  const unrevokedPayload = {
    ...value.manifest.signedPayload,
    issuedAt: '2026-07-18T11:01:00.000Z',
    expiresAt: '2026-07-19T11:01:00.000Z',
    revokedKeyIds: []
  };
  assert.throws(() => value.store.accept({
    ...unrevokedPayload,
    signature: crypto.sign(null, Buffer.from(canonicalJson(unrevokedPayload)), value.keys.privateKey).toString('base64'),
    signedPayload: unrevokedPayload
  }), { code: 'SIGNING_MANIFEST_KEY_REVOKED' });

  fs.rmSync(value.root, { recursive: true, force: true });
});
