const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INTEGRITY_FORMAT = 'nova-lhm-runtime-v2';
const EXPECTED_CRITICAL_RUNTIME_SHA256 = 'a5096c7f82ca4de37af350cfed16b0a408f3c1e3c00a435d9081cc17bc0e9be3';
const PATCHED_DIRECTORY = 'patched';
const MUTABLE_CONFIG = path.join(PATCHED_DIRECTORY, 'LibreHardwareMonitor.config');
const CRITICAL_EXTENSIONS = new Set(['.config', '.dll', '.exe', '.json']);

class MonitoringIntegrityError extends Error {
  constructor(message, code = 'MONITORING_RUNTIME_INTEGRITY_INVALID') {
    super(message);
    this.name = 'MonitoringIntegrityError';
    this.code = code;
  }
}

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function collectCriticalRuntimeFiles(runtimeRoot) {
  const absoluteRoot = path.resolve(String(runtimeRoot || ''));
  const patchedRoot = path.join(absoluteRoot, PATCHED_DIRECTORY);
  const collected = [];

  if (!fs.existsSync(patchedRoot) || !fs.statSync(patchedRoot).isDirectory()) {
    throw new MonitoringIntegrityError('The monitoring runtime is incomplete.');
  }

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new MonitoringIntegrityError('The monitoring runtime contains a symbolic link.');
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !CRITICAL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const relativePath = path.relative(absoluteRoot, absolutePath);
      if (relativePath !== MUTABLE_CONFIG) {
        collected.push(relativePath);
      }
    }
  };

  visit(patchedRoot);
  const uniqueFiles = [...new Set(collected)].sort();
  for (const relativePath of uniqueFiles) {
    const absolutePath = path.resolve(absoluteRoot, relativePath);
    if (
      !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)
      || !fs.existsSync(absolutePath)
      || !fs.lstatSync(absolutePath).isFile()
      || fs.lstatSync(absolutePath).isSymbolicLink()
    ) {
      throw new MonitoringIntegrityError('The monitoring runtime is incomplete.');
    }
  }

  return uniqueFiles;
}

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

function computeCriticalRuntimeSha256(runtimeRoot) {
  const absoluteRoot = path.resolve(String(runtimeRoot || ''));
  const hash = crypto.createHash('sha256');
  hash.update(INTEGRITY_FORMAT, 'utf8');
  hash.update(Buffer.from([0]));

  for (const relativePath of collectCriticalRuntimeFiles(absoluteRoot)) {
    const portablePath = toPortablePath(relativePath);
    const contents = canonicalContents(fs.readFileSync(path.join(absoluteRoot, relativePath)));
    const encodedPath = Buffer.from(portablePath, 'utf8');

    updateLength(hash, encodedPath.length);
    hash.update(encodedPath);
    updateLength(hash, contents.length);
    hash.update(contents);
  }

  return hash.digest('hex');
}

function assertMonitoringRuntimeIntegrity(
  runtimeRoot,
  expectedSha256 = EXPECTED_CRITICAL_RUNTIME_SHA256
) {
  const normalizedExpected = String(expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
    throw new MonitoringIntegrityError(
      'The monitoring runtime integrity policy is invalid.',
      'MONITORING_RUNTIME_INTEGRITY_POLICY_INVALID'
    );
  }

  const actualSha256 = computeCriticalRuntimeSha256(runtimeRoot);
  if (actualSha256 !== normalizedExpected) {
    throw new MonitoringIntegrityError('The monitoring runtime failed its integrity check.');
  }

  return true;
}

function runtimeRootForExecutable(executablePath) {
  const normalized = path.resolve(String(executablePath || ''));
  if (
    path.basename(normalized).toLowerCase() !== 'librehardwaremonitor.exe'
    || path.basename(path.dirname(normalized)).toLowerCase() !== PATCHED_DIRECTORY
  ) {
    throw new MonitoringIntegrityError('The monitoring executable path is not trusted.');
  }
  return path.dirname(path.dirname(normalized));
}

module.exports = {
  EXPECTED_CRITICAL_RUNTIME_SHA256,
  MonitoringIntegrityError,
  assertMonitoringRuntimeIntegrity,
  collectCriticalRuntimeFiles,
  computeCriticalRuntimeSha256,
  runtimeRootForExecutable
};
