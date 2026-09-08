const crypto = require('crypto');

function normalizePublicKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function getPublicKeyId(publicKey) {
  const normalizedPublicKey = normalizePublicKey(publicKey);
  if (!normalizedPublicKey) return '';
  const keyObject = crypto.createPublicKey(normalizedPublicKey);
  if (keyObject.asymmetricKeyType !== 'ed25519') {
    return '';
  }
  const der = keyObject.export({ type: 'spki', format: 'der' });
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
}

function normalizePublicKeys(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [value];
  const keys = [];
  for (const candidate of source) {
    const publicKey = normalizePublicKey(candidate);
    if (!publicKey || keys.includes(publicKey)) continue;
    keys.push(publicKey);
  }
  return keys;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function verifySignedPayload({ payload, signature, publicKey }) {
  const normalizedPublicKey = normalizePublicKey(publicKey);
  const normalizedSignature = String(signature || '').trim();
  if (
    !normalizedPublicKey
    || !/^[A-Za-z0-9+/]{86}==$/.test(normalizedSignature)
  ) {
    return false;
  }
  try {
    const keyObject = crypto.createPublicKey(normalizedPublicKey);
    if (keyObject.asymmetricKeyType !== 'ed25519') {
      return false;
    }
    return crypto.verify(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      keyObject,
      Buffer.from(normalizedSignature, 'base64')
    );
  } catch (_error) {
    return false;
  }
}

function verifySignedPayloadWithKeyring({ payload, signature, publicKeys, keyId }) {
  const requestedKeyId = String(keyId || payload?.keyId || '').trim();
  const keys = normalizePublicKeys(publicKeys);
  for (const publicKey of keys) {
    let candidateKeyId;
    try {
      candidateKeyId = getPublicKeyId(publicKey);
    } catch (_error) {
      continue;
    }
    if (requestedKeyId && candidateKeyId !== requestedKeyId) continue;
    if (verifySignedPayload({ payload, signature, publicKey })) {
      return { verified: true, keyId: candidateKeyId };
    }
  }
  return { verified: false, keyId: requestedKeyId };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

module.exports = {
  canonicalJson,
  getPublicKeyId,
  normalizePublicKeys,
  sha256Hex,
  verifySignedPayload,
  verifySignedPayloadWithKeyring
};
