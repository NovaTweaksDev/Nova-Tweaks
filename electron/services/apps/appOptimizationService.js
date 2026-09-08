const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const {
  findOptimizationProfile,
  normalizeIdentity,
  toProfileSummary
} = require('./appOptimizationCatalog');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const OPERATION_TIMEOUT_MS = 30000;
const SNAPSHOT_FILE_NAME = 'app-optimization-state.json';

class AppOptimizationError extends Error {
  constructor(message, code = 'APP_OPTIMIZATION_ERROR', details = {}) {
    super(message);
    this.name = 'AppOptimizationError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShellJson(script, { timeoutMs = OPERATION_TIMEOUT_MS } = {}) {
  if (process.platform !== 'win32') {
    throw new AppOptimizationError('App optimization is only available on Windows.', 'APP_OPTIMIZATION_UNSUPPORTED_PLATFORM');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(resolveWindowsSystemExecutable('powershell'), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShell([
        '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
        '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
        '$OutputEncoding = New-Object System.Text.UTF8Encoding $false',
        script
      ].join('\n'))
    ], {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new AppOptimizationError('Unable to start the app optimization helper.', 'APP_OPTIMIZATION_PROCESS_FAILED', {
        message: error.message
      }));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new AppOptimizationError('App optimization helper timed out.', 'APP_OPTIMIZATION_TIMEOUT'));
        return;
      }
      if (exitCode !== 0) {
        reject(new AppOptimizationError('App optimization helper failed.', 'APP_OPTIMIZATION_PROCESS_FAILED', {
          exitCode,
          stderr: stderr.trim(),
          stdout: stdout.trim()
        }));
        return;
      }

      const raw = stdout.trim();
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new AppOptimizationError('App optimization returned invalid data.', 'APP_OPTIMIZATION_INVALID_RESULT', {
          message: error.message,
          stdout: raw
        }));
      }
    });
  });
}

function normalizeRegistryValue(value, type) {
  if (type === 'dword') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  }
  return String(value ?? '');
}

function registryValuesEqual(left, right, type) {
  return normalizeRegistryValue(left, type) === normalizeRegistryValue(right, type);
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isContainedPath(root, candidate) {
  const normalizedRoot = path.resolve(String(root || '')).toLowerCase();
  const normalizedCandidate = path.resolve(String(candidate || '')).toLowerCase();
  return Boolean(normalizedRoot && normalizedCandidate && (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  ));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listDirectories(root) {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name));
  } catch (_error) {
    return [];
  }
}

async function resolveCacheTargets(profile) {
  const targets = [];
  for (const group of profile.cacheGroups) {
    const root = path.resolve(group.root);
    if (!group.root || !(await pathExists(root))) {
      continue;
    }

    let profileRoots = [];
    if (group.kind === 'chromiumProfiles') {
      profileRoots.push(root);
      const children = await listDirectories(root);
      profileRoots.push(...children.filter((entry) => {
        const name = path.basename(entry);
        return name === 'Default' || name === 'Guest Profile' || name === 'System Profile' || /^Profile \d+$/i.test(name);
      }));
    } else if (group.kind === 'childProfiles') {
      profileRoots = await listDirectories(root);
    } else if (group.kind === 'packagePrefix') {
      profileRoots = (await listDirectories(root))
        .filter((entry) => path.basename(entry).toLowerCase().startsWith(String(group.prefix || '').toLowerCase()));
    } else {
      profileRoots = [root];
    }

    for (const profileRoot of profileRoots) {
      for (const relativeDir of group.relativeDirs) {
        const target = path.resolve(profileRoot, relativeDir);
        if (!isContainedPath(root, target) || !(await pathExists(target))) {
          continue;
        }
        targets.push({ root, target });
      }
    }
  }

  const seen = new Set();
  return targets.filter(({ target }) => {
    const key = target.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function getPathStats(targetPath) {
  let itemCount = 0;
  let sizeBytes = 0;

  async function visit(currentPath) {
    let stat;
    try {
      stat = await fs.lstat(currentPath);
    } catch (_error) {
      return;
    }
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isFile()) {
      itemCount += 1;
      sizeBytes += Number(stat.size) || 0;
      return;
    }
    if (!stat.isDirectory()) {
      return;
    }

    let children = [];
    try {
      children = await fs.readdir(currentPath);
    } catch (_error) {
      return;
    }
    for (const child of children) {
      await visit(path.join(currentPath, child));
    }
  }

  await visit(targetPath);
  return { itemCount, sizeBytes };
}

async function clearCacheTargets(targets) {
  let removedItems = 0;
  let removedBytes = 0;
  const cleanedPaths = [];

  for (const { root, target } of targets) {
    if (!isContainedPath(root, target) || path.resolve(root) === path.resolve(target)) {
      continue;
    }
    let children = [];
    try {
      children = await fs.readdir(target);
    } catch (_error) {
      continue;
    }

    for (const child of children) {
      const childPath = path.resolve(target, child);
      if (!isContainedPath(target, childPath)) {
        continue;
      }
      const childStats = await getPathStats(childPath);
      try {
        await fs.rm(childPath, { recursive: true, force: true });
        removedItems += 1;
        removedBytes += childStats.sizeBytes;
      } catch (_error) {
        // Locked cache items are left in place and reported by verification.
      }
    }
    if (children.length) {
      cleanedPaths.push(target);
    }
  }

  return { removedItems, removedBytes, cleanedPaths };
}

function matchesStartupEntry(app, profile, entry) {
  const haystack = normalizeIdentity([
    entry?.name,
    entry?.command,
    entry?.sourcePath,
    entry?.entryName
  ].filter(Boolean).join(' '));
  if (!haystack) {
    return false;
  }

  const appExecutable = path.basename(String(app?.executablePath || '')).toLowerCase();
  if (appExecutable && appExecutable !== 'launcher.exe' && haystack.includes(normalizeIdentity(appExecutable.replace(/\.exe$/i, '')))) {
    return true;
  }

  return profile.names
    .map(normalizeIdentity)
    .filter((value) => value.length >= 4 && !['browser', 'stable'].includes(value))
    .some((value) => haystack.includes(value));
}

function actionLabel(actionId) {
  const labels = {
    'browser.hardwareAcceleration': 'Hardware acceleration',
    'browser.backgroundMode': 'Background apps',
    'browser.memorySaver': 'Memory saver',
    'browser.memorySaverLevel': 'Balanced memory saver',
    'browser.startupBoost': 'Startup boost',
    'browser.efficiencyMode': 'Efficiency mode',
    'browser.sleepingTabs': 'Sleeping tabs',
    'browser.sleepingTabsTimeout': '30-minute sleeping tabs',
    'browser.doh': 'DNS over HTTPS',
    'browser.dohFallback': 'Secure DNS fallback',
    'browser.telemetry': 'Optional telemetry',
    'browser.diagnostics': 'Optional diagnostic data',
    'discord.hardwareAcceleration': 'Reduce Discord GPU usage',
    'discord.minimizeToTray': 'Stop Discord when its window closes',
    'startup.disable': 'Windows startup',
    'cache.cleanup': 'Application cache'
  };
  return labels[actionId] || actionId;
}

function getNestedValue(source, settingPath) {
  let current = source;
  for (const segment of settingPath) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: null };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function setNestedValue(source, settingPath, value) {
  let current = source;
  for (const segment of settingPath.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[settingPath.at(-1)] = value;
}

function deleteNestedValue(source, settingPath) {
  let current = source;
  for (const segment of settingPath.slice(0, -1)) {
    if (!current?.[segment] || typeof current[segment] !== 'object') {
      return;
    }
    current = current[segment];
  }
  delete current[settingPath.at(-1)];
}

function resolveSettingFile(action, app) {
  const appName = normalizeIdentity(app?.name);
  const candidates = Array.isArray(action?.filePaths) ? action.filePaths : [];
  return candidates.find((candidate) => (
    (candidate.names || []).some((name) => appName === normalizeIdentity(name))
  ))?.path || candidates.find((candidate) => (
    (candidate.names || []).some((name) => appName.includes(normalizeIdentity(name)))
  ))?.path || candidates.at(-1)?.path || '';
}

function createAppOptimizationService({
  logger,
  onUpdate,
  getApps,
  getStartupEntries,
  setStartupEntryEnabled,
  backupRoot,
  environment = process.env,
  executePowerShell = runPowerShellJson,
  executePrivilegedPolicy
} = {}) {
  const snapshotPath = path.join(String(backupRoot || process.cwd()), SNAPSHOT_FILE_NAME);
  let activeOperation = null;
  let lastState = null;
  const knownApps = new Map();

  function emit(state) {
    lastState = clone(state);
    onUpdate?.(clone(state));
  }

  async function readRegistryValues(policies) {
    if (!policies.length) {
      return new Map();
    }
    const payload = Buffer.from(JSON.stringify(policies.map((entry) => ({
      id: entry.id,
      path: entry.registryPath,
      name: entry.valueName
    }))), 'utf8').toString('base64');
    const result = await executePowerShell(`
$ErrorActionPreference = 'Stop'
$items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$result = foreach ($item in @($items)) {
  $exists = $false
  $value = $null
  $kind = ''
  if (Test-Path -LiteralPath ([string]$item.path)) {
    try {
      $key = Get-Item -LiteralPath ([string]$item.path) -ErrorAction Stop
      $value = $key.GetValue([string]$item.name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $value) {
        $exists = $true
        $kind = [string]$key.GetValueKind([string]$item.name)
      }
    } catch {}
  }
  [PSCustomObject]@{ id = [string]$item.id; exists = $exists; value = $value; kind = $kind }
}
@($result) | ConvertTo-Json -Compress -Depth 4
`);
    const source = Array.isArray(result) ? result : result ? [result] : [];
    return new Map(source.map((entry) => [String(entry.id), entry]));
  }

  async function writeRegistryValue(policyAction, value) {
    const payload = Buffer.from(JSON.stringify({
      path: policyAction.registryPath,
      name: policyAction.valueName,
      type: policyAction.valueType,
      value
    }), 'utf8').toString('base64');
    await executePowerShell(`
$ErrorActionPreference = 'Stop'
$item = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
New-Item -Path ([string]$item.path) -Force | Out-Null
$propertyType = if ([string]$item.type -eq 'dword') { 'DWord' } else { 'String' }
New-ItemProperty -Path ([string]$item.path) -Name ([string]$item.name) -Value $item.value -PropertyType $propertyType -Force | Out-Null
[PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress
`);
  }

  async function removeRegistryValue(registryPath, valueName) {
    const payload = Buffer.from(JSON.stringify({ path: registryPath, name: valueName }), 'utf8').toString('base64');
    await executePowerShell(`
$ErrorActionPreference = 'Stop'
$item = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
if (Test-Path -LiteralPath ([string]$item.path)) {
  Remove-ItemProperty -LiteralPath ([string]$item.path) -Name ([string]$item.name) -ErrorAction SilentlyContinue
}
[PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress
`);
  }

  async function readSnapshots() {
    try {
      const raw = await fs.readFile(snapshotPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  async function writeSnapshots(snapshots) {
    const snapshotDirectory = path.dirname(snapshotPath);
    await fs.mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await fs.chmod(snapshotDirectory, 0o700);
    }
    const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(snapshots, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    try {
      await fs.rename(tempPath, snapshotPath);
    } catch (_error) {
      await fs.rm(snapshotPath, { force: true });
      await fs.rename(tempPath, snapshotPath);
    }
    if (process.platform !== 'win32') {
      await fs.chmod(snapshotPath, 0o600);
    }
  }

  async function readJsonFile(filePath) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw new AppOptimizationError('App settings file has an unsupported format.', 'APP_OPTIMIZATION_SETTINGS_INVALID');
    }
    const raw = await fs.readFile(filePath, 'utf8');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AppOptimizationError('App settings file has an unsupported format.', 'APP_OPTIMIZATION_SETTINGS_INVALID');
    }
    return value;
  }

  async function writeJsonFile(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    try {
      await fs.copyFile(tempPath, filePath);
      if (process.platform !== 'win32') {
        await fs.chmod(filePath, 0o600);
      }
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }

  async function saveOriginalRegistryValue(profileId, action, current) {
    const snapshots = await readSnapshots();
    const profileSnapshot = snapshots[profileId] && typeof snapshots[profileId] === 'object'
      ? snapshots[profileId]
      : { registry: {}, startup: {}, updatedAt: '' };
    profileSnapshot.registry ||= {};
    if (!profileSnapshot.registry[action.id]) {
      profileSnapshot.registry[action.id] = {
        registryPath: action.registryPath,
        valueName: action.valueName,
        valueType: action.valueType,
        exists: Boolean(current?.exists),
        value: current?.value ?? null
      };
    }
    profileSnapshot.updatedAt = new Date().toISOString();
    snapshots[profileId] = profileSnapshot;
    await writeSnapshots(snapshots);
  }

  async function saveOriginalStartupValue(profileId, entry) {
    const snapshots = await readSnapshots();
    const profileSnapshot = snapshots[profileId] && typeof snapshots[profileId] === 'object'
      ? snapshots[profileId]
      : { registry: {}, startup: {}, updatedAt: '' };
    profileSnapshot.startup ||= {};
    if (!profileSnapshot.startup[entry.id]) {
      profileSnapshot.startup[entry.id] = {
        enabled: Boolean(entry.enabled),
        name: String(entry.name || '')
      };
    }
    profileSnapshot.updatedAt = new Date().toISOString();
    snapshots[profileId] = profileSnapshot;
    await writeSnapshots(snapshots);
  }

  async function saveOriginalSettingValue(profileId, action) {
    const snapshots = await readSnapshots();
    const profileSnapshot = snapshots[profileId] && typeof snapshots[profileId] === 'object'
      ? snapshots[profileId]
      : { registry: {}, settings: {}, startup: {}, updatedAt: '' };
    profileSnapshot.settings ||= {};
    if (!profileSnapshot.settings[action.id]) {
      profileSnapshot.settings[action.id] = {
        filePath: action.filePath,
        settingPath: action.settingPath,
        exists: Boolean(action.currentExists),
        value: action.currentValue ?? null
      };
    }
    profileSnapshot.updatedAt = new Date().toISOString();
    snapshots[profileId] = profileSnapshot;
    await writeSnapshots(snapshots);
  }

  function rememberApps(apps, detailLevel) {
    for (const app of Array.isArray(apps) ? apps : []) {
      if (!app?.id) continue;
      const previous = knownApps.get(app.id);
      if (!previous || detailLevel === 'full' || previous.detailLevel !== 'full') {
        knownApps.set(app.id, { app, detailLevel });
      }
    }
  }

  async function findApp(appId, { requireFull = false } = {}) {
    const known = knownApps.get(appId);
    if (known && (!requireFull || known.detailLevel === 'full')) {
      return known.app;
    }
    const detailLevel = requireFull ? 'full' : 'summary';
    const apps = await getApps?.({ detailLevel });
    rememberApps(apps, detailLevel);
    const app = (Array.isArray(apps) ? apps : []).find((entry) => entry.id === appId);
    if (!app) {
      throw new AppOptimizationError('Requested app was not found.', 'APPS_APP_NOT_FOUND', { appId });
    }
    return app;
  }

  async function analyzeApp(app, { includeCacheSize = false, includeStartup = true, startupEntries = null } = {}) {
    const profile = findOptimizationProfile(app, environment);
    const baseSummary = toProfileSummary(profile);
    if (!profile) {
      return { ...baseSummary, actions: [] };
    }
    const snapshots = await readSnapshots();
    const savedSnapshot = snapshots[profile.id] && typeof snapshots[profile.id] === 'object'
      ? snapshots[profile.id]
      : null;
    const restoreCount = savedSnapshot
      ? Object.keys(savedSnapshot.registry || {}).length +
        Object.keys(savedSnapshot.settings || {}).length +
        Object.keys(savedSnapshot.startup || {}).length
      : 0;

    const actions = [];
    const registryValues = await readRegistryValues(profile.policies);
    for (const policyAction of profile.policies) {
      const current = registryValues.get(policyAction.id) || { exists: false, value: null, kind: '' };
      const needsChange = !current.exists ||
        !registryValuesEqual(current.value, policyAction.recommendedValue, policyAction.valueType);
      actions.push({
        ...policyAction,
        label: actionLabel(policyAction.id),
        currentValue: current.value,
        currentExists: Boolean(current.exists),
        needsChange,
        supported: true,
        reversible: true
      });
    }

    for (const settingAction of profile.settings) {
      const filePath = resolveSettingFile(settingAction, app);
      if (!filePath || !(await pathExists(filePath))) {
        continue;
      }
      try {
        const settings = await readJsonFile(filePath);
        const current = getNestedValue(settings, settingAction.settingPath);
        actions.push({
          ...settingAction,
          filePaths: undefined,
          filePath,
          label: actionLabel(settingAction.id),
          currentValue: current.value,
          currentExists: current.exists,
          needsChange: !current.exists || !valuesEqual(current.value, settingAction.recommendedValue),
          supported: true,
          reversible: true
        });
      } catch (error) {
        logger?.warn?.('Unable to read app optimization settings.', {
          appId: app.id,
          actionId: settingAction.id,
          message: error?.message || 'Invalid app settings file'
        });
      }
    }

    const entries = includeStartup && profile.startup
      ? Array.isArray(startupEntries) ? startupEntries : await getStartupEntries?.()
      : [];
    const matchingStartupEntries = includeStartup && profile.startup
      ? (Array.isArray(entries) ? entries : []).filter((entry) => matchesStartupEntry(app, profile, entry) && entry?.canToggle !== false)
      : [];
    if (includeStartup && profile.startup && matchingStartupEntries.length) {
      actions.push({
        id: profile.startup.id,
        kind: 'startup',
        label: actionLabel(profile.startup.id),
        recommended: profile.startup.recommended,
        recommendedValue: false,
        currentValue: matchingStartupEntries.some((entry) => Boolean(entry.enabled)),
        needsChange: matchingStartupEntries.some((entry) => Boolean(entry.enabled)),
        supported: true,
        reversible: true,
        entries: matchingStartupEntries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          enabled: Boolean(entry.enabled)
        }))
      });
    }

    const cacheTargets = await resolveCacheTargets(profile);
    if (profile.cacheGroups.length && cacheTargets.length) {
      let cacheStats = { itemCount: 0, sizeBytes: 0 };
      if (includeCacheSize) {
        for (const { target } of cacheTargets) {
          const stats = await getPathStats(target);
          cacheStats.itemCount += stats.itemCount;
          cacheStats.sizeBytes += stats.sizeBytes;
        }
      } else {
        for (const { target } of cacheTargets) {
          try {
            const entriesInTarget = await fs.readdir(target);
            cacheStats.itemCount += entriesInTarget.length ? 1 : 0;
          } catch (_error) {
            // Missing or inaccessible cache is treated as empty.
          }
        }
      }
      actions.push({
        id: 'cache.cleanup',
        kind: 'cache',
        label: actionLabel('cache.cleanup'),
        recommended: true,
        recommendedValue: 'empty',
        currentValue: cacheStats.itemCount ? 'data' : 'empty',
        needsChange: cacheStats.itemCount > 0,
        supported: true,
        requiresClose: true,
        reversible: false,
        itemCount: cacheStats.itemCount,
        sizeBytes: cacheStats.sizeBytes,
        targets: cacheTargets
      });
    }

    const actionable = actions.filter((entry) => entry.supported);
    const recommendedChanges = actionable.filter((entry) => entry.recommended && entry.needsChange).length;
    const optionalChanges = actionable.filter((entry) => !entry.recommended && entry.needsChange).length;
    const status = profile.statusOnly
      ? 'status-only'
      : recommendedChanges > 0
        ? 'recommended'
        : optionalChanges > 0
          ? 'partial'
          : actionable.length
            ? 'optimized'
            : 'status-only';

    return {
      ...baseSummary,
      analyzed: true,
      status,
      supported: actionable.length > 0,
      availableCount: actionable.length,
      recommendedCount: recommendedChanges,
      optionalCount: optionalChanges,
      requiresClose: actionable.some((entry) => entry.recommended && entry.needsChange && entry.requiresClose),
      adminRequired: false,
      managedSettings: actionable.some((entry) => entry.kind === 'policy'),
      restoreAvailable: restoreCount > 0,
      restoreCount,
      running: Boolean(app.processActive),
      actions: actionable.map((entry) => ({
        ...entry,
        targets: undefined
      })),
      _actions: actionable
    };
  }

  async function analyzeById(appId, options = {}) {
    const app = await findApp(appId);
    const analysis = await analyzeApp(app, { ...options, includeStartup: false });
    return {
      app: {
        id: app.id,
        name: app.name,
        iconPath: app.iconPath,
        iconDataUrl: app.iconDataUrl,
        processActive: Boolean(app.processActive),
        processId: Number(app.processId) || 0
      },
      optimization: {
        ...analysis,
        actions: analysis.actions.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          label: entry.label,
          description: entry.description || '',
          recommended: Boolean(entry.recommended),
          currentValue: entry.currentValue,
          needsChange: Boolean(entry.needsChange),
          supported: Boolean(entry.supported),
          requiresClose: Boolean(entry.requiresClose),
          requiresRestart: Boolean(entry.requiresRestart),
          managed: Boolean(entry.managed),
          reversible: entry.reversible !== false,
          itemCount: Number(entry.itemCount) || 0,
          sizeBytes: Number(entry.sizeBytes) || 0
        })),
        _actions: undefined
      }
    };
  }

  async function enrichApps(apps, { detailLevel = 'full' } = {}) {
    const source = Array.isArray(apps) ? apps : [];
    rememberApps(source, detailLevel);
    if (detailLevel === 'summary') {
      return source.map((app) => ({
        ...app,
        optimization: toProfileSummary(findOptimizationProfile(app, environment))
      }));
    }

    return Promise.all(source.map(async (app) => {
      try {
        const analysis = await analyzeApp(app, { includeCacheSize: false, includeStartup: false });
        return {
          ...app,
          optimization: {
            ...analysis,
            actions: analysis.actions.map((entry) => ({
              id: entry.id,
              kind: entry.kind,
              label: entry.label,
              description: entry.description || '',
              recommended: Boolean(entry.recommended),
              needsChange: Boolean(entry.needsChange),
              supported: Boolean(entry.supported),
              requiresClose: Boolean(entry.requiresClose),
              requiresRestart: Boolean(entry.requiresRestart),
              managed: Boolean(entry.managed),
              reversible: entry.reversible !== false
            })),
            _actions: undefined
          }
        };
      } catch (error) {
        logger?.warn?.('Unable to analyze app optimization state.', {
          appId: app.id,
          message: error?.message || 'Unknown optimization analysis error'
        });
        return {
          ...app,
          optimization: {
            ...toProfileSummary(findOptimizationProfile(app, environment)),
            status: 'unavailable'
          }
        };
      }
    }));
  }

  function operationPublicState(operation) {
    return {
      operationId: operation.id,
      appId: operation.app.id,
      appName: operation.app.name,
      appIconDataUrl: operation.app.iconDataUrl || '',
      profileId: operation.profile.id,
      status: operation.status,
      phase: operation.phase,
      total: operation.steps.length,
      current: operation.current,
      currentStepId: operation.currentStepId,
      currentStepName: operation.currentStepName,
      message: operation.message,
      applied: operation.applied,
      skipped: operation.skipped,
      failed: operation.failed,
      failures: operation.failures.map((entry) => ({ ...entry })),
      removedItems: operation.removedItems,
      removedBytes: operation.removedBytes,
      requiresRestart: operation.requiresRestart,
      managedSettings: operation.steps.some((entry) => entry.kind === 'policy'),
      closeFailed: Boolean(operation.closeFailed),
      canCancel: ['preflight', 'waiting-close', 'backup', 'applying'].includes(operation.phase)
    };
  }

  async function isProcessAlive(processId) {
    if (!Number.isFinite(Number(processId)) || Number(processId) <= 0) {
      return false;
    }
    try {
      process.kill(Number(processId), 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  }

  async function requestGracefulClose(processId) {
    if (!(await isProcessAlive(processId))) {
      return true;
    }
    const payload = Buffer.from(JSON.stringify({ processId: Number(processId) }), 'utf8').toString('base64');
    await executePowerShell(`
$ErrorActionPreference = 'SilentlyContinue'
$item = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$process = Get-Process -Id ([int]$item.processId) -ErrorAction SilentlyContinue
$requested = $false
if ($process) { $requested = [bool]$process.CloseMainWindow() }
[PSCustomObject]@{ requested = $requested } | ConvertTo-Json -Compress
`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return !(await isProcessAlive(processId));
  }

  async function applyStep(operation, step) {
    if (step.kind === 'policy') {
      await saveOriginalRegistryValue(operation.profile.id, step, {
        exists: step.currentExists,
        value: step.currentValue
      });
      if (typeof executePrivilegedPolicy === 'function') {
        await executePrivilegedPolicy({
          profileId: operation.profile.id,
          actionId: step.id,
          mode: 'apply'
        });
      } else {
        await writeRegistryValue(step, step.recommendedValue);
      }
      const verification = await readRegistryValues([step]);
      const verified = verification.get(step.id);
      if (!verified?.exists || !registryValuesEqual(verified.value, step.recommendedValue, step.valueType)) {
        throw new AppOptimizationError('Managed browser setting could not be verified.', 'APP_OPTIMIZATION_VERIFY_FAILED', {
          actionId: step.id
        });
      }
      operation.requiresRestart ||= Boolean(step.requiresRestart);
      return;
    }

    if (step.kind === 'startup') {
      for (const entry of step.entries) {
        if (!entry.enabled) {
          continue;
        }
        await saveOriginalStartupValue(operation.profile.id, entry);
        const result = await setStartupEntryEnabled?.({ entryId: entry.id, enabled: false });
        if (!result?.entry || result.entry.enabled !== false) {
          throw new AppOptimizationError('Windows startup entry could not be disabled.', 'APP_OPTIMIZATION_VERIFY_FAILED', {
            actionId: step.id,
            entryId: entry.id
          });
        }
      }
      return;
    }

    if (step.kind === 'setting') {
      await saveOriginalSettingValue(operation.profile.id, step);
      const settings = await readJsonFile(step.filePath);
      setNestedValue(settings, step.settingPath, step.recommendedValue);
      await writeJsonFile(step.filePath, settings);
      const verification = getNestedValue(await readJsonFile(step.filePath), step.settingPath);
      if (!verification.exists || !valuesEqual(verification.value, step.recommendedValue)) {
        throw new AppOptimizationError('App setting could not be verified.', 'APP_OPTIMIZATION_VERIFY_FAILED', {
          actionId: step.id
        });
      }
      operation.requiresRestart ||= Boolean(step.requiresRestart);
      return;
    }

    if (step.kind === 'cache') {
      const result = await clearCacheTargets(step.targets);
      operation.removedItems += result.removedItems;
      operation.removedBytes += result.removedBytes;
      return;
    }

    throw new AppOptimizationError('Unsupported optimization action.', 'APP_OPTIMIZATION_ACTION_UNSUPPORTED', {
      actionId: step.id
    });
  }

  async function runOperation(operation) {
    operation.phase = 'backup';
    operation.message = 'Saving current settings...';
    emit(operationPublicState(operation));

    operation.phase = 'applying';
    for (let index = 0; index < operation.steps.length; index += 1) {
      if (operation.cancelRequested) {
        operation.status = 'cancelled';
        operation.phase = 'cancelled';
        operation.message = 'Optimization cancelled. Completed changes were kept.';
        emit(operationPublicState(operation));
        activeOperation = null;
        return;
      }

      const step = operation.steps[index];
      operation.current = index + 1;
      operation.currentStepId = step.id;
      operation.currentStepName = step.label;
      operation.message = `Applying ${step.label}...`;
      emit(operationPublicState(operation));

      if (!step.needsChange) {
        operation.skipped += 1;
        continue;
      }
      try {
        await applyStep(operation, step);
        operation.applied += 1;
      } catch (error) {
        operation.failed += 1;
        operation.failures.push({
          actionId: step.id,
          actionName: step.label,
          code: String(error?.code || 'APP_OPTIMIZATION_STEP_FAILED'),
          message: String(error?.message || 'This change could not be applied.')
        });
        logger?.warn?.('App optimization step failed.', {
          operationId: operation.id,
          appId: operation.app.id,
          actionId: step.id,
          code: error?.code || 'APP_OPTIMIZATION_STEP_FAILED',
          message: error?.message || 'Unknown app optimization error'
        });
        if (String(error?.code || '').startsWith('ADMIN_BROKER_')) {
          operation.skipped += Math.max(0, operation.steps.length - index - 1);
          break;
        }
      }
    }

    operation.phase = 'verifying';
    operation.message = 'Verifying applied settings...';
    emit(operationPublicState(operation));

    operation.status = operation.failed > 0
      ? operation.applied > 0 ? 'partial' : 'error'
      : 'success';
    operation.phase = operation.status;
    operation.message = operation.status === 'success'
      ? operation.applied > 0
        ? 'Recommended optimizations were applied.'
        : 'This app is already optimized.'
      : operation.status === 'partial'
        ? 'Optimization completed with some skipped or failed steps.'
        : 'The optimization could not be completed.';
    emit(operationPublicState(operation));
    activeOperation = null;
  }

  async function start({ appId, actionIds = null } = {}) {
    if (activeOperation) {
      throw new AppOptimizationError('Another app optimization is already running.', 'APPS_OPTIMIZATION_BUSY', {
        operationId: activeOperation.id
      });
    }
    const app = await findApp(String(appId || '').trim(), { requireFull: true });
    const profile = findOptimizationProfile(app, environment);
    if (!profile) {
      throw new AppOptimizationError('No stable optimization profile is available for this app.', 'APP_OPTIMIZATION_NOT_SUPPORTED');
    }
    const analysis = await analyzeApp(app, { includeCacheSize: false });
    const allowedIds = Array.isArray(actionIds) && actionIds.length
      ? new Set(actionIds.map((entry) => String(entry || '').trim()))
      : null;
    const steps = analysis._actions.filter((entry) => (
      allowedIds ? allowedIds.has(entry.id) : entry.recommended && entry.needsChange
    ));

    const operation = {
      id: crypto.randomUUID(),
      app,
      profile,
      steps,
      status: 'running',
      phase: 'preflight',
      current: 0,
      currentStepId: '',
      currentStepName: '',
      message: 'Checking current app settings...',
      applied: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      removedItems: 0,
      removedBytes: 0,
      requiresRestart: false,
      closeFailed: false,
      cancelRequested: false
    };
    activeOperation = operation;
    emit(operationPublicState(operation));

    if (!steps.length) {
      operation.status = 'success';
      operation.phase = 'success';
      operation.message = analysis.status === 'status-only'
        ? 'No stable automatic actions are available for this app.'
        : 'This app is already optimized.';
      emit(operationPublicState(operation));
      activeOperation = null;
      return operationPublicState(operation);
    }

    if (steps.some((entry) => entry.requiresClose) && await isProcessAlive(app.processId)) {
      operation.phase = 'waiting-close';
      operation.message = `${app.name} must be closed before its cache can be cleaned.`;
      emit(operationPublicState(operation));
      return operationPublicState(operation);
    }

    void runOperation(operation);
    return operationPublicState(operation);
  }

  async function confirmClose({ operationId } = {}) {
    const operation = activeOperation;
    if (!operation || operation.id !== operationId || operation.phase !== 'waiting-close') {
      throw new AppOptimizationError('The waiting optimization operation was not found.', 'APP_OPTIMIZATION_OPERATION_NOT_FOUND');
    }
    operation.message = `Closing ${operation.app.name}...`;
    operation.closeFailed = false;
    emit(operationPublicState(operation));
    const closed = await requestGracefulClose(operation.app.processId);
    if (!closed) {
      operation.closeFailed = true;
      operation.message = `Please close ${operation.app.name} manually, then retry.`;
      emit(operationPublicState(operation));
      return operationPublicState(operation);
    }
    void runOperation(operation);
    return operationPublicState(operation);
  }

  function cancel({ operationId } = {}) {
    const operation = activeOperation;
    if (!operation || operation.id !== operationId) {
      throw new AppOptimizationError('The optimization operation was not found.', 'APP_OPTIMIZATION_OPERATION_NOT_FOUND');
    }
    operation.cancelRequested = true;
    if (operation.phase === 'waiting-close' || operation.phase === 'preflight') {
      operation.status = 'cancelled';
      operation.phase = 'cancelled';
      operation.message = 'Optimization cancelled.';
      emit(operationPublicState(operation));
      activeOperation = null;
    }
    return operationPublicState(operation);
  }

  async function reset({ appId } = {}) {
    const app = await findApp(String(appId || '').trim());
    const profile = findOptimizationProfile(app, environment);
    if (!profile) {
      throw new AppOptimizationError('No optimization profile is available for this app.', 'APP_OPTIMIZATION_NOT_SUPPORTED');
    }
    const snapshots = await readSnapshots();
    const snapshot = snapshots[profile.id];
    if (!snapshot) {
      return { restored: 0, failed: 0 };
    }

    let restored = 0;
    let failed = 0;
    for (const [actionId, entry] of Object.entries(snapshot.registry || {})) {
      try {
        const registryAction = {
          id: `restore:${entry.valueName}`,
          registryPath: entry.registryPath,
          valueName: entry.valueName,
          valueType: entry.valueType
        };
        if (typeof executePrivilegedPolicy === 'function') {
          await executePrivilegedPolicy({
            profileId: profile.id,
            actionId,
            mode: 'restore',
            exists: Boolean(entry.exists),
            value: entry.value
          });
        } else if (entry.exists) {
          await writeRegistryValue(registryAction, entry.value);
        } else {
          await removeRegistryValue(entry.registryPath, entry.valueName);
        }
        const verification = await readRegistryValues([registryAction]);
        const restoredValue = verification.get(registryAction.id);
        const verified = entry.exists
          ? restoredValue?.exists && registryValuesEqual(restoredValue.value, entry.value, entry.valueType)
          : !restoredValue?.exists;
        if (!verified) {
          throw new Error('registry_restore_verification_failed');
        }
        restored += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    for (const [actionId, entry] of Object.entries(snapshot.settings || {})) {
      try {
        const allowedAction = profile.settings.find((action) => action.id === actionId);
        const allowedPath = allowedAction ? resolveSettingFile(allowedAction, app) : '';
        if (
          !allowedAction ||
          path.resolve(String(entry.filePath || '')).toLowerCase() !== path.resolve(allowedPath).toLowerCase() ||
          !valuesEqual(entry.settingPath, allowedAction.settingPath)
        ) {
          throw new Error('setting_restore_target_invalid');
        }
        const settings = await readJsonFile(entry.filePath);
        if (entry.exists) {
          setNestedValue(settings, entry.settingPath, entry.value);
        } else {
          deleteNestedValue(settings, entry.settingPath);
        }
        await writeJsonFile(entry.filePath, settings);
        const restoredValue = getNestedValue(await readJsonFile(entry.filePath), entry.settingPath);
        const verified = entry.exists
          ? restoredValue.exists && valuesEqual(restoredValue.value, entry.value)
          : !restoredValue.exists;
        if (!verified) {
          throw new Error('setting_restore_verification_failed');
        }
        restored += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    for (const [entryId, entry] of Object.entries(snapshot.startup || {})) {
      try {
        const result = await setStartupEntryEnabled?.({ entryId, enabled: Boolean(entry.enabled) });
        if (!result?.entry || Boolean(result.entry.enabled) !== Boolean(entry.enabled)) {
          throw new Error('startup_restore_failed');
        }
        restored += 1;
      } catch (_error) {
        failed += 1;
      }
    }

    if (!failed) {
      delete snapshots[profile.id];
      await writeSnapshots(snapshots);
    }
    return { restored, failed };
  }

  async function cleanupInactiveAppCaches() {
    if (activeOperation) {
      throw new AppOptimizationError('An app optimization is already running.', 'APPS_OPTIMIZATION_BUSY');
    }
    const apps = await getApps?.({ detailLevel: 'full' });
    let cleanedApps = 0;
    let skippedRunning = 0;
    let removedItems = 0;
    let removedBytes = 0;
    const failures = [];
    for (const app of Array.isArray(apps) ? apps : []) {
      const profile = findOptimizationProfile(app, environment);
      if (!profile?.cacheGroups?.length) continue;
      if (app.processActive || Number(app.processId) > 0) {
        skippedRunning += 1;
        continue;
      }
      try {
        const targets = await resolveCacheTargets(profile);
        if (!targets.length) continue;
        const result = await clearCacheTargets(targets);
        if (result.removedItems > 0) cleanedApps += 1;
        removedItems += result.removedItems;
        removedBytes += result.removedBytes;
      } catch (error) {
        failures.push({ appId: app.id, name: app.name, message: error?.message || 'Cache cleanup failed.' });
      }
    }
    return {
      cleanedApps,
      skippedRunning,
      removedItems,
      removedBytes,
      failed: failures.length,
      failures
    };
  }

  return {
    analyzeById,
    cancel,
    confirmClose,
    cleanupInactiveAppCaches,
    enrichApps,
    getState: () => clone(activeOperation ? operationPublicState(activeOperation) : lastState),
    reset,
    start
  };
}

module.exports = {
  AppOptimizationError,
  clearCacheTargets,
  createAppOptimizationService,
  isContainedPath,
  matchesStartupEntry,
  resolveCacheTargets,
  runPowerShellJson
};
