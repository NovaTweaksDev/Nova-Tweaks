const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REQUIRED_LEGAL_FILES = [
  'LICENSE',
  'TRADEMARKS.MD',
  'THIRD-PARTY-NOTICES.md',
  'third-party-components.json'
];

function loadThirdPartyManifest(projectDirectory) {
  const manifestPath = path.join(projectDirectory, 'third-party-components.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.components)) {
    throw new Error('Third-party component manifest must use schemaVersion 1 and contain a components array.');
  }
  for (const component of manifest.components) {
    const fileName = String(component?.fileName || '').trim() || 'unnamed component';
    if (component?.redistributionStatus !== 'documented') {
      throw new Error(`Third-party redistribution is not documented for ${fileName}.`);
    }
    if (!String(component?.license || '').trim()) {
      throw new Error(`Third-party license is missing for ${fileName}.`);
    }
    if (Object.hasOwn(component, 'todo')) {
      throw new Error(`Third-party manifest must not contain a release TODO for ${fileName}.`);
    }
  }
  return manifest;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function assertThirdPartyFiles(rootDirectory, manifest, pathField) {
  const seenFileNames = new Set();
  for (const component of manifest.components) {
    const relativePath = String(component?.[pathField] || '').trim();
    const expectedHash = String(component?.sha256 || '').trim().toUpperCase();
    const fileName = String(component?.fileName || '').trim();
    if (!fileName || !relativePath || !/^[0-9A-F]{64}$/.test(expectedHash)) {
      throw new Error(`Third-party manifest entry is incomplete for ${fileName || 'an unnamed component'}.`);
    }
    if (seenFileNames.has(fileName)) {
      throw new Error(`Third-party manifest contains a duplicate file name: ${fileName}`);
    }
    seenFileNames.add(fileName);

    const resolvedPath = path.resolve(rootDirectory, ...relativePath.split('/'));
    const relativeResolvedPath = path.relative(path.resolve(rootDirectory), resolvedPath);
    if (relativeResolvedPath.startsWith('..') || path.isAbsolute(relativeResolvedPath)) {
      throw new Error(`Third-party component path escapes its expected root: ${relativePath}`);
    }
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw new Error(`Third-party component is missing: ${resolvedPath}`);
    }
    const actualHash = sha256File(resolvedPath);
    if (actualHash !== expectedHash) {
      throw new Error(`Third-party component hash mismatch for ${fileName}: expected ${expectedHash}, received ${actualHash}.`);
    }
  }
}

function assertThirdPartyLegalFiles(rootDirectory, manifest) {
  const relativeFiles = new Set(REQUIRED_LEGAL_FILES);
  for (const component of manifest.components) {
    for (const licenseFile of component.licenseFiles || []) {
      relativeFiles.add(String(licenseFile || '').trim());
    }
  }
  for (const relativeFile of relativeFiles) {
    if (!relativeFile) {
      throw new Error('Third-party manifest contains an empty license file path.');
    }
    const resolvedPath = path.resolve(rootDirectory, ...relativeFile.split('/'));
    const relativeResolvedPath = path.relative(path.resolve(rootDirectory), resolvedPath);
    if (relativeResolvedPath.startsWith('..') || path.isAbsolute(relativeResolvedPath)) {
      throw new Error(`Third-party legal file path escapes its expected root: ${relativeFile}`);
    }
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile() || fs.statSync(resolvedPath).size <= 0) {
      throw new Error(`Third-party legal file is missing or empty: ${resolvedPath}`);
    }
  }
}

function assertThirdPartySigningExclusions(config, manifest) {
  const signExts = config?.win?.signExts;
  if (!Array.isArray(signExts)) {
    throw new Error('Windows packaging must define explicit third-party signing exclusions.');
  }
  for (const component of manifest.components) {
    const exclusion = `!${component.fileName}`;
    if (!signExts.includes(exclusion)) {
      throw new Error(`Windows packaging must exclude ${component.fileName} from Nova code signing.`);
    }
  }
}

module.exports = {
  REQUIRED_LEGAL_FILES,
  assertThirdPartyFiles,
  assertThirdPartyLegalFiles,
  assertThirdPartySigningExclusions,
  loadThirdPartyManifest,
  sha256File
};
