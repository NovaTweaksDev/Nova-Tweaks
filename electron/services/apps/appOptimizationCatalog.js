const path = require('path');

const CHROMIUM_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'GrShaderCache',
  'Media Cache',
  path.join('Service Worker', 'CacheStorage'),
  path.join('Service Worker', 'ScriptCache')
];

function normalizeIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function executableName(value) {
  const raw = String(value || '').trim().replace(/^"+|"+$/g, '');
  return path.basename(raw).toLowerCase();
}

function policy(id, registryPath, valueName, valueType, recommendedValue, options = {}) {
  return {
    id,
    kind: 'policy',
    registryPath,
    valueName,
    valueType,
    recommendedValue,
    recommended: options.recommended !== false,
    requiresRestart: options.requiresRestart === true,
    managed: true
  };
}

function jsonSetting(id, filePaths, settingPath, recommendedValue, options = {}) {
  return {
    id,
    kind: 'setting',
    filePaths,
    settingPath: Array.isArray(settingPath) ? settingPath : [settingPath],
    recommendedValue,
    recommended: options.recommended !== false,
    requiresClose: options.requiresClose === true,
    requiresRestart: options.requiresRestart === true,
    description: String(options.description || '')
  };
}

function chromiumCache(root) {
  return {
    kind: 'chromiumProfiles',
    root,
    relativeDirs: CHROMIUM_CACHE_DIRS
  };
}

function simpleCache(root, relativeDirs) {
  return {
    kind: 'simple',
    root,
    relativeDirs
  };
}

function profile(definition) {
  return {
    policies: [],
    settings: [],
    cacheGroups: [],
    startup: null,
    statusOnly: false,
    excludeNames: [],
    ...definition
  };
}

function buildProfiles(env = process.env) {
  const local = String(env.LOCALAPPDATA || '');
  const roaming = String(env.APPDATA || '');

  return [
    profile({
      id: 'chrome',
      names: ['google chrome', 'chrome'],
      publishers: ['google'],
      executables: ['chrome.exe'],
      description: 'Hardware acceleration, background mode, balanced memory saver, secure DNS and targeted browser cache cleanup.',
      policies: [
        policy('browser.hardwareAcceleration', 'HKCU:\\Software\\Policies\\Google\\Chrome', 'HardwareAccelerationModeEnabled', 'dword', 1, { requiresRestart: true }),
        policy('browser.backgroundMode', 'HKCU:\\Software\\Policies\\Google\\Chrome', 'BackgroundModeEnabled', 'dword', 0),
        policy('browser.memorySaver', 'HKCU:\\Software\\Policies\\Google\\Chrome', 'HighEfficiencyModeEnabled', 'dword', 1),
        policy('browser.memorySaverLevel', 'HKCU:\\Software\\Policies\\Google\\Chrome', 'MemorySaverModeSavings', 'dword', 1),
        policy('browser.doh', 'HKCU:\\Software\\Policies\\Google\\Chrome', 'DnsOverHttpsMode', 'string', 'automatic')
      ],
      cacheGroups: [chromiumCache(path.join(local, 'Google', 'Chrome', 'User Data'))],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'edge',
      names: ['microsoft edge'],
      excludeNames: ['webview', 'update', 'runtime'],
      publishers: ['microsoft'],
      executables: ['msedge.exe'],
      description: 'Hardware acceleration, background mode, sleeping tabs, efficiency mode, secure DNS and targeted browser cache cleanup.',
      policies: [
        policy('browser.hardwareAcceleration', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'HardwareAccelerationModeEnabled', 'dword', 1, { requiresRestart: true }),
        policy('browser.backgroundMode', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'BackgroundModeEnabled', 'dword', 0),
        policy('browser.startupBoost', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'StartupBoostEnabled', 'dword', 0),
        policy('browser.efficiencyMode', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'EfficiencyModeEnabled', 'dword', 1),
        policy('browser.sleepingTabs', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'SleepingTabsEnabled', 'dword', 1),
        policy('browser.sleepingTabsTimeout', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'SleepingTabsTimeout', 'dword', 1800, { recommended: false }),
        policy('browser.doh', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'DnsOverHttpsMode', 'string', 'automatic'),
        policy('browser.diagnostics', 'HKCU:\\Software\\Policies\\Microsoft\\Edge', 'DiagnosticData', 'dword', 1, { requiresRestart: true })
      ],
      cacheGroups: [chromiumCache(path.join(local, 'Microsoft', 'Edge', 'User Data'))],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'firefox',
      names: ['mozilla firefox', 'firefox'],
      publishers: ['mozilla'],
      executables: ['firefox.exe'],
      description: 'Hardware acceleration, telemetry, secure DNS and targeted Firefox profile cache cleanup.',
      policies: [
        policy('browser.hardwareAcceleration', 'HKCU:\\Software\\Policies\\Mozilla\\Firefox', 'HardwareAcceleration', 'dword', 1, { requiresRestart: true }),
        policy('browser.telemetry', 'HKCU:\\Software\\Policies\\Mozilla\\Firefox', 'DisableTelemetry', 'dword', 1, { requiresRestart: true }),
        policy('browser.doh', 'HKCU:\\Software\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS', 'Enabled', 'dword', 1, { requiresRestart: true }),
        policy('browser.dohFallback', 'HKCU:\\Software\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS', 'Fallback', 'dword', 1, { requiresRestart: true })
      ],
      cacheGroups: [{
        kind: 'childProfiles',
        root: path.join(local, 'Mozilla', 'Firefox', 'Profiles'),
        relativeDirs: ['cache2', 'startupCache']
      }],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'brave',
      names: ['brave'],
      publishers: ['brave'],
      executables: ['brave.exe'],
      description: 'Brave policies for graphics, background mode, balanced memory saver and secure DNS plus targeted cache cleanup.',
      policies: [
        policy('browser.hardwareAcceleration', 'HKCU:\\Software\\Policies\\BraveSoftware\\Brave', 'HardwareAccelerationModeEnabled', 'dword', 1, { requiresRestart: true }),
        policy('browser.backgroundMode', 'HKCU:\\Software\\Policies\\BraveSoftware\\Brave', 'BackgroundModeEnabled', 'dword', 0),
        policy('browser.memorySaver', 'HKCU:\\Software\\Policies\\BraveSoftware\\Brave', 'HighEfficiencyModeEnabled', 'dword', 1),
        policy('browser.memorySaverLevel', 'HKCU:\\Software\\Policies\\BraveSoftware\\Brave', 'MemorySaverModeSavings', 'dword', 1),
        policy('browser.doh', 'HKCU:\\Software\\Policies\\BraveSoftware\\Brave', 'DnsOverHttpsMode', 'string', 'automatic')
      ],
      cacheGroups: [chromiumCache(path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'))],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'opera',
      names: ['opera browser', 'opera stable', 'opera'],
      publishers: ['opera'],
      executables: ['opera.exe', 'launcher.exe'],
      description: 'Explicitly scoped Opera browser cache cleanup.',
      cacheGroups: [chromiumCache(path.join(roaming, 'Opera Software', 'Opera Stable'))],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'vivaldi',
      names: ['vivaldi'],
      publishers: ['vivaldi'],
      executables: ['vivaldi.exe'],
      description: 'Explicitly scoped Vivaldi browser cache cleanup.',
      cacheGroups: [chromiumCache(path.join(local, 'Vivaldi', 'User Data'))],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'arc',
      names: ['arc', 'arc browser'],
      publishers: ['the browser company'],
      executables: ['arc.exe'],
      packageFamilies: ['thebrowsercompany.arc'],
      description: 'Targeted cleanup of the Windows-managed Arc package cache.',
      cacheGroups: [{
        kind: 'packagePrefix',
        root: path.join(local, 'Packages'),
        prefix: 'TheBrowserCompany.Arc',
        relativeDirs: ['LocalCache', 'TempState']
      }],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'discord',
      names: ['discord', 'discord canary', 'discord ptb'],
      publishers: ['discord'],
      executables: ['discord.exe'],
      description: 'Discord graphics and background behavior plus targeted Electron cache cleanup. Accounts, sessions and personal data stay untouched.',
      settings: [
        jsonSetting(
          'discord.hardwareAcceleration',
          [
            { names: ['discord canary'], path: path.join(roaming, 'discordcanary', 'settings.json') },
            { names: ['discord ptb'], path: path.join(roaming, 'discordptb', 'settings.json') },
            { names: ['discord'], path: path.join(roaming, 'discord', 'settings.json') }
          ],
          'enableHardwareAcceleration',
          false,
          {
            recommended: false,
            requiresClose: true,
            requiresRestart: true,
            description: 'Reduces Discord GPU contention while gaming. This can increase CPU use and is best for systems that show frame drops with Discord open.'
          }
        ),
        jsonSetting(
          'discord.minimizeToTray',
          [
            { names: ['discord canary'], path: path.join(roaming, 'discordcanary', 'settings.json') },
            { names: ['discord ptb'], path: path.join(roaming, 'discordptb', 'settings.json') },
            { names: ['discord'], path: path.join(roaming, 'discord', 'settings.json') }
          ],
          'MINIMIZE_TO_TRAY',
          false,
          {
            recommended: false,
            requiresClose: true,
            description: 'Makes closing the Discord window stop its visible background session instead of leaving it in the notification area.'
          }
        )
      ],
      cacheGroups: [
        simpleCache(path.join(roaming, 'discord'), ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Crashpad\\reports']),
        simpleCache(path.join(roaming, 'discordcanary'), ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Crashpad\\reports']),
        simpleCache(path.join(roaming, 'discordptb'), ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Crashpad\\reports'])
      ],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'steam',
      names: ['steam'],
      publishers: ['valve'],
      executables: ['steam.exe'],
      requireNameMatch: true,
      description: 'Steam web-cache cleanup; game files, shader data and download configuration stay untouched.',
      cacheGroups: [simpleCache(path.join(local, 'Steam'), ['htmlcache'])],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'spotify',
      names: ['spotify'],
      publishers: ['spotify'],
      executables: ['spotify.exe'],
      packageFamilies: ['spotifyab.spotify'],
      description: 'Spotify UI-cache cleanup while protecting offline music and account data.',
      cacheGroups: [simpleCache(path.join(local, 'Spotify'), ['Browser\\Cache', 'Code Cache', 'GPUCache'])],
      startup: { id: 'startup.disable', recommended: true }
    }),
    profile({
      id: 'adobe-creative-cloud',
      names: ['adobe creative cloud', 'creative cloud'],
      publishers: ['adobe'],
      executables: ['creative cloud.exe', 'creative cloud helper.exe'],
      description: 'Creative Cloud process and startup status. Startup changes remain optional to protect sync and fonts.',
      startup: { id: 'startup.disable', recommended: false }
    }),
    profile({
      id: 'onedrive',
      names: ['microsoft onedrive', 'onedrive'],
      publishers: ['microsoft'],
      executables: ['onedrive.exe'],
      description: 'Reliable OneDrive runtime and sync-client status without interrupting synchronization.',
      statusOnly: true
    }),
    profile({
      id: 'obs-studio',
      names: ['obs studio', 'obs'],
      publishers: ['obs project'],
      executables: ['obs64.exe', 'obs32.exe'],
      description: 'OBS Studio installation and runtime status. Encoder and recording settings remain under OBS control.',
      statusOnly: true
    }),
    profile({
      id: 'nvidia-app',
      names: ['nvidia app', 'nvidia geforce experience', 'geforce experience'],
      excludeNames: ['driver settings', 'frameview', 'physx'],
      publishers: ['nvidia'],
      executables: ['nvidia app.exe', 'nvidia share.exe'],
      description: 'NVIDIA companion-app runtime status without undocumented overlay or telemetry changes.',
      statusOnly: true
    }),
    profile({
      id: 'logitech-ghub',
      names: ['logitech g hub', 'logitech ghub'],
      publishers: ['logitech'],
      executables: ['lghub.exe'],
      description: 'G Hub process and startup status. Startup control is optional to protect device profiles and macros.',
      startup: { id: 'startup.disable', recommended: false }
    }),
    profile({
      id: 'razer-synapse',
      names: ['razer synapse'],
      publishers: ['razer'],
      executables: ['razer synapse 3.exe', 'razersynapse.exe'],
      description: 'Razer process and startup status. Startup control is optional to protect device profiles and macros.',
      startup: { id: 'startup.disable', recommended: false }
    }),
    profile({
      id: 'steelseries-gg',
      names: ['steelseries gg'],
      publishers: ['steelseries'],
      executables: ['steelseriesgg.exe'],
      description: 'SteelSeries GG process and startup status. Startup control is optional to protect device profiles.',
      startup: { id: 'startup.disable', recommended: false }
    })
  ];
}

function includesIdentity(haystack, needle) {
  if (!haystack || !needle) {
    return false;
  }
  return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
}

function matchesProfile(app, candidate) {
  const name = normalizeIdentity(app?.name);
  const publisher = normalizeIdentity(app?.publisher);
  const executable = executableName(app?.executablePath || app?.iconPath);
  const packageFamily = normalizeIdentity(app?.packageFamilyName || app?.packageFullName || app?.id);
  if ((candidate.excludeNames || []).some((entry) => name.includes(normalizeIdentity(entry)))) {
    return false;
  }

  const nameMatch = candidate.names.some((entry) => includesIdentity(name, normalizeIdentity(entry)));
  const executableMatch = candidate.executables.some((entry) => executable === String(entry).toLowerCase());
  const packageMatch = (candidate.packageFamilies || []).some((entry) => packageFamily.includes(normalizeIdentity(entry)));
  if (candidate.requireNameMatch && !nameMatch) {
    return false;
  }
  if (!nameMatch && !executableMatch && !packageMatch) {
    return false;
  }

  if (!candidate.publishers.length || executableMatch || packageMatch) {
    return true;
  }
  return candidate.publishers.some((entry) => publisher.includes(normalizeIdentity(entry)));
}

function findOptimizationProfile(app, env = process.env) {
  return buildProfiles(env).find((candidate) => matchesProfile(app, candidate)) || null;
}

function toProfileSummary(profileDefinition) {
  if (!profileDefinition) {
    return {
      supported: false,
      analyzed: false,
      profileId: '',
      status: 'unsupported',
      description: 'No stable optimization profile is available.',
      availableCount: 0,
      recommendedCount: 0,
      managedSettings: false,
      actions: []
    };
  }

  const actions = [
    ...profileDefinition.policies.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      recommended: Boolean(entry.recommended),
      supported: true,
      reversible: true,
      requiresClose: false,
      requiresRestart: Boolean(entry.requiresRestart),
      needsChange: null
    })),
    ...profileDefinition.settings.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      recommended: Boolean(entry.recommended),
      supported: true,
      reversible: true,
      requiresClose: Boolean(entry.requiresClose),
      requiresRestart: Boolean(entry.requiresRestart),
      needsChange: null
    })),
    ...(profileDefinition.cacheGroups.length ? [{
      id: 'cache.cleanup',
      kind: 'cache',
      recommended: true,
      supported: true,
      reversible: false,
      requiresClose: true,
      requiresRestart: false,
      needsChange: null
    }] : []),
    ...(profileDefinition.startup ? [{
      id: profileDefinition.startup.id,
      kind: 'startup',
      recommended: Boolean(profileDefinition.startup.recommended),
      supported: true,
      reversible: true,
      requiresClose: false,
      requiresRestart: false,
      needsChange: null
    }] : [])
  ];

  return {
    supported: actions.length > 0,
    analyzed: false,
    profileId: profileDefinition.id,
    status: profileDefinition.statusOnly ? 'status-only' : 'available',
    description: profileDefinition.description,
    availableCount: actions.length,
    recommendedCount: actions.filter((entry) => entry.recommended).length,
    managedSettings: profileDefinition.policies.length > 0,
    actions
  };
}

module.exports = {
  CHROMIUM_CACHE_DIRS,
  buildProfiles,
  findOptimizationProfile,
  matchesProfile,
  normalizeIdentity,
  toProfileSummary
};
