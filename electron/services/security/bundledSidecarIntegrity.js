const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INTEGRITY_FORMAT = 'nova-bundled-sidecar-v2';
const CRITICAL_EXTENSIONS = new Set(['.config', '.dll', '.exe', '.json']);
const SIDECAR_POLICIES = Object.freeze({
  'game-detector-x64': {
    expectedSha256: '566327499b8ea47920650ef337796a31ae7b33983d512dc8af4c0af199438d09',
    requiredFiles: ['NovaGameDetector.exe', 'NovaGameDetector.dll', 'NovaGameDetector.runtimeconfig.json']
  },
  'nvidia-display-helper': {
    expectedSha256: '50826a7175220916fe93541cdeb3fe6bd6900d83f70903f335c9c6d07094a8f9',
    requiredFiles: ['nvidia-display-helper.exe']
  },
  'nvidia-profile-helper': {
    expectedSha256: '4b44f687cda993e066349a428f8f51d8a49bae835dbbc1f081af90c0b3f45f29',
    requiredFiles: ['nvidia-profile-helper.exe']
  },
  'presentmon-capture': {
    expectedSha256: 'a3a24c15c90b69089bf92e6d904c094c19be4e096ac17041a8d935b96e3ea11f',
    requiredFiles: ['PresentMon.exe', 'PresentMonLegacy.exe']
  },
  'presentmon-helper': {
    expectedSha256: '86606183e468e0a3850a47be01b5c43a1f33ed377da17a857b476b3fbed158de',
    requiredFiles: ['NovaPresentMonHelper.exe']
  },
  'presentmon-tools': {
    expectedSha256: '55342ede1dea16e1f86efffc6d010bb7a19cf723a5cb691238a87ffe44b49c9e',
    requiredFiles: ['PresentMonAPI2Loader.dll', 'Intel-PresentMon.dll']
  }
});

class BundledSidecarIntegrityError extends Error {
  constructor(message, code = 'BUNDLED_SIDECAR_INTEGRITY_INVALID') {
    super(message);
    this.name = 'BundledSidecarIntegrityError';
    this.code = code;
  }
}

function getPolicy(policyName) {
  const normalizedName = String(policyName || '').trim().toLowerCase();
  const policy = SIDECAR_POLICIES[normalizedName];
  if (!policy) {
    throw new BundledSidecarIntegrityError(
      'The bundled sidecar integrity policy is unavailable.',
      'BUNDLED_SIDECAR_POLICY_INVALID'
    );
  }
  return policy;
}

function collectCriticalFiles(directoryPath, policyName) {
  const policy = getPolicy(policyName);
  const absoluteRoot = path.resolve(String(directoryPath || ''));
  if (
    !fs.existsSync(absoluteRoot)
    || !fs.lstatSync(absoluteRoot).isDirectory()
    || fs.lstatSync(absoluteRoot).isSymbolicLink()
  ) {
    throw new BundledSidecarIntegrityError('The bundled sidecar is incomplete.');
  }

  const collected = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new BundledSidecarIntegrityError('The bundled sidecar contains a symbolic link.');
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isFile() && CRITICAL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        collected.push(path.relative(absoluteRoot, absolutePath));
      }
    }
  };
  visit(absoluteRoot);

  for (const requiredFile of policy.requiredFiles) {
    const requiredPath = path.join(absoluteRoot, requiredFile);
    if (
      !fs.existsSync(requiredPath)
      || !fs.lstatSync(requiredPath).isFile()
      || fs.lstatSync(requiredPath).isSymbolicLink()
    ) {
      throw new BundledSidecarIntegrityError('The bundled sidecar is incomplete.');
    }
  }

  return [...new Set(collected)].sort();
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

function computeSidecarSha256(directoryPath, policyName) {
  const absoluteRoot = path.resolve(String(directoryPath || ''));
  const hash = crypto.createHash('sha256');
  hash.update(INTEGRITY_FORMAT, 'utf8');
  hash.update(Buffer.from([0]));
  hash.update(String(policyName || '').trim().toLowerCase(), 'utf8');
  hash.update(Buffer.from([0]));

  for (const relativePath of collectCriticalFiles(absoluteRoot, policyName)) {
    const portablePath = relativePath.split(path.sep).join('/');
    const encodedPath = Buffer.from(portablePath, 'utf8');
    const contents = canonicalContents(fs.readFileSync(path.join(absoluteRoot, relativePath)));
    updateLength(hash, encodedPath.length);
    hash.update(encodedPath);
    updateLength(hash, contents.length);
    hash.update(contents);
  }
  return hash.digest('hex');
}

function assertBundledSidecarIntegrity(directoryPath, policyName, expectedSha256) {
  const policy = getPolicy(policyName);
  const normalizedExpected = String(expectedSha256 || policy.expectedSha256).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
    throw new BundledSidecarIntegrityError(
      'The bundled sidecar integrity policy is invalid.',
      'BUNDLED_SIDECAR_POLICY_INVALID'
    );
  }
  if (computeSidecarSha256(directoryPath, policyName) !== normalizedExpected) {
    throw new BundledSidecarIntegrityError('The bundled sidecar failed its integrity check.');
  }
  return true;
}

module.exports = {
  BundledSidecarIntegrityError,
  SIDECAR_POLICIES,
  assertBundledSidecarIntegrity,
  collectCriticalFiles,
  computeSidecarSha256
};
