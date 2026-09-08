const { execFileSync } = require('child_process');
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const {
  assertMonitoringRuntimeIntegrity
} = require('../electron/services/monitoring/monitoringIntegrity');
const {
  assertBundledSidecarIntegrity
} = require('../electron/services/security/bundledSidecarIntegrity');
const {
  assertBundledTweakIntegrity
} = require('../electron/services/security/bundledTweakIntegrity');
const bundledTweakManifest = require('../electron/generated/bundled-tweaks-manifest');
const {
  assertThirdPartyFiles,
  assertThirdPartyLegalFiles,
  assertThirdPartySigningExclusions,
  loadThirdPartyManifest
} = require('./third-party-compliance');
const {
  assertExcludedThirdPartyFiles,
  assertThirdPartySourceTrees
} = require('./third-party-source-compliance');

function parsePublicKeyCollection(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '').trim() ? [String(value).trim()] : [];
}

function assertReleaseSigningConfig(projectDirectory) {
  const signingConfigPath = path.join(
    projectDirectory,
    'electron',
    'generated',
    'signing-config.js'
  );
  if (!fs.existsSync(signingConfigPath)) {
    throw new Error('Desktop packaging requires a generated signing configuration.');
  }

  delete require.cache[require.resolve(signingConfigPath)];
  const config = require(signingConfigPath);
  const enabled = (value) => String(value || '').trim().toLowerCase() === 'true';
  const artifactKeys = [
    ...parsePublicKeyCollection(config.NOVA_ARTIFACT_PUBLIC_KEY),
    ...parsePublicKeyCollection(config.NOVA_ARTIFACT_PUBLIC_KEYS)
  ];
  const tweakKeys = [
    ...artifactKeys,
    ...parsePublicKeyCollection(config.NOVA_TWEAK_PUBLIC_KEY),
    ...parsePublicKeyCollection(config.NOVA_TWEAK_PUBLIC_KEYS)
  ];
  const updateKeys = [
    ...artifactKeys,
    ...parsePublicKeyCollection(config.NOVA_UPDATE_PUBLIC_KEY),
    ...parsePublicKeyCollection(config.NOVA_UPDATE_PUBLIC_KEYS)
  ];

  if (
    !enabled(config.NOVA_REQUIRE_TWEAK_SIGNATURES)
    || !enabled(config.NOVA_REQUIRE_UPDATE_SIGNATURES)
    || !artifactKeys.length
    || !tweakKeys.length
    || !updateKeys.length
  ) {
    throw new Error(
      'Desktop packaging requires artifact-root trust and enforced tweak/update signatures.'
    );
  }
}

function assertElectronFusePolicy(config) {
  const fuses = config?.electronFuses || {};
  const expected = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false
  };

  for (const [name, requiredValue] of Object.entries(expected)) {
    if (fuses[name] !== requiredValue) {
      throw new Error(`Desktop packaging requires the ${name} Electron fuse to be ${requiredValue}.`);
    }
  }
}

function normalizeAsarEntry(entry) {
  const normalized = String(entry || '').replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function assertPackagedAsarEntries(entries) {
  const normalizedEntries = new Set(
    (Array.isArray(entries) ? entries : []).map(normalizeAsarEntry)
  );
  const requiredEntries = [
    '/dist/index.html',
    '/electron/main.js',
    '/electron/preload.js',
    '/electron/generated/signing-config.js'
  ];
  for (const requiredEntry of requiredEntries) {
    if (!normalizedEntries.has(requiredEntry)) {
      throw new Error(`Desktop ASAR is missing required runtime entry: ${requiredEntry}`);
    }
  }

  const forbiddenEntry = [...normalizedEntries].find((entry) => (
    entry.startsWith('/node_modules/')
    || /(?:^|\/)[^/]+\.test\.js$/i.test(entry)
    || /(?:^|\/)launcher\.js$/i.test(entry)
    || /\.(?:ts|pdb|cs|csproj|sln)$/i.test(entry)
  ));
  if (forbiddenEntry) {
    throw new Error(`Desktop ASAR contains a forbidden development entry: ${forbiddenEntry}`);
  }
}

function assertPackagedAsarMinimized(appOutDir) {
  const asarPath = path.join(appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Desktop ASAR was not created: ${asarPath}`);
  }
  assertPackagedAsarEntries(asar.listPackage(asarPath));
}

function findPresentMonExecutable(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return '';
  }

  const directPath = path.join(directoryPath, 'PresentMon.exe');
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile() && fs.statSync(directPath).size > 0) {
    return directPath;
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => /^PresentMon(?:[-_.].*)?\.exe$/i.test(fileName) && !/^PresentMonLegacy\.exe$/i.test(fileName))
    .sort((left, right) => {
      if (/x64/i.test(left) && !/x64/i.test(right)) return -1;
      if (!/x64/i.test(left) && /x64/i.test(right)) return 1;
      return left.localeCompare(right);
    })
    .map((fileName) => path.join(directoryPath, fileName))
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).size > 0) || '';
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  if (context.packager.config?.win?.forceCodeSigning === true) {
    assertReleaseSigningConfig(context.packager.projectDir);
  }
  assertElectronFusePolicy(context.packager.config);
  assertPackagedAsarMinimized(context.appOutDir);

  const thirdPartyManifest = loadThirdPartyManifest(context.packager.projectDir);
  assertThirdPartySigningExclusions(context.packager.config, thirdPartyManifest);
  assertThirdPartyFiles(context.appOutDir, thirdPartyManifest, 'packagedPath');
  assertThirdPartyLegalFiles(context.appOutDir, thirdPartyManifest);
  assertThirdPartySourceTrees(context.appOutDir, thirdPartyManifest, 'packagedPath');
  assertExcludedThirdPartyFiles(context.appOutDir, thirdPartyManifest, 'packagedPaths');

  assertBundledTweakIntegrity(
    path.join(context.appOutDir, 'resources', 'tweaks'),
    bundledTweakManifest
  );

  const monitoringRuntimeDirectory = path.join(
    context.appOutDir,
    'resources',
    'resources',
    'monitoring',
    'LibreHardwareMonitor'
  );
  assertMonitoringRuntimeIntegrity(monitoringRuntimeDirectory);

  const presentMonDirectory = path.join(context.appOutDir, 'resources', 'capture', 'PresentMon');
  assertBundledSidecarIntegrity(presentMonDirectory, 'presentmon-capture');
  assertBundledSidecarIntegrity(
    path.join(context.appOutDir, 'resources', 'tools', 'presentmon'),
    'presentmon-tools'
  );
  assertBundledSidecarIntegrity(
    path.join(context.appOutDir, 'resources', 'tools', 'nova-presentmon-helper'),
    'presentmon-helper'
  );
  assertBundledSidecarIntegrity(
    path.join(context.appOutDir, 'resources', 'helpers', 'NovaGameDetector', 'publish', 'win-x64'),
    'game-detector-x64'
  );
  assertBundledSidecarIntegrity(
    path.join(context.appOutDir, 'resources', 'tools', 'nvidia-display-helper', 'bin'),
    'nvidia-display-helper'
  );
  assertBundledSidecarIntegrity(
    path.join(context.appOutDir, 'resources', 'tools', 'nvidia-profile-helper', 'bin'),
    'nvidia-profile-helper'
  );

  const presentMonExecutable = findPresentMonExecutable(presentMonDirectory);
  const presentMonLegacyExecutable = path.join(presentMonDirectory, 'PresentMonLegacy.exe');
  if (!presentMonExecutable) {
    throw new Error(`Unable to package PresentMon sidecar; no executable was copied to ${presentMonDirectory}. Run npm run vendor:presentmon before packaging.`);
  }
  if (!fs.existsSync(presentMonLegacyExecutable) || fs.statSync(presentMonLegacyExecutable).size <= 0) {
    throw new Error(`Unable to package PresentMon legacy fallback; no executable was copied to ${presentMonLegacyExecutable}. Run npm run vendor:presentmon before packaging.`);
  }

  const executableName = context.packager?.appInfo?.productFilename || 'NovaTweaks';
  const executablePath = path.join(context.appOutDir, `${executableName}.exe`);
  const iconPath = path.resolve(context.packager.projectDir, 'resources', 'pictures', 'logo', 'logo.ico');
  const rceditPath = path.resolve(context.packager.projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Unable to patch icon; executable not found: ${executablePath}`);
  }

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Unable to patch icon; icon not found: ${iconPath}`);
  }

  if (!fs.existsSync(rceditPath)) {
    throw new Error(`Unable to patch icon; rcedit not found: ${rceditPath}`);
  }

  execFileSync(rceditPath, [
    executablePath,
    '--set-icon',
    iconPath,
    '--set-version-string',
    'FileDescription',
    'Nova Tweaks',
    '--set-version-string',
    'ProductName',
    'Nova Tweaks',
    '--set-version-string',
    'CompanyName',
    'Nova Tweaks'
  ], {
    stdio: 'inherit'
  });
};

module.exports.assertPackagedAsarEntries = assertPackagedAsarEntries;
