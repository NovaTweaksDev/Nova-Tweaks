const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, shell, webContents, nativeImage, screen, protocol, net } = require('electron');
const { createLogger } = require('./logger');
const { createScriptRunner, ScriptRunnerError } = require('./services/script-runner');
const { createMonitoringManager } = require('./services/monitoring/monitoringManager');
const { createExtendedNetworkTestService } = require('./services/monitoring/extendedNetworkTestService');
const { createProcessWatcherService } = require('./services/automation/processWatcherService');
const { createRuleAutomationService } = require('./services/automation/ruleAutomationService');
const { createScheduledMaintenanceService } = require('./services/automation/scheduledMaintenanceService');
const { executeAutomaticTweakRuleAction } = require('./services/automation/automaticTweakRuleAction');
const { createGameSessionManager } = require('./services/gamemode/gameSessionManager');
const { createAppsManager, AppsManagerError } = require('./services/apps/appsManager');
const { createBackupManager, BackupManagerError } = require('./services/backups/backupManager');
const { captureAutomaticTweakSnapshot } = require('./services/backups/automaticBackupSnapshot');
const { createSystemDetectionService } = require('./services/systemDetection/systemDetectionService');
const { createSettingsService, SettingsServiceError } = require('./services/settings/settingsService');
const { migrateLegacyUserData } = require('./services/settings/userDataMigration');
const { TweakEngineError } = require('./services/tweaks/errors');
const { createTweakRunner, TweakRunnerError } = require('./services/tweaks/tweakRunner');
const { createBackendTweakCatalog } = require('./services/tweaks/backendTweakCatalog');
const { requiresTweakStateCheck } = require('./services/tweaks/tweakStatePolicy');
const {
  isBlockedSecurityTweakId,
  isBlockedSecurityTweakScriptName
} = require('./services/tweaks/blockedSecurityTweaks');
const { registerTweakExecutionIpcHandlers } = require('./ipcHandlers');
const { createAdminBrokerManager } = require('./services/admin/adminBrokerManager');
const { runAdminBrokerWorker } = require('./services/admin/adminBrokerWorker');
const {
  hardenWindowsChildProcessEnvironment,
  resolveWindowsSystemExecutable
} = require('./services/security/systemExecutables');
const { resolveThirdPartyNoticesPath } = require('./services/legal/thirdPartyLegal');
const {
  LOCAL_RENDERER_URL,
  registerLocalRendererProtocol,
  registerLocalRendererScheme
} = require('./services/security/localRendererProtocol');

hardenWindowsChildProcessEnvironment();
registerLocalRendererScheme(protocol);
const TRUSTED_POWERSHELL = resolveWindowsSystemExecutable('powershell');
const WINDOWS_SHUTDOWN_EVENT_QUERY_TIMEOUT_MS = 5000;
let cachedWindowsShutdownEventAt = null;
const PRODUCT_NAME = 'Nova Tweaks';
const LEGACY_PRODUCT_NAME = 'Nova Tweaks Local';
app.setName(PRODUCT_NAME);
try {
  migrateLegacyUserData({
    appDataPath: app.getPath('appData'),
    currentUserDataPath: app.getPath('userData'),
    legacyDirectoryName: LEGACY_PRODUCT_NAME
  });
} catch (error) {
  console.warn(`Legacy user-data migration failed: ${error?.message || error}`);
}
app.setAppLogsPath();
const WINDOWS_APP_USER_MODEL_ID = 'de.novatweaks';
const RELEASES_URL = 'https://github.com/NovaTweaksDev/Nova-Tweaks/releases';
const PROFILE_IMAGE_SOURCE_MAX_BYTES = 6_000_000;
const PROFILE_IMAGE_UPLOAD_MAX_BYTES = 650_000;
const PROFILE_IMAGE_MAX_DIMENSION = 512;
const PROFILE_IMAGE_JPEG_QUALITY = 82;
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toReportNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatReportNumber(value, digits = 0) {
  const numeric = toReportNumber(value);
  if (numeric === null) return 'Unavailable';
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatReportMetric(value, unit, digits = 0) {
  const numeric = toReportNumber(value);
  if (numeric === null) return 'Unavailable';
  return `${formatReportNumber(numeric, digits)} ${unit}`;
}

function formatReportMemory(value) {
  const numeric = toReportNumber(value);
  if (numeric === null) return 'Unavailable';
  return numeric >= 1024
    ? `${formatReportNumber(numeric / 1024, 1)} GB`
    : `${formatReportNumber(numeric, 0)} MB`;
}

function formatReportDuration(seconds) {
  const numeric = toReportNumber(seconds);
  if (numeric === null || numeric <= 0) return '0:00';
  const totalSeconds = Math.max(0, Math.round(numeric));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatReportDateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Unavailable';
}

function formatReportStopReason(value) {
  const reason = String(value || '').trim();
  if (!reason) return 'Stopped';
  if (reason === 'manual') return 'Stopped manually';
  if (reason === 'game-exited') return 'Game exited';
  return reason
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function findBundledPublicAsset(...segments) {
  const relativePath = path.join(...segments);
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, 'dist', relativePath),
    path.join(appPath, 'public', relativePath),
    path.join(__dirname, '..', 'dist', relativePath),
    path.join(__dirname, '..', 'public', relativePath)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildReportFontFaceCss() {
  const sansPath = findBundledPublicAsset('fonts', 'geist', 'Geist-Variable.woff2');
  const monoPath = findBundledPublicAsset('fonts', 'geist', 'GeistMono-Variable.woff2');
  const faces = [];

  if (sansPath) {
    faces.push(`@font-face { font-family: "Geist"; src: url("${pathToFileURL(sansPath).href}") format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }`);
  }

  if (monoPath) {
    faces.push(`@font-face { font-family: "Geist Mono"; src: url("${pathToFileURL(monoPath).href}") format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }`);
  }

  return faces.join('\n    ');
}

function getReportHealth(report) {
  const metrics = report?.metrics || {};
  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
  const gpuMaxTempC = toReportNumber(metrics.gpuMaxTempC);
  const avgLatencyMs = toReportNumber(metrics.avgLatencyMs);
  const packetLossPercent = toReportNumber(metrics.packetLossPercent);
  const avgFps = toReportNumber(metrics.avgFps);
  const onePercentLow = toReportNumber(metrics.onePercentLow);
  const lowRatio = avgFps && onePercentLow !== null ? onePercentLow / avgFps : null;

  if ((gpuMaxTempC !== null && gpuMaxTempC >= 88) || (packetLossPercent !== null && packetLossPercent > 0) || warnings.length >= 3) {
    return {
      tone: 'critical',
      label: 'Critical',
      title: 'Critical signals detected',
      description: 'Review the highlighted metrics before relying on this setup for longer sessions.'
    };
  }

  if ((gpuMaxTempC !== null && gpuMaxTempC >= 80) || (avgLatencyMs !== null && avgLatencyMs >= 100) || (lowRatio !== null && lowRatio < 0.55) || warnings.length > 0) {
    return {
      tone: 'warning',
      label: 'Attention',
      title: 'A few signals need attention',
      description: 'The report found possible causes for heat, stutter, missing data, or network issues.'
    };
  }

  return {
    tone: 'good',
    label: 'Good',
    title: 'Session looked stable',
    description: 'Captured metrics stayed in a healthy range for this run.'
  };
}

function buildGameSessionReportHtml(report) {
  const metrics = report?.metrics || {};
  const health = getReportHealth(report);
  const warnings = Array.isArray(report?.warnings) ? report.warnings.filter(Boolean) : [];
  const insights = Array.isArray(report?.insights)
    ? report.insights.filter((entry) => String(entry || '').trim().toLowerCase() !== 'collecting live session data.')
    : [];
  const rows = [
    ['Duration', formatReportDuration(report?.durationSeconds), formatReportStopReason(report?.stopReason)],
    ['Average FPS', formatReportMetric(metrics.avgFps, 'FPS', 1), 'Overall frame rate'],
    ['1% Low', formatReportMetric(metrics.onePercentLow, 'FPS', 1), 'Stutter indicator'],
    ['0.1% Low', formatReportMetric(metrics.pointOnePercentLow, 'FPS', 1), 'Worst frame pacing'],
    ['P95 Frametime', formatReportMetric(metrics.p95FrametimeMs, 'ms', 2), '95% of frames below this'],
    ['Worst Frametime', formatReportMetric(metrics.worstFrametimeMs, 'ms', 2), 'Highest captured frame time'],
    ['CPU / GPU Avg', `${formatReportMetric(metrics.cpuAvgPercent, '%', 0)} / ${formatReportMetric(metrics.gpuAvgPercent, '%', 0)}`, 'Average load'],
    ['Max GPU Temp', formatReportMetric(metrics.gpuMaxTempC, 'C', 0), 'Thermal peak'],
    ['RAM Peak', formatReportMemory(metrics.ramPeakMB), 'Highest system memory use'],
    ['VRAM Peak', formatReportMemory(metrics.vramPeakMB), 'Highest graphics memory use'],
    ['Network Latency', formatReportMetric(metrics.avgLatencyMs, 'ms', 1), 'Average ping'],
    ['Packet Loss', formatReportMetric(metrics.packetLossPercent, '%', 2), 'Average loss']
  ];
  const facts = [
    ['Game', report?.gameName || report?.processName || 'Game session'],
    ['Started', formatReportDateTime(report?.startedAt)],
    ['Ended', formatReportDateTime(report?.endedAt)],
    ['Profile', report?.profileId || 'No active profile'],
    ['Capture Status', report?.captureStatus || 'Unavailable'],
    ['Session ID', report?.sessionId || 'Unavailable']
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report?.gameName || 'Game Session')} - Nova Tweaks Report</title>
  <style>
    ${buildReportFontFaceCss()}
    :root { color-scheme: dark; font-family: Geist, Segoe UI, Arial, sans-serif; background: #0f172a; color: #e5e7eb; }
    body { margin: 0; padding: 32px; background: #0f172a; }
    main { max-width: 1080px; margin: 0 auto; }
    header, section { border: 1px solid #273449; border-radius: 14px; background: #121c2f; padding: 20px; }
    header { display: grid; gap: 12px; margin-bottom: 18px; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 28px; line-height: 1.15; }
    h2 { margin-bottom: 12px; font-size: 16px; }
    .muted { color: #94a3b8; }
    .health { display: inline-flex; width: fit-content; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .health.good { background: #064e3b; color: #a7f3d0; }
    .health.warning { background: #713f12; color: #fde68a; }
    .health.critical { background: #7f1d1d; color: #fecaca; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .card { border: 1px solid #273449; border-radius: 12px; background: #0f172a; padding: 14px; }
    .card span, .fact span { display: block; color: #94a3b8; font-size: 12px; font-weight: 700; }
    .card strong { display: block; margin-top: 6px; color: #f8fafc; font-size: 18px; }
    .card em { display: block; margin-top: 4px; color: #cbd5e1; font-size: 12px; font-style: normal; }
    section { margin-top: 18px; }
    ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    li, .fact { border: 1px solid #273449; border-radius: 10px; background: #0f172a; padding: 10px 12px; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .fact strong { display: block; margin-top: 4px; overflow-wrap: anywhere; }
    @media (max-width: 780px) { body { padding: 16px; } .grid, .facts { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="health ${escapeHtml(health.tone)}">${escapeHtml(health.label)}</span>
      <h1>${escapeHtml(report?.gameName || report?.processName || 'Game Session Report')}</h1>
      <p class="muted">${escapeHtml(health.title)} - ${escapeHtml(health.description)}</p>
      <p class="muted">Started: ${escapeHtml(formatReportDateTime(report?.startedAt))} - Duration: ${escapeHtml(formatReportDuration(report?.durationSeconds))}</p>
    </header>
    <section>
      <h2>Session Summary</h2>
      <div class="grid">${rows.slice(0, 4).map(([label, value, detail]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(detail)}</em></div>`).join('')}</div>
    </section>
    <section>
      <h2>Detailed Metrics</h2>
      <div class="grid">${rows.slice(4).map(([label, value, detail]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(detail)}</em></div>`).join('')}</div>
    </section>
    <section>
      <h2>Insights</h2>
      ${insights.length ? `<ul>${insights.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>` : '<p class="muted">No special findings were detected in this report.</p>'}
    </section>
    ${warnings.length ? `<section><h2>Warnings</h2><ul>${warnings.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section>` : ''}
    <section>
      <h2>Technical Details</h2>
      <div class="facts">${facts.map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    </section>
  </main>
</body>
</html>`;
}

const logger = createLogger('main');
const scriptLogger = createLogger('scripts');
const metricsLogger = createLogger('metrics');
const gameSessionLogger = createLogger('game-session');
const apiLogger = createLogger('api');
const appsLogger = createLogger('apps');
const backupsLogger = createLogger('backups');
const settingsLogger = createLogger('settings');
const systemDetectionLogger = createLogger('system-detection');
const processWatcherLogger = createLogger('process-watcher');
const networkTestLogger = createLogger('network-test');
const ruleAutomationLogger = createLogger('rule-automation');
const scheduledMaintenanceLogger = createLogger('scheduled-maintenance');
const adminBrokerLogger = createLogger('admin-broker');
let mainWindow = null;
let tray = null;
let isQuitting = false;
let isAdminSession = false;
let scriptRunner = null;
let monitoringManager = null;
let gameSessionManager = null;
let tweakRunner = null;
let backendTweakCatalog = null;
let appsManager = null;
let backupManager = null;
let automaticBackupTimer = null;
let automaticBackupRetryAt = 0;
let settingsService = null;
let systemDetectionService = null;
let processWatcherService = null;
let extendedNetworkTestService = null;
let ruleAutomationService = null;
let scheduledMaintenanceService = null;
let adminBrokerManager = null;
let adminBrokerWasReady = false;
let latestUpdateCheck = null;
const metricsSubscriberIds = new Set();
const gameSessionSubscriberIds = new Set();
let advancedSensorMonitoringEnabled = false;
const GAME_MODE_STATE_VERSION = 1;
const IPC_SLOW_CALL_THRESHOLD_MS = 1000;

function resolveExistingPath(candidates) {
  return candidates
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => fs.existsSync(candidate)) || '';
}

function resolveAppIconPath() {
  return resolveExistingPath([
    process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'pictures', 'logo', 'logo.ico') : '',
    path.join(__dirname, '..', 'resources', 'pictures', 'logo', 'logo.ico'),
    path.join(app.getAppPath(), 'resources', 'pictures', 'logo', 'logo.ico'),
    path.join(process.cwd(), 'resources', 'pictures', 'logo', 'logo.ico')
  ]);
}

const APP_ICON_PATH = resolveAppIconPath();
const HAS_APP_ICON = Boolean(APP_ICON_PATH);

function warnIfSlow(loggerInstance, label, startedAt, thresholdMs, details = {}) {
  const durationMs = Date.now() - startedAt;
  if (durationMs > thresholdMs) {
    loggerInstance?.warn?.(`${label} was slow.`, {
      durationMs,
      ...details
    });
  }
}

function resolveBundledTweaksRootPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'tweaks') : '',
    path.join(app.getAppPath(), 'resources', 'tweaks'),
    path.join(__dirname, '..', 'resources', 'tweaks')
  ]
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'configs')) &&
      fs.existsSync(path.join(candidate, 'scripts'))
    ) {
      return candidate;
    }
  }

  return candidates[0] || path.resolve(__dirname, '..', 'resources', 'tweaks');
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) {
    return [];
  }

  const limit = Math.max(1, Math.min(source.length, Math.trunc(Number(concurrency) || 1)));
  const results = new Array(source.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= source.length) {
        return;
      }

      results[currentIndex] = await iteratee(source[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function getDefaultGameModeState() {
  return {
    version: GAME_MODE_STATE_VERSION,
    active: false,
    lastActivatedAt: '',
    source: ''
  };
}

function getGameModeStatePath() {
  return path.join(app.getPath('userData'), 'game-mode', 'state.json');
}

function readGameModeState() {
  const fallbackState = getDefaultGameModeState();

  try {
    const storagePath = getGameModeStatePath();
    if (!fs.existsSync(storagePath)) {
      return fallbackState;
    }

    const rawValue = fs.readFileSync(storagePath, 'utf8');
    const parsed = JSON.parse(rawValue);
    return {
      ...fallbackState,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      active: Boolean(parsed?.active),
      lastActivatedAt: typeof parsed?.lastActivatedAt === 'string' ? parsed.lastActivatedAt.trim() : '',
      source: typeof parsed?.source === 'string' ? parsed.source.trim() : ''
    };
  } catch (error) {
    logger.warn('Failed to read persisted Game Mode state.', { message: error.message });
    return fallbackState;
  }
}

function toIpcError(error) {
  if (error instanceof ScriptRunnerError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  if (error instanceof TweakEngineError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  if (error instanceof TweakRunnerError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  if (error instanceof AppsManagerError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  if (error instanceof BackupManagerError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  if (error instanceof SettingsServiceError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  if (typeof error?.code === 'string' && error.code.trim()) {
    return {
      code: error.code.trim(),
      message: error.message || 'Unexpected error',
      details: error.details || {}
    };
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: error?.message || 'Unexpected error',
    details: {}
  };
}

function resizeProfileImage(filePath) {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  const width = Number(size?.width) || 0;
  const height = Number(size?.height) || 0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const scale = Math.min(1, PROFILE_IMAGE_MAX_DIMENSION / Math.max(width, height));
  const resized = scale < 1
    ? image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'best'
      })
    : image;
  const buffer = resized.toJPEG(PROFILE_IMAGE_JPEG_QUALITY);

  return buffer.length > 0 ? buffer : null;
}

function csvEscape(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildTweakActionLogCsv(rows) {
  const headers = [
    'timestamp',
    'tweakId',
    'tweakName',
    'category',
    'subcategory',
    'action',
    'targetState',
    'result',
    'code',
    'riskLevel',
    'requiresAdmin',
    'rebootRequired',
    'premium',
    'compatibility',
    'durationMs',
    'message'
  ];
  const source = Array.isArray(rows) ? rows : [];
  const lines = [
    headers.join(','),
    ...source.map((row) => headers.map((header) => csvEscape(header === 'message' ? redactDiagnosticString(row?.[header] || '') : row?.[header])).join(','))
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function normalizeRiskLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return '';
}

function normalizeContainerType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'powerplan' || normalized === 'power_plans') {
    return 'power_plan';
  }

  if (normalized === 'timerresolution' || normalized === 'timer_resolutions') {
    return 'timer_resolution';
  }

  if (normalized === 'oneshotselection' || normalized === 'one_shot' || normalized === 'one_shot_selections') {
    return 'one_shot_selection';
  }

  if (normalized === 'oneshotaction' || normalized === 'one_shot_action' || normalized === 'one_shot_actions') {
    return 'one_shot_action';
  }

  if (normalized === 'fix' || normalized === 'fixes') {
    return 'fix';
  }

  if (normalized === 'normal' || normalized === 'normaltweak' || normalized === 'normal_tweaks') {
    return 'normal_tweak';
  }

  return normalized || 'normal_tweak';
}

function normalizeBulletpoints(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text ? { icon: '', text } : null;
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const text = typeof entry.text === 'string'
        ? entry.text.trim()
        : typeof entry.label === 'string'
          ? entry.label.trim()
          : typeof entry.title === 'string'
            ? entry.title.trim()
            : '';
      if (!text) {
        return null;
      }

      const icon = typeof entry.icon === 'string' ? entry.icon.trim().toLowerCase() : '';
      return {
        icon,
        text
      };
    })
    .filter(Boolean);
}

function normalizeCompactDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatusLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const active = typeof value.active === 'string' ? value.active.trim() : '';
  const inactive = typeof value.inactive === 'string' ? value.inactive.trim() : '';
  if (!active && !inactive) {
    return null;
  }

  return {
    ...(active ? { active } : {}),
    ...(inactive ? { inactive } : {})
  };
}

function normalizeCtaLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const defaultLabel = typeof value.default === 'string' ? value.default.trim() : '';
  const active = typeof value.active === 'string' ? value.active.trim() : '';
  if (!defaultLabel && !active) {
    return null;
  }

  return {
    ...(defaultLabel ? { default: defaultLabel } : {}),
    ...(active ? { active } : {})
  };
}

function normalizeUiConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const variant = typeof value.variant === 'string' ? value.variant.trim().toLowerCase() : '';
  const size = typeof value.size === 'string' ? value.size.trim().toLowerCase() : '';
  const showProfileBadgeSource = value.showProfileBadge ?? value.show_profile_badge;
  const showTargetSystemSource = value.showTargetSystem ?? value.show_target_system;
  const showTradeoffsSource = value.showTradeoffs ?? value.show_tradeoffs;
  const showBulletpointsSource = value.showBulletpoints ?? value.show_bulletpoints;
  const maxMetricsSource = value.maxMetrics ?? value.max_metrics;
  const maxMetricsNumber = Number(maxMetricsSource);
  const maxMetrics = Number.isFinite(maxMetricsNumber) && maxMetricsNumber > 0
    ? Math.max(1, Math.trunc(maxMetricsNumber))
    : null;

  const normalized = {
    ...(variant ? { variant } : {}),
    ...(size ? { size } : {}),
    ...(typeof showProfileBadgeSource === 'boolean' ? { showProfileBadge: showProfileBadgeSource } : {}),
    ...(typeof showTargetSystemSource === 'boolean' ? { showTargetSystem: showTargetSystemSource } : {}),
    ...(typeof showTradeoffsSource === 'boolean' ? { showTradeoffs: showTradeoffsSource } : {}),
    ...(typeof showBulletpointsSource === 'boolean' ? { showBulletpoints: showBulletpointsSource } : {}),
    ...(maxMetrics ? { maxMetrics } : {})
  };

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeMetricDirection(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'positive' || normalized === 'negative' || normalized === 'neutral') {
    return normalized;
  }
  return '';
}

function normalizeMetrics(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const label = typeof entry.label === 'string'
        ? entry.label.trim()
        : typeof entry.text === 'string'
          ? entry.text.trim()
          : '';
      if (!label) {
        return null;
      }

      const maxSource = Number(entry.max);
      const max = Number.isFinite(maxSource) && maxSource > 0 ? Math.min(5, Math.max(1, Math.trunc(maxSource))) : 5;
      const valueSource = Number(entry.value);
      const rawValue = Number.isFinite(valueSource) ? Math.trunc(valueSource) : 0;
      const boundedValue = Math.max(0, Math.min(max, rawValue));

      return {
        icon: typeof entry.icon === 'string' ? entry.icon.trim().toLowerCase() : '',
        label,
        value: boundedValue,
        max,
        direction: normalizeMetricDirection(entry.direction)
      };
    })
    .filter(Boolean);
}

function normalizeSelections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        const label = String(entry).trim();
        return label ? { label, value: label } : null;
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const label = String(entry.label || entry.name || entry.value || entry.id || '').trim();
      const optionValue = String(entry.value || entry.id || label).trim();
      if (!label || !optionValue) {
        return null;
      }

      return {
        ...entry,
        label,
        value: optionValue
      };
    })
    .filter(Boolean);
}

function normalizeRangeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const minimum = Number(value.min ?? value.minimum);
  const maximum = Number(value.max ?? value.maximum);
  const step = Number(value.step);
  const recommendedValue = Number(value.recommendedValue ?? value.recommended_value);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return null;
  }

  return {
    parameter: typeof value.parameter === 'string' && value.parameter.trim() ? value.parameter.trim() : 'Value',
    min: minimum,
    max: maximum,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    unit: typeof value.unit === 'string' ? value.unit.trim() : '',
    recommendedValue: Number.isFinite(recommendedValue)
      ? Math.min(maximum, Math.max(minimum, recommendedValue))
      : minimum + ((maximum - minimum) / 2)
  };
}

function normalizeOptionalRangeValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSelectedOption(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback === undefined || fallback === null ? false : normalizeBooleanFlag(fallback, false);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on', 'enabled', 'recommended', 'premium'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off', 'disabled', 'optional', 'free'].includes(normalized)) {
      return false;
    }
  }

  return fallback === undefined || fallback === null ? false : normalizeBooleanFlag(fallback, false);
}

function normalizeResolutionValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().replace(',', '.');
  return normalized || '';
}

function normalizeRecommendedSelection(value, selections = []) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }

  return Array.isArray(selections) && selections.some((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      return String(entry).trim() === normalized;
    }
    return String(entry?.value || entry?.label || '').trim() === normalized;
  }) ? normalized : '';
}

function getLocalTweakOverrides(tweakId) {
  if (String(tweakId || '').trim().toLowerCase() !== 'set_timer_resolution') {
    return null;
  }

  return {
    id: 'set_timer_resolution',
    name: 'Set Timer Resolution',
    description: 'Optimizes timer resolution for lower input latency.',
    compact_description: 'Optimizes timer resolution for lower input latency.',
    container_type: 'timer_resolution',
    script: 'set_timer_resolution.ps1',
    requires_admin: true,
    reboot_required: false,
    risk_level: 'low',
    supports_status_detection: true,
    ui: {
      variant: 'compact_selector',
      size: 'square',
      max_metrics: 3
    },
    profile: {
      label: 'Latency',
      icon: 'clock'
    },
    status_labels: {
      active: 'Currently Applied',
      inactive: 'Disabled'
    },
    cta_labels: {
      default: 'Apply',
      active: 'Currently Applied'
    },
    metrics: [
      {
        icon: 'mouse-pointer',
        label: 'Input Latency Improvement',
        value: 4,
        max: 5,
        direction: 'positive'
      },
      {
        icon: 'bolt',
        label: 'Responsiveness Improvement',
        value: 4,
        max: 5,
        direction: 'positive'
      },
      {
        icon: 'plug',
        label: 'Power Usage',
        value: 3,
        max: 5,
        direction: 'negative'
      }
    ]
  };
}

function mergeTweakDetails(tweak, details = {}) {
  const localOverrides = getLocalTweakOverrides(tweak?.id);
  const baseTweak = localOverrides ? { ...tweak, ...localOverrides } : tweak;
  const source = details && typeof details === 'object' ? details : {};
  const nextRisk = normalizeRiskLevel(source.risk || source.riskLevel || baseTweak.risk || baseTweak.riskLevel);
  const nextCompactDescription = normalizeCompactDescription(
    source.compactDescription ||
    source.compact_description ||
    baseTweak.compactDescription ||
    baseTweak.compact_description
  );
  const nextUi = normalizeUiConfig(source.ui) || normalizeUiConfig(baseTweak.ui);
  const nextStatusLabels =
    normalizeStatusLabels(source.statusLabels || source.status_labels) ||
    normalizeStatusLabels(baseTweak.statusLabels || baseTweak.status_labels);
  const nextCtaLabels =
    normalizeCtaLabels(source.ctaLabels || source.cta_labels) ||
    normalizeCtaLabels(baseTweak.ctaLabels || baseTweak.cta_labels);
  const sourceMetrics = normalizeMetrics(source.metrics);
  const tweakMetrics = normalizeMetrics(baseTweak.metrics);
  const nextMetrics = sourceMetrics.length ? sourceMetrics : tweakMetrics;
  const selectedOptionInSource =
    Object.prototype.hasOwnProperty.call(source, 'selectedOption') ||
    Object.prototype.hasOwnProperty.call(source, 'selected_option');
  const selectionsInSource = Object.prototype.hasOwnProperty.call(source, 'selections');
  const nextSelectedOption = selectedOptionInSource
    ? normalizeSelectedOption(source.selectedOption ?? source.selected_option)
    : normalizeSelectedOption(baseTweak.selectedOption);
  const nextSelections = normalizeSelections(selectionsInSource ? source.selections : baseTweak.selections);
  const nextRange = normalizeRangeConfig(source.range || source.range_config) ||
    normalizeRangeConfig(baseTweak.range || baseTweak.rangeConfig || baseTweak.range_config);
  const recommendedSelectionInSource =
    Object.prototype.hasOwnProperty.call(source, 'recommendedSelection') ||
    Object.prototype.hasOwnProperty.call(source, 'recommended_selection');
  const nextRecommendedSelection = normalizeRecommendedSelection(
    recommendedSelectionInSource ? (source.recommendedSelection ?? source.recommended_selection) : baseTweak.recommendedSelection,
    nextSelections
  );
  const selectedResolutionInSource =
    Object.prototype.hasOwnProperty.call(source, 'selectedResolution') ||
    Object.prototype.hasOwnProperty.call(source, 'selected_resolution');
  const currentResolutionInSource =
    Object.prototype.hasOwnProperty.call(source, 'currentResolution') ||
    Object.prototype.hasOwnProperty.call(source, 'current_resolution');
  const nextSelectedResolution = selectedResolutionInSource
    ? normalizeResolutionValue(source.selectedResolution ?? source.selected_resolution)
    : normalizeResolutionValue(baseTweak.selectedResolution);
  const nextCurrentResolution = currentResolutionInSource
    ? normalizeResolutionValue(source.currentResolution ?? source.current_resolution)
    : normalizeResolutionValue(baseTweak.currentResolution || nextSelectedResolution);

  return {
    ...baseTweak,
    description:
      typeof source.description === 'string' && source.description.trim()
        ? source.description.trim()
        : baseTweak.description,
    descriptionI18n: source.descriptionI18n || source.description_i18n || baseTweak.descriptionI18n || baseTweak.description_i18n || null,
    description_i18n: source.description_i18n || source.descriptionI18n || baseTweak.description_i18n || baseTweak.descriptionI18n || null,
    compactDescription: nextCompactDescription,
    risk: nextRisk,
    riskLevel: nextRisk,
    containerType: normalizeContainerType(source.containerType || source.container_type || baseTweak.containerType),
    ui: nextUi,
    statusLabels: nextStatusLabels,
    ctaLabels: nextCtaLabels,
    metrics: nextMetrics,
    bulletpoints: normalizeBulletpoints(source.bulletpoints || baseTweak.bulletpoints),
    requiresAdmin: normalizeBooleanFlag(source.requiresAdmin ?? source.requires_admin, baseTweak.requiresAdmin ?? baseTweak.requires_admin ?? true),
    rebootRequired: normalizeBooleanFlag(source.rebootRequired ?? source.reboot_required, baseTweak.rebootRequired ?? baseTweak.reboot_required),
    premium: normalizeBooleanFlag(source.premium ?? source.requiresPremium ?? source.requires_premium, baseTweak.premium ?? baseTweak.requiresPremium ?? baseTweak.requires_premium),
    profile: source.profile || baseTweak.profile || null,
    targetSystem: Array.isArray(source.targetSystem)
      ? source.targetSystem
      : Array.isArray(baseTweak.targetSystem)
        ? baseTweak.targetSystem
        : [],
    useCase:
      typeof source.useCase === 'string'
        ? source.useCase
        : typeof baseTweak.useCase === 'string'
          ? baseTweak.useCase
          : '',
    supportsStatusDetection: Boolean(
      source.supportsStatusDetection ??
      source.supports_status_detection ??
      baseTweak.supportsStatusDetection ??
      baseTweak.supports_status_detection
    ),
    tradeoffs: Array.isArray(source.tradeoffs)
      ? source.tradeoffs
      : Array.isArray(baseTweak.tradeoffs)
        ? baseTweak.tradeoffs
        : [],
    selections: nextSelections,
    range: nextRange,
    selectedOption: nextSelectedOption,
    currentValue:
      normalizeOptionalRangeValue(source.currentValue ?? source.current_value) ??
      normalizeOptionalRangeValue(baseTweak.currentValue ?? baseTweak.current_value),
    selectedResolution: nextSelectedResolution,
    currentResolution: nextCurrentResolution,
    recommendedSelection: nextRecommendedSelection,
    recommended: normalizeBooleanFlag(
      source.recommended ?? source.isRecommended ?? source.is_recommended,
      baseTweak.recommended ?? baseTweak.isRecommended ?? baseTweak.is_recommended
    ),
    impact: Number.isFinite(Number(source.impact))
      ? Math.max(1, Math.min(5, Math.trunc(Number(source.impact))))
      : Number.isFinite(Number(baseTweak.impact))
        ? Math.max(1, Math.min(5, Math.trunc(Number(baseTweak.impact))))
        : 2,
    impactLevel: typeof source.impactLevel === 'string'
      ? source.impactLevel
      : typeof source.impact_level === 'string'
        ? source.impact_level
        : typeof baseTweak.impactLevel === 'string'
          ? baseTweak.impactLevel
          : typeof baseTweak.impact_level === 'string'
            ? baseTweak.impact_level
            : '',
    lastUpdated: [
      source.lastUpdated,
      source.last_updated,
      baseTweak.lastUpdated,
      baseTweak.last_updated
    ].map((value) => String(value || '').trim()).find(Boolean) || '',
    last_updated: [
      source.last_updated,
      source.lastUpdated,
      baseTweak.last_updated,
      baseTweak.lastUpdated
    ].map((value) => String(value || '').trim()).find(Boolean) || '',
    technicalDetails: typeof source.technicalDetails === 'string'
      ? source.technicalDetails
      : typeof source.technical_details === 'string'
        ? source.technical_details
        : baseTweak.technicalDetails || baseTweak.technical_details || '',
    technicalChanges: source.technicalChanges || source.technical_changes || baseTweak.technicalChanges || baseTweak.technical_changes || null,
    technical_changes: source.technical_changes || source.technicalChanges || baseTweak.technical_changes || baseTweak.technicalChanges || null,
    warnings: Array.isArray(source.warnings) ? source.warnings : Array.isArray(baseTweak.warnings) ? baseTweak.warnings : [],
    compatibility: source.compatibility || baseTweak.compatibility || null,
    applicability: source.applicability || baseTweak.applicability || null,
    changes: Array.isArray(source.changes) ? source.changes : Array.isArray(baseTweak.changes) ? baseTweak.changes : [],
    advancedInfo: source.advancedInfo || source.advanced_info || baseTweak.advancedInfo || baseTweak.advanced_info || null,
    ai: source.ai || baseTweak.ai || null,
    script: typeof source.script === 'string' ? source.script : typeof baseTweak.script === 'string' ? baseTweak.script : '',
    ...(typeof source.currentState === 'string' ? { currentState: source.currentState } : {}),
    ...(typeof source.status === 'string' ? { status: source.status } : {})
  };
}

function getLastWindowsShutdownEventAt() {
  if (process.platform !== 'win32') {
    return 0;
  }

  if (cachedWindowsShutdownEventAt !== null) {
    return cachedWindowsShutdownEventAt;
  }

  cachedWindowsShutdownEventAt = 0;

  try {
    const command = [
      "$event = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1074 } -MaxEvents 1 -ErrorAction Stop",
      "if ($null -ne $event) { $event.TimeCreated.ToUniversalTime().ToString('o') }"
    ].join('; ');
    const output = execFileSync(
      TRUSTED_POWERSHELL,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024,
        timeout: WINDOWS_SHUTDOWN_EVENT_QUERY_TIMEOUT_MS,
        windowsHide: true
      }
    ).trim();
    const timestamp = Date.parse(output);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      cachedWindowsShutdownEventAt = timestamp;
    }
  } catch (error) {
    logger.warn('Unable to read the latest Windows shutdown event; using kernel uptime only.', {
      error: error.message
    });
  }

  return cachedWindowsShutdownEventAt;
}

function getSystemRestartMarkerSnapshot() {
  const capturedAt = Date.now();
  const uptimeSeconds = Math.max(0, Math.floor(os.uptime()));
  const bootStartedAt = Math.max(0, capturedAt - (uptimeSeconds * 1000));

  return {
    uptimeSeconds,
    restartMarkerAt: Math.max(bootStartedAt, getLastWindowsShutdownEventAt())
  };
}

function checkWindowsAdmin() {
  if (process.platform !== 'win32') {
    return true;
  }

  try {
    const command = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
    const output = execFileSync(
      TRUSTED_POWERSHELL,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8' }
    )
      .trim()
      .toLowerCase();

    return output === 'true';
  } catch (error) {
    logger.error('Unable to determine admin state.', { error: error.message });
    return false;
  }
}

function initializePrivilegeState() {
  if (process.platform !== 'win32') {
    logger.warn('Non-Windows platform detected. Administrator-only actions remain unavailable.');
    isAdminSession = false;
    return true;
  }

  isAdminSession = checkWindowsAdmin();
  if (isAdminSession) {
    logger.info('Application is running with administrator privileges.');
  } else {
    logger.info('Application is running with limited privileges. Elevation is available on explicit request.');
  }

  return true;
}

function registerGlobalErrorHandling() {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in main process.', { error: error.stack || error.message });
    dialog.showErrorBox('Critical Error', 'An unexpected error occurred in the main process.');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in main process.', {
      reason: reason instanceof Error ? reason.stack || reason.message : String(reason)
    });
  });
}

function pruneMetricsSubscribers() {
  for (const subscriberId of Array.from(metricsSubscriberIds)) {
    const subscriberContents = webContents.fromId(subscriberId);
    if (!subscriberContents || subscriberContents.isDestroyed()) {
      metricsSubscriberIds.delete(subscriberId);
    }
  }
}

function pruneGameSessionSubscribers() {
  for (const subscriberId of Array.from(gameSessionSubscriberIds)) {
    const subscriberContents = webContents.fromId(subscriberId);
    if (!subscriberContents || subscriberContents.isDestroyed()) {
      gameSessionSubscriberIds.delete(subscriberId);
    }
  }
}

async function syncMonitoringSubscriptionState() {
  pruneMetricsSubscribers();
  pruneGameSessionSubscribers();

  if (!monitoringManager) {
    return;
  }

  if (!advancedSensorMonitoringEnabled) {
    monitoringManager.stop();
    return;
  }

  const rulesNeedMonitoring = (settingsService?.getSettings?.()?.automation?.rules || []).some((rule) => (
    rule?.enabled && (rule.conditions || []).some((condition) => !String(condition?.type || '').startsWith('process'))
  ));
  if (metricsSubscriberIds.size > 0 || gameSessionManager?.isRecording?.() || rulesNeedMonitoring) {
    await monitoringManager.start();
    return;
  }

  monitoringManager.stop();
}

function broadcastMetricsUpdate(metrics) {
  pruneMetricsSubscribers();

  for (const subscriberId of metricsSubscriberIds) {
    const subscriberContents = webContents.fromId(subscriberId);
    if (!subscriberContents || subscriberContents.isDestroyed()) {
      metricsSubscriberIds.delete(subscriberId);
      continue;
    }

    subscriberContents.send('metrics:update', metrics);
    subscriberContents.send('monitoring:update', metrics?.overview || null);
  }
}

function broadcastGameSessionUpdate(state = null) {
  pruneGameSessionSubscribers();
  const payload = state || gameSessionManager?.getState?.() || null;
  ruleAutomationService?.handleGameState?.(payload);

  for (const subscriberId of gameSessionSubscriberIds) {
    const subscriberContents = webContents.fromId(subscriberId);
    if (!subscriberContents || subscriberContents.isDestroyed()) {
      gameSessionSubscriberIds.delete(subscriberId);
      continue;
    }

    subscriberContents.send('game-session:update', payload);
  }
}

function broadcastProcessAutomationUpdate(state = null) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('process-automation:update', state || processWatcherService?.getState?.() || null);
}

function broadcastExtendedNetworkTestUpdate(state = null) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('network-test:update', state || extendedNetworkTestService?.getState?.() || null);
}

function broadcastRuleAutomationUpdate(state = null) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('rule-automation:update', state || ruleAutomationService?.getState?.() || null);
}

function broadcastScheduledMaintenanceUpdate(state = null) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(
    'scheduled-maintenance:update',
    state || scheduledMaintenanceService?.getState?.() || null
  );
}

function broadcastAdminAccessState(state = null) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('app:admin-access-state', state || adminBrokerManager?.getState?.() || {
    status: 'unavailable',
    available: false,
    ready: false,
    alreadyElevated: false,
    pendingCount: 0
  });
}

function handleAdminBrokerStateChange(state) {
  broadcastAdminAccessState(state);
  const ready = Boolean(state?.ready);
  if (ready && !adminBrokerWasReady) {
    void ruleAutomationService?.resumePendingAutomaticActions?.({ adminApproved: true });
  }
  adminBrokerWasReady = ready;
}

function broadcastAppOptimizationUpdate(state = null) {
  if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(
    'apps:optimization:update',
    state || appsManager?.getAppOptimizationState?.() || null
  );
}

function isRecommendedMaintenanceTweak(tweak) {
  const value = tweak?.recommended ?? tweak?.isRecommended ?? tweak?.is_recommended;
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function getMaintenanceTweaks(taskId) {
  const scope = taskId === 'cleanup'
    ? { category: 'General', subcategory: 'Cleanup' }
    : taskId === 'drive'
      ? { category: 'Hardware', subcategory: 'Storage' }
      : null;
  if (!scope || !backendTweakCatalog) return [];
  return backendTweakCatalog.listTweaks().filter((tweak) => (
    !isBlockedSecurityTweakId(tweak?.id) &&
    isRecommendedMaintenanceTweak(tweak) &&
    tweak?.category === scope.category &&
    tweak?.subcategory === scope.subcategory
  ));
}

function getMaintenanceTweakParams(tweak) {
  const containerType = String(tweak?.containerType || tweak?.container_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const recommendedSelection = String(
    tweak?.recommendedSelection ||
    tweak?.recommended_selection ||
    tweak?.selections?.find?.((entry) => entry?.recommended)?.value ||
    ''
  ).trim();
  if (containerType.includes('selection') && recommendedSelection) {
    return { Selection: recommendedSelection };
  }
  if (containerType.includes('range')) {
    const parameter = String(tweak?.range?.parameter || tweak?.parameter || 'Value');
    const value = Number(tweak?.range?.recommendedValue ?? tweak?.recommendedValue);
    return Number.isFinite(value) ? { [parameter]: value } : {};
  }
  if (containerType.includes('timer')) {
    return { Resolution: recommendedSelection || '0.5' };
  }
  return {};
}

async function executeAutomaticRuleAction(execution, options = {}) {
  return executeAutomaticTweakRuleAction({
    execution,
    tweakRunner,
    tweakCatalog: backendTweakCatalog,
    logger: ruleAutomationLogger,
    allowAdminPrompt: options.allowAdminPrompt === true,
    isAdminAccessReady: () => Boolean(isAdminSession || adminBrokerManager?.getState?.()?.ready),
    createBackup: async (tweak) => createAutomaticTweakBackup({
      name: `Before rule ${execution?.ruleName || execution?.ruleId || 'automation'}`,
      description: 'Automatic backup before a confirmation-bypassed rule tweak.'
    }, [tweak])
  });
}

async function createAutomaticTweakBackup({ name, description }, tweaks) {
  if (!settingsService?.getSettings?.()?.backupData?.backupBeforeApplyingTweaks || !backupManager || !tweaks.length) {
    return { ok: true, skipped: true };
  }
  try {
    const tweakStates = await captureAutomaticTweakSnapshot(tweaks, tweakRunner, { strict: true });
    await backupManager.createBackup({
      engine: 'nova',
      type: 'beforeApply',
      name,
      description,
      scope: ['tweakStates'],
      snapshot: {
        tweakStates
      }
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error?.code || 'BACKUP_CREATE_FAILED', message: error?.message || 'The safety backup could not be created.' };
  }
}

async function runScheduledBackup() {
  if (!backupManager || Date.now() < automaticBackupRetryAt) return;
  try {
    const result = await backupManager.runAutomaticBackup(async () => {
      const tweaks = backendTweakCatalog.listTweaks().filter((tweak) => !isBlockedSecurityTweakId(tweak?.id));
      const tweakStates = await captureAutomaticTweakSnapshot(tweaks, tweakRunner);
      const settings = settingsService.getSettings();
      return {
        tweakStates,
        appSettings: {
          capturedAt: new Date().toISOString(), captureStatus: 'complete',
          data: { theme: settings.preferences?.theme, language: settings.preferences?.language,
            settings, backupPreferences: (await backupManager.getBackupSettings()).settings }
        }
      };
    });
    if (!result.skipped) backupsLogger.info('Scheduled backup created.', { id: result.backup?.id });
  } catch (error) {
    automaticBackupRetryAt = Date.now() + 15 * 60 * 1000;
    backupsLogger.error('Scheduled backup failed.', { code: error?.code, message: error?.message });
    if (Notification.isSupported()) {
      new Notification({ title: 'Nova Backup', body: `Automatic backup failed: ${error?.message || 'Unknown error'}` }).show();
    }
  }
}

async function executeScheduledMaintenanceTask(taskId) {
  if (taskId === 'app-cache') {
    try {
      const summary = await appsManager.cleanupInactiveAppCaches();
      return { ok: summary.failed === 0, code: summary.failed ? 'CACHE_PARTIAL' : '', summary };
    } catch (error) {
      return { ok: false, code: error?.code || 'CACHE_CLEANUP_FAILED' };
    }
  }
  const tweaks = getMaintenanceTweaks(taskId);
  if (!tweaks.length) return { ok: false, code: 'NO_MAINTENANCE_TWEAKS' };
  const backup = await createAutomaticTweakBackup({
    name: `Before scheduled ${taskId}`,
    description: 'Automatic backup before scheduled maintenance.'
  }, tweaks);
  if (!backup.ok) return backup;
  let successful = 0;
  let failed = 0;
  for (const tweak of tweaks) {
    try {
      const result = await tweakRunner.runTweak({
        tweakId: tweak.id,
        targetState: 'enabled',
        params: getMaintenanceTweakParams(tweak),
        timeoutMs: 180000,
        executionContext: { allowPrompt: false, source: 'scheduled-maintenance' }
      });
      if (result?.ok) successful += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      scheduledMaintenanceLogger.warn('Maintenance tweak failed.', {
        taskId,
        tweakId: tweak.id,
        code: error?.code || 'TWEAK_FAILED'
      });
    }
  }
  return {
    ok: failed === 0,
    code: failed ? successful ? 'MAINTENANCE_PARTIAL' : 'MAINTENANCE_FAILED' : '',
    summary: { successful, failed, total: tweaks.length }
  };
}

async function maintenanceRequiresAdmin(taskIds = []) {
  let requiresAdmin = false;
  for (const taskId of taskIds) {
    if (taskId === 'app-cache') continue;
    for (const tweak of getMaintenanceTweaks(taskId)) {
      const requirements = await tweakRunner.getExecutionRequirements({
        tweakId: tweak.id,
        targetState: 'enabled',
        params: getMaintenanceTweakParams(tweak)
      });
      requiresAdmin ||= requirements.requiresAdmin;
    }
  }
  return requiresAdmin;
}

function broadcastPresentMonEvent(event = {}) {
  const type = String(event?.type || '').trim().toLowerCase();
  if (!['status', 'metrics', 'error'].includes(type)) {
    return;
  }

  const targetIds = new Set();
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    targetIds.add(mainWindow.webContents.id);
  }
  for (const subscriberId of gameSessionSubscriberIds) {
    targetIds.add(subscriberId);
  }

  for (const targetId of targetIds) {
    const targetContents = webContents.fromId(targetId);
    if (!targetContents || targetContents.isDestroyed()) {
      continue;
    }
    targetContents.send(`presentmon:${type}`, event);
  }
}

function getCurrentSettings() {
  return settingsService?.getSettings?.() || null;
}

function getBackupRootFromSettings() {
  return getCurrentSettings()?.backupData?.backupLocation || '';
}

function shouldUseTray(settings = getCurrentSettings()) {
  return Boolean(settings?.startupWindow?.minimizeToTray || settings?.startupWindow?.closeToTray);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function destroyTrayIfUnused(settings = getCurrentSettings()) {
  if (shouldUseTray(settings)) {
    return;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function ensureTray(settings = getCurrentSettings()) {
  if (!shouldUseTray(settings) || tray || !HAS_APP_ICON) {
    destroyTrayIfUnused(settings);
    return Boolean(tray);
  }

  tray = new Tray(APP_ICON_PATH);
  tray.setToolTip('Nova Tweaks');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Nova Tweaks',
      click: showMainWindow
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', showMainWindow);
  return true;
}

function applyLoginItemSettings(settings = getCurrentSettings()) {
  if (process.platform !== 'win32' || !settings?.startupWindow) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(settings.startupWindow.startWithWindows),
      args: settings.startupWindow.startMinimized ? ['--hidden'] : []
    });
  } catch (error) {
    settingsLogger.warn('Failed to update Windows login item settings.', {
      message: error?.message || ''
    });
  }
}

function applySettingsRuntimeEffects(settings = getCurrentSettings()) {
  if (!settings) {
    return;
  }

  const monitoringWasEnabled = advancedSensorMonitoringEnabled;
  advancedSensorMonitoringEnabled = settings.monitoring?.advancedSensorsEnabled === true;
  applyLoginItemSettings(settings);
  ensureTray(settings);
  backupManager?.setBackupRoot?.(settings.backupData?.backupLocation);
  processWatcherService?.applySettings?.();
  ruleAutomationService?.applySettings?.();
  if (monitoringManager && monitoringWasEnabled && !advancedSensorMonitoringEnabled) {
    void monitoringManager.shutdown();
  } else {
    void syncMonitoringSubscriptionState();
  }
}

const DIAGNOSTIC_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DIAGNOSTIC_JWT_PATTERN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_+/=-]{16,}\b/g;
const DIAGNOSTIC_UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const DIAGNOSTIC_HASH_PATTERN = /\b[a-f0-9]{64}\b/gi;
const DIAGNOSTIC_USER_PATH_PATTERN = /([A-Z]:\\Users\\)[^\\/\s"]+/gi;
const DIAGNOSTIC_SENSITIVE_KEY_PATTERN = /token|password|authorization|cookie|secret|mfa|otp|totp|recovery|email|hwid|installid|deviceid|stripe|checkout|avatar|profileimage|dataurl|image/i;

function redactDiagnosticString(value) {
  return String(value)
    .replace(DIAGNOSTIC_EMAIL_PATTERN, '[redacted-email]')
    .replace(DIAGNOSTIC_JWT_PATTERN, '[redacted-token]')
    .replace(DIAGNOSTIC_UUID_PATTERN, '[redacted-id]')
    .replace(DIAGNOSTIC_HASH_PATTERN, '[redacted-hash]')
    .replace(DIAGNOSTIC_USER_PATH_PATTERN, '$1[redacted-user]');
}

function redactDiagnosticValue(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }
  if (DIAGNOSTIC_SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return redactDiagnosticString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticValue(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactDiagnosticValue(entryValue, entryKey)])
    );
  }
  return value;
}

function restrictExportFilePermissions(filePath) {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o600);
  }
}

function writePrivateExportFile(filePath, content) {
  fs.writeFileSync(filePath, content, {
    encoding: 'utf8',
    mode: 0o600
  });
  restrictExportFilePermissions(filePath);
}

function safeReadRecentLogLines(maxLines = 120) {
  try {
    const logsPath = app.getPath('logs');
    if (!fs.existsSync(logsPath)) {
      return [];
    }
    const entries = fs.readdirSync(logsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(logsPath, entry.name);
        const stat = fs.statSync(filePath);
        return { filePath, name: entry.name, mtimeMs: stat.mtimeMs, size: stat.size };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, 3);

    const lines = [];
    for (const entry of entries) {
      const raw = fs.readFileSync(entry.filePath, 'utf8');
      lines.push(
        ...raw
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-Math.ceil(maxLines / Math.max(1, entries.length)))
          .map((line) => redactDiagnosticString(`[${entry.name}] ${line.slice(0, 500)}`))
      );
    }
    return lines.slice(-maxLines);
  } catch (error) {
    return [`Unable to read recent logs: ${error?.message || 'Unknown error'}`];
  }
}

function getSafeCacheTargets() {
  const userData = app.getPath('userData');
  return [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnCache',
    'GrShaderCache',
    'ShaderCache',
    path.join('Service Worker', 'CacheStorage'),
    path.join('Service Worker', 'ScriptCache')
  ].map((relativePath) => path.join(userData, relativePath));
}

function clearSafeCacheTargets() {
  const userData = path.resolve(app.getPath('userData'));
  const targets = getSafeCacheTargets();
  let removedTargets = 0;
  let removedBytes = 0;

  for (const target of targets) {
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(`${userData}${path.sep}`) || !fs.existsSync(resolvedTarget)) {
      continue;
    }
    const stat = fs.statSync(resolvedTarget);
    if (!stat.isDirectory()) {
      continue;
    }
    removedBytes += getDirectorySizeSafe(resolvedTarget);
    fs.rmSync(resolvedTarget, { recursive: true, force: true });
    removedTargets += 1;
  }

  return {
    removedTargets,
    removedBytes,
    targetsChecked: targets
  };
}

function getDirectorySizeSafe(directoryPath) {
  try {
    let total = 0;
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySizeSafe(childPath);
      } else if (entry.isFile()) {
        total += fs.statSync(childPath).size;
      }
    }
    return total;
  } catch (_error) {
    return 0;
  }
}

function resolveOptimizedMainWindowBounds() {
  const fallback = {
    width: 1520,
    height: 950
  };

  try {
    const workArea = screen.getPrimaryDisplay()?.workArea;
    if (!workArea) {
      return fallback;
    }

    const horizontalMargin = 80;
    const verticalMargin = 72;
    const maxWidth = Math.max(900, workArea.width - horizontalMargin);
    const maxHeight = Math.max(650, workArea.height - verticalMargin);
    const width = Math.min(1520, maxWidth);
    const height = Math.min(950, maxHeight);

    return {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2)
    };
  } catch (_error) {
    return fallback;
  }
}

function resolveTrustedRendererDevUrl(value) {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (!configured || app.isPackaged) {
    return '';
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch (_error) {
    throw new Error('Renderer development URL is invalid.');
  }
  const allowedOrigins = new Set([
    'http://127.0.0.1:5183',
    'http://localhost:5183'
  ]);
  if (
    !allowedOrigins.has(parsed.origin)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Renderer development URL must be the trusted loopback Vite origin.');
  }
  return parsed.origin;
}

function createMainWindow() {
  const settings = getCurrentSettings();
  const optimizedBounds = resolveOptimizedMainWindowBounds();
  mainWindow = new BrowserWindow({
    ...optimizedBounds,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(HAS_APP_ICON ? { icon: APP_ICON_PATH } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      allowRunningInsecureContent: false
    }
  });

  const devServerUrl = resolveTrustedRendererDevUrl(process.env.VITE_DEV_SERVER_URL);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = mainWindow?.webContents?.getURL?.() || '';
    if (targetUrl !== currentUrl) {
      event.preventDefault();
    }
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (
      !app.isPackaged
      && String(process.env.NOVA_OPEN_DEVTOOLS || '').trim().toLowerCase() === 'true'
    ) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadURL(LOCAL_RENDERER_URL);
  }

  mainWindow.once('ready-to-show', () => {
    applySettingsRuntimeEffects(settings);
    if (settings?.startupWindow?.startMinimized) {
      if (shouldUseTray(settings)) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.minimize();
      }
      return;
    }

    mainWindow.show();
  });

  mainWindow.on('minimize', (event) => {
    const latestSettings = getCurrentSettings();
    if (!latestSettings?.startupWindow?.minimizeToTray) {
      return;
    }
    ensureTray(latestSettings);
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    const latestSettings = getCurrentSettings();
    if (isQuitting || !latestSettings?.startupWindow?.closeToTray) {
      return;
    }
    ensureTray(latestSettings);
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    metricsSubscriberIds.clear();
    void syncMonitoringSubscriptionState();
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-admin-state', async () => ({
    isAdmin: isAdminSession,
    ...(adminBrokerManager?.getState?.() || {})
  }));

  ipcMain.handle('app:get-admin-access-state', async () => (
    adminBrokerManager?.getState?.() || {
      status: process.platform === 'win32' ? 'idle' : 'unavailable',
      available: process.platform === 'win32',
      ready: isAdminSession,
      alreadyElevated: isAdminSession,
      pendingCount: 0
    }
  ));

  const requestAdminAccess = async (_event, payload = {}) => {
    if (process.platform !== 'win32') {
      return { ok: false, code: 'ADMIN_BROKER_UNAVAILABLE' };
    }
    if (isAdminSession) {
      return { ok: true, alreadyElevated: true, state: adminBrokerManager?.getState?.() || null };
    }
    try {
      const state = await adminBrokerManager.ensureReady({ reason: String(payload?.reason || 'manual') });
      return { ok: true, state };
    } catch (error) {
      return { ok: false, ...toIpcError(error) };
    }
  };

  ipcMain.handle('app:request-admin-access', requestAdminAccess);
  ipcMain.handle('app:request-admin-relaunch', requestAdminAccess);

  ipcMain.handle('app:window:minimize', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false };
    }
    mainWindow.minimize();
    return { ok: true };
  });

  ipcMain.handle('app:window:toggle-maximize', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, isMaximized: false };
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { ok: true, isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle('app:window:close', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false };
    }
    mainWindow.close();
    return { ok: true };
  });

  ipcMain.handle('app:get-os-language', async () => app.getLocale());

  ipcMain.handle('app:get-system-uptime', async () => ({
    ok: true,
    ...getSystemRestartMarkerSnapshot()
  }));

  ipcMain.handle('app:get-system-detection', async () => {
    if (!systemDetectionService?.getSnapshot) {
      return {
        ok: false,
        code: 'SYSTEM_DETECTION_NOT_READY',
        message: 'System detection service is not initialized.',
        detection: null
      };
    }

    try {
      const detection = await systemDetectionService.getSnapshot();
      return {
        ok: true,
        detection
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      systemDetectionLogger.error('Failed to resolve system detection snapshot.', ipcError);
      return {
        ok: false,
        ...ipcError,
        detection: null
      };
    }
  });

  ipcMain.handle('app:open-external-url', async (_event, payload = {}) => {
    const targetUrl = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!targetUrl) {
      return {
        ok: false,
        code: 'INVALID_URL',
        message: 'A valid URL is required.'
      };
    }

    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'https:') {
        return {
          ok: false,
          code: 'INVALID_URL_PROTOCOL',
          message: 'Only HTTPS URLs are allowed.'
        };
      }
      if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        return {
          ok: false,
          code: 'INVALID_URL_AUTHORITY',
          message: 'The external URL authority is not allowed.'
        };
      }
      const hostname = parsed.hostname.toLowerCase();
      const allowedHosts = [
        'nova-tweaks.com',
        'stripe.com',
        'buymeacoffee.com',
        'discord.gg',
        'github.com',
        'wikipedia.org',
        'tomshardware.com',
        'nvidia.com',
        'amd.com',
        'intel.com'
      ];
      if (!allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))) {
        return {
          ok: false,
          code: 'EXTERNAL_URL_NOT_ALLOWED',
          message: 'This external destination is not allowed.'
        };
      }

      await shell.openExternal(parsed.toString());
      return {
        ok: true
      };
    } catch (_error) {
      return {
        ok: false,
        code: 'INVALID_URL',
        message: 'A valid URL is required.'
      };
    }
  });

  ipcMain.handle('app:open-mail-url', async (_event, payload = {}) => {
    const targetUrl = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (
      !targetUrl ||
      targetUrl.length > 2000 ||
      /[\r\n\0]/.test(targetUrl)
    ) {
      return {
        ok: false,
        code: 'INVALID_MAIL_URL',
        message: 'A valid mailto URL is required.'
      };
    }

    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'mailto:') {
        return {
          ok: false,
          code: 'INVALID_MAIL_URL',
          message: 'A valid mailto URL is required.'
        };
      }
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: 'OPEN_MAIL_FAILED',
        message: error?.message || 'Unable to open email client.'
      };
    }
  });

  ipcMain.handle('app:open-path', async (_event, payload = {}) => {
    const targetPath = typeof payload === 'string'
      ? payload.trim()
      : typeof payload?.path === 'string'
        ? payload.path.trim()
        : '';

    if (!targetPath) {
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: 'A valid path is required.'
      };
    }

    try {
      const resolvedPath = path.resolve(targetPath);
      if (!fs.existsSync(resolvedPath)) {
        return {
          ok: false,
          code: 'PATH_NOT_FOUND',
          message: 'The requested path does not exist.'
        };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isFile()) {
        shell.showItemInFolder(resolvedPath);
      } else {
        await shell.openPath(resolvedPath);
      }

      return {
        ok: true
      };
    } catch (error) {
      return {
        ok: false,
        code: 'OPEN_PATH_FAILED',
        message: error?.message || 'Unable to open the requested path.'
      };
    }
  });

  ipcMain.handle('app:open-third-party-licenses', async () => {
    const noticesPath = resolveThirdPartyNoticesPath({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath
    });

    if (!fs.existsSync(noticesPath) || !fs.statSync(noticesPath).isFile()) {
      return {
        ok: false,
        code: 'THIRD_PARTY_NOTICES_NOT_FOUND',
        message: 'The local third-party notices file is unavailable.'
      };
    }

    try {
      const openError = await shell.openPath(noticesPath);
      if (openError) {
        return {
          ok: false,
          code: 'OPEN_THIRD_PARTY_NOTICES_FAILED',
          message: openError
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: 'OPEN_THIRD_PARTY_NOTICES_FAILED',
        message: error?.message || 'Unable to open the local third-party notices file.'
      };
    }
  });

  ipcMain.handle('settings:get', async () => ({
    ok: true,
    settings: settingsService.getSettings(),
    defaults: settingsService.getDefaults(),
    settingsPath: settingsService.getSettingsPath(),
    warning: settingsService.getLastLoadWarning()
  }));

  ipcMain.handle('settings:update', async (_event, payload = {}) => {
    try {
      const settings = settingsService.updateSettings(payload);
      applySettingsRuntimeEffects(settings);
      return { ok: true, settings };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to update settings.', ipcError);
      return { ok: false, ...ipcError, settings: settingsService.getSettings() };
    }
  });

  ipcMain.handle('settings:reset', async () => {
    try {
      const settings = settingsService.resetSettings();
      applySettingsRuntimeEffects(settings);
      return { ok: true, settings };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to reset settings.', ipcError);
      return { ok: false, ...ipcError, settings: settingsService.getSettings() };
    }
  });

  ipcMain.handle('settings:choose-backup-location', async () => {
    try {
      const currentPath = settingsService.getSettings()?.backupData?.backupLocation || app.getPath('documents');
      const result = await dialog.showOpenDialog({
        title: 'Choose Backup Location',
        defaultPath: currentPath,
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: true, canceled: true, settings: settingsService.getSettings() };
      }

      const settings = settingsService.updateSettings({
        backupData: { backupLocation: result.filePaths[0] }
      });
      applySettingsRuntimeEffects(settings);
      return { ok: true, canceled: false, settings };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to choose backup location.', ipcError);
      return { ok: false, ...ipcError, canceled: false, settings: settingsService.getSettings() };
    }
  });

  ipcMain.handle('profile:choose-image', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Choose Profile Image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: true, canceled: true, avatarDataUrl: '' };
      }

      const filePath = result.filePaths[0];
      const stat = fs.statSync(filePath);
      if (stat.size > PROFILE_IMAGE_SOURCE_MAX_BYTES) {
        return {
          ok: false,
          code: 'PROFILE_IMAGE_TOO_LARGE',
          message: 'Profile image must be smaller than 6 MB.',
          avatarDataUrl: ''
        };
      }

      const buffer = resizeProfileImage(filePath);
      if (!buffer) {
        return {
          ok: false,
          code: 'PROFILE_IMAGE_INVALID',
          message: 'Profile image could not be read.',
          avatarDataUrl: ''
        };
      }

      if (buffer.length > PROFILE_IMAGE_UPLOAD_MAX_BYTES) {
        return {
          ok: false,
          code: 'PROFILE_IMAGE_TOO_LARGE',
          message: 'Profile image is too large after resizing. Please choose a smaller image.',
          avatarDataUrl: ''
        };
      }

      const data = buffer.toString('base64');
      return {
        ok: true,
        canceled: false,
        avatarDataUrl: `data:image/jpeg;base64,${data}`
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      return { ok: false, ...ipcError, avatarDataUrl: '' };
    }
  });

  ipcMain.handle('settings:export', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Settings',
        defaultPath: path.join(app.getPath('documents'), 'nova-tweaks-settings.json'),
        showOverwriteConfirmation: true,
        filters: [{ name: 'Nova Tweaks Settings JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true, filePath: '' };
      }

      writePrivateExportFile(
        result.filePath,
        JSON.stringify(settingsService.createExportDocument(), null, 2)
      );
      return { ok: true, canceled: false, filePath: result.filePath };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to export settings.', ipcError);
      return { ok: false, ...ipcError, canceled: false, filePath: '' };
    }
  });

  ipcMain.handle('settings:import', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Settings',
        properties: ['openFile'],
        filters: [{ name: 'Nova Tweaks Settings JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: true, canceled: true, settings: settingsService.getSettings() };
      }

      const document = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const importedSettings = settingsService.validateImportDocument(document);
      const settings = settingsService.saveSettings(importedSettings);
      applySettingsRuntimeEffects(settings);
      return { ok: true, canceled: false, settings, filePath: result.filePaths[0] };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to import settings.', ipcError);
      return { ok: false, ...ipcError, canceled: false, settings: settingsService.getSettings() };
    }
  });

  ipcMain.handle('settings:metadata', async () => ({
    ok: true,
    metadata: {
      appName: app.getName(),
      appVersion: app.getVersion(),
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      logsPath: app.getPath('logs'),
      settingsPath: settingsService.getSettingsPath(),
      backupPath: backupManager?.getStoragePaths?.().backupsRoot || getBackupRootFromSettings()
    }
  }));

  ipcMain.handle('settings:open-logs-folder', async () => {
    try {
      const logsPath = app.getPath('logs');
      fs.mkdirSync(logsPath, { recursive: true });
      const openError = await shell.openPath(logsPath);
      if (openError) {
        return { ok: false, code: 'OPEN_LOGS_FOLDER_FAILED', message: openError, path: logsPath };
      }
      return { ok: true, path: logsPath };
    } catch (error) {
      const ipcError = toIpcError(error);
      return { ok: false, ...ipcError, path: '' };
    }
  });

  ipcMain.handle('settings:clear-cache', async () => {
    try {
      const result = clearSafeCacheTargets();
      if (result.removedTargets === 0) {
        return {
          ok: false,
          code: 'NO_SAFE_CACHE_FOUND',
          message: 'No safe local cache folder is available to clear.',
          ...result
        };
      }
      return { ok: true, ...result };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to clear app cache.', ipcError);
      return { ok: false, ...ipcError, removedTargets: 0, removedBytes: 0 };
    }
  });

  ipcMain.handle('settings:export-diagnostics', async () => {
    try {
      const backupPaths = backupManager?.getStoragePaths?.() || {};
      const diagnosticReport = {
        schema: 'nova-tweaks-diagnostic-report',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        app: { name: app.getName(), version: app.getVersion() },
        system: {
          platform: process.platform,
          release: os.release(),
          arch: process.arch,
          uptimeSeconds: Math.max(0, Math.floor(os.uptime()))
        },
        paths: {
          logsPath: app.getPath('logs'),
          settingsPath: settingsService.getSettingsPath(),
          backupPath: backupPaths.backupsRoot || getBackupRootFromSettings()
        },
        settings: settingsService.getSettings(),
        status: {
          admin: isAdminSession,
          adminBroker: adminBrokerManager?.getState?.() || null,
          updateCheckCode: latestUpdateCheck?.code || ''
        },
        recentLogs: safeReadRecentLogLines()
      };

      const result = await dialog.showSaveDialog({
        title: 'Export Diagnostic Report',
        defaultPath: path.join(app.getPath('documents'), 'nova-tweaks-diagnostics.json'),
        showOverwriteConfirmation: true,
        filters: [{ name: 'Diagnostic JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true, filePath: '' };
      }

      writePrivateExportFile(
        result.filePath,
        JSON.stringify(redactDiagnosticValue(diagnosticReport), null, 2)
      );
      return { ok: true, canceled: false, filePath: result.filePath };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to export diagnostic report.', ipcError);
      return { ok: false, ...ipcError, canceled: false, filePath: '' };
    }
  });

  ipcMain.handle('tweak-actions:export-log-csv', async (_event, payload = {}) => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Tweak Action Log',
        defaultPath: path.join(app.getPath('documents'), 'nova-tweaks-action-log.csv'),
        showOverwriteConfirmation: true,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true, filePath: '' };
      }

      writePrivateExportFile(result.filePath, buildTweakActionLogCsv(payload?.rows));
      return { ok: true, canceled: false, filePath: result.filePath };
    } catch (error) {
      const ipcError = toIpcError(error);
      settingsLogger.error('Failed to export tweak action log.', ipcError);
      return { ok: false, ...ipcError, canceled: false, filePath: '' };
    }
  });

  registerTweakExecutionIpcHandlers({
    ipcMain,
    tweakRunner,
    logger: apiLogger,
    toIpcError,
    isAuthenticated: () => true
  });

  ipcMain.handle('api:update:check', async () => {
    latestUpdateCheck = {
      currentVersion: app.getVersion(),
      latestVersion: '',
      updateAvailable: false,
      automaticCheckDisabled: true,
      releasesUrl: RELEASES_URL
    };
    return { ok: true, update: latestUpdateCheck };
  });

  ipcMain.handle('api:update:notes', async () => {
    return {
      ok: true,
      notes: {
        title: PRODUCT_NAME,
        version: app.getVersion(),
        updatedAt: '',
        body: 'Tweaks und Skripte sind Bestandteil dieser App-Version. Neue Versionen werden bewusst nicht automatisch im Hintergrund abgefragt.',
        items: [
          'Keine Anmeldung und keine Premium-Sperren',
          'Lokaler Tweak-Katalog mit gebündelten JSON- und PowerShell-Dateien',
          'Manuelle Updates über die GitHub-Releases-Seite'
        ],
        downloadUrl: RELEASES_URL
      }
    };
  });

  ipcMain.handle('process-automation:get-state', async () => ({
    ok: Boolean(processWatcherService),
    state: processWatcherService?.getState?.() || null
  }));

  ipcMain.handle('process-automation:update-settings', async (_event, payload = {}) => {
    try {
      const settings = settingsService.updateSettings({
        automation: {
          processDetection: payload?.processDetection || payload || {}
        }
      });
      applySettingsRuntimeEffects(settings);
      return { ok: true, settings, state: processWatcherService?.getState?.() || null };
    } catch (error) {
      return { ok: false, ...toIpcError(error), state: processWatcherService?.getState?.() || null };
    }
  });

  ipcMain.handle('process-automation:dismiss-alert', async (_event, payload = {}) => (
    processWatcherService?.dismissAlert?.(String(payload?.alertId || '')) ||
    { ok: false, code: 'PROCESS_WATCHER_NOT_READY', message: 'Process detection is unavailable.' }
  ));

  ipcMain.handle('process-automation:exclude-process', async (_event, payload = {}) => {
    const alertId = String(payload?.alertId || '');
    const alert = processWatcherService?.getState?.().currentAlerts?.find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, code: 'ALERT_NOT_FOUND', message: 'Process alert was not found.' };
    const identity = String(alert.executablePath || alert.processName || '').trim().toLowerCase();
    if (!identity) return { ok: false, code: 'PROCESS_IDENTITY_MISSING', message: 'Process identity is unavailable.' };
    const current = settingsService.getSettings()?.automation?.processDetection || {};
    const excludedExecutables = Array.from(new Set([...(current.excludedExecutables || []), identity]));
    const settings = settingsService.updateSettings({
      automation: { processDetection: { excludedExecutables } }
    });
    applySettingsRuntimeEffects(settings);
    processWatcherService.dismissAlert(alertId);
    return { ok: true, settings, state: processWatcherService.getState() };
  });

  ipcMain.handle('process-automation:request-close', async (_event, payload = {}) => (
    processWatcherService?.requestClose?.(String(payload?.alertId || '')) ||
    { ok: false, code: 'PROCESS_WATCHER_NOT_READY', message: 'Process detection is unavailable.' }
  ));

  ipcMain.handle('process-automation:force-terminate', async (_event, payload = {}) => {
    if (payload?.confirmed !== true) {
      return { ok: false, code: 'CONFIRMATION_REQUIRED', message: 'Forced termination requires confirmation.' };
    }
    return processWatcherService?.forceTerminate?.(String(payload?.alertId || '')) ||
      { ok: false, code: 'PROCESS_WATCHER_NOT_READY', message: 'Process detection is unavailable.' };
  });

  ipcMain.handle('process-automation:clear-history', async () => (
    processWatcherService?.clearHistory?.() ||
    { ok: false, code: 'PROCESS_WATCHER_NOT_READY', message: 'Process detection is unavailable.' }
  ));

  ipcMain.handle('rule-automation:get-state', async () => ({
    ok: Boolean(ruleAutomationService),
    state: ruleAutomationService?.getState?.() || null
  }));

  ipcMain.handle('rule-automation:save-rule', async (_event, payload = {}) => {
    const rule = payload?.rule;
    if (!rule || typeof rule !== 'object') return { ok: false, code: 'INVALID_RULE', message: 'A valid rule is required.' };
    const current = settingsService.getSettings()?.automation?.rules || [];
    const id = String(rule.id || `rule-${Date.now()}`);
    const rules = [...current.filter((entry) => entry.id !== id), { ...rule, id, updatedAt: Date.now(), createdAt: rule.createdAt || Date.now() }];
    const settings = settingsService.updateSettings({ automation: { rules } });
    applySettingsRuntimeEffects(settings);
    return { ok: true, settings, state: ruleAutomationService.getState() };
  });

  ipcMain.handle('rule-automation:delete-rule', async (_event, payload = {}) => {
    const id = String(payload?.ruleId || '');
    const rules = (settingsService.getSettings()?.automation?.rules || []).filter((entry) => entry.id !== id);
    const settings = settingsService.updateSettings({ automation: { rules } });
    applySettingsRuntimeEffects(settings);
    return { ok: true, settings, state: ruleAutomationService.getState() };
  });

  ipcMain.handle('rule-automation:execute', async (_event, payload = {}) => {
    if (payload?.confirmed !== true) return { ok: false, code: 'CONFIRMATION_REQUIRED', message: 'Rule actions require confirmation.' };
    return ruleAutomationService?.execute?.(String(payload?.executionId || '')) ||
      { ok: false, code: 'RULE_AUTOMATION_NOT_READY', message: 'Rule automation is unavailable.' };
  });

  ipcMain.handle('rule-automation:approve-admin-pending', async () => {
    if (!ruleAutomationService) {
      return { ok: false, code: 'RULE_AUTOMATION_NOT_READY', message: 'Rule automation is unavailable.' };
    }
    const waiting = (ruleAutomationService.getState()?.pending || []).filter((entry) => (
      entry?.blockedReason === 'awaitingAdmin'
    ));
    if (!waiting.length) {
      return { ok: true, state: ruleAutomationService.getState() };
    }
    try {
      if (!isAdminSession) {
        await adminBrokerManager.ensureReady({ reason: 'automatic-rules' });
      }
      ruleAutomationService.resumePendingAutomaticActions({ adminApproved: true });
      return { ok: true, state: ruleAutomationService.getState(), approvedCount: waiting.length };
    } catch (error) {
      return { ok: false, ...toIpcError(error), state: ruleAutomationService.getState() };
    }
  });

  ipcMain.handle('rule-automation:complete', async (_event, payload = {}) => (
    ruleAutomationService?.complete?.(String(payload?.executionId || ''), payload?.ok === true, String(payload?.message || '')) ||
    { ok: false, code: 'RULE_AUTOMATION_NOT_READY', message: 'Rule automation is unavailable.' }
  ));

  ipcMain.handle('rule-automation:dismiss', async (_event, payload = {}) => (
    ruleAutomationService?.dismiss?.(String(payload?.executionId || '')) ||
    { ok: false, code: 'RULE_AUTOMATION_NOT_READY', message: 'Rule automation is unavailable.' }
  ));

  ipcMain.handle('rule-automation:clear-history', async () => (
    ruleAutomationService?.clearHistory?.() ||
    { ok: false, code: 'RULE_AUTOMATION_NOT_READY', message: 'Rule automation is unavailable.' }
  ));

  ipcMain.handle('scheduled-maintenance:get-state', async () => ({
    ok: Boolean(scheduledMaintenanceService),
    state: scheduledMaintenanceService?.getState?.() || null
  }));

  ipcMain.handle('scheduled-maintenance:update', async (_event, payload = {}) => (
    scheduledMaintenanceService?.updateSchedule?.(payload?.schedule || payload) ||
    { ok: false, code: 'MAINTENANCE_NOT_READY', message: 'Scheduled maintenance is unavailable.' }
  ));

  ipcMain.handle('scheduled-maintenance:run-now', async () => (
    scheduledMaintenanceService?.runNow?.() ||
    { ok: false, code: 'MAINTENANCE_NOT_READY', message: 'Scheduled maintenance is unavailable.' }
  ));

  ipcMain.handle('scheduled-maintenance:clear-history', async () => (
    scheduledMaintenanceService?.clearHistory?.() ||
    { ok: false, code: 'MAINTENANCE_NOT_READY', message: 'Scheduled maintenance is unavailable.' }
  ));

  ipcMain.handle('backup:list', async () => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.listBackups())
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to list backups.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  ipcMain.handle('backup:create', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.createBackup(payload.type === 'beforeApply' && payload.engine !== 'windows' ? {
          ...payload,
          snapshot: {
            ...payload.snapshot,
            tweakStates: await captureAutomaticTweakSnapshot(
              (payload.snapshot?.tweakStates?.data || []).map((entry) => {
                const tweak = backendTweakCatalog.getConfigById(String(entry.id));
                if (!tweak || isBlockedSecurityTweakId(tweak.id)) {
                  throw new Error(`Cannot capture unavailable tweak: ${entry.id}`);
                }
                return tweak;
              }), tweakRunner, { strict: true }
            )
          }
        } : payload, {
          createWindowsProvider: String(payload?.engine || '').trim().toLowerCase() === 'windows' && !isAdminSession
            ? (name) => adminBrokerManager.execute(
                'systemRestore.create',
                { name },
                { reason: 'system-restore-point', timeoutMs: 120000 }
              )
            : null
        }))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to create backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  ipcMain.handle('backup:rename', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.renameBackup(payload))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to rename backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  ipcMain.handle('backup:delete', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.deleteBackup(payload))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to delete backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  ipcMain.handle('backup:export', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        filePath: '',
        canceled: false
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.exportBackup(payload))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to export backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        filePath: '',
        canceled: false
      };
    }
  });

  ipcMain.handle('backup:import', async () => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.importBackup())
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to import backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  ipcMain.handle('backup:restore', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        restorePlan: null
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.restoreBackup(payload, {
          restoreWindowsProvider: (sequenceNumber) => (
            isAdminSession
              ? backupManager.restoreWindowsRestorePoint(sequenceNumber)
              : adminBrokerManager.execute(
                  'systemRestore.restore',
                  { sequenceNumber },
                  { reason: 'system-restore', timeoutMs: 120000 }
                )
          )
        }))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to prepare backup restore.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        restorePlan: null
      };
    }
  });

  ipcMain.handle('backup:open-folder', async () => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {}
      };
    }

    try {
      const { backupsRoot } = backupManager.getStoragePaths();
      fs.mkdirSync(backupsRoot, { recursive: true });
      const openError = await shell.openPath(backupsRoot);
      if (openError) {
        return {
          ok: false,
          code: 'OPEN_BACKUP_FOLDER_FAILED',
          message: openError
        };
      }

      return {
        ok: true,
        path: backupsRoot
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to open backup folder.', ipcError);
      return {
        ok: false,
        ...ipcError
      };
    }
  });

  ipcMain.handle('backup:clean-old', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        deletedCount: 0,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.cleanOldBackups(payload))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to clean old backups.', ipcError);
      return {
        ok: false,
        ...ipcError,
        deletedCount: 0,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  ipcMain.handle('backup:settings:get', async () => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        settings: null
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.getBackupSettings())
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to load backup settings.', ipcError);
      return {
        ok: false,
        ...ipcError,
        settings: null
      };
    }
  });

  ipcMain.handle('backup:settings:update', async (_event, payload = {}) => {
    if (!backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        settings: null
      };
    }

    try {
      return {
        ok: true,
        ...(await backupManager.updateBackupSettings(payload))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      backupsLogger.error('Failed to update backup settings.', ipcError);
      return {
        ok: false,
        ...ipcError,
        settings: null
      };
    }
  });

  ipcMain.handle('game-detection:scan', async () => {
    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        detection: {
          games: [],
          activeGame: null,
          lastUpdatedAt: new Date().toISOString()
        }
      };
    }

    const startedAt = Date.now();
    try {
      const detection = await appsManager.scanGameDetection();
      warnIfSlow(appsLogger, 'game-detection:scan', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        detectedCount: Array.isArray(detection?.games) ? detection.games.length : 0
      });
      return {
        ok: true,
        detection
      };
    } catch (error) {
      warnIfSlow(appsLogger, 'game-detection:scan', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        failed: true
      });
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to scan running games.', ipcError);
      return {
        ok: false,
        ...ipcError,
        detection: {
          games: [],
          activeGame: null,
          lastUpdatedAt: new Date().toISOString()
        }
      };
    }
  });

  ipcMain.handle('game-detection:get-current', async () => {
    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        detection: {
          games: [],
          activeGame: null,
          lastUpdatedAt: new Date().toISOString()
        }
      };
    }

    try {
      const detection = await appsManager.getCurrentGameDetection();
      return {
        ok: true,
        detection
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to load current game detection result.', ipcError);
      return {
        ok: false,
        ...ipcError,
        detection: {
          games: [],
          activeGame: null,
          lastUpdatedAt: new Date().toISOString()
        }
      };
    }
  });

  ipcMain.handle('gamemode:active-game', async () => {
    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        game: null
      };
    }

    const startedAt = Date.now();
    try {
      const game = await appsManager.detectActiveGame();
      warnIfSlow(appsLogger, 'gamemode:active-game', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        detected: Boolean(game)
      });
      return {
        ok: true,
        game
      };
    } catch (error) {
      warnIfSlow(appsLogger, 'gamemode:active-game', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        failed: true
      });
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to detect active game.', ipcError);
      return {
        ok: false,
        ...ipcError,
        game: null
      };
    }
  });

  ipcMain.handle('gamemode:state', async () => {
    try {
      return {
        ok: true,
        state: readGameModeState()
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to load Game Mode state.', ipcError);
      return {
        ok: false,
        ...ipcError,
        state: getDefaultGameModeState()
      };
    }
  });

  ipcMain.handle('gamemode:apply-settings', async (_event, payload = {}) => {
    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const executablePath = typeof payload?.executablePath === 'string' ? payload.executablePath.trim() : '';
    if (!executablePath) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid executablePath is required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await appsManager.configureActiveGame({
        executablePath,
        processId: payload?.processId,
        disableFullscreenOptimizations: payload?.disableFullscreenOptimizations,
        preferHighPriority: payload?.preferHighPriority,
        applyFullscreenOptimizations: payload?.applyFullscreenOptimizations,
        applyPriority: payload?.applyPriority,
        applyCpuAffinity: payload?.applyCpuAffinity,
        cpuAffinityProcessors: Array.isArray(payload?.cpuAffinityProcessors) ? payload.cpuAffinityProcessors : []
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to apply game mode settings.', {
        ...ipcError,
        executablePath
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  ipcMain.handle('game-session:get-state', async () => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        state: null
      };
    }

    return {
      ok: true,
      state: gameSessionManager.getState()
    };
  });

  ipcMain.handle('game-session:subscribe', async (event) => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        state: null
      };
    }

    gameSessionSubscriberIds.add(event.sender.id);
    const state = gameSessionManager.getState();
    event.sender.send('game-session:update', state);
    return {
      ok: true,
      state
    };
  });

  ipcMain.handle('game-session:unsubscribe', async (event) => {
    gameSessionSubscriberIds.delete(event.sender.id);
    pruneGameSessionSubscribers();
    return {
      ok: true
    };
  });

  ipcMain.handle('game-session:set-auto-tracking', async (_event, payload = {}) => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        state: null
      };
    }

    gameSessionManager.setAutoTracking(Boolean(payload?.enabled));
    return {
      ok: true,
      state: gameSessionManager.getState()
    };
  });

  ipcMain.handle('game-session:start', async (_event, payload = {}) => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        session: null,
        state: null
      };
    }

    try {
      const session = await gameSessionManager.startSession({
        game: payload?.game,
        profileId: payload?.profileId,
        autoRestore: payload?.autoRestore,
        autoStarted: payload?.autoStarted
      });
      await syncMonitoringSubscriptionState();
      return {
        ok: true,
        session,
        state: gameSessionManager.getState()
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      gameSessionLogger.warn('Failed to start game session.', ipcError);
      return {
        ok: false,
        ...ipcError,
        session: null,
        state: gameSessionManager.getState()
      };
    }
  });

  ipcMain.handle('game-session:stop', async (_event, payload = {}) => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        report: null,
        state: null
      };
    }

    try {
      const report = await gameSessionManager.stopSession({
        reason: typeof payload?.reason === 'string' ? payload.reason : 'manual'
      });
      await syncMonitoringSubscriptionState();
      return {
        ok: true,
        report,
        state: gameSessionManager.getState()
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      gameSessionLogger.warn('Failed to stop game session.', ipcError);
      return {
        ok: false,
        ...ipcError,
        report: null,
        state: gameSessionManager.getState()
      };
    }
  });

  ipcMain.handle('presentmon:retry', async () => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        state: null
      };
    }

    try {
      const state = await gameSessionManager.retryCapture();
      return {
        ok: true,
        state
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      gameSessionLogger.warn('Failed to retry PresentMon monitoring.', ipcError);
      return {
        ok: false,
        ...ipcError,
        state: gameSessionManager.getState()
      };
    }
  });

  ipcMain.handle('game-session:list-reports', async () => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        reports: []
      };
    }

    try {
      return {
        ok: true,
        reports: gameSessionManager.listReports()
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      gameSessionLogger.warn('Failed to list game session reports.', ipcError);
      return {
        ok: false,
        ...ipcError,
        reports: []
      };
    }
  });

  ipcMain.handle('game-session:choose-executable', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select game executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return {
        ok: false,
        code: 'GAME_EXECUTABLE_SELECTION_CANCELLED',
        message: 'Game executable selection was cancelled.',
        details: {},
        game: null
      };
    }

    const executablePath = result.filePaths[0];
    const processName = path.basename(executablePath);
    return {
      ok: true,
      game: {
        displayName: path.basename(executablePath, path.extname(executablePath)),
        processName,
        executablePath,
        processId: 0,
        manual: true
      }
    };
  });

  ipcMain.handle('game-session:export-report', async (_event, payload = {}) => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {},
        filePath: ''
      };
    }

    const report = gameSessionManager.getReport(payload?.sessionId) || gameSessionManager.getState()?.lastReport;
    if (!report?.reportPath || !fs.existsSync(report.reportPath)) {
      return {
        ok: false,
        code: 'GAME_SESSION_REPORT_NOT_FOUND',
        message: 'Game session report was not found.',
        details: {},
        filePath: ''
      };
    }

    const safeGameName = String(report.gameName || 'game-session')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 60);
    const defaultPath = path.join(app.getPath('documents'), `${safeGameName}-${report.sessionId}.html`);
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Export game session report',
      defaultPath,
      filters: [
        { name: 'Readable HTML Report', extensions: ['html'] },
        { name: 'Raw JSON', extensions: ['json'] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return {
        ok: false,
        code: 'GAME_SESSION_EXPORT_CANCELLED',
        message: 'Game session report export was cancelled.',
        details: {},
        filePath: ''
      };
    }

    if (path.extname(saveResult.filePath).toLowerCase() === '.json') {
      fs.copyFileSync(report.reportPath, saveResult.filePath);
      restrictExportFilePermissions(saveResult.filePath);
    } else {
      writePrivateExportFile(saveResult.filePath, buildGameSessionReportHtml(report));
    }
    return {
      ok: true,
      filePath: saveResult.filePath
    };
  });

  ipcMain.handle('game-session:open-report', async (_event, payload = {}) => {
    if (!gameSessionManager) {
      return {
        ok: false,
        code: 'GAME_SESSION_NOT_READY',
        message: 'Game session manager is not initialized.',
        details: {}
      };
    }

    const report = gameSessionManager.getReport(payload?.sessionId) || gameSessionManager.getState()?.lastReport;
    if (!report?.reportPath || !fs.existsSync(report.reportPath)) {
      return {
        ok: false,
        code: 'GAME_SESSION_REPORT_NOT_FOUND',
        message: 'Game session report was not found.',
        details: {}
      };
    }

    shell.showItemInFolder(report.reportPath);
    return {
      ok: true
    };
  });

  ipcMain.handle('apps:list', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        apps: []
      };
    }

    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        apps: []
      };
    }

    const detailLevel = payload?.detailLevel === 'summary' ? 'summary' : 'full';
    const startedAt = Date.now();
    try {
      const apps = await appsManager.listInstalledApps({ detailLevel });
      warnIfSlow(appsLogger, 'apps:list', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        detailLevel,
        appCount: apps.length
      });
      return {
        ok: true,
        detailLevel,
        apps
      };
    } catch (error) {
      warnIfSlow(appsLogger, 'apps:list', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        detailLevel,
        failed: true
      });
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to list installed apps.', ipcError);
      return {
        ok: false,
        ...ipcError,
        apps: []
      };
    }
  });

  ipcMain.handle('apps:startup:list', async () => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        entries: []
      };
    }

    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        entries: []
      };
    }

    const startedAt = Date.now();
    try {
      const entries = await appsManager.listStartupApps();
      warnIfSlow(appsLogger, 'apps:startup:list', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        entryCount: entries.length
      });
      return {
        ok: true,
        entries
      };
    } catch (error) {
      warnIfSlow(appsLogger, 'apps:startup:list', startedAt, IPC_SLOW_CALL_THRESHOLD_MS, {
        failed: true
      });
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to list startup entries.', ipcError);
      return {
        ok: false,
        ...ipcError,
        entries: []
      };
    }
  });

  ipcMain.handle('apps:startup:set-enabled', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const entryId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!entryId || typeof payload?.enabled !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid startup entry id and enabled flag are required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await appsManager.setStartupEntryEnabled({
        entryId,
        enabled: payload.enabled
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      if (error?.code === 'ADMIN_REQUIRED' && !isAdminSession && error?.details?.startupScope === 'machine') {
        try {
          const result = await adminBrokerManager.execute(
            'startup.setEnabled',
            { entryId, enabled: payload.enabled, expectedScope: 'machine' },
            { reason: 'startup-entry', timeoutMs: 60000 }
          );
          return { ok: true, result };
        } catch (brokerError) {
          error = brokerError;
        }
      } else if (error?.code === 'ADMIN_REQUIRED' && !isAdminSession) {
        error.code = 'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED';
        error.message = 'This protected per-user startup entry cannot be changed through administrator credentials for another account.';
      }
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to update startup entry state.', {
        ...ipcError,
        entryId,
        enabled: payload.enabled
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  ipcMain.handle('apps:startup:set-type', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const entryId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const startupType = typeof payload?.startupType === 'string' ? payload.startupType.trim() : '';
    if (!entryId || !startupType) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid startup entry id and startupType are required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await appsManager.setStartupEntryType({
        entryId,
        startupType
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to change startup entry type.', {
        ...ipcError,
        entryId,
        startupType
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  ipcMain.handle('apps:uninstall', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const appId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!appId) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid app id is required.',
        details: {},
        result: null
      };
    }

    try {
      const installedApps = await appsManager.listInstalledApps({ detailLevel: 'summary' });
      const targetApp = installedApps.find((entry) => entry.id === appId);
      const requiresBroker = !isAdminSession && targetApp?.source === 'win32' && targetApp.installScope === 'machine';
      const result = requiresBroker
        ? await adminBrokerManager.execute('apps.uninstall', { appId, expectedScope: 'machine' }, { reason: 'app-uninstall', timeoutMs: 300000 })
        : await appsManager.uninstallApp({ appId });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to uninstall app.', {
        ...ipcError,
        appId
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  ipcMain.handle('apps:optimize', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const appId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!appId) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid app id is required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await appsManager.optimizeApp({
        appId,
        actionIds: Array.isArray(payload?.actionIds) ? payload.actionIds : null
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to optimize app.', {
        ...ipcError,
        appId
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  ipcMain.handle('apps:optimization:analyze', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    if (!appsManager) {
      return { ok: false, code: 'APPS_NOT_READY', message: 'Apps manager is not initialized.', details: {}, result: null };
    }
    const appId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!appId) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'A valid app id is required.', details: {}, result: null };
    }
    try {
      return {
        ok: true,
        result: await appsManager.analyzeAppOptimization({
          appId,
          includeCacheSize: payload?.includeCacheSize !== false
        })
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      appsLogger.error('Failed to analyze app optimization.', { ...ipcError, appId });
      return { ok: false, ...ipcError, result: null };
    }
  });

  ipcMain.handle('apps:optimization:confirm-close', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    try {
      return { ok: true, result: await appsManager.confirmAppOptimizationClose(payload) };
    } catch (error) {
      const ipcError = toIpcError(error);
      return { ok: false, ...ipcError, result: null };
    }
  });

  ipcMain.handle('apps:optimization:cancel', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    try {
      return { ok: true, result: appsManager.cancelAppOptimization(payload) };
    } catch (error) {
      const ipcError = toIpcError(error);
      return { ok: false, ...ipcError, result: null };
    }
  });

  ipcMain.handle('apps:optimization:reset', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    try {
      return { ok: true, result: await appsManager.resetAppOptimizations({ appId: payload?.id }) };
    } catch (error) {
      const ipcError = toIpcError(error);
      return { ok: false, ...ipcError, result: null };
    }
  });

  ipcMain.handle('apps:optimization:get-state', async () => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    return {
      ok: true,
      result: appsManager?.getAppOptimizationState?.() || null
    };
  });

  ipcMain.handle('metrics:get-latest', async () => {
    if (!monitoringManager) {
      return {
        ok: false,
        code: 'METRICS_NOT_READY',
        message: 'Metrics service is not initialized.',
        metrics: null
      };
    }

    return {
      ok: true,
      metrics: monitoringManager.getLatest()
    };
  });

  ipcMain.handle('metrics:subscribe', async (event) => {
    if (!monitoringManager) {
      return {
        ok: false,
        code: 'METRICS_NOT_READY',
        message: 'Metrics service is not initialized.',
        metrics: null
      };
    }

    metricsSubscriberIds.add(event.sender.id);
    const latestMetrics = monitoringManager.getLatest();
    if (latestMetrics) {
      event.sender.send('metrics:update', latestMetrics);
    }

    try {
      await syncMonitoringSubscriptionState();
      return {
        ok: true,
        metrics: latestMetrics
      };
    } catch (error) {
      metricsSubscriberIds.delete(event.sender.id);
      const ipcError = toIpcError(error);
      metricsLogger.error('Failed to subscribe to metrics updates.', ipcError);
      return {
        ok: false,
        ...ipcError,
        metrics: null
      };
    }
  });

  ipcMain.handle('metrics:unsubscribe', async (event) => {
    metricsSubscriberIds.delete(event.sender.id);
    await syncMonitoringSubscriptionState();
    return {
      ok: true
    };
  });

  ipcMain.handle('network-test:get-state', async () => ({
    ok: Boolean(extendedNetworkTestService),
    state: extendedNetworkTestService?.getState?.() || null
  }));

  ipcMain.handle('network-test:start', async () => (
    extendedNetworkTestService?.start?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  ipcMain.handle('network-test:cancel', async () => (
    extendedNetworkTestService?.cancel?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  ipcMain.handle('network-test:mtu:apply', async () => (
    extendedNetworkTestService?.applyMtu?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  ipcMain.handle('network-test:mtu:reset', async () => (
    extendedNetworkTestService?.resetMtu?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  ipcMain.handle('monitoring:getSnapshot', async () => {
    if (!monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        snapshot: null
      };
    }

    const latestMetrics = monitoringManager.getLatest();
    return {
      ok: true,
      snapshot: latestMetrics?.overview || null
    };
  });

  ipcMain.handle('monitoring:getAdvancedSensorState', async () => ({
    ok: true,
    enabled: advancedSensorMonitoringEnabled
  }));

  ipcMain.handle('monitoring:setAdvancedSensorsEnabled', async (event, payload = {}) => {
    if (!monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        enabled: advancedSensorMonitoringEnabled,
        settings: settingsService?.getSettings?.() || null
      };
    }

    const enabled = payload?.enabled === true;
    if (!enabled) {
      try {
        advancedSensorMonitoringEnabled = false;
        const shutdownResult = await monitoringManager.shutdown({
          ensureProcessStopped: true
        });
        const settings = settingsService.updateSettings({
          monitoring: {
            advancedSensorsEnabled: false
          }
        });
        return {
          ok: shutdownResult.sidecarStopped,
          code: shutdownResult.sidecarStopped ? undefined : 'LHM_PROCESS_STILL_RUNNING',
          message: shutdownResult.sidecarStopped
            ? ''
            : 'LibreHardwareMonitor is still running. Stop it in Task Manager if needed.',
          enabled: false,
          settings,
          sidecarStopped: shutdownResult.sidecarStopped
        };
      } catch (error) {
        const ipcError = toIpcError(error);
        metricsLogger.error('Failed to disable advanced sensor monitoring.', ipcError);
        return {
          ok: false,
          ...ipcError,
          enabled: false,
          settings: settingsService.getSettings()
        };
      }
    }

    metricsSubscriberIds.add(event.sender.id);
    advancedSensorMonitoringEnabled = true;
    try {
      const started = await monitoringManager.start();
      if (!started) {
        const activationError = new Error(
          monitoringManager.getLatest()?.message || 'LibreHardwareMonitor could not be started.'
        );
        activationError.code = 'ADVANCED_SENSOR_MONITORING_UNAVAILABLE';
        throw activationError;
      }
      const settings = settingsService.updateSettings({
        monitoring: {
          advancedSensorsEnabled: true
        }
      });
      return {
        ok: true,
        enabled: true,
        settings
      };
    } catch (error) {
      advancedSensorMonitoringEnabled = false;
      metricsSubscriberIds.delete(event.sender.id);
      await monitoringManager.shutdown();
      const ipcError = toIpcError(error);
      metricsLogger.error('Failed to enable advanced sensor monitoring.', ipcError);
      return {
        ok: false,
        ...ipcError,
        enabled: false,
        settings: settingsService.getSettings()
      };
    }
  });

  ipcMain.handle('monitoring:start', async (event) => {
    if (!monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        snapshot: null
      };
    }

    metricsSubscriberIds.add(event.sender.id);
    try {
      await syncMonitoringSubscriptionState();
      const latestMetrics = monitoringManager.getLatest();
      if (latestMetrics?.overview) {
        event.sender.send('monitoring:update', latestMetrics.overview);
      }
      return {
        ok: true,
        snapshot: latestMetrics?.overview || null
      };
    } catch (error) {
      metricsSubscriberIds.delete(event.sender.id);
      const ipcError = toIpcError(error);
      metricsLogger.error('Failed to start monitoring updates.', ipcError);
      return {
        ok: false,
        ...ipcError,
        snapshot: null
      };
    }
  });

  ipcMain.handle('monitoring:stop', async (event) => {
    metricsSubscriberIds.delete(event.sender.id);
    await syncMonitoringSubscriptionState();
    return {
      ok: true
    };
  });

  ipcMain.handle('monitoring:setRefreshRate', async (_event, payload = {}) => {
    if (!monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        refreshRateMs: null
      };
    }

    const refreshRateMs = monitoringManager.setRefreshRate(payload?.refreshRateMs);
    return {
      ok: true,
      refreshRateMs
    };
  });

  ipcMain.handle('scripts:list', async () => {
    try {
      return {
        ok: true,
        scripts: scriptRunner.listScripts()
          .filter((scriptName) => !isBlockedSecurityTweakScriptName(scriptName))
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error('Failed to list scripts.', ipcError);
      return {
        ok: false,
        ...ipcError,
        scripts: []
      };
    }
  });

  ipcMain.handle('scripts:run', async (_event, payload = {}) => {
    return {
      ok: false,
      code: 'DIRECT_SCRIPT_IPC_DISABLED',
      message: 'Direct script execution is disabled. Use a catalog-backed remote tweak action instead.',
      details: {},
      stdout: '',
      stderr: ''
    };
  });

  ipcMain.handle('tweaks:list', async (_event, options = {}) => {
    try {
      const catalogTweaks = backendTweakCatalog.listTweaks()
        .filter((tweak) => !isBlockedSecurityTweakId(tweak?.id));
      const includeState = options?.includeState !== false;
      const tweaks = includeState
        ? await mapWithConcurrency(catalogTweaks, 3, async (tweak) => {
            if (!requiresTweakStateCheck(tweak)) {
              return tweak;
            }
            try {
              const state = await tweakRunner.getCurrentState({ tweakId: tweak.id });
              return mergeTweakDetails(tweak, state);
            } catch (_error) {
              return tweak;
            }
          })
        : catalogTweaks;

      return {
        ok: true,
        tweaks
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error('Failed to list tweaks.', ipcError);
      return {
        ok: false,
        ...ipcError,
        tweaks: []
      };
    }
  });

  ipcMain.handle('tweaks:reload', async () => {
    try {
      backendTweakCatalog.reload();
      const catalogTweaks = backendTweakCatalog.listTweaks()
        .filter((tweak) => !isBlockedSecurityTweakId(tweak?.id));
      const tweaks = await mapWithConcurrency(catalogTweaks, 3, async (tweak) => {
        if (!requiresTweakStateCheck(tweak)) {
          return tweak;
        }
        try {
          const state = await tweakRunner.getCurrentState({ tweakId: tweak.id });
          return mergeTweakDetails(tweak, state);
        } catch (_error) {
          return tweak;
        }
      });
      return {
        ok: true,
        tweaks
      };
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error('Failed to reload tweaks.', ipcError);
      return {
        ok: false,
        ...ipcError,
        tweaks: []
      };
    }
  });

  ipcMain.handle('tweaks:execute', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        stdout: '',
        stderr: ''
      };
    }

    const tweakId = typeof payload.id === 'string' ? payload.id : '';
    const targetState = typeof payload.targetState === 'string' ? payload.targetState : 'enabled';
    const params = payload.params && typeof payload.params === 'object' ? payload.params : {};
    const timeoutMs = Number.isFinite(payload.timeoutMs) ? payload.timeoutMs : undefined;

    if (!tweakId) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Payload must include a valid tweak id.',
        details: {}
      };
    }

    try {
      return await tweakRunner.runTweak({ tweakId, targetState, params, timeoutMs });
    } catch (error) {
      const ipcError = toIpcError(error);
      return {
        ok: false,
        ...ipcError,
        stdout: error?.details?.stdout || '',
        stderr: error?.details?.stderr || ''
      };
    }
  });

  ipcMain.handle('tweaks:run-example', async () => {
    return {
      ok: false,
      code: 'DIRECT_SCRIPT_IPC_DISABLED',
      message: 'Example script execution is disabled. Use a catalog-backed remote tweak action instead.',
      details: {},
      stdout: '',
      stderr: ''
    };
  });
}

const isAdminBrokerWorkerProcess = process.argv.includes('--nova-admin-broker-worker');

if (isAdminBrokerWorkerProcess) {
  app.whenReady()
    .then(() => {
      if (process.platform === 'win32' && !checkWindowsAdmin()) {
        const error = new Error('Administrator broker worker is not elevated.');
        error.code = 'ADMIN_BROKER_NOT_ELEVATED';
        throw error;
      }
      return runAdminBrokerWorker({
        app,
        logger: adminBrokerLogger,
        ...(process.argv.includes('--broker-stdio') ? { input: process.stdin, output: process.stdout } : {})
      });
    })
    .catch((error) => {
      adminBrokerLogger.error('Administrator broker worker failed to start.', {
        code: error?.code || 'ADMIN_BROKER_WORKER_FAILED',
        message: error?.message || String(error)
      });
      app.exit(2);
    });
} else {
registerGlobalErrorHandling();

if (!initializePrivilegeState()) {
  app.quit();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      showMainWindow();
    });

  app.whenReady().then(() => {
    if (process.platform === 'win32' && process.windowsStore !== true) {
      app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
    }

    Menu.setApplicationMenu(null);

    registerLocalRendererProtocol({
      protocol,
      net,
      rootDirectory: path.join(app.getAppPath(), 'dist')
    });

    adminBrokerManager = createAdminBrokerManager({
      app,
      logger: adminBrokerLogger,
      isAdminProvider: () => isAdminSession,
      powerShellPath: TRUSTED_POWERSHELL,
      onStateChange: handleAdminBrokerStateChange
    });

    const bundledTweaksRootPath = resolveBundledTweaksRootPath();
    backendTweakCatalog = createBackendTweakCatalog({
      resourcesRootPath: bundledTweaksRootPath,
      enforceIntegrity: app.isPackaged
    });

    try {
      const integrity = backendTweakCatalog.assertIntegrity();
      backendTweakCatalog.reload();
      logger.info('Bundled tweak integrity verified.', {
        fileCount: integrity?.fileCount || 0,
        rootHash: integrity?.rootHash || ''
      });
    } catch (error) {
      const ipcError = toIpcError(error);
      logger.error('Failed to initialize backend tweak catalog.', ipcError);
      dialog.showErrorBox('Tweak catalog error', ipcError.message);
      app.quit();
      return;
    }

    const bundledScriptsPath = path.join(bundledTweaksRootPath, 'scripts');
    const bundledScriptRunner = createScriptRunner({
      scriptsPath: bundledScriptsPath,
      logger: scriptLogger,
      env: {
        NOVA_TWEAKS_APP_PATH: app.getAppPath(),
        NOVA_TWEAKS_BACKEND_ROOT: bundledTweaksRootPath,
        NOVA_TWEAKS_RESOURCES_PATH: process.resourcesPath || ''
      }
    });
    scriptRunner = bundledScriptRunner;

    logger.info('Bundled local script runner initialized.', {
      bundledScriptsPath,
      bundledScriptCount: bundledScriptRunner.listScripts().length,
      bundledTweaksRootPath
    });

    logger.info('Local-only runtime initialized; Nova API client is disabled.');

    tweakRunner = createTweakRunner({
      remoteScriptRunner: bundledScriptRunner,
      remoteScriptsPath: bundledScriptsPath,
      logger: apiLogger,
      isAdminProvider: () => isAdminSession,
      tweakCatalog: backendTweakCatalog,
      privilegedExecutor: (operation, payload, options) => adminBrokerManager.execute(operation, payload, options),
      getAppVersion: () => app.getVersion(),
      localOnly: true,
      allowUnsignedDevelopmentArtifacts:
        !app.isPackaged &&
        String(process.env.NOVA_ALLOW_UNSIGNED_TWEAK_ARTIFACTS_FOR_DEVELOPMENT || '').trim().toLowerCase() === 'true',
      isPackaged: app.isPackaged
    });

    logger.info('Tweak runner initialized.');

    appsManager = createAppsManager({
      getFileIcon: (iconPath, options) => app.getFileIcon(iconPath, options),
      logger: appsLogger,
      onOptimizationUpdate: broadcastAppOptimizationUpdate,
      optimizationBackupRoot: path.join(app.getPath('userData'), 'app-optimization'),
      isAdminProvider: () => isAdminSession,
      privilegedExecutor: (operation, payload, options) => adminBrokerManager.execute(operation, payload, options),
      isPackaged: app.isPackaged
    });

    logger.info('Apps manager initialized.');

    settingsService = createSettingsService({
      app,
      logger: settingsLogger
    });

    logger.info('Settings service initialized.', {
      settingsPath: settingsService.getSettingsPath()
    });

    backupManager = createBackupManager({
      app,
      dialog,
      logger: backupsLogger,
      getAppVersion: () => app.getVersion(),
      getBackupRoot: getBackupRootFromSettings
    });

    logger.info('Backup manager initialized.', backupManager.getStoragePaths());
    automaticBackupTimer = setInterval(() => { void runScheduledBackup(); }, 60000);
    automaticBackupTimer.unref?.();
    void runScheduledBackup();
    applySettingsRuntimeEffects(settingsService.getSettings());

    systemDetectionService = createSystemDetectionService({
      logger: systemDetectionLogger,
      cacheTtlMs: 5 * 60 * 1000
    });

    logger.info('System detection service initialized.');

    gameSessionManager = createGameSessionManager({
      app,
      logger: gameSessionLogger,
      detectActiveGame: () => appsManager?.detectActiveGame?.(),
      onUpdate: broadcastGameSessionUpdate,
      onPresentMonEvent: broadcastPresentMonEvent,
      onRecordingStateChange: () => {
        void syncMonitoringSubscriptionState();
      }
    });

    logger.info('Game session manager initialized.');

    scheduledMaintenanceService = createScheduledMaintenanceService({
      app,
      logger: scheduledMaintenanceLogger,
      statePath: path.join(app.getPath('userData'), 'automation', 'scheduled-maintenance.json'),
      executeTask: executeScheduledMaintenanceTask,
      canRun: async ({ source, schedule }) => {
        const gameState = gameSessionManager?.getState?.();
        if (gameState?.activeGame || gameState?.sessionStatus === 'recording') {
          return { ok: false, code: 'GAME_ACTIVE', message: 'Maintenance is deferred while a game is active.' };
        }
        let requiresAdmin = false;
        try {
          requiresAdmin = await maintenanceRequiresAdmin(schedule?.tasks || []);
        } catch (error) {
          return {
            ok: false,
            code: error?.code || 'MAINTENANCE_PREFLIGHT_FAILED',
            message: error?.message || 'Maintenance preflight failed.'
          };
        }
        if (requiresAdmin) {
          const brokerReady = Boolean(isAdminSession || adminBrokerManager?.getState?.()?.ready);
          if (!brokerReady && source === 'scheduled') {
            return {
              ok: false,
              code: 'ADMIN_BROKER_APPROVAL_REQUIRED',
              message: 'Scheduled maintenance is waiting for administrator approval.'
            };
          }
          if (!brokerReady) {
            try {
              await adminBrokerManager.ensureReady({ reason: 'scheduled-maintenance' });
            } catch (error) {
              return { ok: false, code: error?.code || 'ADMIN_BROKER_CANCELLED', message: error?.message || 'Administrator approval was cancelled.' };
            }
          }
        }
        return { ok: true };
      },
      onAdminRequired: () => {
        if (!Notification.isSupported()) return;
        const notification = new Notification({
          title: 'Nova Maintenance',
          body: 'Scheduled maintenance is waiting for administrator approval.'
        });
        notification.on('click', () => {
          showMainWindow();
          void adminBrokerManager.ensureReady({ reason: 'scheduled-maintenance' })
            .then(() => scheduledMaintenanceService?.runNow?.())
            .catch(() => {});
        });
        notification.show();
      },
      onUpdate: broadcastScheduledMaintenanceUpdate
    });

    logger.info('Scheduled maintenance service initialized.');

    ruleAutomationService = createRuleAutomationService({
      app,
      logger: ruleAutomationLogger,
      getSettings: () => settingsService.getSettings(),
      closeProcess: (processInfo) => processWatcherService?.requestCloseProcess?.(processInfo) ||
        Promise.resolve({ ok: false, code: 'PROCESS_WATCHER_NOT_READY', message: 'Process service is unavailable.' }),
      executeAutomaticAction: executeAutomaticRuleAction,
      onNotify: (execution) => {
        if (mainWindow?.isVisible?.() && !mainWindow?.isMinimized?.()) return;
        if (!Notification.isSupported()) return;
        const notification = new Notification({
          title: 'Nova Automation',
          body: execution.automatic
            ? `Rule "${execution.ruleName}" ${execution.status === 'completed' ? 'executed' : 'failed'}: ${execution.message || ''}`
            : execution.action?.message || `Rule "${execution.ruleName}" was triggered.`
        });
        notification.on('click', () => showMainWindow());
        notification.show();
      },
      onAdminRequired: (execution) => {
        if (!Notification.isSupported()) return;
        const pendingCount = Math.max(1, Number(execution?.pendingAdminCount) || 1);
        const notification = new Notification({
          title: 'Nova Automation',
          body: pendingCount > 1
            ? `${pendingCount} rule actions are waiting for administrator approval.`
            : `Rule "${execution.ruleName}" is waiting for administrator approval.`
        });
        notification.on('click', () => showMainWindow());
        notification.show();
      },
      onUpdate: broadcastRuleAutomationUpdate
    });

    processWatcherService = createProcessWatcherService({
      app,
      logger: processWatcherLogger,
      isAdminProvider: () => isAdminSession,
      privilegedExecutor: (operation, payload, options) => adminBrokerManager.execute(operation, payload, options),
      getSettings: () => settingsService.getSettings(),
      getActiveGame: () => gameSessionManager?.getState?.()?.activeGame || null,
      onUpdate: broadcastProcessAutomationUpdate,
      onSnapshot: (processes) => ruleAutomationService?.handleProcessSnapshot?.(processes)
    });
    processWatcherService.applySettings();
    ruleAutomationService.resumePendingAutomaticActions();

    logger.info('Process watcher service initialized.');

    extendedNetworkTestService = createExtendedNetworkTestService({
      logger: networkTestLogger,
      onUpdate: broadcastExtendedNetworkTestUpdate,
      mtuStatePath: path.join(app.getPath('userData'), 'network', 'mtu-settings.json'),
      privilegedExecutor: isAdminSession
        ? null
        : (operation, payload, options) => adminBrokerManager.execute(operation, payload, options)
    });

    logger.info('Extended network test service initialized.');

    monitoringManager = createMonitoringManager({
      app,
      logger: metricsLogger,
      intervalMs: 2000,
      systemDetectionService,
      isAdminProvider: () => isAdminSession,
      allowDriverProvisionProvider: () => false,
      privilegedExecutor: (operation, payload, options) => adminBrokerManager.execute(operation, payload, options),
      onMetrics: (metrics) => {
        broadcastMetricsUpdate(metrics);
        gameSessionManager?.handleMetrics?.(metrics);
        ruleAutomationService?.handleMetrics?.(metrics);
      }
    });
    void syncMonitoringSubscriptionState();

    latestUpdateCheck = {
      currentVersion: app.getVersion(),
      latestVersion: '',
      updateAvailable: false,
      automaticCheckDisabled: true,
      releasesUrl: RELEASES_URL
    };

    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
  }
}

app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(automaticBackupTimer);
  adminBrokerManager?.shutdown?.();
  extendedNetworkTestService?.cancel?.();
  scheduledMaintenanceService?.destroy?.();
  processWatcherService?.stop?.();
  void gameSessionManager?.stopSession?.({ reason: 'app-quit' });
  void monitoringManager?.shutdown?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
}
