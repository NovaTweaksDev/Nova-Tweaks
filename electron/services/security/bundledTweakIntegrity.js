const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class BundledTweakIntegrityError extends Error {
  constructor(message, code = 'BUNDLED_TWEAK_INTEGRITY_FAILED', details = {}) {
    super(message);
    this.name = 'BundledTweakIntegrityError';
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new BundledTweakIntegrityError('Bundled tweak path is invalid.', 'BUNDLED_TWEAK_PATH_INVALID', { path: value });
  }
  return normalized;
}

function listFiles(directory, baseDirectory = directory) {
  if (!fs.existsSync(directory)) {
    throw new BundledTweakIntegrityError('Bundled tweak directory is missing.', 'BUNDLED_TWEAK_DIRECTORY_MISSING', { directory });
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new BundledTweakIntegrityError('Bundled tweak resources must not contain symbolic links.', 'BUNDLED_TWEAK_LINK_REJECTED', { path: absolutePath });
      }
      if (entry.isDirectory()) return listFiles(absolutePath, baseDirectory);
      if (!entry.isFile()) {
        throw new BundledTweakIntegrityError('Bundled tweak resources contain an unsupported entry.', 'BUNDLED_TWEAK_ENTRY_REJECTED', { path: absolutePath });
      }
      return [path.relative(baseDirectory, absolutePath).replace(/\\/g, '/')];
    });
}

function assertManifestShape(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object') {
    throw new BundledTweakIntegrityError('Bundled tweak manifest is invalid.', 'BUNDLED_TWEAK_MANIFEST_INVALID');
  }
}

function assertBundledTweakContent(relativePath, content, manifest) {
  assertManifestShape(manifest);
  const normalizedPath = normalizeRelativePath(relativePath);
  const expected = manifest.files[normalizedPath];
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
  if (!expected || expected.size !== buffer.length || expected.sha256 !== sha256(buffer)) {
    throw new BundledTweakIntegrityError('Bundled tweak content does not match this app version.', 'BUNDLED_TWEAK_CONTENT_MISMATCH', {
      path: normalizedPath
    });
  }
  return { relativePath: normalizedPath, sha256: expected.sha256, size: expected.size };
}

function assertBundledTweakIntegrity(resourcesRootPath, manifest) {
  assertManifestShape(manifest);
  const root = path.resolve(resourcesRootPath);
  const actualFiles = listFiles(root);
  const expectedFiles = Object.keys(manifest.files);
  if (actualFiles.length !== expectedFiles.length || actualFiles.some((entry, index) => entry !== expectedFiles[index])) {
    throw new BundledTweakIntegrityError('Bundled tweak file set does not match this app version.', 'BUNDLED_TWEAK_FILE_SET_MISMATCH', {
      expectedCount: expectedFiles.length,
      actualCount: actualFiles.length
    });
  }
  for (const relativePath of expectedFiles) {
    assertBundledTweakContent(
      relativePath,
      fs.readFileSync(path.join(root, ...relativePath.split('/'))),
      manifest
    );
  }
  return { ok: true, fileCount: expectedFiles.length, rootHash: manifest.rootHash || '' };
}

module.exports = {
  BundledTweakIntegrityError,
  assertBundledTweakContent,
  assertBundledTweakIntegrity
};
