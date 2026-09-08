const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TWEAK_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ARTIFACT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KNOWN_ACTIONS = ['Check', 'On', 'Off'];
const PARAMETER_TYPES = ['string', 'number', 'boolean'];
const METADATA_FILE_NAME = 'metadata.json';
const SCRIPT_FILE_NAME = 'script.ps1';

class RemoteTweakArtifactCacheError extends Error {
  constructor(message, code = 'REMOTE_TWEAK_CACHE_ERROR', details = {}) {
    super(message);
    this.name = 'RemoteTweakArtifactCacheError';
    this.code = code;
    this.details = details;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function normalizeTweakId(value) {
  const tweakId = String(value || '').trim();
  if (!TWEAK_ID_PATTERN.test(tweakId)) {
    throw new RemoteTweakArtifactCacheError('Remote tweak id is invalid.', 'REMOTE_TWEAK_INVALID_ID', { tweakId });
  }
  return tweakId;
}

function normalizeArtifactVersion(value) {
  const artifactVersion = String(value || '').trim();
  if (!ARTIFACT_VERSION_PATTERN.test(artifactVersion) || artifactVersion.includes('..')) {
    throw new RemoteTweakArtifactCacheError('Remote tweak artifact version is invalid.', 'REMOTE_TWEAK_INVALID_ARTIFACT_VERSION', { artifactVersion });
  }
  return artifactVersion;
}

function normalizeActions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RemoteTweakArtifactCacheError('Remote tweak allowed actions are missing.', 'REMOTE_TWEAK_ACTIONS_MISSING');
  }
  const actions = [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))].sort();
  if (actions.some((entry) => !KNOWN_ACTIONS.includes(entry))) {
    throw new RemoteTweakArtifactCacheError('Remote tweak contains an unsupported action.', 'REMOTE_TWEAK_INVALID_ACTION', { actions });
  }
  return actions;
}

function normalizeParameterDefinitions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const definitions = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak parameter definition is invalid.', 'REMOTE_TWEAK_INVALID_PARAMETER_SCHEMA');
    }

    const name = String(entry.name || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || seen.has(name)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak parameter name is invalid.', 'REMOTE_TWEAK_INVALID_PARAMETER_SCHEMA', { name });
    }
    seen.add(name);

    const type = String(entry.type || '').trim().toLowerCase();
    if (!PARAMETER_TYPES.includes(type)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak parameter type is invalid.', 'REMOTE_TWEAK_INVALID_PARAMETER_SCHEMA', { name, type });
    }

    const normalized = {
      name,
      type,
      required: Boolean(entry.required)
    };
    if (Array.isArray(entry.allowedValues)) {
      normalized.allowedValues = [...new Set(entry.allowedValues.filter((candidate) => typeof candidate === type))];
    }
    if (Number.isFinite(entry.minimum)) {
      normalized.minimum = Number(entry.minimum);
    }
    if (Number.isFinite(entry.maximum)) {
      normalized.maximum = Number(entry.maximum);
    }
    if (Number.isInteger(entry.maxLength) && entry.maxLength > 0) {
      normalized.maxLength = Number(entry.maxLength);
    }
    if (normalized.minimum !== undefined && normalized.maximum !== undefined && normalized.minimum > normalized.maximum) {
      throw new RemoteTweakArtifactCacheError('Remote tweak parameter range is invalid.', 'REMOTE_TWEAK_INVALID_PARAMETER_SCHEMA', { name });
    }
    return normalized;
  });

  return definitions.sort((left, right) => left.name.localeCompare(right.name));
}

function buildSignedPayload({
  tweakId,
  artifactVersion,
  scriptFileName,
  sha256,
  allowedActions,
  allowedParameters,
  requiresAdmin,
  requiresReboot,
  minimumAppVersion,
  expiresAt,
  revoked,
  keyId
}) {
  const normalizedKeyId = String(keyId || '').trim();
  return {
    kind: 'nova-tweak-artifact',
    schemaVersion: normalizedKeyId ? 2 : 1,
    ...(normalizedKeyId ? { keyId: normalizedKeyId } : {}),
    tweakId,
    artifactVersion,
    scriptFileName,
    sha256,
    allowedActions,
    allowedParameters,
    requiresAdmin: Boolean(requiresAdmin),
    requiresReboot: Boolean(requiresReboot),
    minimumAppVersion: String(minimumAppVersion || ''),
    expiresAt: String(expiresAt || ''),
    revoked: Boolean(revoked)
  };
}

function compareVersions(currentVersion, minimumVersion) {
  const current = String(currentVersion || '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const minimum = String(minimumVersion || '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(current.length, minimum.length);
  for (let index = 0; index < length; index += 1) {
    if ((current[index] || 0) > (minimum[index] || 0)) return 1;
    if ((current[index] || 0) < (minimum[index] || 0)) return -1;
  }
  return 0;
}

function createRemoteTweakArtifactCache({ cacheRoot, verifySignature, getAppVersion, now = () => new Date() }) {
  if (!cacheRoot) {
    throw new Error('Remote tweak artifact cache requires cacheRoot.');
  }

  const absoluteCacheRoot = path.resolve(cacheRoot);
  const inFlight = new Map();

  function resolveArtifactDirectory(tweakId, artifactVersion) {
    const directory = path.resolve(absoluteCacheRoot, tweakId, artifactVersion);
    const relative = path.relative(absoluteCacheRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak cache path is invalid.', 'REMOTE_TWEAK_CACHE_PATH_VIOLATION', { tweakId, artifactVersion });
    }
    return directory;
  }

  function cleanupTemporaryFiles() {
    if (!fs.existsSync(absoluteCacheRoot)) {
      return;
    }
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const next = path.join(directory, entry.name);
        if (entry.name.startsWith('.tmp-')) {
          fs.rmSync(next, { recursive: entry.isDirectory(), force: true });
        } else if (entry.isDirectory()) {
          walk(next);
        }
      }
    };
    walk(absoluteCacheRoot);
  }

  function parseMetadata(metadataPath) {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch (error) {
      throw new RemoteTweakArtifactCacheError('Cached remote tweak metadata is invalid.', 'REMOTE_TWEAK_CACHE_METADATA_INVALID', {
        metadataPath,
        message: error?.message || ''
      });
    }
  }

  function normalizeArtifact(input) {
    const tweakId = normalizeTweakId(input?.tweakId);
    const artifactVersion = normalizeArtifactVersion(input?.artifactVersion);
    const scriptFileName = String(input?.scriptFileName || '').trim();
    if (!scriptFileName || scriptFileName.includes('/') || scriptFileName.includes('\\') || scriptFileName.includes('..') || !/^[A-Za-z0-9._-]+\.ps1$/i.test(scriptFileName)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak script name is invalid.', 'REMOTE_TWEAK_SCRIPT_INVALID_NAME', { scriptFileName });
    }
    const sha256 = String(input?.sha256 || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak SHA-256 is invalid.', 'REMOTE_TWEAK_INVALID_HASH', { tweakId });
    }
    const allowedActions = normalizeActions(input?.allowedActions);
    const allowedParameters = normalizeParameterDefinitions(input?.allowedParameters);
    const minimumAppVersion = String(input?.minimumAppVersion || '').trim();
    const expiresAt = String(input?.expiresAt || '').trim();
    const keyId = String(input?.keyId || input?.signedPayload?.keyId || '').trim();
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      throw new RemoteTweakArtifactCacheError('Remote tweak expiry is invalid.', 'REMOTE_TWEAK_INVALID_EXPIRY', { tweakId, expiresAt });
    }
    if (keyId && !/^sha256:[a-f0-9]{64}$/.test(keyId)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak signing key ID is invalid.', 'REMOTE_TWEAK_INVALID_KEY_ID', { tweakId, keyId });
    }
    return {
      tweakId,
      artifactVersion,
      scriptFileName,
      sha256,
      allowedActions,
      allowedParameters,
      requiresAdmin: Boolean(input?.requiresAdmin),
      requiresReboot: Boolean(input?.requiresReboot),
      minimumAppVersion,
      expiresAt,
      revoked: Boolean(input?.revoked),
      ...(keyId ? { keyId } : {}),
      signature: String(input?.signature || '').trim(),
      signedPayload: input?.signedPayload && typeof input.signedPayload === 'object' && !Array.isArray(input.signedPayload)
        ? input.signedPayload
        : null,
      signatureStatus: String(input?.signatureStatus || 'verified').trim() || 'verified',
      invalid: Boolean(input?.invalid)
    };
  }

  function assertArtifactUsable(artifact, { action = '', checkIntegrity = false, allowRevoked = false } = {}) {
    if (artifact.expiresAt && Date.parse(artifact.expiresAt) <= now().getTime()) {
      throw new RemoteTweakArtifactCacheError('Remote tweak artifact has expired.', 'REMOTE_TWEAK_ARTIFACT_EXPIRED', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }
    if (artifact.minimumAppVersion && compareVersions(getAppVersion?.() || '', artifact.minimumAppVersion) < 0) {
      throw new RemoteTweakArtifactCacheError('Remote tweak artifact requires a newer app version.', 'REMOTE_TWEAK_ARTIFACT_APP_VERSION_UNSUPPORTED', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }
    if (action && !artifact.allowedActions.includes(action)) {
      throw new RemoteTweakArtifactCacheError('Remote tweak action is not allowed by the artifact.', 'REMOTE_TWEAK_INVALID_ACTION', { tweakId: artifact.tweakId, action });
    }
    if (!artifact.signedPayload || canonicalJson(artifact.signedPayload) !== canonicalJson(buildSignedPayload(artifact))) {
      throw new RemoteTweakArtifactCacheError('Remote tweak signed metadata does not match the artifact.', 'REMOTE_TWEAK_SIGNATURE_METADATA_MISMATCH', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }
    if (typeof verifySignature === 'function' && !verifySignature({ payload: artifact.signedPayload, signature: artifact.signature })) {
      throw new RemoteTweakArtifactCacheError('Remote tweak signature verification failed.', 'REMOTE_TWEAK_SCRIPT_SIGNATURE_INVALID', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }
    if (artifact.revoked && !allowRevoked) {
      throw new RemoteTweakArtifactCacheError('Remote tweak artifact is revoked.', 'REMOTE_TWEAK_ARTIFACT_REVOKED', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }

    if (checkIntegrity) {
      const scriptPath = path.join(resolveArtifactDirectory(artifact.tweakId, artifact.artifactVersion), SCRIPT_FILE_NAME);
      let content;
      try {
        content = fs.readFileSync(scriptPath, 'utf8');
      } catch (_error) {
        throw new RemoteTweakArtifactCacheError('Cached remote tweak script is missing.', 'integrity_failed', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
      }
      if (sha256Hex(content) !== artifact.sha256) {
        try {
          const metadataPath = path.join(resolveArtifactDirectory(artifact.tweakId, artifact.artifactVersion), METADATA_FILE_NAME);
          fs.writeFileSync(metadataPath, JSON.stringify({ ...artifact, invalid: true, invalidReason: 'hash_mismatch' }, null, 2), 'utf8');
        } catch (_error) {
          // Integrity errors must not be hidden when the invalid marker cannot be persisted.
        }
        throw new RemoteTweakArtifactCacheError('Cached remote tweak script integrity verification failed.', 'integrity_failed', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
      }
    }
  }

  function toStoredArtifact(artifact, { downloadedAt = now().toISOString() } = {}) {
    return {
      schemaVersion: 1,
      ...artifact,
      downloadedAt,
      invalid: false
    };
  }

  function readArtifact(tweakId, artifactVersion, options = {}) {
    const normalizedId = normalizeTweakId(tweakId);
    const normalizedVersion = normalizeArtifactVersion(artifactVersion);
    const directory = resolveArtifactDirectory(normalizedId, normalizedVersion);
    const metadata = normalizeArtifact(parseMetadata(path.join(directory, METADATA_FILE_NAME)));
    if (metadata.invalid) {
      throw new RemoteTweakArtifactCacheError('Cached remote tweak artifact is marked invalid.', 'integrity_failed', { tweakId: normalizedId, artifactVersion: normalizedVersion });
    }
    assertArtifactUsable(metadata, options);
    return {
      ...metadata,
      scriptRelativePath: path.join(normalizedId, normalizedVersion, SCRIPT_FILE_NAME).replace(/\\/g, '/')
    };
  }

  function storeArtifact(input) {
    const artifact = normalizeArtifact(input);
    const content = typeof input?.content === 'string' ? input.content : '';
    if (!content.trim()) {
      throw new RemoteTweakArtifactCacheError('Remote tweak script content is empty.', 'REMOTE_TWEAK_SCRIPT_EMPTY', { tweakId: artifact.tweakId });
    }
    if (sha256Hex(content) !== artifact.sha256) {
      throw new RemoteTweakArtifactCacheError('Remote tweak script hash verification failed.', 'REMOTE_TWEAK_SCRIPT_HASH_MISMATCH', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }
    assertArtifactUsable(artifact);

    const key = `${artifact.tweakId}:${artifact.artifactVersion}`;
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }

    const task = Promise.resolve().then(() => {
      const artifactDirectory = resolveArtifactDirectory(artifact.tweakId, artifact.artifactVersion);
      const scriptPath = path.join(artifactDirectory, SCRIPT_FILE_NAME);
      const metadataPath = path.join(artifactDirectory, METADATA_FILE_NAME);
      if (fs.existsSync(scriptPath) && fs.existsSync(metadataPath)) {
        const existing = readArtifact(artifact.tweakId, artifact.artifactVersion, { checkIntegrity: true });
        if (existing.sha256 !== artifact.sha256 || canonicalJson(existing.signedPayload) !== canonicalJson(artifact.signedPayload)) {
          throw new RemoteTweakArtifactCacheError('Remote tweak artifact version conflicts with an existing cached artifact.', 'REMOTE_TWEAK_ARTIFACT_VERSION_CONFLICT', {
            tweakId: artifact.tweakId,
            artifactVersion: artifact.artifactVersion
          });
        }
        return existing;
      }

      const parentDirectory = path.dirname(artifactDirectory);
      fs.mkdirSync(parentDirectory, { recursive: true });
      const temporaryDirectory = path.join(parentDirectory, `.tmp-${artifact.artifactVersion}-${process.pid}-${crypto.randomUUID()}`);
      try {
        fs.mkdirSync(temporaryDirectory, { recursive: false });
        const temporaryScriptPath = path.join(temporaryDirectory, SCRIPT_FILE_NAME);
        fs.writeFileSync(temporaryScriptPath, content, 'utf8');
        const writtenContent = fs.readFileSync(temporaryScriptPath, 'utf8');
        if (sha256Hex(writtenContent) !== artifact.sha256) {
          throw new RemoteTweakArtifactCacheError('Remote tweak script hash verification failed after download.', 'REMOTE_TWEAK_SCRIPT_HASH_MISMATCH', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
        }
        fs.writeFileSync(path.join(temporaryDirectory, METADATA_FILE_NAME), JSON.stringify(toStoredArtifact(artifact), null, 2), 'utf8');
        if (fs.existsSync(artifactDirectory)) {
          fs.rmSync(temporaryDirectory, { recursive: true, force: true });
          const existing = readArtifact(artifact.tweakId, artifact.artifactVersion, { checkIntegrity: true });
          if (existing.sha256 !== artifact.sha256 || canonicalJson(existing.signedPayload) !== canonicalJson(artifact.signedPayload)) {
            throw new RemoteTweakArtifactCacheError('Remote tweak artifact version conflicts with an existing cached artifact.', 'REMOTE_TWEAK_ARTIFACT_VERSION_CONFLICT', {
              tweakId: artifact.tweakId,
              artifactVersion: artifact.artifactVersion
            });
          }
          return existing;
        }
        fs.renameSync(temporaryDirectory, artifactDirectory);
        return readArtifact(artifact.tweakId, artifact.artifactVersion, { checkIntegrity: true });
      } catch (error) {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }
    }).finally(() => inFlight.delete(key));

    inFlight.set(key, task);
    return task;
  }

  function getLatestValidArtifact(tweakId, options = {}) {
    const normalizedId = normalizeTweakId(tweakId);
    const tweakDirectory = path.join(absoluteCacheRoot, normalizedId);
    if (!fs.existsSync(tweakDirectory)) {
      throw new RemoteTweakArtifactCacheError('No cached remote tweak artifact is available.', 'REMOTE_TWEAK_OFFLINE_CACHE_MISS', { tweakId: normalizedId });
    }

    const versions = fs.readdirSync(tweakDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.tmp-'))
      .map((entry) => ({
        version: entry.name,
        modifiedAt: fs.statSync(path.join(tweakDirectory, entry.name)).mtimeMs
      }))
      .sort((left, right) => right.modifiedAt - left.modifiedAt);

    if (!versions.length) {
      throw new RemoteTweakArtifactCacheError('No valid cached remote tweak artifact is available.', 'REMOTE_TWEAK_OFFLINE_CACHE_MISS', { tweakId: normalizedId });
    }
    return readArtifact(normalizedId, versions[0].version, { ...options, checkIntegrity: true });
  }

  function markArtifactRevoked(input) {
    const artifact = normalizeArtifact(input);
    if (!artifact.revoked) {
      return;
    }
    assertArtifactUsable(artifact, { allowRevoked: true });
    const directory = resolveArtifactDirectory(artifact.tweakId, artifact.artifactVersion);
    const metadataPath = path.join(directory, METADATA_FILE_NAME);
    if (!fs.existsSync(metadataPath)) {
      return;
    }
    const existing = parseMetadata(metadataPath);
    fs.writeFileSync(metadataPath, JSON.stringify({
      ...existing,
      revoked: true,
      signature: artifact.signature,
      signedPayload: artifact.signedPayload,
      signatureStatus: artifact.signatureStatus
    }, null, 2), 'utf8');
  }

  cleanupTemporaryFiles();

  return {
    cleanupTemporaryFiles,
    getLatestValidArtifact,
    markArtifactRevoked,
    readArtifact,
    storeArtifact,
    validateForExecution: (tweakId, artifactVersion, action) => readArtifact(tweakId, artifactVersion, { action, checkIntegrity: true })
  };
}

module.exports = {
  ARTIFACT_VERSION_PATTERN,
  KNOWN_ACTIONS,
  RemoteTweakArtifactCacheError,
  TWEAK_ID_PATTERN,
  buildSignedPayload,
  createRemoteTweakArtifactCache,
  normalizeParameterDefinitions,
  sha256Hex
};
