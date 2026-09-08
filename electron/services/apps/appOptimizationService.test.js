const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  clearCacheTargets,
  createAppOptimizationService,
  isContainedPath,
  matchesStartupEntry,
  resolveCacheTargets
} = require('./appOptimizationService');

test('path containment rejects sibling paths with a shared prefix', () => {
  const root = path.join('C:\\', 'Users', 'Test', 'Cache');
  assert.equal(isContainedPath(root, path.join(root, 'GPUCache')), true);
  assert.equal(isContainedPath(root, `${root}-other`), false);
});

test('cache cleanup removes children but preserves the explicit cache directory', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-app-opt-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const cache = path.join(tempRoot, 'Cache');
  const protectedFile = path.join(tempRoot, 'Preferences.json');
  await fs.mkdir(path.join(cache, 'nested'), { recursive: true });
  await fs.writeFile(path.join(cache, 'nested', 'entry.bin'), 'cache-data');
  await fs.writeFile(protectedFile, 'keep-me');

  const result = await clearCacheTargets([{ root: tempRoot, target: cache }]);
  assert.equal(result.removedItems, 1);
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'keep-me');
  assert.deepEqual(await fs.readdir(cache), []);
});

test('cache resolver never returns profile cookies or history files', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-browser-opt-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const profile = path.join(tempRoot, 'Default');
  await fs.mkdir(path.join(profile, 'Cache'), { recursive: true });
  await fs.writeFile(path.join(profile, 'Cookies'), 'protected');
  await fs.writeFile(path.join(profile, 'History'), 'protected');

  const targets = await resolveCacheTargets({
    cacheGroups: [{
      kind: 'chromiumProfiles',
      root: tempRoot,
      relativeDirs: ['Cache']
    }]
  });
  assert.deepEqual(targets.map((entry) => entry.target), [path.join(profile, 'Cache')]);
});

test('startup matching uses app identity instead of generic words', () => {
  const profile = { names: ['discord'] };
  assert.equal(matchesStartupEntry(
    { executablePath: 'C:\\Users\\Test\\Discord.exe' },
    profile,
    { name: 'Discord', command: '"C:\\Users\\Test\\Discord.exe" --start-minimized' }
  ), true);
  assert.equal(matchesStartupEntry(
    { executablePath: 'C:\\Users\\Test\\Discord.exe' },
    profile,
    { name: 'Updater', command: '"C:\\Other\\Updater.exe"' }
  ), false);
});

test('reuses a trusted summary scan when opening optimization details', async (t) => {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-app-summary-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  let appScans = 0;
  const app = {
    id: 'discord',
    name: 'Discord',
    publisher: 'Discord Inc.',
    executablePath: ''
  };
  const service = createAppOptimizationService({
    backupRoot,
    environment: {
      APPDATA: path.join(backupRoot, 'roaming'),
      LOCALAPPDATA: path.join(backupRoot, 'local')
    },
    getApps: async () => {
      appScans += 1;
      return [app];
    },
    getStartupEntries: async () => []
  });

  await service.enrichApps([app], { detailLevel: 'summary' });
  const analysis = await service.analyzeById(app.id, { includeCacheSize: false });

  assert.equal(appScans, 0);
  assert.equal(analysis.optimization.analyzed, true);
  assert.equal(analysis.optimization.profileId, 'discord');
});

test('status-only apps complete without invoking undocumented changes', async (t) => {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-app-state-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));
  let powershellCalls = 0;
  const updates = [];
  const service = createAppOptimizationService({
    backupRoot,
    getApps: async () => [{
      id: 'onedrive',
      name: 'Microsoft OneDrive',
      publisher: 'Microsoft Corporation',
      executablePath: 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe'
    }],
    getStartupEntries: async () => [],
    executePowerShell: async () => {
      powershellCalls += 1;
      return null;
    },
    onUpdate: (state) => updates.push(state)
  });

  const state = await service.start({ appId: 'onedrive' });
  assert.equal(state.status, 'success');
  assert.equal(state.total, 0);
  assert.equal(powershellCalls, 0);
  assert.deepEqual(updates.map((entry) => entry.phase), ['preflight', 'success']);
});

test('applies and restores Discord JSON settings without changing unrelated values', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-discord-opt-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const discordRoot = path.join(tempRoot, 'discord');
  const settingsPath = path.join(discordRoot, 'settings.json');
  await fs.mkdir(discordRoot, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify({
    BACKGROUND_COLOR: '#101010',
    enableHardwareAcceleration: true
  }, null, 2));

  let finishOperation;
  const finished = new Promise((resolve) => {
    finishOperation = resolve;
  });
  const service = createAppOptimizationService({
    backupRoot: path.join(tempRoot, 'backups'),
    environment: {
      APPDATA: tempRoot,
      LOCALAPPDATA: path.join(tempRoot, 'local')
    },
    getApps: async () => [{
      id: 'discord',
      name: 'Discord',
      publisher: 'Discord Inc.',
      executablePath: 'C:\\Users\\Test\\Discord.exe',
      processActive: false,
      processId: 0
    }],
    getStartupEntries: async () => [],
    executePowerShell: async () => {
      throw new Error('Discord settings must not require PowerShell.');
    },
    onUpdate: (state) => {
      if (['success', 'partial', 'error'].includes(state.phase)) finishOperation(state);
    }
  });

  const analysis = await service.analyzeById('discord');
  const hardwareAction = analysis.optimization.actions.find((entry) => entry.id === 'discord.hardwareAcceleration');
  assert.equal(hardwareAction?.currentValue, true);
  assert.equal(hardwareAction?.needsChange, true);
  assert.equal(hardwareAction?.reversible, true);

  await service.start({
    appId: 'discord',
    actionIds: ['discord.hardwareAcceleration']
  });
  const completed = await finished;
  assert.equal(completed.status, 'success');
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')), {
    BACKGROUND_COLOR: '#101010',
    enableHardwareAcceleration: false
  });

  assert.deepEqual(await service.reset({ appId: 'discord' }), { restored: 1, failed: 0 });
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')), {
    BACKGROUND_COLOR: '#101010',
    enableHardwareAcceleration: true
  });
});

test('rejects a tampered Discord restore target outside the catalog path', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-discord-restore-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const discordRoot = path.join(tempRoot, 'discord');
  const backupRoot = path.join(tempRoot, 'backups');
  const victimPath = path.join(tempRoot, 'unrelated.json');
  await fs.mkdir(discordRoot, { recursive: true });
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.writeFile(path.join(discordRoot, 'settings.json'), '{}');
  await fs.writeFile(victimPath, JSON.stringify({ enableHardwareAcceleration: false }));
  await fs.writeFile(path.join(backupRoot, 'app-optimization-state.json'), JSON.stringify({
    discord: {
      registry: {},
      settings: {
        'discord.hardwareAcceleration': {
          filePath: victimPath,
          settingPath: ['enableHardwareAcceleration'],
          exists: true,
          value: true
        }
      },
      startup: {}
    }
  }));

  const service = createAppOptimizationService({
    backupRoot,
    environment: {
      APPDATA: tempRoot,
      LOCALAPPDATA: path.join(tempRoot, 'local')
    },
    getApps: async () => [{
      id: 'discord',
      name: 'Discord',
      publisher: 'Discord Inc.',
      executablePath: 'C:\\Users\\Test\\Discord.exe'
    }],
    getStartupEntries: async () => []
  });

  assert.deepEqual(await service.reset({ appId: 'discord' }), { restored: 0, failed: 1 });
  assert.deepEqual(JSON.parse(await fs.readFile(victimPath, 'utf8')), {
    enableHardwareAcceleration: false
  });
});

test('saves, exposes and verifies restoration of managed browser settings', async (t) => {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-app-restore-'));
  t.after(() => fs.rm(backupRoot, { recursive: true, force: true }));

  const registry = new Map();
  const privilegedPolicyCalls = [];
  const registryKey = (entry) => `${entry.path || entry.registryPath}\\${entry.name || entry.valueName}`;
  const hardwareKey = 'HKCU:\\Software\\Policies\\Google\\Chrome\\HardwareAccelerationModeEnabled';
  registry.set(hardwareKey, { exists: true, value: 0, kind: 'DWord' });

  function decodePayload(script) {
    const match = String(script).match(/FromBase64String\('([^']+)'\)/);
    return match ? JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) : null;
  }

  const executePowerShell = async (script) => {
    const payload = decodePayload(script);
    if (String(script).includes('$result = foreach')) {
      return payload.map((entry) => {
        const current = registry.get(registryKey(entry));
        return {
          id: entry.id,
          exists: Boolean(current?.exists),
          value: current?.value ?? null,
          kind: current?.kind || ''
        };
      });
    }
    if (String(script).includes('New-ItemProperty')) {
      throw new Error('Managed policies must use the administrator broker.');
    }
    if (String(script).includes('Remove-ItemProperty')) {
      registry.delete(registryKey(payload));
      return { ok: true };
    }
    return null;
  };

  let finishOperation;
  const finished = new Promise((resolve) => {
    finishOperation = resolve;
  });
  const service = createAppOptimizationService({
    backupRoot,
    getApps: async () => [{
      id: 'chrome',
      name: 'Google Chrome',
      publisher: 'Google LLC',
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      processActive: false,
      processId: 0
    }],
    getStartupEntries: async () => [],
    setStartupEntryEnabled: async () => ({ entry: null }),
    executePowerShell,
    executePrivilegedPolicy: async (payload) => {
      privilegedPolicyCalls.push(payload);
      if (payload.mode === 'apply') {
        registry.set(hardwareKey, { exists: true, value: 1, kind: 'DWord' });
      } else if (payload.exists) {
        registry.set(hardwareKey, { exists: true, value: payload.value, kind: 'DWord' });
      } else {
        registry.delete(hardwareKey);
      }
      return { ok: true };
    },
    onUpdate: (state) => {
      if (['success', 'partial', 'error'].includes(state.phase)) finishOperation(state);
    }
  });

  await service.start({
    appId: 'chrome',
    actionIds: ['browser.hardwareAcceleration']
  });
  const completed = await finished;
  assert.equal(completed.status, 'success');
  assert.equal(registry.get(hardwareKey).value, 1);
  assert.deepEqual(privilegedPolicyCalls[0], {
    profileId: 'chrome',
    actionId: 'browser.hardwareAcceleration',
    mode: 'apply'
  });

  const afterApply = await service.analyzeById('chrome');
  assert.equal(afterApply.optimization.restoreAvailable, true);
  assert.equal(afterApply.optimization.restoreCount, 1);
  assert.equal(
    afterApply.optimization.actions.find((entry) => entry.id === 'browser.hardwareAcceleration')?.reversible,
    true
  );

  const restored = await service.reset({ appId: 'chrome' });
  assert.deepEqual(restored, { restored: 1, failed: 0 });
  assert.equal(registry.get(hardwareKey).value, 0);
  assert.deepEqual(privilegedPolicyCalls[1], {
    profileId: 'chrome',
    actionId: 'browser.hardwareAcceleration',
    mode: 'restore',
    exists: true,
    value: 0
  });

  const afterRestore = await service.analyzeById('chrome');
  assert.equal(afterRestore.optimization.restoreAvailable, false);
  assert.equal(afterRestore.optimization.restoreCount, 0);
});
