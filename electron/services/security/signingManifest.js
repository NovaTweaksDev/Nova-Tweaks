const fs = require('fs');
const path = require('path');

const {
  canonicalJson,
  verifySignedPayloadWithKeyring
} = require('./artifactVerifier');

class SigningManifestError extends Error {
  constructor(message, code = 'SIGNING_MANIFEST_INVALID', details = {}) {
    super(message);
    this.name = 'SigningManifestError';
    this.code = code;
    this.details = details;
  }
}

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_MANIFEST_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const KEY_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TWEAK_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ARTIFACT_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}(?:-[A-Za-z0-9.-]+)?$/;

function assertExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SigningManifestError('Signing manifest object is invalid.');
  }
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new SigningManifestError('Signing manifest contains unknown or missing fields.');
  }
}

function normalizeKeyIds(value, maximum) {
  const source = Array.isArray(value) ? value : [];
  const result = [...new Set(source.map((entry) => String(entry || '').trim()).filter(Boolean))].sort();
  if (result.length > maximum || result.some((entry) => !KEY_ID_PATTERN.test(entry))) {
    throw new SigningManifestError('Signing manifest key list is invalid.');
  }
  return result;
}

function normalizeRevokedArtifacts(value) {
  const source = Array.isArray(value) ? value : [];
  const entries = source.map((entry) => ({
    tweakId: String(entry?.tweakId || '').trim(),
    artifactVersion: String(entry?.artifactVersion || '').trim()
  }));
  if (
    entries.length > 2048
    || entries.some((entry) => (
      !TWEAK_ID_PATTERN.test(entry.tweakId)
      || !ARTIFACT_VERSION_PATTERN.test(entry.artifactVersion)
    ))
  ) {
    throw new SigningManifestError('Signing manifest artifact revocations are invalid.');
  }
  const byIdentity = new Map(
    entries.map((entry) => [`${entry.tweakId}:${entry.artifactVersion}`, entry])
  );
  return [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => entry);
}

function parseCanonicalIsoDate(value) {
  const normalized = String(value || '').trim();
  const timestamp = Date.parse(normalized);
  if (!normalized || Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== normalized) {
    throw new SigningManifestError('Signing manifest timestamp is invalid.');
  }
  return { normalized, timestamp };
}

function normalizeManifest(input) {
  const payloadKeys = [
    'kind',
    'schemaVersion',
    'keyId',
    'issuedAt',
    'expiresAt',
    'activeKeyIds',
    'revokedKeyIds',
    'revokedTweakArtifacts'
  ];
  assertExactKeys(input, [...payloadKeys, 'signature', 'signedPayload']);
  const signedPayload = input?.signedPayload;
  const signature = String(input?.signature || '').trim();
  if (!signedPayload || typeof signedPayload !== 'object' || Array.isArray(signedPayload) || !signature) {
    throw new SigningManifestError('Signing manifest payload or signature is missing.');
  }
  assertExactKeys(signedPayload, payloadKeys);
  const issuedAt = parseCanonicalIsoDate(input.issuedAt);
  const expiresAt = parseCanonicalIsoDate(input.expiresAt);
  const normalized = {
    kind: String(input.kind || '').trim(),
    schemaVersion: Number(input.schemaVersion),
    keyId: String(input.keyId || '').trim(),
    issuedAt: issuedAt.normalized,
    expiresAt: expiresAt.normalized,
    activeKeyIds: normalizeKeyIds(input.activeKeyIds, 64),
    revokedKeyIds: normalizeKeyIds(input.revokedKeyIds, 256),
    revokedTweakArtifacts: normalizeRevokedArtifacts(input.revokedTweakArtifacts)
  };
  if (
    normalized.kind !== 'nova-signing-manifest' ||
    normalized.schemaVersion !== 1 ||
    !KEY_ID_PATTERN.test(normalized.keyId) ||
    !normalized.activeKeyIds.includes(normalized.keyId) ||
    normalized.activeKeyIds.some((keyId) => normalized.revokedKeyIds.includes(keyId)) ||
    expiresAt.timestamp <= issuedAt.timestamp ||
    expiresAt.timestamp - issuedAt.timestamp > MAX_MANIFEST_TTL_MS
  ) {
    throw new SigningManifestError('Signing manifest fields are invalid.');
  }
  if (canonicalJson(signedPayload) !== canonicalJson(normalized)) {
    throw new SigningManifestError('Signing manifest metadata does not match its signed payload.');
  }
  return { ...normalized, signature, signedPayload };
}

function createSigningManifestStore({ filePath, getPublicKeys, now = () => new Date() } = {}) {
  if (!filePath) throw new Error('Signing manifest store requires filePath.');
  const absolutePath = path.resolve(filePath);

  function verify(input, { enforceStoredRevocations = true } = {}) {
    const manifest = normalizeManifest(input);
    const verification = verifySignedPayloadWithKeyring({
      payload: manifest.signedPayload,
      signature: manifest.signature,
      publicKeys: getPublicKeys?.() || [],
      keyId: manifest.keyId
    });
    if (!verification.verified) {
      throw new SigningManifestError('Signing manifest signature verification failed.', 'SIGNING_MANIFEST_SIGNATURE_INVALID');
    }
    if (Date.parse(manifest.issuedAt) > now().getTime() + 5 * 60 * 1000) {
      throw new SigningManifestError('Signing manifest issue time is in the future.');
    }
    if (enforceStoredRevocations) {
      const stored = readStored();
      if (stored?.revokedKeyIds.includes(manifest.keyId)) {
        throw new SigningManifestError(
          'The signing manifest key was previously revoked.',
          'SIGNING_MANIFEST_KEY_REVOKED',
          { keyId: manifest.keyId }
        );
      }
    }
    return manifest;
  }

  function readStored() {
    try {
      if (!fs.existsSync(absolutePath)) return null;
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) return null;
      return verify(JSON.parse(fs.readFileSync(absolutePath, 'utf8')), { enforceStoredRevocations: false });
    } catch (_error) {
      return null;
    }
  }

  function accept(input) {
    const manifest = verify(input);
    if (Date.parse(manifest.expiresAt) <= now().getTime()) {
      throw new SigningManifestError('Signing manifest has expired.', 'SIGNING_MANIFEST_EXPIRED');
    }
    const stored = readStored();
    if (stored && Date.parse(manifest.issuedAt) < Date.parse(stored.issuedAt)) {
      throw new SigningManifestError('Signing manifest rollback was rejected.', 'SIGNING_MANIFEST_ROLLBACK');
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
      fs.renameSync(temporaryPath, absolutePath);
      if (process.platform !== 'win32') fs.chmodSync(absolutePath, 0o600);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    return manifest;
  }

  function assertNotRevoked({ keyId, tweakId, artifactVersion } = {}) {
    const manifest = readStored();
    if (!manifest) return;
    const normalizedKeyId = String(keyId || '').trim();
    if (normalizedKeyId && manifest.revokedKeyIds.includes(normalizedKeyId)) {
      throw new SigningManifestError('The artifact signing key is revoked.', 'SIGNING_KEY_REVOKED', { keyId: normalizedKeyId });
    }
    if (normalizedKeyId && !manifest.activeKeyIds.includes(normalizedKeyId)) {
      throw new SigningManifestError(
        'The artifact signing key is not active.',
        'SIGNING_KEY_NOT_ACTIVE',
        { keyId: normalizedKeyId }
      );
    }
    if (tweakId && artifactVersion && manifest.revokedTweakArtifacts.some((entry) => (
      entry.tweakId === String(tweakId) && entry.artifactVersion === String(artifactVersion)
    ))) {
      throw new SigningManifestError('The tweak artifact is revoked.', 'REMOTE_TWEAK_ARTIFACT_REVOKED', { tweakId, artifactVersion });
    }
  }

  return { accept, assertNotRevoked, readStored, verify };
}

module.exports = {
  SigningManifestError,
  createSigningManifestStore,
  normalizeManifest
};
