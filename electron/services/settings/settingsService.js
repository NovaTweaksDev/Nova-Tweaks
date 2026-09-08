const fs = require('fs');
const path = require('path');

const SETTINGS_SCHEMA = 'nova-tweaks-settings';
const SETTINGS_SCHEMA_VERSION = 1;
const SUPPORTED_LANGUAGES = new Set(['en', 'de', 'fr']);
const SUPPORTED_THEMES = new Set(['light', 'dark', 'system']);
const SUPPORTED_ACCENTS = new Set(['#EC4899', '#3B82F6', '#6366F1', '#FFB24B', '#F43F5E']);
const LEGACY_ACCENT_ALIASES = Object.freeze({
  '#008CFF': '#3B82F6',
  '#7C5CFF': '#6366F1',
  '#FF738B': '#F43F5E'
});

class SettingsServiceError extends Error {
  constructor(message, code = 'SETTINGS_SERVICE_ERROR', details = {}) {
    super(message);
    this.name = 'SettingsServiceError';
    this.code = code;
    this.details = details;
  }
}

function getDefaultSettings(defaultBackupLocation = '') {
  return {
    preferences: {
      language: 'en',
      theme: 'dark',
      accentColor: '#3B82F6',
      compactMode: false,
      reducedMotion: false,
      mascotAnimationEnabled: false
    },
    startupWindow: {
      startWithWindows: false,
      startMinimized: false,
      minimizeToTray: false,
      closeToTray: false,
      rememberLastTab: false,
      lastTab: 'dashboard'
    },
    safety: {
      confirmCriticalTweaks: true,
      warnBeforeRestartRequiredTweaks: true,
      showRiskLabels: true,
      showCompatibilityWarnings: true
    },
    monitoring: {
      advancedSensorsEnabled: false
    },
    backupData: {
      backupBeforeApplyingTweaks: false,
      backupLocation: defaultBackupLocation
    },
    automation: {
      processDetection: {
        enabled: false,
        cpuEnabled: true,
        cpuThresholdPercent: 35,
        cpuDurationSeconds: 20,
        memoryEnabled: true,
        memoryThresholdMB: 0,
        memoryDurationSeconds: 30,
        diskEnabled: true,
        diskThresholdMBs: 75,
        diskDurationSeconds: 20,
        notRespondingEnabled: true,
        notRespondingDurationSeconds: 15,
        cooldownMinutes: 15,
        excludedExecutables: []
      },
      rules: []
    },
    userProfile: {
      displayName: '',
      avatarDataUrl: ''
    }
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function normalizeStringArray(value, maximumEntries = 100) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((entry) => normalizeString(entry).toLowerCase())
    .filter(Boolean)))
    .slice(0, maximumEntries);
}

function normalizeAutomationRules(value) {
  const conditionTypes = new Set(['processRunning', 'processStarted', 'processStopped', 'processCpu', 'processMemory', 'processDisk', 'processNotResponding', 'systemCpu', 'systemGpu', 'systemMemory', 'cpuTemperature', 'gpuTemperature', 'networkLatency', 'packetLoss', 'gameRunning', 'gameStarted', 'gameStopped']);
  const operators = new Set(['gt', 'gte', 'lt', 'lte', 'contains', 'equals', 'is']);
  const actions = new Set(['notify', 'askClose', 'runTweak', 'runOptimization']);
  const optimizations = new Set(['cpu', 'storage', 'network', 'cleanup']);
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((rule, index) => {
    if (!isPlainObject(rule)) return null;
    const conditions = (Array.isArray(rule.conditions) ? rule.conditions : []).slice(0, 8).map((condition, conditionIndex) => {
      if (!isPlainObject(condition)) return null;
      const type = conditionTypes.has(condition.type) ? condition.type : 'systemCpu';
      return {
        id: normalizeString(condition.id).slice(0, 80) || `condition-${conditionIndex + 1}`,
        type,
        operator: operators.has(condition.operator) ? condition.operator : type.endsWith('Running') || type.endsWith('Started') || type.endsWith('Stopped') || type === 'processNotResponding' ? 'is' : 'gte',
        value: normalizeBoundedNumber(condition.value, 0, 0, type === 'processMemory' ? 32768 : type === 'processDisk' ? 1000 : 1000),
        text: normalizeString(condition.text).slice(0, 160)
      };
    }).filter(Boolean);
    const action = isPlainObject(rule.action) ? rule.action : {};
    const actionType = actions.has(action.type) ? action.type : 'notify';
    return {
      id: normalizeString(rule.id).slice(0, 80) || `rule-${index + 1}`,
      name: normalizeString(rule.name).slice(0, 80) || `Rule ${index + 1}`,
      enabled: normalizeBoolean(rule.enabled, true),
      matchMode: rule.matchMode === 'any' ? 'any' : 'all',
      conditions: conditions.length ? conditions : [{ id: 'condition-1', type: 'systemCpu', operator: 'gte', value: 80, text: '' }],
      holdSeconds: normalizeBoundedNumber(rule.holdSeconds, 10, 0, 300),
      cooldownMinutes: normalizeBoundedNumber(rule.cooldownMinutes, 15, 1, 1440),
      action: {
        type: actionType,
        message: normalizeString(action.message).slice(0, 240),
        tweakId: normalizeString(action.tweakId).slice(0, 120),
        tweakTargetValue: normalizeString(action.tweakTargetValue).slice(0, 160),
        bypassConfirmation: actionType === 'runTweak'
          ? normalizeBoolean(action.bypassConfirmation, false)
          : false,
        optimizationId: optimizations.has(action.optimizationId) ? action.optimizationId : 'cpu'
      },
      createdAt: normalizeBoundedNumber(rule.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      updatedAt: normalizeBoundedNumber(rule.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
    };
  }).filter(Boolean);
}

function normalizeLanguage(value, fallback) {
  const normalized = normalizeString(value).toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : fallback;
}

function normalizeTheme(value, fallback) {
  const normalized = normalizeString(value).toLowerCase();
  return SUPPORTED_THEMES.has(normalized) ? normalized : fallback;
}

function normalizeAccentColor(value, fallback) {
  const normalized = normalizeString(value).toUpperCase();
  const migrated = LEGACY_ACCENT_ALIASES[normalized] || normalized;
  if (/^#[0-9A-F]{6}$/.test(migrated) && SUPPORTED_ACCENTS.has(migrated)) {
    return migrated;
  }
  return fallback;
}

function normalizeDisplayName(value) {
  const normalized = normalizeString(value).replace(/\s+/g, ' ');
  return normalized.length > 32 ? normalized.slice(0, 32).trim() : normalized;
}

function normalizeAvatarDataUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(normalized) && normalized.length <= 1_500_000) {
    return normalized;
  }
  return '';
}

function normalizeLastTab(value, fallback) {
  const normalized = normalizeString(value).toLowerCase();
  const allowed = new Set(['game-mode', 'ai', 'dashboard', 'overview', 'automation', 'tweaks', 'apps', 'backup', 'settings']);
  return allowed.has(normalized) ? normalized : fallback;
}

function validateBackupLocation(value, fallback) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }

  const resolved = path.resolve(normalized);
  if (!path.isAbsolute(resolved)) {
    throw new SettingsServiceError('Backup location must be an absolute path.', 'INVALID_BACKUP_LOCATION', {
      backupLocation: normalized
    });
  }

  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new SettingsServiceError('Backup location cannot be a drive root.', 'INVALID_BACKUP_LOCATION', {
      backupLocation: resolved
    });
  }

  return resolved;
}

function sanitizeSettings(input, defaults, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const strict = Boolean(options.strict);
  const preferences = isPlainObject(source.preferences) ? source.preferences : {};
  const startupWindow = isPlainObject(source.startupWindow) ? source.startupWindow : {};
  const safety = isPlainObject(source.safety) ? source.safety : {};
  const monitoring = isPlainObject(source.monitoring) ? source.monitoring : {};
  const backupData = isPlainObject(source.backupData) ? source.backupData : {};
  const automation = isPlainObject(source.automation) ? source.automation : {};
  const processDetection = isPlainObject(automation.processDetection) ? automation.processDetection : {};
  const userProfile = isPlainObject(source.userProfile) ? source.userProfile : {};

  return {
    preferences: {
      language: normalizeLanguage(preferences.language, defaults.preferences.language),
      theme: normalizeTheme(preferences.theme, defaults.preferences.theme),
      accentColor: normalizeAccentColor(preferences.accentColor, defaults.preferences.accentColor),
      compactMode: normalizeBoolean(preferences.compactMode, defaults.preferences.compactMode),
      reducedMotion: normalizeBoolean(preferences.reducedMotion, defaults.preferences.reducedMotion),
      mascotAnimationEnabled: normalizeBoolean(
        preferences.mascotAnimationEnabled,
        normalizeBoolean(
          preferences.mascotAnimationTestMode,
          defaults.preferences.mascotAnimationEnabled
        )
      )
    },
    startupWindow: {
      startWithWindows: normalizeBoolean(startupWindow.startWithWindows, defaults.startupWindow.startWithWindows),
      startMinimized: normalizeBoolean(startupWindow.startMinimized, defaults.startupWindow.startMinimized),
      minimizeToTray: normalizeBoolean(startupWindow.minimizeToTray, defaults.startupWindow.minimizeToTray),
      closeToTray: normalizeBoolean(startupWindow.closeToTray, defaults.startupWindow.closeToTray),
      rememberLastTab: normalizeBoolean(startupWindow.rememberLastTab, defaults.startupWindow.rememberLastTab),
      lastTab: normalizeLastTab(startupWindow.lastTab, defaults.startupWindow.lastTab)
    },
    safety: {
      confirmCriticalTweaks: normalizeBoolean(safety.confirmCriticalTweaks, defaults.safety.confirmCriticalTweaks),
      warnBeforeRestartRequiredTweaks: normalizeBoolean(
        safety.warnBeforeRestartRequiredTweaks,
        defaults.safety.warnBeforeRestartRequiredTweaks
      ),
      showRiskLabels: normalizeBoolean(safety.showRiskLabels, defaults.safety.showRiskLabels),
      showCompatibilityWarnings: normalizeBoolean(
        safety.showCompatibilityWarnings,
        defaults.safety.showCompatibilityWarnings
      )
    },
    monitoring: {
      advancedSensorsEnabled: normalizeBoolean(
        monitoring.advancedSensorsEnabled,
        defaults.monitoring.advancedSensorsEnabled
      )
    },
    backupData: {
      backupBeforeApplyingTweaks: normalizeBoolean(
        backupData.backupBeforeApplyingTweaks,
        defaults.backupData.backupBeforeApplyingTweaks
      ),
      backupLocation: strict
        ? validateBackupLocation(backupData.backupLocation, defaults.backupData.backupLocation)
        : (() => {
            try {
              return validateBackupLocation(backupData.backupLocation, defaults.backupData.backupLocation);
            } catch (_error) {
              return defaults.backupData.backupLocation;
            }
          })()
    },
    automation: {
      processDetection: {
        enabled: normalizeBoolean(processDetection.enabled, defaults.automation.processDetection.enabled),
        cpuEnabled: normalizeBoolean(processDetection.cpuEnabled, defaults.automation.processDetection.cpuEnabled),
        cpuThresholdPercent: normalizeBoundedNumber(processDetection.cpuThresholdPercent, defaults.automation.processDetection.cpuThresholdPercent, 10, 90),
        cpuDurationSeconds: normalizeBoundedNumber(processDetection.cpuDurationSeconds, defaults.automation.processDetection.cpuDurationSeconds, 10, 120),
        memoryEnabled: normalizeBoolean(processDetection.memoryEnabled, defaults.automation.processDetection.memoryEnabled),
        memoryThresholdMB: normalizeBoundedNumber(processDetection.memoryThresholdMB, defaults.automation.processDetection.memoryThresholdMB, 0, 32768),
        memoryDurationSeconds: normalizeBoundedNumber(processDetection.memoryDurationSeconds, defaults.automation.processDetection.memoryDurationSeconds, 10, 120),
        diskEnabled: normalizeBoolean(processDetection.diskEnabled, defaults.automation.processDetection.diskEnabled),
        diskThresholdMBs: normalizeBoundedNumber(processDetection.diskThresholdMBs, defaults.automation.processDetection.diskThresholdMBs, 10, 1000),
        diskDurationSeconds: normalizeBoundedNumber(processDetection.diskDurationSeconds, defaults.automation.processDetection.diskDurationSeconds, 10, 120),
        notRespondingEnabled: normalizeBoolean(processDetection.notRespondingEnabled, defaults.automation.processDetection.notRespondingEnabled),
        notRespondingDurationSeconds: normalizeBoundedNumber(processDetection.notRespondingDurationSeconds, defaults.automation.processDetection.notRespondingDurationSeconds, 5, 120),
        cooldownMinutes: normalizeBoundedNumber(processDetection.cooldownMinutes, defaults.automation.processDetection.cooldownMinutes, 1, 1440),
        excludedExecutables: normalizeStringArray(processDetection.excludedExecutables)
      },
      rules: normalizeAutomationRules(automation.rules)
    },
    userProfile: {
      displayName: normalizeDisplayName(userProfile.displayName),
      avatarDataUrl: normalizeAvatarDataUrl(userProfile.avatarDataUrl)
    }
  };
}

function createDocument(settings) {
  return {
    schema: SETTINGS_SCHEMA,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings
  };
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (_rmError) {
      // Ignore missing target.
    }
    fs.renameSync(tempPath, filePath);
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(directory, 0o700);
    fs.chmodSync(filePath, 0o600);
  }
}

function createSettingsService({ app, logger } = {}) {
  if (!app?.getPath) {
    throw new Error('createSettingsService requires an Electron app instance.');
  }

  const settingsRoot = path.join(app.getPath('userData'), 'settings');
  const settingsPath = path.join(settingsRoot, 'settings.json');
  const appDataDirectoryName = typeof app.getName === 'function' && app.getName()
    ? app.getName()
    : 'Nova Tweaks';
  const defaultBackupLocation = path.join(app.getPath('appData'), appDataDirectoryName, 'backups');
  const legacyDefaultBackupLocation = path.join(app.getPath('appData'), 'Nova Tweaks Local', 'backups');
  const defaults = getDefaultSettings(defaultBackupLocation);
  let currentSettings = defaults;
  let lastLoadWarning = null;

  function readSettings() {
    lastLoadWarning = null;
    try {
      if (!fs.existsSync(settingsPath)) {
        currentSettings = defaults;
        writeJsonAtomic(settingsPath, createDocument(currentSettings));
        return currentSettings;
      }

      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const source = parsed?.schema === SETTINGS_SCHEMA ? parsed.settings : parsed;
      currentSettings = sanitizeSettings(source, defaults, { strict: false });
      if (
        appDataDirectoryName === 'Nova Tweaks'
        && path.resolve(currentSettings.backupData.backupLocation) === path.resolve(legacyDefaultBackupLocation)
      ) {
        currentSettings = {
          ...currentSettings,
          backupData: {
            ...currentSettings.backupData,
            backupLocation: defaultBackupLocation
          }
        };
        writeJsonAtomic(settingsPath, createDocument(currentSettings));
      }
      return currentSettings;
    } catch (error) {
      lastLoadWarning = {
        code: 'SETTINGS_LOAD_FALLBACK',
        message: 'Settings could not be read and defaults were loaded.',
        details: { message: error?.message || '' }
      };
      logger?.warn?.('Settings could not be read. Falling back to defaults.', lastLoadWarning);
      currentSettings = defaults;
      return currentSettings;
    }
  }

  function saveSettings(nextSettings) {
    currentSettings = sanitizeSettings(nextSettings, defaults, { strict: true });
    writeJsonAtomic(settingsPath, createDocument(currentSettings));
    return currentSettings;
  }

  function updateSettings(patch = {}) {
    const source = isPlainObject(patch) ? patch : {};
    return saveSettings({
      preferences: {
        ...currentSettings.preferences,
        ...(isPlainObject(source.preferences) ? source.preferences : {})
      },
      startupWindow: {
        ...currentSettings.startupWindow,
        ...(isPlainObject(source.startupWindow) ? source.startupWindow : {})
      },
      safety: {
        ...currentSettings.safety,
        ...(isPlainObject(source.safety) ? source.safety : {})
      },
      monitoring: {
        ...currentSettings.monitoring,
        ...(isPlainObject(source.monitoring) ? source.monitoring : {})
      },
      backupData: {
        ...currentSettings.backupData,
        ...(isPlainObject(source.backupData) ? source.backupData : {})
      },
      automation: {
        ...currentSettings.automation,
        ...(isPlainObject(source.automation) ? source.automation : {}),
        processDetection: {
          ...currentSettings.automation.processDetection,
          ...(isPlainObject(source.automation?.processDetection) ? source.automation.processDetection : {})
        }
      },
      userProfile: {
        ...currentSettings.userProfile,
        ...(isPlainObject(source.userProfile) ? source.userProfile : {})
      }
    });
  }

  function resetSettings() {
    return saveSettings(defaults);
  }

  function validateImportDocument(input) {
    const document = isPlainObject(input) ? input : null;
    if (!document) {
      throw new SettingsServiceError('Settings import must be a JSON object.', 'INVALID_SETTINGS_FILE');
    }
    if (document.schema !== SETTINGS_SCHEMA || Number(document.schemaVersion) !== SETTINGS_SCHEMA_VERSION) {
      throw new SettingsServiceError('Settings file schema is not supported.', 'INVALID_SETTINGS_FILE', {
        schema: document.schema,
        schemaVersion: document.schemaVersion
      });
    }
    return sanitizeSettings(document.settings, defaults, { strict: true });
  }

  readSettings();

  return {
    getDefaults: () => defaults,
    getSettingsPath: () => settingsPath,
    getSettingsRoot: () => settingsRoot,
    getLastLoadWarning: () => lastLoadWarning,
    getSettings: () => currentSettings,
    loadSettings: readSettings,
    saveSettings,
    updateSettings,
    resetSettings,
    createExportDocument: () => createDocument(currentSettings),
    validateImportDocument
  };
}

module.exports = {
  SETTINGS_SCHEMA,
  SETTINGS_SCHEMA_VERSION,
  SettingsServiceError,
  createSettingsService,
  getDefaultSettings,
  sanitizeSettings
};
