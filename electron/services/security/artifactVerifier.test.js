const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  canonicalJson,
  getPublicKeyId,
  sha256Hex,
  verifySignedPayload,
  verifySignedPayloadWithKeyring
} = require('./artifactVerifier');

test('verifies signed artifact payloads and rejects tampering', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = {
    kind: 'nova-tweak-script',
    version: 1,
    tweakId: 'network_latency',
    script: 'network_latency.ps1',
    hash: sha256Hex('Write-Output "ok"')
  };
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey).toString('base64');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  assert.equal(verifySignedPayload({ payload, signature, publicKey: publicKeyPem }), true);
  assert.equal(verifySignedPayload({
    payload: { ...payload, hash: sha256Hex('tampered') },
    signature,
    publicKey: publicKeyPem
  }), false);
});

test('selects a rotated public key by its signed fingerprint', () => {
  const oldKeys = crypto.generateKeyPairSync('ed25519');
  const newKeys = crypto.generateKeyPairSync('ed25519');
  const newPublicKey = newKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const payload = { kind: 'rotation-test', keyId: getPublicKeyId(newPublicKey) };
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload)), newKeys.privateKey).toString('base64');
  const result = verifySignedPayloadWithKeyring({
    payload,
    signature,
    publicKeys: [oldKeys.publicKey.export({ type: 'spki', format: 'pem' }), newPublicKey]
  });
  assert.equal(result.verified, true);
  assert.equal(result.keyId, payload.keyId);
});
