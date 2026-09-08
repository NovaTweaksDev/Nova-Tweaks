const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SOURCE_TREE_FORMAT = 'nova-third-party-source-v2';
const SOURCE_EXCLUDED_DIRECTORIES = new Set(['bin', 'obj', 'patched', '.github']);
const SOURCE_EXCLUDED_FILES = new Set([
  '.editorconfig',
  '.gitignore',
  'PawnIO_setup.exe'
]);

function updateLength(hash, length) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(length));
  hash.update(encoded);
}

function canonicalContents(contents) {
  return contents.includes(0)
    ? contents
    : Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function collectSourceFiles(sourceRoot) {
  const absoluteRoot = path.resolve(String(sourceRoot || ''));
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Third-party source tree is missing: ${absoluteRoot}`);
  }

  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Third-party source tree contains a symbolic link: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        if (!SOURCE_EXCLUDED_DIRECTORIES.has(entry.name)) visit(absolutePath);
        continue;
      }
      if (entry.isFile() && !SOURCE_EXCLUDED_FILES.has(entry.name)) {
        files.push(path.relative(absoluteRoot, absolutePath).split(path.sep).join('/'));
      }
    }
  };

  visit(absoluteRoot);
  return files.sort();
}

function computeSourceTreeSha256(sourceRoot) {
  const absoluteRoot = path.resolve(String(sourceRoot || ''));
  const hash = crypto.createHash('sha256');
  hash.update(SOURCE_TREE_FORMAT, 'utf8');
  hash.update(Buffer.from([0]));

  for (const relativePath of collectSourceFiles(absoluteRoot)) {
    const encodedPath = Buffer.from(relativePath, 'utf8');
    const contents = canonicalContents(
      fs.readFileSync(path.join(absoluteRoot, ...relativePath.split('/')))
    );
    updateLength(hash, encodedPath.length);
    hash.update(encodedPath);
    updateLength(hash, contents.length);
    hash.update(contents);
  }

  return hash.digest('hex').toUpperCase();
}

function resolveContainedPath(rootDirectory, relativePath, description) {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(resolvedRoot, ...String(relativePath).split('/'));
  const relativeResolvedPath = path.relative(resolvedRoot, resolvedPath);
  if (relativeResolvedPath.startsWith('..') || path.isAbsolute(relativeResolvedPath)) {
    throw new Error(`${description} escapes its expected root: ${relativePath}`);
  }
  return resolvedPath;
}

function assertThirdPartySourceTrees(rootDirectory, manifest, pathField) {
  for (const component of manifest.components) {
    if (!component?.source) continue;

    const relativePath = String(component.source[pathField] || '').trim();
    const expectedHash = String(component.source.sha256 || '').trim().toUpperCase();
    if (!relativePath || !/^[0-9A-F]{64}$/.test(expectedHash)) {
      throw new Error(`Third-party source metadata is incomplete for ${component.fileName}.`);
    }

    const resolvedPath = resolveContainedPath(
      rootDirectory,
      relativePath,
      'Third-party source path'
    );
    const files = collectSourceFiles(resolvedPath);
    if (Number(component.source.fileCount) !== files.length) {
      throw new Error(`Third-party source file count mismatch for ${component.fileName}.`);
    }
    const actualHash = computeSourceTreeSha256(resolvedPath);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Third-party source hash mismatch for ${component.fileName}: expected ${expectedHash}, received ${actualHash}.`
      );
    }
  }
}

function assertExcludedThirdPartyFiles(rootDirectory, manifest, pathField) {
  for (const component of manifest.excludedComponents || []) {
    for (const relativePath of component?.[pathField] || []) {
      const resolvedPath = resolveContainedPath(
        rootDirectory,
        relativePath,
        'Excluded third-party path'
      );
      if (fs.existsSync(resolvedPath)) {
        throw new Error(`Excluded third-party component must not be distributed: ${resolvedPath}`);
      }
    }
  }
}

module.exports = {
  SOURCE_TREE_FORMAT,
  assertExcludedThirdPartyFiles,
  assertThirdPartySourceTrees,
  collectSourceFiles,
  computeSourceTreeSha256
};
