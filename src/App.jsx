import i18n from './i18n';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';
import SidebarNavigation from './components/SidebarNavigation';
import ProcessAlertCard from './components/ProcessAlertCard';
import RuleNotificationOverlay from './components/RuleNotificationOverlay';
import ToastStack from './components/ToastStack';
import ConfirmModal from './components/ConfirmModal';
import FixResultModal from './components/FixResultModal';
import OneClickOptimizationModal from './components/OneClickOptimizationModal';
import AppOptimizationModal from './components/AppOptimizationModal';
import CommandPalette from './components/CommandPalette';
import { DotsMenuIcon } from './components/AppIcons';
import { SUPPORT_URL } from './supportConfig';
import { Button, ListSkeleton, LoadingIndicator, ModalShell, PageSection, Skeleton } from './components/ui';
import { CheckCircle2, CircleX, LayoutGrid, Loader2, Minus, PackageCheck, RefreshCw, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Square, X } from 'lucide-react';
import { getOrderedSubcategories, normalizeTweakTaxonomy } from './constants/tweakTaxonomy';
import { normalizeTweakProfiles } from './constants/tweakProfiles';
import {
  getOneClickOptimizationTargets,
  partitionOneClickOptimizationTargets
} from './utils/oneClickOptimizations.mjs';
import {
  normalizeLastUpdated,
  normalizeRangeConfig,
  normalizeRecommended,
  normalizeRebootRequired,
  normalizeRequiresAdmin,
  normalizeRiskLevel,
  normalizeTweakTags
} from './utils/tweakMetadata';

function createLazyModuleLoader(importer) {
  let modulePromise = null;
  return () => {
    modulePromise ||= importer();
    return modulePromise;
  };
}

const loadDashboard = createLazyModuleLoader(() => import('./components/Dashboard'));
const loadOverviewPanel = createLazyModuleLoader(() => import('./components/OverviewPanel'));
const loadAutomationPanel = createLazyModuleLoader(() => import('./components/AutomationPanel'));
const loadTweaksPanel = createLazyModuleLoader(() => import('./components/TweaksPanel'));
const loadAppsPanel = createLazyModuleLoader(() => import('./components/AppsPanel'));
const loadGameModePanel = createLazyModuleLoader(() => import('./components/GameModePanel'));
const loadSettingsPanel = createLazyModuleLoader(() => import('./components/SettingsPanel'));
const loadBackupRestorePanel = createLazyModuleLoader(() => import('./components/BackupRestorePanel'));

const SECTION_MODULE_LOADERS = {
  dashboard: loadDashboard,
  overview: loadOverviewPanel,
  automation: loadAutomationPanel,
  tweaks: loadTweaksPanel,
  apps: loadAppsPanel,
  'session-monitoring': loadGameModePanel,
  'game-mode': loadGameModePanel,
  settings: loadSettingsPanel,
  backup: loadBackupRestorePanel
};

const IDLE_PREFETCH_SECTION_IDS = [
  'overview',
  'tweaks',
  'apps',
  'settings',
  'backup',
  'game-mode',
  'session-monitoring'
];

const Dashboard = lazy(loadDashboard);
const OverviewPanel = lazy(loadOverviewPanel);
const AutomationPanel = lazy(loadAutomationPanel);
const TweaksPanel = lazy(loadTweaksPanel);
const AppsPanel = lazy(loadAppsPanel);
const GameModePanel = lazy(loadGameModePanel);
const SettingsPanel = lazy(loadSettingsPanel);
const BackupRestorePanel = lazy(loadBackupRestorePanel);

function prefetchSectionModule(sectionId) {
  const loader = SECTION_MODULE_LOADERS[sectionId];
  return loader ? loader().catch(() => undefined) : Promise.resolve();
}

function detectInitialTheme() {
  const persistedTheme = localStorage.getItem('app-theme');
  if (persistedTheme === 'light' || persistedTheme === 'dark') {
    return persistedTheme;
  }

  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function createDefaultAppSettings() {
  return {
    preferences: {
      language: 'en',
      theme: 'dark',
      accentColor: '#EC4899',
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
      backupLocation: ''
    },
    userProfile: {
      displayName: '',
      avatarDataUrl: ''
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
    }
  };
}

function createDefaultProcessAutomationState() {
  return {
    enabled: false,
    running: false,
    lastUpdated: null,
    lastError: '',
    calculatedMemoryThresholdMB: 2048,
    settings: createDefaultAppSettings().automation.processDetection,
    currentAlerts: [],
    history: [],
    unreadCount: 0
  };
}

const TWEAK_ACTION_LOG_STORAGE_KEY = 'nova-tweaks:action-log:v1';
const REBOOT_PENDING_STORAGE_KEY = 'nova-tweaks:reboot-pending-tweaks:v1';
const SESSION_CLEANED_BYTES_STORAGE_KEY = 'nova-tweaks:session-cleaned-bytes:v1';
const REBOOT_PENDING_META_STORAGE_KEY = 'nova-tweaks:reboot-pending-tweaks-meta:v1';
const REBOOT_BOOT_TIME_TOLERANCE_MS = 5 * 1000;
const ADMIN_ACCESS_DENIED_FEEDBACK_DELAY_MS = 5 * 1000;

function waitForRendererDelay(durationMs) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(durationMs) || 0)));
}

function readStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeStoredArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  } catch (_error) {
    // Storage can be unavailable in restricted renderer contexts.
  }
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readLatestRebootActionTimestampByTweakId() {
  const timestamps = new Map();

  for (const entry of readStoredArray(TWEAK_ACTION_LOG_STORAGE_KEY)) {
    const id = String(entry?.tweakId || '').trim();
    const timestamp = Date.parse(entry?.timestamp || '');
    if (
      !id ||
      !Number.isFinite(timestamp) ||
      entry?.result !== 'success' ||
      !entry?.rebootRequired
    ) {
      continue;
    }

    timestamps.set(id, Math.max(timestamps.get(id) || 0, timestamp));
  }

  return timestamps;
}

function readStoredRebootPendingEntries() {
  const entriesById = new Map();
  const latestRebootActionTimestampByTweakId = readLatestRebootActionTimestampByTweakId();

  for (const id of readStoredArray(REBOOT_PENDING_STORAGE_KEY).map((entry) => String(entry)).filter(Boolean)) {
    entriesById.set(id, {
      id,
      markedAt: latestRebootActionTimestampByTweakId.get(id) || 0,
      bootStartedAt: 0,
      legacy: true
    });
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(REBOOT_PENDING_META_STORAGE_KEY) || '[]');
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed)
        : [];

    for (const entry of entries) {
      const id = String(entry?.id || '').trim();
      if (!id) {
        continue;
      }

      entriesById.set(id, {
        id,
        markedAt: Number.isFinite(Number(entry?.markedAt)) ? Number(entry.markedAt) : 0,
        bootStartedAt: Number.isFinite(Number(entry?.bootStartedAt)) ? Number(entry.bootStartedAt) : 0,
        legacy: false
      });
    }
  } catch (_error) {
    // Legacy storage still carries the IDs; metadata is optional.
  }

  return Array.from(entriesById.values());
}

function writeStoredRebootPendingEntries(entries) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      id: String(entry?.id || '').trim(),
      markedAt: Number.isFinite(Number(entry?.markedAt)) ? Number(entry.markedAt) : 0,
      bootStartedAt: Number.isFinite(Number(entry?.bootStartedAt)) ? Number(entry.bootStartedAt) : 0
    }))
    .filter((entry) => entry.id);

  writeStoredArray(REBOOT_PENDING_STORAGE_KEY, normalizedEntries.map((entry) => entry.id));

  try {
    if (normalizedEntries.length) {
      localStorage.setItem(REBOOT_PENDING_META_STORAGE_KEY, JSON.stringify(normalizedEntries));
    } else {
      localStorage.removeItem(REBOOT_PENDING_META_STORAGE_KEY);
    }
  } catch (_error) {
    // Storage can be unavailable in restricted renderer contexts.
  }
}

function getStoredRebootPendingIds() {
  return readStoredRebootPendingEntries().map((entry) => entry.id);
}

function hasBootCompletedRebootPendingEntry(entry, currentBootStartedAt) {
  const bootStartedAt = Number(entry?.bootStartedAt);
  if (Number.isFinite(bootStartedAt) && bootStartedAt > 0) {
    return currentBootStartedAt > bootStartedAt + REBOOT_BOOT_TIME_TOLERANCE_MS;
  }

  const markedAt = Number(entry?.markedAt);
  if (Number.isFinite(markedAt) && markedAt > 0) {
    return currentBootStartedAt > markedAt + REBOOT_BOOT_TIME_TOLERANCE_MS;
  }

  return true;
}

function normalizeFilterBooleanValue(value) {
  const normalized = String(value || 'all').trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true') return 'yes';
  if (normalized === 'no' || normalized === 'false') return 'no';
  return 'all';
}

function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchTypoTolerance(value) {
  if (value.length >= 8) return 2;
  if (value.length >= 4) return 1;
  return 0;
}

function getDamerauLevenshteinDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let index = 0; index <= left.length; index += 1) rows[index][0] = index;
  for (let index = 0; index <= right.length; index += 1) rows[0][index] = index;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      rows[leftIndex][rightIndex] = Math.min(
        rows[leftIndex - 1][rightIndex] + 1,
        rows[leftIndex][rightIndex - 1] + 1,
        rows[leftIndex - 1][rightIndex - 1] + substitutionCost
      );

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        rows[leftIndex][rightIndex] = Math.min(
          rows[leftIndex][rightIndex],
          rows[leftIndex - 2][rightIndex - 2] + 1
        );
      }
    }
  }

  return rows[left.length][right.length];
}

function matchesTweakNameQuery(tweak, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedName = normalizeSearchText(tweak?.name);
  if (normalizedName.includes(normalizedQuery)) return true;

  const nameWords = normalizedName.split(' ').filter(Boolean);
  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  return queryWords.every((queryWord) => nameWords.some((nameWord) => {
    if (nameWord.startsWith(queryWord)) return true;

    const typoTolerance = getSearchTypoTolerance(queryWord);
    return typoTolerance > 0 &&
      Math.abs(nameWord.length - queryWord.length) <= typoTolerance &&
      getDamerauLevenshteinDistance(nameWord, queryWord) <= typoTolerance;
  }));
}

function stringifyCompatibility(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyCompatibility).join(' ');
  if (typeof value === 'object') {
    return Object.values(value).map(stringifyCompatibility).join(' ');
  }
  return String(value || '');
}

function redactActionLogMessage(value) {
  return String(value || '')
    .replace(/[A-Z]:\\Users\\[^\\/\s"]+/gi, 'C:\\Users\\[redacted-user]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_+/=-]{16,}\b/g, '[redacted-token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-id]');
}

function getSystemDetectionSearchText(systemDetection) {
  return [
    systemDetection?.cpu?.name,
    systemDetection?.gpu?.primary,
    ...(Array.isArray(systemDetection?.gpu?.secondary) ? systemDetection.gpu.secondary : []),
    ...(Array.isArray(systemDetection?.gpu?.all) ? systemDetection.gpu.all : []),
    systemDetection?.ram?.label,
    systemDetection?.ram?.type,
    systemDetection?.motherboard?.name,
    navigator?.userAgent || ''
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function getTweakCompatibilityState(tweak, systemDetection) {
  const compatibility = tweak?.compatibility;
  if (!compatibility) {
    return { status: 'unknown', warning: '' };
  }

  const compatibilityText = stringifyCompatibility(compatibility).toLowerCase();
  if (!compatibilityText.trim()) {
    return { status: 'unknown', warning: '' };
  }

  const systemText = getSystemDetectionSearchText(systemDetection);
  const negativeHints = ['not compatible', 'unsupported', 'incompatible', 'not suitable', 'nicht geeignet', 'nicht kompatibel'];
  if (negativeHints.some((hint) => compatibilityText.includes(hint))) {
    return { status: 'warning', warning: compatibilityText };
  }

  const gpuText = `${systemDetection?.gpu?.primary || ''} ${(systemDetection?.gpu?.all || []).join(' ')}`.toLowerCase();
  if (compatibilityText.includes('nvidia') && !gpuText.includes('nvidia') && !gpuText.includes('geforce') && !gpuText.includes('rtx') && !gpuText.includes('gtx')) {
    return { status: 'warning', warning: i18n.t('interfaceText.nvidia_gpu_compatibility_expected_but_system_detection_did_not_fi_8d22b') };
  }
  if ((compatibilityText.includes('amd') || compatibilityText.includes('radeon')) && !gpuText.includes('amd') && !gpuText.includes('radeon')) {
    return { status: 'warning', warning: i18n.t('interfaceText.amd_radeon_gpu_compatibility_expected_but_system_detection_did_no_83137') };
  }
  if (compatibilityText.includes('intel') && !systemText.includes('intel')) {
    return { status: 'warning', warning: i18n.t('interfaceText.intel_compatibility_expected_but_system_detection_did_not_find_in_50a1d') };
  }

  const requiredTerms = Array.isArray(compatibility?.requires)
    ? compatibility.requires
    : Array.isArray(compatibility?.required)
      ? compatibility.required
      : [];
  if (requiredTerms.length) {
    const missing = requiredTerms
      .map((term) => String(term || '').trim().toLowerCase())
      .filter((term) => term && !systemText.includes(term));
    if (missing.length) {
      return { status: 'warning', warning: `Missing detected compatibility terms: ${missing.join(', ')}` };
    }
  }

  return { status: 'compatible', warning: '' };
}

function normalizeProfileSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const displayName = typeof source.displayName === 'string'
    ? source.displayName.trim().replace(/\s+/g, ' ').slice(0, 32)
    : '';
  const avatarDataUrl = typeof source.avatarDataUrl === 'string' && source.avatarDataUrl.startsWith('data:image/')
    ? source.avatarDataUrl
    : '';
  return { displayName, avatarDataUrl };
}

function normalizeUpdateNotesPayload(payload) {
  const source = payload?.notes && typeof payload.notes === 'object'
    ? payload.notes
    : payload?.update && typeof payload.update === 'object'
      ? payload.update
      : payload && typeof payload === 'object'
        ? payload
        : {};
  const rawItems = Array.isArray(source.notes)
    ? source.notes
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.changelog)
        ? source.changelog
        : [];
  const body = typeof source.body === 'string'
    ? source.body
    : typeof source.description === 'string'
      ? source.description
      : typeof source.releaseNotes === 'string'
        ? source.releaseNotes
        : '';
  return {
    title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : i18n.t('dashboard.updateNotes.title'),
    version: typeof source.version === 'string' ? source.version.trim() : typeof source.latestVersion === 'string' ? source.latestVersion.trim() : '',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt.trim() : typeof source.date === 'string' ? source.date.trim() : '',
    downloadUrl: typeof source.downloadUrl === 'string' ? source.downloadUrl.trim() : typeof source.download_url === 'string' ? source.download_url.trim() : '',
    sha256: typeof source.sha256 === 'string' ? source.sha256.trim() : typeof source.checksumSha256 === 'string' ? source.checksumSha256.trim() : '',
    minimumSupportedVersion: typeof source.minimumSupportedVersion === 'string' ? source.minimumSupportedVersion.trim() : typeof source.minimum_supported_version === 'string' ? source.minimum_supported_version.trim() : '',
    body: body.trim(),
    items: rawItems.map((item) => (typeof item === 'string' ? item.trim() : String(item?.text || item?.label || '').trim())).filter(Boolean)
  };
}

function resolveThemeMode(theme) {
  if (theme === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme === 'light' ? 'light' : 'dark';
}

const SUPPORTED_BACKUP_LANGUAGES = new Set(['en', 'de', 'fr']);
const RESTORE_TWEAK_SCOPE_IDS = new Set([
  'tweakStates',
  'powerPlans',
  'timerProfiles',
  'bootBcd',
  'registryChanges',
  'serviceTweaks'
]);
const QUICKSTART_STEP_KEYS = [
  'createBackup',
  'createRestorePoint',
  'cleanUpSystem',
  'exploreGeneralTweaks',
  'applyNovaPowerPlan',
  'reduceInputDelay'
];

function createQuickstartCompletionState() {
  return QUICKSTART_STEP_KEYS.reduce((result, key) => {
    result[key] = false;
    return result;
  }, {});
}

function GlobalOperationStatus({ execution, operation, t, suppressed = false }) {
  if (suppressed) {
    return null;
  }
  const executionActive = ['running', 'success', 'error'].includes(execution?.status);
  const operationActive = ['running', 'success', 'error'].includes(operation?.status);
  if (!executionActive && !operationActive) {
    return null;
  }

  const status = executionActive ? execution.status : operation.status;
  const label = executionActive
    ? `${execution.tweakName || i18n.t('tweaks.table.tweak')} - ${execution.mode || i18n.t('apply')}`
    : operation?.label || t('common.running', { defaultValue: 'Running' });
  const message = executionActive
    ? execution.message || (
      status === 'success'
        ? t('common.success', { defaultValue: 'Successful' })
        : status === 'error'
          ? t('errors.executionFailed', { defaultValue: 'Execution failed.' })
          : t('tweaks.running', { defaultValue: 'Executing tweak...' })
    )
    : operation?.message || (
      status === 'success'
        ? t('common.success', { defaultValue: 'Successful' })
        : status === 'error'
          ? t('errors.executionFailed', { defaultValue: 'Action failed.' })
          : t('tweaks.running', { defaultValue: 'Action is still running...' })
    );
  const toneClass = status === 'success'
    ? 'border-[color:color-mix(in_srgb,var(--success)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--success)_13%,var(--surface)_87%)] text-[var(--success)]'
    : status === 'error'
      ? 'border-[color:color-mix(in_srgb,var(--danger)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_13%,var(--surface)_87%)] text-[var(--danger)]'
      : 'border-[color:color-mix(in_srgb,var(--loading)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--loading)_10%,var(--surface)_90%)] text-[var(--loading)]';
  const Icon = status === 'success' ? CheckCircle2 : status === 'error' ? CircleX : Loader2;

  return (
    <div className={`fixed right-4 top-[3.25rem] z-[140] w-[min(92vw,390px)] animate-enter rounded-xl border px-4 py-3 shadow-[0_18px_42px_rgba(0,0,0,0.35)] backdrop-blur transition-colors duration-300 ${toneClass}`}>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/30 bg-[color:color-mix(in_srgb,currentColor_10%,transparent)] transition-colors duration-300">
          <Icon key={status} className={`h-4 w-4 transition-all duration-300 ${status === 'running' ? 'animate-spin' : 'animate-execution-icon'}`} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{label}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{message}</p>
        </div>
      </div>
    </div>
  );
}

function WindowControls() {
  return (
    <div className="app-window-controls app-region-no-drag">
      <button
        type="button"
        className="window-control-button"
        aria-label={i18n.t('interfaceText.minimize_window_72115')}
        title={i18n.t('interfaceText.minimize_1c5b7')}
        onClick={() => window.desktopApi?.minimizeWindow?.()}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="window-control-button"
        aria-label={i18n.t('interfaceText.maximize_window_23646')}
        title={i18n.t('interfaceText.maximize_35afa')}
        onClick={() => window.desktopApi?.toggleMaximizeWindow?.()}
      >
        <Square className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="window-control-button window-control-button-close"
        aria-label={i18n.t('interfaceText.close_window_e3896')}
        title={i18n.t('common.close')}
        onClick={() => window.desktopApi?.closeWindow?.()}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function AppTitleBar() {
  return (
    <div className="app-titlebar app-region-drag">
      <WindowControls />
    </div>
  );
}

function normalizeTweakState(value) {
  return value === 'enabled' ? 'enabled' : 'disabled';
}

function normalizeTweakContainerType(tweak) {
  const normalized = String(tweak?.containerType || tweak?.container_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'oneshotaction' || normalized === 'one_shot_actions') {
    return 'one_shot_action';
  }
  if (normalized === 'fixes') {
    return 'fix';
  }
  if (normalized === 'oneshotselection' || normalized === 'one_shot' || normalized === 'one_shot_selections') {
    return 'one_shot_selection';
  }
  return normalized;
}

function isStatelessExecutionTweak(tweak) {
  const containerType = normalizeTweakContainerType(tweak);
  return containerType === 'one_shot_action' || containerType === 'fix';
}

function requiresRendererTweakStateCheck(tweak) {
  const containerType = normalizeTweakContainerType(tweak);
  if (containerType === 'one_shot_action' || containerType === 'fix') {
    return false;
  }
  if (containerType === 'one_shot_selection') {
    return Boolean(tweak?.supportsStatusDetection ?? tweak?.supports_status_detection);
  }
  return true;
}

function normalizeResolutionString(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().replace(',', '.');
  return normalized || '';
}

function normalizeBackupLanguage(language) {
  const normalized = typeof language === 'string' ? language.trim().toLowerCase().split('-')[0] : '';
  return SUPPORTED_BACKUP_LANGUAGES.has(normalized) ? normalized : '';
}

function mergeRestoreEntry(existingEntry, incomingEntry) {
  if (!existingEntry) {
    return incomingEntry;
  }

  return {
    ...existingEntry,
    name: existingEntry.name || incomingEntry.name,
    category: existingEntry.category || incomingEntry.category,
    subcategory: existingEntry.subcategory || incomingEntry.subcategory,
    containerType: existingEntry.containerType || incomingEntry.containerType,
    selectedResolution: existingEntry.selectedResolution || incomingEntry.selectedResolution,
    selectedOption: existingEntry.selectedOption || incomingEntry.selectedOption,
    currentValue: Number.isFinite(existingEntry.currentValue) ? existingEntry.currentValue : incomingEntry.currentValue,
    profileLabel: existingEntry.profileLabel || incomingEntry.profileLabel,
    requiresAdmin: Boolean(existingEntry.requiresAdmin || incomingEntry.requiresAdmin),
    rebootRequired: Boolean(existingEntry.rebootRequired || incomingEntry.rebootRequired),
    sourceScopeIds: Array.from(new Set([...(existingEntry.sourceScopeIds || []), ...(incomingEntry.sourceScopeIds || [])]))
  };
}

function collectRestoreEntryMap(snapshot, scopeIds) {
  const restoreEntries = new Map();

  for (const scopeId of Array.isArray(scopeIds) ? scopeIds : []) {
    if (!RESTORE_TWEAK_SCOPE_IDS.has(scopeId)) {
      continue;
    }

    const entries = Array.isArray(snapshot?.[scopeId]?.data) ? snapshot[scopeId].data : [];
    for (const entry of entries) {
      const id = String(entry?.id || '').trim();
      if (!id) {
        continue;
      }

      const normalizedEntry = {
        id,
        name: String(entry?.name || '').trim(),
        category: String(entry?.category || '').trim(),
        subcategory: String(entry?.subcategory || '').trim(),
        containerType: String(entry?.containerType || '').trim().toLowerCase(),
        currentState: normalizeTweakState(entry?.currentState),
        selectedResolution: typeof entry?.selectedResolution === 'string' && entry.selectedResolution.trim()
          ? entry.selectedResolution.trim()
          : '',
        selectedOption: typeof entry?.selectedOption === 'string' && entry.selectedOption.trim()
          ? entry.selectedOption.trim()
          : '',
        currentValue: normalizeOptionalNumber(entry?.currentValue),
        profileLabel: String(entry?.profileLabel || '').trim(),
        requiresAdmin: Boolean(entry?.requiresAdmin),
        rebootRequired: Boolean(entry?.rebootRequired),
        sourceScopeIds: [scopeId]
      };

      restoreEntries.set(id, mergeRestoreEntry(restoreEntries.get(id), normalizedEntry));
    }
  }

  return restoreEntries;
}

function toBackupTweakEntry(tweak) {
  return {
    id: String(tweak?.id || '').trim(),
    name: String(tweak?.name || '').trim(),
    category: String(tweak?.category || '').trim(),
    subcategory: String(tweak?.subcategory || '').trim(),
    currentState: normalizeTweakState(tweak?.currentState),
    status: String(tweak?.status || '').trim() || normalizeTweakState(tweak?.currentState),
    containerType: String(tweak?.containerType || '').trim(),
    profileLabel: String(tweak?.profile?.label || '').trim(),
    selectedResolution: typeof tweak?.selectedResolution === 'string' && tweak.selectedResolution.trim()
      ? tweak.selectedResolution.trim()
      : '',
    selectedOption: typeof tweak?.selectedOption === 'string' && tweak.selectedOption.trim()
      ? tweak.selectedOption.trim()
      : '',
    currentValue: normalizeOptionalNumber(tweak?.currentValue),
    requiresAdmin: Boolean(tweak?.requiresAdmin),
    rebootRequired: Boolean(tweak?.rebootRequired)
  };
}

function normalizeTweakForUi(tweak) {
  const normalized = normalizeTweakTaxonomy(tweak);
  const tags = normalizeTweakTags(normalized);
  const riskLevel = normalizeRiskLevel(normalized);

  return {
    ...normalized,
    tags,
    premium: false,
    recommended: normalizeRecommended({ ...normalized, tags }),
    risk: riskLevel,
    riskLevel,
    risk_level: riskLevel,
    profiles: normalizeTweakProfiles(normalized.profiles),
    lastUpdated: normalizeLastUpdated(normalized),
    last_updated: normalizeLastUpdated(normalized),
    currentState: normalizeTweakState(tweak.currentState),
    status: tweak.status || normalizeTweakState(tweak.currentState)
  };
}

function mergeTweakRuntimeState(incomingTweak, previousTweak, includeState) {
  if (!previousTweak || includeState) {
    return incomingTweak;
  }

  return {
    ...incomingTweak,
    currentState: normalizeTweakState(previousTweak.currentState),
    status: previousTweak.status || normalizeTweakState(previousTweak.currentState),
    selectedOption: previousTweak.selectedOption || incomingTweak.selectedOption,
    selectedResolution: previousTweak.selectedResolution || incomingTweak.selectedResolution,
    currentResolution: previousTweak.currentResolution || incomingTweak.currentResolution,
    currentValue: normalizeOptionalNumber(previousTweak.currentValue) ?? incomingTweak.currentValue
  };
}

function createOneClickOptimizationState(overrides = {}) {
  return {
    open: false,
    optimizationId: '',
    runningId: '',
    completedId: '',
    phase: "idle",
    currentTweakName: '',
    current: 0,
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    requiresRestart: false,
    message: '',
    ...overrides
  };
}

function getTweakRateLimitDelay(result) {
  if (result?.code !== 'API_HTTP_ERROR' || Number(result?.details?.status) !== 429) {
    return 0;
  }

  const retryAfterMs = Number(result?.details?.retryAfterMs);
  return Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(retryAfterMs, 15 * 60 * 1000)
    : 60 * 1000;
}

function SectionLoadingSkeleton({ sectionId, label }) {
  return (
    <div className="section-transition-skeleton space-y-4" role="status" aria-label={label} aria-busy="true" data-section={sectionId}>
      <div className="space-y-2">
        <Skeleton className="h-7 w-44 max-w-[55%]" />
        <Skeleton className="h-4 w-80 max-w-[82%]" />
      </div>
      <PageSection className="space-y-4 p-5">
        <Skeleton className="h-4 w-32 max-w-[50%]" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </PageSection>
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const [activeSection, setActiveSection] = useState('dashboard');
  const [renderedSection, setRenderedSection] = useState('dashboard');
  const [showSectionFallback, setShowSectionFallback] = useState(false);
  const [, startSectionTransition] = useTransition();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [theme, setTheme] = useState(() => detectInitialTheme());
  const [appSettings, setAppSettings] = useState(() => createDefaultAppSettings());
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [appMetadata, setAppMetadata] = useState(null);
  const [processAutomationState, setProcessAutomationState] = useState(createDefaultProcessAutomationState);
  const [ruleAutomationState, setRuleAutomationState] = useState({ rules: [], pending: [], history: [] });
  const [processAutomationBusy, setProcessAutomationBusy] = useState(false);
  const [adminRuleApprovalBusy, setAdminRuleApprovalBusy] = useState(false);

  const [isAdmin, setIsAdmin] = useState(null);
  const [adminAccessState, setAdminAccessState] = useState(null);
  const [updateNotesModalOpen, setUpdateNotesModalOpen] = useState(false);
  const [updateNotesLoading, setUpdateNotesLoading] = useState(false);
  const [updateNotes, setUpdateNotes] = useState(null);
  const [tweaks, setTweaks] = useState([]);
  const [checkingStateTweakIds, setCheckingStateTweakIds] = useState([]);
  const [isLoadingTweaks, setIsLoadingTweaks] = useState(false);
  const [isRefreshingTweakStates, setIsRefreshingTweakStates] = useState(false);
  const [tweakReloadBlockedUntil, setTweakReloadBlockedUntil] = useState(0);
  const [tweaksError, setTweaksError] = useState('');
  const [installedApps, setInstalledApps] = useState([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [isLoadingAppDetails, setIsLoadingAppDetails] = useState(false);
  const [appsError, setAppsError] = useState('');
  const [appsSearchTerm, setAppsSearchTerm] = useState('');
  const [appsSort, setAppsSort] = useState('name-asc');
  const [appsNavigationRequest, setAppsNavigationRequest] = useState(null);
  const [startupEntries, setStartupEntries] = useState([]);
  const [isLoadingStartupEntries, setIsLoadingStartupEntries] = useState(false);
  const [startupEntriesError, setStartupEntriesError] = useState('');
  const [startupSearchTerm, setStartupSearchTerm] = useState('');
  const [startupSort, setStartupSort] = useState('name-asc');
  const [showAdditionalStartupSources, setShowAdditionalStartupSources] = useState(false);
  const [activeStartupToggleId, setActiveStartupToggleId] = useState('');
  const [activeStartupTypeChangeId, setActiveStartupTypeChangeId] = useState('');
  const [showAppxPackages, setShowAppxPackages] = useState(false);
  const [showTechnicalComponents, setShowTechnicalComponents] = useState(false);
  const [activeAppUninstallId, setActiveAppUninstallId] = useState('');
  const [activeAppOptimizeId, setActiveAppOptimizeId] = useState('');
  const [appOptimizationModal, setAppOptimizationModal] = useState({
    open: false,
    view: 'details',
    scope: 'reversible',
    app: null,
    analysis: null,
    operation: null,
    busy: false,
    error: ''
  });
  const [uninstallAppConfirm, setUninstallAppConfirm] = useState({ open: false, app: null });
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [ruleNotifications, setRuleNotifications] = useState([]);
  const [ruleNotificationStreamReady, setRuleNotificationStreamReady] = useState(false);
  const [dashboardActivity, setDashboardActivity] = useState([]);
  const didBootstrapRef = useRef(false);
  const seenRuleNotificationIdsRef = useRef(new Set());
  const ruleNotificationTimersRef = useRef(new Map());
  const stateRefreshCounterRef = useRef(0);
  const activeStateRefreshRunRef = useRef(0);
  const activeTweaksLoadRequestRef = useRef(0);
  const activeAppsLoadRequestRef = useRef(0);
  const activeTweaksRefreshPromiseRef = useRef(null);
  const tweakReloadBlockedUntilRef = useRef(0);
  const hasLoadedTweaksRef = useRef(false);
  const hasLoadedTweakStatesRef = useRef(false);
  const hasLoadedAppsRef = useRef(false);
  const hasLoadedStartupEntriesRef = useRef(false);
  const finalizedAppOptimizationIdsRef = useRef(new Set());
  const dismissedAppOptimizationIdsRef = useRef(new Set());

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSubcategory, setSelectedSubcategory] = useState('all');
  const [recommendedFilter, setRecommendedFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [requiresAdminFilter, setRequiresAdminFilter] = useState('all');
  const [rebootRequiredFilter, setRebootRequiredFilter] = useState('all');
  const [compatibilityFilter, setCompatibilityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [systemDetection, setSystemDetection] = useState(null);
  const [tweakActionLogs, setTweakActionLogs] = useState(() => readStoredArray(TWEAK_ACTION_LOG_STORAGE_KEY));
  const [rebootPendingTweakIds, setRebootPendingTweakIds] = useState(() => getStoredRebootPendingIds());
  const [globalOperation, setGlobalOperation] = useState({ id: '', label: '', message: '', status: 'idle', startedAt: null, endedAt: null });
  const [oneClickOptimization, setOneClickOptimization] = useState(createOneClickOptimizationState);

  const [execution, setExecution] = useState({
    open: false,
    status: 'idle',
    tweakName: '',
    tweakId: '',
    mode: i18n.t('apply'),
    progress: 0,
    stdout: '',
    stderr: '',
    code: '',
    message: '',
    startedAt: null,
    endedAt: null
  });
  const [fixResultModal, setFixResultModal] = useState({
    open: false,
    payload: null
  });
  const confirmationResolverRef = useRef(null);
  const [settingsConfirm, setSettingsConfirm] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: i18n.t('common.continue'),
    tone: 'warning'
  });
  const [quickstartCompletion, setQuickstartCompletion] = useState(() => createQuickstartCompletionState());
  const [backupQuickstartNavigationRequest, setBackupQuickstartNavigationRequest] = useState(null);
  const sectionIsChanging = renderedSection !== activeSection;
  const pendingAdminRuleActions = useMemo(() => {
    const seen = new Set();
    return (ruleAutomationState.pending || [])
      .filter((entry) => {
        const id = String(entry?.id || '');
        if (!id || entry?.blockedReason !== 'awaitingAdmin' || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((left, right) => Number(left?.createdAt || 0) - Number(right?.createdAt || 0));
  }, [ruleAutomationState.pending]);
  const highlightedPendingRuleAction = pendingAdminRuleActions[0] || ruleAutomationState.pending?.find((entry) => (
    !isAdmin || !['runTweak', 'runOptimization'].includes(entry.action?.type)
  )) || null;
  const automaticOptimizationIds = useRef(new Set());
  const [automaticOptimizationBusy, setAutomaticOptimizationBusy] = useState(false);
  const ruleAutomationDisplayState = useMemo(() => ({
    ...ruleAutomationState,
    pending: (ruleAutomationState.pending || []).filter((entry) => (
      entry.blockedReason === 'awaitingAdmin' || !isAdmin || !['runTweak', 'runOptimization'].includes(entry.action?.type)
    ))
  }), [ruleAutomationState, isAdmin]);

  useEffect(() => {
    if (!isAdmin || !tweaks.length || oneClickOptimization.runningId || automaticOptimizationBusy) return;
    const execution = ruleAutomationState.pending?.find((entry) => (
      entry.action?.type === 'runOptimization' && !automaticOptimizationIds.current.has(entry.id)
    ));
    if (!execution) return;
    automaticOptimizationIds.current.add(execution.id);
    setAutomaticOptimizationBusy(true);
    void executeAutomationRuleAction(execution, { skipConfirmation: true })
      .catch((error) => pushToast(error?.message || t('automation.actionFailed'), "error"))
      .finally(() => setAutomaticOptimizationBusy(false));
  }, [isAdmin, tweaks.length, ruleAutomationState.pending, oneClickOptimization.runningId, automaticOptimizationBusy]);

  useEffect(() => {
    if (!window.desktopApi?.onAdminAccessStateChanged) return undefined;
    return window.desktopApi.onAdminAccessStateChanged((state) => {
      setAdminAccessState(state || null);
      setIsAdmin(Boolean(state?.ready || state?.alreadyElevated));
    });
  }, []);

  useEffect(() => {
    if (adminRuleApprovalBusy && pendingAdminRuleActions.length === 0) {
      setAdminRuleApprovalBusy(false);
    }
  }, [adminRuleApprovalBusy, pendingAdminRuleActions.length]);

  useEffect(() => {
    if (!sectionIsChanging) {
      setShowSectionFallback(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSectionFallback(true);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [activeSection, sectionIsChanging]);

  useEffect(() => {
    if (isBootstrapLoading) {
      return undefined;
    }

    const pendingSections = IDLE_PREFETCH_SECTION_IDS.filter((sectionId) => sectionId !== activeSection);
    let cancelled = false;
    let idleCallbackId = null;
    let timeoutId = null;
    let nextIndex = 0;

    function scheduleNextPrefetch() {
      if (cancelled || nextIndex >= pendingSections.length) {
        return;
      }

      const run = () => {
        if (cancelled) return;
        const sectionId = pendingSections[nextIndex];
        nextIndex += 1;
        void prefetchSectionModule(sectionId).finally(scheduleNextPrefetch);
      };

      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(run, { timeout: 2000 });
      } else {
        timeoutId = window.setTimeout(run, 350);
      }
    }

    scheduleNextPrefetch();
    return () => {
      cancelled = true;
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
    // Prefetch once after bootstrap; the memoized loaders make later hover prefetches free.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBootstrapLoading]);

  useEffect(() => {
    function handleCommandPaletteShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', handleCommandPaletteShortcut);
    return () => window.removeEventListener('keydown', handleCommandPaletteShortcut);
  }, []);

  useEffect(() => {
    if (!ruleNotificationStreamReady) return;
    const ruleEvents = ruleAutomationState.history || [];
    ruleEvents.forEach((entry) => {
      if (entry.action?.type === 'notify') {
        if (seenRuleNotificationIdsRef.current.has(entry.id)) return;
        seenRuleNotificationIdsRef.current.add(entry.id);
        showRuleNotification(entry);
        return;
      }
      if (entry.automatic === true && entry.action?.type === 'runTweak') {
        if (seenRuleNotificationIdsRef.current.has(entry.id)) return;
        seenRuleNotificationIdsRef.current.add(entry.id);
        if (entry.tweakState?.tweakId) {
          const stateUpdate = entry.tweakState;
          const selectedResolution = normalizeResolutionString(stateUpdate.selectedResolution);
          const currentResolution = normalizeResolutionString(stateUpdate.currentResolution) || selectedResolution;
          const selectedOption = String(stateUpdate.selectedOption || '').trim();
          const currentValue = normalizeOptionalNumber(stateUpdate.currentValue);
          const hasSelectedResolution = Object.prototype.hasOwnProperty.call(stateUpdate, 'selectedResolution');
          const hasCurrentResolution = Object.prototype.hasOwnProperty.call(stateUpdate, 'currentResolution');
          setTweaks((previous) => previous.map((tweak) => {
            if (String(tweak.id) !== String(stateUpdate.tweakId)) return tweak;
            const currentState = normalizeTweakState(stateUpdate.currentState);
            return {
              ...tweak,
              currentState,
              status: stateUpdate.status || currentState,
              ...(hasSelectedResolution ? { selectedResolution } : {}),
              ...(hasCurrentResolution ? { currentResolution } : {}),
              ...(selectedOption ? { selectedOption } : {}),
              ...(currentValue !== null ? { currentValue } : {})
            };
          }));
        }
        const tweakName = tweaks.find((tweak) => String(tweak.id) === String(entry.action?.tweakId))?.name ||
          entry.action?.tweakId ||
          t('ruleAutomation.actions.runTweak');
        pushToast(
          entry.status === 'completed'
            ? t('toasts.tweakEnabled', { name: tweakName })
            : entry.message || t('toasts.tweakFailed', { name: tweakName }),
          entry.status === 'completed' ? "success" : "error"
        );
      }
    });
  }, [ruleAutomationState.history, ruleNotificationStreamReady, t, tweaks]);

  useEffect(() => () => {
    ruleNotificationTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    ruleNotificationTimersRef.current.clear();
  }, []);

  useEffect(() => {
    let mounted = true;
    let initialStateCaptured = false;
    const acceptState = (state) => {
      if (!mounted || !state) return;
      if (!initialStateCaptured) {
        (state.history || []).forEach((entry) => {
          if (entry.action?.type === 'notify' || entry.automatic === true) {
            seenRuleNotificationIdsRef.current.add(entry.id);
          }
        });
        initialStateCaptured = true;
        setRuleNotificationStreamReady(true);
      }
      setRuleAutomationState(state);
    };
    void window.desktopApi?.getRuleAutomationState?.().then((result) => {
      if (result?.state) acceptState(result.state);
    }).catch(() => {});
    const unsubscribe = window.desktopApi?.onRuleAutomationUpdate?.((state) => {
      acceptState(state);
    });
    return () => { mounted = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const handleUpdate = (operation) => {
      if (!mounted || !operation) return;
      setActiveAppOptimizeId(['success', 'partial', 'error', 'cancelled'].includes(operation.status) ? '' : operation.appId || '');
      setAppOptimizationModal((previous) => ({
        ...previous,
        open: !dismissedAppOptimizationIdsRef.current.has(operation.operationId),
        view: 'progress',
        app: previous.app || installedApps.find((entry) => entry.id === operation.appId) || null,
        operation,
        busy: false,
        error: ''
      }));

      if (['success', 'partial', 'error'].includes(operation.status) && !finalizedAppOptimizationIdsRef.current.has(operation.operationId)) {
        finalizedAppOptimizationIdsRef.current.add(operation.operationId);
        const removedBytes = Number(operation.removedBytes) || 0;
        if (removedBytes > 0) {
          const previousCleanedBytes = Number(sessionStorage.getItem(SESSION_CLEANED_BYTES_STORAGE_KEY)) || 0;
          const cleanedBytes = previousCleanedBytes + removedBytes;
          sessionStorage.setItem(SESSION_CLEANED_BYTES_STORAGE_KEY, String(cleanedBytes));
          window.dispatchEvent(new CustomEvent('nova:session-cleaned-bytes', { detail: { cleanedBytes } }));
        }
      }
    };

    void window.desktopApi?.getAppOptimizationState?.()
      .then((result) => {
        if (mounted && result?.ok && result?.result && !['success', 'partial', 'error', 'cancelled'].includes(result.result.status)) {
          handleUpdate(result.result);
        }
      })
      .catch(() => {});
    const unsubscribe = window.desktopApi?.onAppOptimizationUpdate?.(handleUpdate);
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [installedApps]);

  useEffect(() => {
    let mounted = true;
    if (!window.desktopApi?.getProcessAutomationState) return undefined;

    void window.desktopApi.getProcessAutomationState()
      .then((result) => {
        if (mounted && result?.state) setProcessAutomationState(result.state);
      })
      .catch(() => {});

    const unsubscribe = window.desktopApi.onProcessAutomationUpdate?.((state) => {
      if (mounted && state) setProcessAutomationState(state);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const remainingMs = tweakReloadBlockedUntil - Date.now();
    if (remainingMs <= 0) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      tweakReloadBlockedUntilRef.current = 0;
      setTweakReloadBlockedUntil(0);
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [tweakReloadBlockedUntil]);

  async function getCurrentBootMarker() {
    const markedAt = Date.now();
    if (!window.desktopApi?.getSystemUptime) {
      return { markedAt, bootStartedAt: 0 };
    }

    try {
      const result = await window.desktopApi.getSystemUptime();
      const uptimeSeconds = Number(result?.uptimeSeconds);
      if (!result?.ok || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
        return { markedAt, bootStartedAt: 0 };
      }

      const restartMarkerAt = Number(result?.restartMarkerAt);

      return {
        markedAt,
        bootStartedAt: Number.isFinite(restartMarkerAt) && restartMarkerAt > 0
          ? restartMarkerAt
          : Math.max(0, markedAt - Math.floor(uptimeSeconds * 1000))
      };
    } catch (_error) {
      return { markedAt, bootStartedAt: 0 };
    }
  }

  useEffect(() => {
    let mounted = true;

    async function reconcileRebootPendingTweaks() {
      const entries = readStoredRebootPendingEntries();
      if (!entries.length || !window.desktopApi?.getSystemUptime) {
        return;
      }

      const marker = await getCurrentBootMarker();
      if (!mounted || !marker.bootStartedAt) {
        return;
      }

      const nextEntries = entries.filter((entry) => !hasBootCompletedRebootPendingEntry(entry, marker.bootStartedAt));
      if (nextEntries.length === entries.length) {
        return;
      }

      const nextIds = nextEntries.map((entry) => entry.id);
      const removedIds = new Set(
        entries
          .filter((entry) => !nextIds.includes(entry.id))
          .map((entry) => entry.id)
      );

      writeStoredRebootPendingEntries(nextEntries);
      setRebootPendingTweakIds(nextIds);
      setTweaks((previous) =>
        previous.map((item) =>
          removedIds.has(String(item.id))
            ? {
                ...item,
                rebootPending: false
              }
            : item
        )
      );

      if (hasLoadedTweaksRef.current) {
        void loadTweaks({ notify: false, includeState: true, background: true });
      }
    }

    void reconcileRebootPendingTweaks();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!window.desktopApi?.getSystemDetection) {
      return () => {
        mounted = false;
      };
    }

    window.desktopApi.getSystemDetection()
      .then((result) => {
        if (mounted && result?.ok) {
          setSystemDetection(result.detection || null);
        }
      })
      .catch(() => {
        if (mounted) {
          setSystemDetection(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  function dismissToast(toastId) {
    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
  }

  function pushToast(message, tone = 'info') {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((previous) => [...previous, { id, message, tone }]);
    window.setTimeout(() => {
      dismissToast(id);
    }, 3600);
  }

  function dismissRuleNotification(notificationId) {
    const timerId = ruleNotificationTimersRef.current.get(notificationId);
    if (timerId) {
      window.clearTimeout(timerId);
      ruleNotificationTimersRef.current.delete(notificationId);
    }
    setRuleNotifications((previous) => previous.filter((notification) => notification.id !== notificationId));
  }

  function showRuleNotification(entry) {
    const id = String(entry?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const notification = {
      id,
      ruleName: String(entry?.ruleName || t('ruleAutomation.title')),
      message: String(
        entry?.action?.message ||
        t('ruleAutomation.notificationTriggered', { rule: entry?.ruleName || t('ruleAutomation.title') })
      )
    };
    setRuleNotifications((previous) => [
      ...previous.filter((item) => item.id !== id),
      notification
    ].slice(-3));
    const existingTimer = ruleNotificationTimersRef.current.get(id);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    ruleNotificationTimersRef.current.set(id, window.setTimeout(() => {
      ruleNotificationTimersRef.current.delete(id);
      setRuleNotifications((previous) => previous.filter((item) => item.id !== id));
    }, 15000));
  }

  function startGlobalOperation(id, label, message = t('tweaks.running', { defaultValue: 'Action is still running...' })) {
    const operationId = String(id || `operation:${Date.now()}`);
    setGlobalOperation({
      id: operationId,
      label,
      message,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null
    });
    return operationId;
  }

  function finishGlobalOperation(id, status, message) {
    const operationId = String(id || '');
    const nextStatus = status === 'error' ? "error" : "success";
    setGlobalOperation((previous) => {
      if (operationId && previous.id !== operationId) {
        return previous;
      }

      return {
        ...previous,
        status: nextStatus,
        message: message || (nextStatus === 'success'
          ? t('common.success', { defaultValue: 'Successful' })
          : t('errors.executionFailed', { defaultValue: 'Action failed.' })),
        endedAt: Date.now()
      };
    });
  }

  function updateGlobalOperationStatus(payload = {}) {
    const id = String(payload.id || `operation:${Date.now()}`);
    if (payload.status === 'running') {
      startGlobalOperation(id, payload.label || t('common.running', { defaultValue: 'Running' }), payload.message);
      return;
    }
    if (payload.status === 'success' || payload.status === 'error') {
      finishGlobalOperation(id, payload.status, payload.message);
      return;
    }
    if (payload.status === 'idle') {
      setGlobalOperation((previous) =>
        previous.id === id
          ? { id: '', label: '', message: '', status: 'idle', startedAt: null, endedAt: null }
          : previous
      );
    }
  }

  useEffect(() => {
    if (execution.status !== 'success' && execution.status !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setExecution((previous) =>
        previous.startedAt === execution.startedAt && previous.status === execution.status
          ? { ...previous, status: 'idle' }
          : previous
      );
    }, execution.status === 'error' ? 6200 : 4200);

    return () => window.clearTimeout(timeoutId);
  }, [execution.startedAt, execution.status]);

  useEffect(() => {
    if (globalOperation.status !== 'success' && globalOperation.status !== 'error') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setGlobalOperation((previous) =>
        previous.id === globalOperation.id && previous.status === globalOperation.status
          ? { id: '', label: '', message: '', status: 'idle', startedAt: null, endedAt: null }
          : previous
      );
    }, globalOperation.status === 'error' ? 6200 : 4200);

    return () => window.clearTimeout(timeoutId);
  }, [globalOperation.id, globalOperation.status]);

  function recordDashboardActivity(label, tone = 'accent') {
    const text = String(label || '').trim();
    if (!text) {
      return;
    }

    const color =
      tone === 'success'
        ? 'var(--success)'
        : tone === 'warning'
          ? 'var(--warning)'
          : tone === 'danger'
            ? 'var(--danger)'
            : 'var(--accent)';

    setDashboardActivity((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: text,
        timestamp: Date.now(),
        color
      },
      ...previous
    ].slice(0, 5));
  }

  function setQuickstartStepCompleted(stepKey, completed = true) {
    if (!QUICKSTART_STEP_KEYS.includes(stepKey)) {
      return;
    }

    setQuickstartCompletion((previous) => {
      if (previous[stepKey] === completed) {
        return previous;
      }

      return {
        ...previous,
        [stepKey]: completed
      };
    });
  }

  function resetTweakBrowserFilters() {
    setSearchTerm('');
    setRecommendedFilter('all');
    setRiskFilter('all');
    setTagFilter('all');
    setRequiresAdminFilter('all');
    setRebootRequiredFilter('all');
    setCompatibilityFilter('all');
    setStatusFilter('all');
  }

  function getFirstTweakTargetByContainerType(containerType, fallbackTarget) {
    const normalizedContainerType = String(containerType || '').trim().toLowerCase();
    const matchingTweak = tweaks.find((tweak) => String(tweak?.containerType || '').trim().toLowerCase() === normalizedContainerType);
    return {
      category: matchingTweak?.category || fallbackTarget?.category || 'all',
      subcategory: matchingTweak?.subcategory || fallbackTarget?.subcategory || 'all'
    };
  }

  function navigateToTweakTarget(category, subcategory) {
    resetTweakBrowserFilters();
    setSelectedCategory(category || 'all');
    setSelectedSubcategory(subcategory || 'all');
    commitSectionNavigation('tweaks');
  }

  function handleQuickstartNavigate(stepKey) {
    if (stepKey === 'createBackup') {
      setBackupQuickstartNavigationRequest({
        id: `${Date.now()}-backup`,
        target: 'createBackup'
      });
      commitSectionNavigation('backup');
      return;
    }

    if (stepKey === 'createRestorePoint') {
      setBackupQuickstartNavigationRequest({
        id: `${Date.now()}-restore`,
        target: 'createRestorePoint'
      });
      commitSectionNavigation('backup');
      return;
    }

    if (stepKey === 'cleanUpSystem') {
      navigateToTweakTarget('General', 'Cleanup');
      setQuickstartStepCompleted('cleanUpSystem', true);
      return;
    }

    if (stepKey === 'exploreGeneralTweaks') {
      navigateToTweakTarget('General', 'System');
      setQuickstartStepCompleted('exploreGeneralTweaks', true);
      return;
    }

    if (stepKey === 'applyNovaPowerPlan') {
      const target = getFirstTweakTargetByContainerType('power_plan', {
        category: 'General',
        subcategory: 'Power Plans'
      });
      navigateToTweakTarget(target.category, target.subcategory);
      return;
    }

    if (stepKey === 'reduceInputDelay') {
      navigateToTweakTarget('Latency', 'Input');
      return;
    }

    if (stepKey === 'manageStartupApps') {
      setAppsSearchTerm('');
      setStartupSearchTerm('');
      setAppsNavigationRequest({
        id: `${Date.now()}-startup`,
        target: 'startup'
      });
      commitSectionNavigation("apps");
    }
  }

  function handleBackupQuickstartEvent(event) {
    const eventType = String(event?.type || '').trim().toLowerCase();
    if (!eventType) {
      return;
    }

    if (eventType === 'backup-created') {
      setQuickstartStepCompleted('createBackup', true);
      return;
    }

    if (eventType === 'restore-point-created') {
      setQuickstartStepCompleted('createRestorePoint', true);
    }
  }

  function applyLoadedSettings(settings) {
    const nextSettings = settings && typeof settings === 'object' ? settings : createDefaultAppSettings();
    setAppSettings({
      ...createDefaultAppSettings(),
      ...nextSettings,
      userProfile: normalizeProfileSettings(nextSettings.userProfile)
    });

    const language = String(nextSettings?.preferences?.language || '').trim();
    if (language && i18n.language?.split('-')?.[0] !== language) {
      void i18n.changeLanguage(language);
    }

    const resolvedTheme = resolveThemeMode(nextSettings?.preferences?.theme || 'dark');
    setTheme(resolvedTheme);
  }

  async function loadAppSettings(options = {}) {
    const notify = Boolean(options.notify);
    if (!window.desktopApi?.getSettings) {
      setSettingsError(t('settingsPanel.messages.settingsUnavailable'));
      return { ok: false, settings: appSettings };
    }

    const operationId = notify
      ? startGlobalOperation('settings:reload', i18n.t('interfaceText.reload_settings_035e3'), t('tweaks.running', { defaultValue: 'Action is still running...' }))
      : '';
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const result = await window.desktopApi.getSettings();
      if (result?.ok && result.settings) {
        applyLoadedSettings(result.settings);
        if (result.warning?.message) {
          setSettingsError(result.warning.message);
        }
        if (notify) {
          finishGlobalOperation(operationId, "success", t('settingsPanel.messages.settingsReloaded'));
        }
        return { ok: true, settings: result.settings };
      }

      const message = result?.message || t('settingsPanel.messages.settingsLoadFailed');
      setSettingsError(message);
      if (notify) finishGlobalOperation(operationId, "error", message);
      return { ok: false, settings: appSettings };
    } catch (error) {
      const message = error?.message || t('settingsPanel.messages.settingsLoadFailed');
      setSettingsError(message);
      if (notify) finishGlobalOperation(operationId, "error", message);
      return { ok: false, settings: appSettings };
    } finally {
      setSettingsLoading(false);
    }
  }

  async function updateAppSettings(patch) {
    if (!window.desktopApi?.updateSettings) {
      return { ok: false, message: t('settingsPanel.messages.settingsUnavailable') };
    }

    const result = await window.desktopApi.updateSettings(patch);
    if (result?.ok && result.settings) {
      applyLoadedSettings(result.settings);
      setSettingsError('');
    }
    return result;
  }

  async function setAdvancedSensorMonitoring(enabled) {
    if (!window.desktopApi?.setAdvancedSensorMonitoringEnabled) {
      return { ok: false, message: t('advancedSensors.unavailable') };
    }

    const result = await window.desktopApi.setAdvancedSensorMonitoringEnabled({
      enabled: Boolean(enabled)
    });
    if (result?.settings) {
      applyLoadedSettings(result.settings);
    }
    if (result?.ok) {
      setSettingsError('');
    }
    if (result?.code === 'LHM_PROCESS_STILL_RUNNING') {
      return {
        ...result,
        message: t('settingsPanel.monitoring.stopFailedMessage')
      };
    }
    return result;
  }

  async function handleThemeChange(nextTheme) {
    const normalizedTheme = nextTheme === 'light' || nextTheme === 'system' ? nextTheme : 'dark';
    const result = await updateAppSettings({
      preferences: {
        theme: normalizedTheme
      }
    });
    if (!result?.ok) {
      setTheme(resolveThemeMode(normalizedTheme));
    }
    return result;
  }

  async function resetAppSettings() {
    if (!window.desktopApi?.resetSettings) {
      return { ok: false, message: t('settingsPanel.messages.settingsUnavailable') };
    }
    const result = await window.desktopApi.resetSettings();
    if (result?.ok && result.settings) {
      applyLoadedSettings(result.settings);
      setSettingsError('');
    }
    return result;
  }

  async function chooseBackupLocation() {
    if (!window.desktopApi?.chooseBackupLocation) {
      return { ok: false, message: t('settingsPanel.messages.backupPickerUnavailable') };
    }
    const result = await window.desktopApi.chooseBackupLocation();
    if (result?.ok && result.settings) {
      applyLoadedSettings(result.settings);
    }
    return result;
  }

  async function openUpdateNotesModal() {
    setUpdateNotesModalOpen(true);
    setUpdateNotesLoading(true);
    try {
      const result = window.desktopApi?.apiGetUpdateNotes
        ? await window.desktopApi.apiGetUpdateNotes()
        : window.desktopApi?.apiCheckUpdate
          ? await window.desktopApi.apiCheckUpdate()
          : { ok: false, code: 'API_NOT_AVAILABLE' };
      if (result?.ok) {
        setUpdateNotes(normalizeUpdateNotesPayload(result));
      } else {
        setUpdateNotes({
          title: t('dashboard.updateNotes.title', { defaultValue: 'Update Notes' }),
          version: '',
          updatedAt: '',
          body: result?.message || t('dashboard.updateNotes.loadFailed', { defaultValue: 'Update Notes konnten nicht geladen werden.' }),
          items: []
        });
      }
    } catch (error) {
      setUpdateNotes({
        title: t('dashboard.updateNotes.title', { defaultValue: 'Update Notes' }),
        version: '',
        updatedAt: '',
        body: error?.message || t('dashboard.updateNotes.loadFailed', { defaultValue: 'Update Notes konnten nicht geladen werden.' }),
        items: []
      });
    } finally {
      setUpdateNotesLoading(false);
    }
  }

  useEffect(() => {
    const resolvedTheme = resolveThemeMode(appSettings.preferences.theme || theme);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-compact', appSettings.preferences.compactMode ? 'true' : 'false');
    document.documentElement.setAttribute('data-reduced-motion', appSettings.preferences.reducedMotion ? 'true' : 'false');
    document.documentElement.style.setProperty('--accent', appSettings.preferences.accentColor || '#EC4899');
    setTheme(resolvedTheme);
    try {
      localStorage.setItem('app-theme', resolvedTheme);
    } catch (_error) {
      // Persisted app settings are the source of truth.
    }
  }, [appSettings.preferences, theme]);

  useEffect(() => {
    async function bootstrap() {
      setIsBootstrapLoading(true);

      const settingsResult = await loadAppSettings({ notify: false });
      const bootstrapSettings = settingsResult?.settings || appSettings;
      const startupSection = bootstrapSettings?.startupWindow?.rememberLastTab
        ? String(bootstrapSettings.startupWindow.lastTab || '').trim()
        : '';
      await Promise.all([
        (async () => {
          if (!window.desktopApi?.getAppMetadata) return;
          try {
            const metadataResult = await window.desktopApi.getAppMetadata();
            setAppMetadata(metadataResult?.ok ? metadataResult.metadata || null : null);
          } catch (_error) {
            setAppMetadata(null);
          }
        })(),
        (async () => {
          if (!window.desktopApi?.getAdminState) {
            setIsAdmin(false);
            return;
          }
          try {
            const adminResult = await window.desktopApi.getAdminState();
            setAdminAccessState(adminResult || null);
            setIsAdmin(Boolean(adminResult?.isAdmin || adminResult?.ready));
          } catch (_error) {
            setIsAdmin(false);
          }
        })()
      ]);

      if (startupSection) {
        setActiveSection(startupSection);
        setRenderedSection(startupSection);
      }

      didBootstrapRef.current = true;
      setIsBootstrapLoading(false);
    }

    bootstrap().catch(() => {
      didBootstrapRef.current = true;
      setIsBootstrapLoading(false);
    });
  }, []);

  async function loadInstalledApps(options = {}) {
    const notify = Boolean(options.notify);
    const requestId = activeAppsLoadRequestRef.current + 1;
    activeAppsLoadRequestRef.current = requestId;

    if (!window.desktopApi?.listInstalledApps) {
      setAppsError('API_NOT_AVAILABLE');
      setInstalledApps([]);
      setIsLoadingApps(false);
      setIsLoadingAppDetails(false);
      if (notify || didBootstrapRef.current) {
        pushToast(t('errors.apiUnavailable'), "error");
      }
      return { ok: false, apps: [] };
    }

    setIsLoadingApps(true);
    setIsLoadingAppDetails(false);
    setAppsError('');

    try {
      const summaryResult = await window.desktopApi.listInstalledApps({ detailLevel: 'summary' });
      if (activeAppsLoadRequestRef.current !== requestId) {
        return { ok: false, apps: [] };
      }

      if (!summaryResult?.ok) {
        setInstalledApps([]);
        setAppsError(summaryResult?.code || 'LOAD_FAILED');
        if (notify || didBootstrapRef.current) {
          pushToast(`${t('apps.loadError')} (${summaryResult?.code || 'LOAD_FAILED'})`, "error");
        }
        return { ok: false, apps: [] };
      }

      const summaryApps = Array.isArray(summaryResult.apps) ? summaryResult.apps : [];
      setInstalledApps(summaryApps);
      hasLoadedAppsRef.current = true;
      setIsLoadingApps(false);
      setIsLoadingAppDetails(true);

      const detailResult = await window.desktopApi.listInstalledApps({ detailLevel: 'full' });
      if (activeAppsLoadRequestRef.current !== requestId) {
        return { ok: false, apps: [] };
      }

      if (detailResult?.ok) {
        const detailedApps = Array.isArray(detailResult.apps) ? detailResult.apps : [];
        setInstalledApps(detailedApps);
        if (notify) {
          pushToast(t('toasts.appsReloaded', { count: detailedApps.length }), 'info');
        }
        return { ok: true, apps: detailedApps };
      }

      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.detailsLoadError')} (${detailResult?.code || 'LOAD_FAILED'})`, "error");
      }
      return { ok: true, apps: summaryApps, detailsLoaded: false };
    } catch (_error) {
      if (activeAppsLoadRequestRef.current !== requestId) {
        return { ok: false, apps: [] };
      }

      if (!hasLoadedAppsRef.current) {
        setInstalledApps([]);
        setAppsError('LOAD_FAILED');
        if (notify || didBootstrapRef.current) {
          pushToast(`${t('apps.loadError')} (LOAD_FAILED)`, "error");
        }
        return { ok: false, apps: [] };
      }

      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.detailsLoadError')} (LOAD_FAILED)`, "error");
      }
    } finally {
      if (activeAppsLoadRequestRef.current === requestId) {
        setIsLoadingApps(false);
        setIsLoadingAppDetails(false);
      }
    }

    return { ok: true, apps: installedApps, detailsLoaded: false };
  }

  async function loadStartupEntries(options = {}) {
    const notify = Boolean(options.notify);

    if (!window.desktopApi?.listStartupApps) {
      setStartupEntriesError('API_NOT_AVAILABLE');
      setStartupEntries([]);
      setIsLoadingStartupEntries(false);
      if (notify || didBootstrapRef.current) {
        pushToast(t('errors.apiUnavailable'), "error");
      }
      return { ok: false, entries: [] };
    }

    setIsLoadingStartupEntries(true);
    setStartupEntriesError('');

    try {
      const result = await window.desktopApi.listStartupApps();
      if (result?.ok) {
        const incomingEntries = Array.isArray(result.entries) ? result.entries : [];
        setStartupEntries(incomingEntries);
        hasLoadedStartupEntriesRef.current = true;
        if (notify) {
          pushToast(t('toasts.startupReloaded', { count: incomingEntries.length }), 'info');
        }
        return { ok: true, entries: incomingEntries };
      }

      setStartupEntries([]);
      setStartupEntriesError(result?.code || 'LOAD_FAILED');
      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.startup.loadError')} (${result?.code || 'LOAD_FAILED'})`, "error");
      }
    } catch (_error) {
      setStartupEntries([]);
      setStartupEntriesError('LOAD_FAILED');
      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.startup.loadError')} (LOAD_FAILED)`, "error");
      }
    } finally {
      setIsLoadingStartupEntries(false);
    }

    return { ok: false, entries: [] };
  }

  async function loadTweaks(options = {}) {
    const notify = Boolean(options.notify);
    const includeState = Boolean(options.includeState);
    const background = Boolean(options.background);
    const isBackgroundStateRefresh = background && includeState;
    const cooldownRemainingMs = tweakReloadBlockedUntilRef.current - Date.now();

    if (cooldownRemainingMs > 0) {
      if (notify) {
        pushToast(t('errors.tweakReloadRateLimited', {
          seconds: Math.max(1, Math.ceil(cooldownRemainingMs / 1000))
        }), 'warning');
      }
      return {
        ok: false,
        code: 'API_RATE_LIMITED',
        details: { retryAfterMs: cooldownRemainingMs },
        tweaks: []
      };
    }

    const requestId = !background ? activeTweaksLoadRequestRef.current + 1 : activeTweaksLoadRequestRef.current;

    if (!background) {
      activeTweaksLoadRequestRef.current = requestId;
    }

    if (isBackgroundStateRefresh) {
      stateRefreshCounterRef.current += 1;
      setIsRefreshingTweakStates(true);
    }

    if (!background) {
      setIsLoadingTweaks(true);
      setTweaksError('');
    }

    const listTweaks = window.desktopApi?.listTweaks;

    if (!listTweaks) {
      setTweaksError('API_NOT_AVAILABLE');
      if (!background) {
        setTweaks([]);
        setIsLoadingTweaks(false);
      }
      if (!background && (notify || didBootstrapRef.current)) {
        pushToast(t('errors.apiUnavailable'), "error");
      }
      return { ok: false, tweaks: [] };
    }

    try {
      const result = await listTweaks({ includeState });
      if (result?.ok) {
        const incomingTweaks = Array.isArray(result.tweaks) ? result.tweaks : [];
        if (!background && activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }

        const rebootPendingSet = new Set(getStoredRebootPendingIds().map((id) => String(id)));
        const normalizedTweaks = incomingTweaks.map((tweak) => {
          const normalized = normalizeTweakForUi({ ...tweak, premium: false });
          return {
            ...normalized,
            rebootPending: rebootPendingSet.has(String(normalized.id))
          };
        });
        setTweaks((previous) => {
          const previousById = new Map(previous.map((item) => [String(item.id), item]));
          return normalizedTweaks.map((tweak) =>
            mergeTweakRuntimeState(tweak, previousById.get(String(tweak.id)), includeState)
          );
        });
        hasLoadedTweaksRef.current = true;
        if (includeState) {
          hasLoadedTweakStatesRef.current = true;
        }

        if (!background && notify) {
          pushToast(t('toasts.tweaksReloaded', { count: incomingTweaks.length }), 'info');
        }
        return { ok: true, tweaks: incomingTweaks };
      }

      const rateLimitDelay = getTweakRateLimitDelay(result);
      const rateLimited = rateLimitDelay > 0;
      if (rateLimited) {
        const blockedUntil = Date.now() + rateLimitDelay;
        tweakReloadBlockedUntilRef.current = blockedUntil;
        setTweakReloadBlockedUntil(blockedUntil);
      }

      if (!background) {
        if (activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }
        setTweaksError(result?.code || 'LOAD_FAILED');
        if (!rateLimited) {
          setTweaks([]);
        }
      }
      if (!background && (notify || didBootstrapRef.current)) {
        if (rateLimited) {
          pushToast(t('errors.tweakReloadRateLimited', {
            seconds: Math.max(1, Math.ceil(rateLimitDelay / 1000))
          }), 'warning');
        } else {
          pushToast(`${t('errors.failedToLoadTweaksApi')} (${result?.code || 'LOAD_FAILED'})`, "error");
        }
      }
    } catch (_error) {
      if (!background) {
        if (activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }
        setTweaksError('LOAD_FAILED');
        setTweaks([]);
      }
      if (!background && (notify || didBootstrapRef.current)) {
        pushToast(`${t('errors.failedToLoadTweaksApi')} (LOAD_FAILED)`, "error");
      }
    } finally {
      if (isBackgroundStateRefresh) {
        stateRefreshCounterRef.current = Math.max(0, stateRefreshCounterRef.current - 1);
        if (stateRefreshCounterRef.current === 0) {
          setIsRefreshingTweakStates(false);
        }
      }
      if (!background) {
        if (activeTweaksLoadRequestRef.current === requestId) {
          setIsLoadingTweaks(false);
        }
      }
    }

    return { ok: false, tweaks: [] };
  }

  async function refreshTweaksTwoPhase(options = {}) {
    if (activeTweaksRefreshPromiseRef.current) {
      return activeTweaksRefreshPromiseRef.current;
    }

    const notify = Boolean(options.notify);
    const refreshStates = options.refreshStates !== false;
    const refreshPromise = (async () => {
      const quickLoad = await loadTweaks({ notify, includeState: false });
      const tweakIds = Array.isArray(quickLoad?.tweaks)
        ? quickLoad.tweaks
            .filter(requiresRendererTweakStateCheck)
            .map((tweak) => String(tweak?.id || ''))
            .filter(Boolean)
        : [];

      if (!quickLoad?.ok || !refreshStates || !tweakIds.length) {
        if (!tweakIds.length) {
          setCheckingStateTweakIds([]);
        }
        return quickLoad;
      }

      const runId = activeStateRefreshRunRef.current + 1;
      activeStateRefreshRunRef.current = runId;
      hasLoadedTweakStatesRef.current = false;
      setCheckingStateTweakIds(tweakIds);

      void (async () => {
        try {
          await loadTweaks({ notify: false, includeState: true, background: true });
        } finally {
          if (activeStateRefreshRunRef.current === runId) {
            setCheckingStateTweakIds([]);
          }
        }
      })();

      return quickLoad;
    })();

    activeTweaksRefreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (activeTweaksRefreshPromiseRef.current === refreshPromise) {
        activeTweaksRefreshPromiseRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (!didBootstrapRef.current || isBootstrapLoading) {
      return;
    }

    if (activeSection === 'tweaks' || activeSection === 'backup' || activeSection === 'automation') {
      const needsRuntimeStates = activeSection === 'tweaks' || activeSection === 'backup';
      const needsLoad = !hasLoadedTweaksRef.current || (needsRuntimeStates && !hasLoadedTweakStatesRef.current);
      if (needsLoad && !isLoadingTweaks) {
        void refreshTweaksTwoPhase({
          notify: false,
          includeAuth: true,
          refreshStates: needsRuntimeStates
        });
      }
      return;
    }

    if (activeSection === 'apps') {
      if (!hasLoadedAppsRef.current && !isLoadingApps) {
        void loadInstalledApps({ notify: false, includeAuth: true });
      }
      if (!hasLoadedStartupEntriesRef.current && !isLoadingStartupEntries) {
        void loadStartupEntries({ notify: false, includeAuth: true });
      }
    }
  }, [activeSection, isBootstrapLoading]);

  useEffect(() => {
    if (!didBootstrapRef.current || !appSettings?.startupWindow?.rememberLastTab) {
      return undefined;
    }
    if (appSettings.startupWindow.lastTab === activeSection) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void updateAppSettings({
        startupWindow: {
          lastTab: activeSection
        }
      });
    }, 400);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, appSettings?.startupWindow?.rememberLastTab]);

  useEffect(() => {
    if (!didBootstrapRef.current) {
      return;
    }

    const activeLanguage = normalizeBackupLanguage(i18n.language);
    if (!activeLanguage || appSettings?.preferences?.language === activeLanguage) {
      return;
    }

    void updateAppSettings({
      preferences: {
        language: activeLanguage
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  function commitSectionNavigation(sectionId) {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) {
      return;
    }

    void prefetchSectionModule(normalizedSectionId);
    setActiveSection(normalizedSectionId);
    setSidebarOpen(false);
    startSectionTransition(() => {
      setRenderedSection(normalizedSectionId);
    });
  }

  function handlePrefetchSection(sectionId) {
    void prefetchSectionModule(sectionId);
  }

  function handleSelectSection(sectionId) {
    commitSectionNavigation(sectionId);
  }

  function resetTweakFilters() {
    setSearchTerm('');
    setSelectedCategory('all');
    setSelectedSubcategory('all');
    setRecommendedFilter('all');
    setRiskFilter('all');
    setTagFilter('all');
    setRequiresAdminFilter('all');
    setRebootRequiredFilter('all');
    setCompatibilityFilter('all');
    setStatusFilter('all');
  }

  function handleCategoryChange(nextCategory) {
    setSelectedCategory(nextCategory);
    setSelectedSubcategory(getFirstAvailableSubcategory(nextCategory));
  }

  function getFirstAvailableSubcategory(category, statsOverride = null) {
    if (!category || category === 'all') {
      return 'all';
    }

    const counts = statsOverride || tweaks.reduce((result, tweak) => {
      if (tweak.category !== category) {
        return result;
      }

      const key = tweak.subcategory || '';
      if (!key) {
        return result;
      }

      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});

    return getOrderedSubcategories(category, counts).find((subcategory) => counts[subcategory]) || 'all';
  }

  const categoryStats = useMemo(() => {
    const counts = {};
    for (const tweak of tweaks) {
      const key = tweak.category || 'misc';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [tweaks]);

  const subcategoryStats = useMemo(() => {
    if (selectedCategory === 'all') {
      return {};
    }

    const counts = {};
    for (const tweak of tweaks) {
      if (tweak.category !== selectedCategory) {
        continue;
      }

      const key = tweak.subcategory || '';
      if (!key) {
        continue;
      }

      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [tweaks, selectedCategory]);

  const availableTweakTags = useMemo(() => {
    const tags = new Set();
    for (const tweak of tweaks) {
      for (const tag of normalizeTweakTags(tweak)) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right));
  }, [tweaks]);

  const filteredTweaks = useMemo(() => {
    const normalizedTagFilter = String(tagFilter || 'all').trim().toLowerCase();
    const normalizedRequiresAdminFilter = normalizeFilterBooleanValue(requiresAdminFilter);
    const normalizedRebootRequiredFilter = normalizeFilterBooleanValue(rebootRequiredFilter);
    const normalizedCompatibilityFilter = String(compatibilityFilter || 'all').trim().toLowerCase();
    const normalizedStatusFilter = String(statusFilter || 'all').trim().toLowerCase();

    return tweaks.filter((tweak) => {
      const matchesCategory = selectedCategory === 'all' || tweak.category === selectedCategory;
      if (!matchesCategory) {
        return false;
      }

      const matchesSubcategory = selectedSubcategory === 'all' || tweak.subcategory === selectedSubcategory;
      if (!matchesSubcategory) {
        return false;
      }

      if (recommendedFilter === 'yes' && !normalizeRecommended(tweak)) {
        return false;
      }

      if (recommendedFilter === 'no' && normalizeRecommended(tweak)) {
        return false;
      }

      if (riskFilter !== 'all' && normalizeRiskLevel(tweak) !== riskFilter) {
        return false;
      }

      if (normalizedRequiresAdminFilter !== 'all') {
        const requiresAdmin = normalizeRequiresAdmin(tweak);
        if ((normalizedRequiresAdminFilter === 'yes') !== requiresAdmin) {
          return false;
        }
      }

      if (normalizedRebootRequiredFilter !== 'all') {
        const rebootRequired = normalizeRebootRequired(tweak);
        if ((normalizedRebootRequiredFilter === 'yes') !== rebootRequired) {
          return false;
        }
      }

      const compatibilityState = getTweakCompatibilityState(tweak, systemDetection);
      if (normalizedCompatibilityFilter !== 'all' && compatibilityState.status !== normalizedCompatibilityFilter) {
        return false;
      }

      if (normalizedStatusFilter !== 'all') {
        const currentStatus = tweak?.rebootPending
          ? 'reboot_required'
          : String(tweak?.currentState || tweak?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_') || "unknown";
        if (currentStatus !== normalizedStatusFilter) {
          return false;
        }
      }

      const tags = normalizeTweakTags(tweak);
      if (normalizedTagFilter !== 'all' && !tags.some((tag) => tag.toLowerCase() === normalizedTagFilter)) {
        return false;
      }

      return matchesTweakNameQuery(tweak, searchTerm);
    });
  }, [
    tweaks,
    searchTerm,
    selectedCategory,
    selectedSubcategory,
    recommendedFilter,
    riskFilter,
    tagFilter,
    requiresAdminFilter,
    rebootRequiredFilter,
    compatibilityFilter,
    statusFilter,
    systemDetection
  ]);

  useEffect(() => {
    if (selectedCategory === 'all' && selectedSubcategory !== 'all') {
      setSelectedSubcategory('all');
      return;
    }

    const fallbackSubcategory = getFirstAvailableSubcategory(selectedCategory, subcategoryStats);

    if ((selectedSubcategory === 'all' && fallbackSubcategory !== 'all') || (selectedSubcategory !== 'all' && !subcategoryStats[selectedSubcategory])) {
      setSelectedSubcategory(fallbackSubcategory);
    }
  }, [selectedCategory, selectedSubcategory, subcategoryStats]);

  function isTechnicalAppEntry(app) {
    if (typeof app?.isTechnical === 'boolean') {
      return app.isTechnical;
    }

    const name = String(app?.name || '').trim();
    const technicalFallbackPatterns = [
      /^vs_/i,
      /^microsoft\.net\./i,
      /\btargeting pack\b/i,
      /\bapphost pack\b/i,
      /\bhost fx resolver\b/i,
      /\bdesktop runtime\b/i,
      /\basp\.net core runtime\b/i
    ];
    return technicalFallbackPatterns.some((pattern) => pattern.test(name));
  }

  function isUserFacingAppxEntry(app) {
    if (String(app?.source || '').toLowerCase() !== 'appx') {
      return true;
    }

    const runtimeStatus = String(app?.runtimeStatus || '').toLowerCase();
    if (Boolean(app?.processActive) || runtimeStatus === 'running' || runtimeStatus === 'active') {
      return true;
    }

    const installType = String(app?.installType || '').toLowerCase();
    return Boolean(app?.canUninstall) &&
      !Boolean(app?.isSystemComponent) &&
      installType !== 'framework' &&
      installType !== 'system' &&
      !isTechnicalAppEntry(app);
  }

  const filteredApps = useMemo(() => {
    const normalizedSearch = appsSearchTerm.trim().toLowerCase();
    const matched = installedApps.filter((app) => {
      if (!showAppxPackages && !isUserFacingAppxEntry(app)) {
        return false;
      }
      if (!showTechnicalComponents && isTechnicalAppEntry(app)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const name = String(app?.name || '').toLowerCase();
      const publisher = String(app?.publisher || '').toLowerCase();
      const version = String(app?.version || '').toLowerCase();
      const source = String(app?.source || '').toLowerCase();
      return (
        name.includes(normalizedSearch) ||
        publisher.includes(normalizedSearch) ||
        version.includes(normalizedSearch) ||
        source.includes(normalizedSearch)
      );
    });

    const sorted = [...matched];
    if (appsSort === 'name-desc') {
      sorted.sort((left, right) => String(right.name || '').localeCompare(String(left.name || ''), undefined, { sensitivity: 'base' }));
      return sorted;
    }
    if (appsSort === 'source') {
      sorted.sort((left, right) => {
        const sourceCompare = String(left.source || '').localeCompare(String(right.source || ''), undefined, { sensitivity: 'base' });
        if (sourceCompare !== 0) {
          return sourceCompare;
        }
        return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
      });
      return sorted;
    }

    sorted.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }));
    return sorted;
  }, [installedApps, appsSearchTerm, appsSort, showAppxPackages, showTechnicalComponents]);

  const startupStandardCount = useMemo(
    () => startupEntries.filter((entry) => Boolean(entry?.isStandard)).length,
    [startupEntries]
  );

  const dashboardStartupEntries = useMemo(() => {
    const standardEntries = startupEntries.filter((entry) => Boolean(entry?.isStandard));
    return standardEntries.length > 0 ? standardEntries : startupEntries;
  }, [startupEntries]);

  const startupDisabledCount = useMemo(
    () => dashboardStartupEntries.filter((entry) => !entry?.enabled).length,
    [dashboardStartupEntries]
  );

  const activeTweaksCount = useMemo(
    () => tweaks.filter((tweak) => normalizeTweakState(tweak?.currentState) === 'enabled').length,
    [tweaks]
  );

  const activePowerPlanName = useMemo(
    () => tweaks.find((tweak) => (
      String(tweak?.containerType || '').trim().toLowerCase() === 'power_plan'
      && normalizeTweakState(tweak?.currentState) === 'enabled'
    ))?.name || '',
    [tweaks]
  );

  const startupSourceEntries = useMemo(() => {
    const hasStandardDataset = startupStandardCount > 0;
    if (!hasStandardDataset || showAdditionalStartupSources) {
      return startupEntries;
    }
    return startupEntries.filter((entry) => Boolean(entry?.isStandard));
  }, [startupEntries, startupStandardCount, showAdditionalStartupSources]);

  const startupAdditionalCount = useMemo(() => {
    return startupEntries.filter((entry) => !entry?.isStandard).length;
  }, [startupEntries]);

  const filteredStartupEntries = useMemo(() => {
    const normalizedSearch = startupSearchTerm.trim().toLowerCase();

    const matched = startupSourceEntries.filter((entry) => {
      if (!normalizedSearch) {
        return true;
      }

      const name = String(entry?.name || '').toLowerCase();
      const startupType = String(entry?.startupType || '').toLowerCase();
      const startupKind = String(entry?.startupKind || '').toLowerCase();
      const sourcePath = String(entry?.sourcePath || '').toLowerCase();
      const command = String(entry?.command || '').toLowerCase();

      return (
        name.includes(normalizedSearch) ||
        startupType.includes(normalizedSearch) ||
        startupKind.includes(normalizedSearch) ||
        sourcePath.includes(normalizedSearch) ||
        command.includes(normalizedSearch)
      );
    });

    const sorted = [...matched];
    if (startupSort === 'name-desc') {
      sorted.sort((left, right) => String(right.name || '').localeCompare(String(left.name || ''), undefined, { sensitivity: 'base' }));
      return sorted;
    }
    if (startupSort === 'status') {
      sorted.sort((left, right) => {
        if (Boolean(left.enabled) !== Boolean(right.enabled)) {
          return left.enabled ? -1 : 1;
        }
        return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
      });
      return sorted;
    }
    if (startupSort === 'type') {
      sorted.sort((left, right) => {
        const typeCompare = String(left.startupType || '').localeCompare(String(right.startupType || ''), undefined, { sensitivity: 'base' });
        if (typeCompare !== 0) {
          return typeCompare;
        }
        return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
      });
      return sorted;
    }

    sorted.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }));
    return sorted;
  }, [startupSourceEntries, startupSearchTerm, startupSort]);

  function startupTypeToTranslationKey(startupType) {
    const normalized = String(startupType || '').trim().toLowerCase();
    if (normalized === 'registry') {
      return 'registry';
    }
    if (normalized === 'startup-folder') {
      return 'startupFolder';
    }
    if (normalized === 'scheduled-task') {
      return 'scheduledTask';
    }
    if (normalized === 'appx') {
      return 'appx';
    }
    return "unknown";
  }

  async function handleToggleStartupEntry(entry, nextEnabled) {
    if (!entry?.canToggle) {
      pushToast(t('apps.startup.toggleNotSupported'), 'info');
      return { ok: false, code: 'TOGGLE_NOT_SUPPORTED' };
    }

    if (!window.desktopApi?.setStartupEntryEnabled) {
      pushToast(t('errors.apiUnavailable'), "error");
      return { ok: false, code: 'API_NOT_AVAILABLE' };
    }

    setActiveStartupToggleId(entry.id);
    const operationId = startGlobalOperation(
      `startup:toggle:${entry.id}`,
      nextEnabled ? i18n.t('interfaceText.enable_startup_app_f644b') : i18n.t('interfaceText.disable_startup_app_8868d'),
      `${nextEnabled ? i18n.t('interfaceText.enabling_ab6c4') : i18n.t('interfaceText.disabling_03bf0')} "${entry.name}"...`
    );
    try {
      const result = await window.desktopApi.setStartupEntryEnabled({
        id: entry.id,
        enabled: nextEnabled
      });
      if (!result?.ok) {
        if (result?.code === 'ADMIN_REQUIRED') {
          finishGlobalOperation(operationId, "error", t('apps.startup.adminRequiredMessage', { name: entry.name }));
          const restartAsAdmin = await requestSettingsConfirmation({
            title: t('apps.startup.adminRequiredTitle'),
            message: t('apps.startup.adminRequiredMessage', { name: entry.name }),
            confirmLabel: t('status.elevate'),
            tone: 'warning'
          });
          if (restartAsAdmin) {
            const elevationResult = await handleRequestAdminRelaunch();
            if (!elevationResult?.ok) {
              pushToast(t('status.elevationFailed'), "error");
            }
          }
          return { ok: false, ...result };
        }

        finishGlobalOperation(
          operationId,
          "error",
          `${result?.message || t('apps.startup.toggleFailed', { name: entry.name })} (${result?.code || 'STARTUP_TOGGLE_FAILED'})`
        );
        return { ok: false, ...result };
      }

      const updatedEntry = result?.result?.entry || {
        ...entry,
        enabled: nextEnabled
      };
      setStartupEntries((previous) =>
        previous.map((item) => (item.id === entry.id ? { ...item, ...updatedEntry, enabled: Boolean(updatedEntry.enabled) } : item))
      );

      finishGlobalOperation(
        operationId,
        "success",
        nextEnabled
          ? t('apps.startup.enableSuccess', { name: entry.name })
          : t('apps.startup.disableSuccess', { name: entry.name })
      );
      recordDashboardActivity(
        nextEnabled
          ? `Startup app enabled: ${entry.name}`
          : `Startup app disabled: ${entry.name}`,
        nextEnabled ? 'warning' : "success"
      );

      return { ok: true, entry: updatedEntry };
    } catch (_error) {
      finishGlobalOperation(operationId, "error", t('apps.startup.toggleFailed', { name: entry.name }));
      return { ok: false, code: 'STARTUP_TOGGLE_FAILED' };
    } finally {
      setActiveStartupToggleId('');
    }
  }

  async function handleChangeStartupEntryType(entry, nextType) {
    if (!entry?.canChangeType || !window.desktopApi?.setStartupEntryType) {
      pushToast(t('apps.startup.typeChangeNotSupported'), 'info');
      return { ok: false, code: 'TYPE_CHANGE_NOT_SUPPORTED' };
    }

    const normalizedType = String(nextType || '').trim().toLowerCase();
    if (!normalizedType || normalizedType === String(entry.startupType || '').toLowerCase()) {
      return { ok: true, entry };
    }

    setActiveStartupTypeChangeId(entry.id);
    const operationId = startGlobalOperation(
      `startup:type:${entry.id}`,
      i18n.t('interfaceText.change_startup_type_3c512'),
      `Changing startup type for "${entry.name}"...`
    );
    try {
      const result = await window.desktopApi.setStartupEntryType({
        id: entry.id,
        startupType: normalizedType
      });
      if (!result?.ok) {
        if (result?.code === 'APPS_STARTUP_TYPE_CHANGE_NOT_SUPPORTED') {
          finishGlobalOperation(operationId, "error", t('apps.startup.typeChangeNotSupported'));
        } else {
          finishGlobalOperation(
            operationId,
            "error",
            `${result?.message || t('apps.startup.typeChangeFailed', { name: entry.name })} (${result?.code || 'STARTUP_TYPE_CHANGE_FAILED'})`
          );
        }
        return { ok: false, ...result };
      }

      const updatedEntry = result?.result?.entry || {
        ...entry,
        startupType: normalizedType
      };
      setStartupEntries((previous) => previous.map((item) => (item.id === entry.id ? { ...item, ...updatedEntry } : item)));
      finishGlobalOperation(
        operationId,
        "success",
        t('apps.startup.typeChangeSuccess', {
          name: entry.name,
          type: t(`apps.startup.types.${startupTypeToTranslationKey(updatedEntry.startupType)}`)
        })
      );
      return { ok: true, entry: updatedEntry };
    } catch (_error) {
      finishGlobalOperation(operationId, "error", t('apps.startup.typeChangeFailed', { name: entry.name }));
      return { ok: false, code: 'STARTUP_TYPE_CHANGE_FAILED' };
    } finally {
      setActiveStartupTypeChangeId('');
    }
  }

  function handleRequestUninstallApp(appEntry) {
    if (!appEntry?.canUninstall) {
      pushToast(t('apps.uninstallNotSupported'), 'info');
      return;
    }

    setUninstallAppConfirm({
      open: true,
      app: appEntry
    });
  }

  async function confirmUninstallApp() {
    const appEntry = uninstallAppConfirm?.app;
    if (!appEntry) {
      setUninstallAppConfirm({ open: false, app: null });
      return;
    }

    if (!window.desktopApi?.uninstallInstalledApp) {
      pushToast(t('errors.apiUnavailable'), "error");
      setUninstallAppConfirm({ open: false, app: null });
      return;
    }

    setActiveAppUninstallId(appEntry.id);
    const operationId = startGlobalOperation(
      `apps:uninstall:${appEntry.id}`,
      i18n.t('interfaceText.uninstall_app_645be'),
      `Uninstalling "${appEntry.name}"...`
    );
    try {
      const result = await window.desktopApi.uninstallInstalledApp({ id: appEntry.id });
      if (!result?.ok) {
        finishGlobalOperation(
          operationId,
          "error",
          `${result?.message || t('apps.uninstallFailed', { name: appEntry.name })} (${result?.code || 'UNINSTALL_FAILED'})`
        );
        return;
      }

      setInstalledApps((previous) => previous.filter((app) => app.id !== appEntry.id));
      finishGlobalOperation(operationId, "success", t('apps.uninstallSuccess', { name: appEntry.name }));

      if (result?.result?.restartRequired) {
        pushToast(t('apps.restartRequiredHint'), 'info');
      }
    } catch (_error) {
      finishGlobalOperation(operationId, "error", t('apps.uninstallFailed', { name: appEntry.name }));
    } finally {
      setActiveAppUninstallId('');
      setUninstallAppConfirm({ open: false, app: null });
    }
  }

  async function startAppOptimization(appEntry, actionIds = null) {
    if (!window.desktopApi?.optimizeInstalledApp) {
      pushToast(t('apps.optimizeNotAvailable'), "error");
      return;
    }

    const normalizedActionIds = Array.isArray(actionIds)
      ? actionIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const cacheOnly = normalizedActionIds.length === 1 && normalizedActionIds[0] === 'cache.cleanup';
    const confirmed = await requestSettingsConfirmation({
      title: cacheOnly
        ? t('apps.optimization.confirmCacheTitle', { defaultValue: 'Clean application cache?' })
        : t('apps.optimization.confirmTitle', { defaultValue: 'Apply app optimizations?' }),
      message: cacheOnly
        ? t('apps.optimization.confirmCacheBody', {
            name: appEntry.name,
            defaultValue: `Nova permanently removes only known temporary cache data for ${appEntry.name}. Settings, sessions and personal files stay untouched.`
          })
        : t('apps.optimization.confirmBody', {
            name: appEntry.name,
            defaultValue: `Nova saves and verifies the current settings for ${appEntry.name} before applying these reversible changes.`
          }),
      confirmLabel: cacheOnly
        ? t('apps.optimization.confirmCache', { defaultValue: 'Clean cache' })
        : t('apps.optimization.confirmApply', { defaultValue: 'Apply optimizations' }),
      tone: 'warning'
    });
    if (!confirmed) return;

    setActiveAppOptimizeId(appEntry.id);
    setAppOptimizationModal({
      open: true,
      view: 'progress',
      scope: cacheOnly ? 'cache' : 'reversible',
      app: appEntry,
      analysis: null,
      operation: {
        appId: appEntry.id,
        appName: appEntry.name,
        status: 'running',
        phase: 'preflight',
        total: 0,
        current: 0,
        applied: 0,
        skipped: 0,
        failed: 0
      },
      busy: true,
      error: ''
    });
    try {
      const result = await window.desktopApi.optimizeInstalledApp({
        id: appEntry.id,
        actionIds: Array.isArray(actionIds) ? actionIds : undefined
      });
      if (!result?.ok) {
        const code = String(result?.code || 'OPTIMIZE_FAILED').trim();
        const baseMessage = result?.message || t('apps.optimizeFailed', { name: appEntry.name });
        setAppOptimizationModal((previous) => ({
          ...previous,
          busy: false,
          error: `${baseMessage} (${code})`,
          operation: {
            ...(previous.operation || {}),
            status: 'error',
            phase: "error",
            message: baseMessage
          }
        }));
        setActiveAppOptimizeId('');
        return;
      }
      if (result.result) {
        setAppOptimizationModal((previous) => ({
          ...previous,
          view: 'progress',
          operation: result.result,
          busy: false
        }));
      }
    } catch (_error) {
      setActiveAppOptimizeId('');
      setAppOptimizationModal((previous) => ({
        ...previous,
        busy: false,
        error: t('apps.optimizeFailed', { name: appEntry.name }),
        operation: {
          ...(previous.operation || {}),
          status: 'error',
          phase: "error"
        }
      }));
    }
  }

  function handleOptimizeApp(appEntry, actionIds = null) {
    return startAppOptimization(appEntry, actionIds);
  }

  async function handleViewAppOptimization(appEntry, scope = 'reversible') {
    if (!window.desktopApi?.getAppOptimization) {
      pushToast(t('apps.optimizeNotAvailable'), "error");
      return;
    }
    setAppOptimizationModal({
      open: true,
      view: 'details',
      scope,
      app: appEntry,
      analysis: null,
      operation: null,
      busy: true,
      error: ''
    });
    try {
      const result = await window.desktopApi.getAppOptimization({ id: appEntry.id, includeCacheSize: false });
      if (!result?.ok) {
        throw new Error(result?.message || t('apps.optimizeNotAvailable'));
      }
      setAppOptimizationModal((previous) => ({
        ...previous,
        analysis: result.result,
        busy: false
      }));
    } catch (error) {
      setAppOptimizationModal((previous) => ({
        ...previous,
        busy: false,
        error: error?.message || t('apps.optimizeNotAvailable')
      }));
    }
  }

  async function confirmAppOptimizationClose() {
    const operationId = appOptimizationModal.operation?.operationId;
    if (!operationId || !window.desktopApi?.confirmAppOptimizationClose) return;
    const result = await window.desktopApi.confirmAppOptimizationClose({ operationId });
    if (!result?.ok) {
      setAppOptimizationModal((previous) => ({ ...previous, error: result?.message || t('apps.optimizeNotAvailable') }));
    }
  }

  async function cancelAppOptimization() {
    const operationId = appOptimizationModal.operation?.operationId;
    if (!operationId || !window.desktopApi?.cancelAppOptimization) return;
    dismissedAppOptimizationIdsRef.current.add(operationId);
    setActiveAppOptimizeId('');
    setAppOptimizationModal((previous) => ({ ...previous, open: false, busy: false, error: '' }));
    try {
      const result = await window.desktopApi.cancelAppOptimization({ operationId });
      if (!result?.ok) {
        dismissedAppOptimizationIdsRef.current.delete(operationId);
        setAppOptimizationModal((previous) => ({
          ...previous,
          open: true,
          error: result?.message || t('apps.optimizeNotAvailable')
        }));
      }
    } catch (error) {
      dismissedAppOptimizationIdsRef.current.delete(operationId);
      setAppOptimizationModal((previous) => ({
        ...previous,
        open: true,
        error: error?.message || t('apps.optimizeNotAvailable')
      }));
    }
  }

  async function restoreAppOptimizations(appEntry, { refreshModal = false } = {}) {
    if (!appEntry?.id || !window.desktopApi?.resetAppOptimizations) return;
    setActiveAppOptimizeId(appEntry.id);
    setAppOptimizationModal((previous) => ({ ...previous, busy: true, error: '' }));
    try {
      const result = await window.desktopApi.resetAppOptimizations({ id: appEntry.id });
      if (!result?.ok) throw new Error(result?.message || t('apps.optimizeNotAvailable'));
      pushToast(t('apps.optimization.restoreComplete', {
        count: Number(result?.result?.restored) || 0,
        defaultValue: 'Saved settings restored.'
      }), result?.result?.failed ? "error" : "success");
      await loadInstalledApps({ includeAuth: true });
      if (refreshModal) {
        await handleViewAppOptimization(appEntry, 'reversible');
      } else {
        setAppOptimizationModal((previous) => ({ ...previous, busy: false }));
      }
    } catch (error) {
      setAppOptimizationModal((previous) => ({ ...previous, busy: false, error: error?.message || t('apps.optimizeNotAvailable') }));
      if (!refreshModal) {
        pushToast(error?.message || t('apps.optimizeNotAvailable'), "error");
      }
    } finally {
      setActiveAppOptimizeId('');
    }
  }

  async function handleRestoreAppOptimizations(appEntry) {
    const confirmed = await requestSettingsConfirmation({
      title: t('apps.optimization.confirmRestoreTitle', { defaultValue: 'Restore previous app settings?' }),
      message: t('apps.optimization.confirmRestoreBody', {
        name: appEntry?.name,
        defaultValue: `Nova will restore every saved setting for ${appEntry?.name || 'this app'} and verify the result.`
      }),
      confirmLabel: t('apps.optimization.confirmRestore', { defaultValue: 'Restore settings' }),
      tone: 'warning'
    });
    if (!confirmed) return;
    await restoreAppOptimizations(appEntry);
  }

  async function resetAppOptimizations() {
    const appEntry = appOptimizationModal.app || appOptimizationModal.analysis?.app;
    await restoreAppOptimizations(appEntry, { refreshModal: true });
  }

  function closeAppOptimizationModal() {
    setAppOptimizationModal((previous) => ({ ...previous, open: false }));
    if (['success', 'partial'].includes(appOptimizationModal.operation?.status)) {
      recordDashboardActivity(`App optimized: ${appOptimizationModal.operation?.appName || appOptimizationModal.app?.name || ''}`, "success");
    }
  }

  const adminStatusLabel = useMemo(() => {
    if (isAdmin === null || adminAccessState?.status === 'starting') {
      return t('status.checking');
    }

    return isAdmin ? t('status.adminYes') : t('status.adminNo');
  }, [adminAccessState?.status, isAdmin, t]);

  const tweaksPanelLoading = isLoadingTweaks || (!hasLoadedTweaksRef.current && !tweaksError);
  const appsPanelLoading = isLoadingApps || (!hasLoadedAppsRef.current && !appsError);
  const startupPanelLoading = isLoadingStartupEntries || (!hasLoadedStartupEntriesRef.current && !startupEntriesError);

  function requestSettingsConfirmation({ title, message, confirmLabel = i18n.t('common.continue'), tone = 'warning' }) {
    return new Promise((resolve) => {
      confirmationResolverRef.current = resolve;
      setSettingsConfirm({
        open: true,
        title,
        message,
        confirmLabel,
        tone
      });
    });
  }

  function resolveSettingsConfirmation(confirmed) {
    const resolver = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setSettingsConfirm((previous) => ({
      ...previous,
      open: false
    }));
    resolver?.(Boolean(confirmed));
  }

  async function updateProcessAutomationSettings(processDetection) {
    if (!window.desktopApi?.updateProcessAutomationSettings) return;
    setProcessAutomationBusy(true);
    try {
      const result = await window.desktopApi.updateProcessAutomationSettings({ processDetection });
      if (!result?.ok) throw new Error(result?.message || t('automation.actionFailed'));
      if (result.state) setProcessAutomationState(result.state);
      if (result.settings) setAppSettings(result.settings);
    } catch (error) {
      pushToast(error?.message || t('automation.actionFailed'), "error");
    } finally {
      setProcessAutomationBusy(false);
    }
  }

  async function runProcessAutomationAction(method, alert) {
    if (!window.desktopApi?.[method]) return;
    try {
      const result = await window.desktopApi[method]({ alertId: alert.id });
      if (!result?.ok) throw new Error(result?.message || t('automation.actionFailed'));
      if (result.state) setProcessAutomationState(result.state);
    } catch (error) {
      pushToast(error?.message || t('automation.actionFailed'), "error");
    }
  }

  async function forceTerminateProcess(alert) {
    const confirmed = await requestSettingsConfirmation({
      title: t('automation.forceConfirmTitle'),
      message: t('automation.forceConfirmBody', { process: alert.processName }),
      confirmLabel: t('automation.forceTerminate'),
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      const result = await window.desktopApi?.forceTerminateProcess?.({ alertId: alert.id, confirmed: true });
      if (!result?.ok) throw new Error(result?.message || t('automation.actionFailed'));
      if (result.state) setProcessAutomationState(result.state);
    } catch (error) {
      pushToast(error?.message || t('automation.actionFailed'), "error");
    }
  }

  async function clearProcessAutomationHistory() {
    try {
      const result = await window.desktopApi?.clearProcessAutomationHistory?.();
      if (!result?.ok) throw new Error(result?.message || t('automation.actionFailed'));
      if (result.state) setProcessAutomationState(result.state);
    } catch (error) {
      pushToast(error?.message || t('automation.actionFailed'), "error");
    }
  }

  async function saveAutomationRule(rule) {
    try {
      const result = await window.desktopApi?.saveAutomationRule?.({ rule });
      if (!result?.ok) throw new Error(result?.message || t('ruleAutomation.saveFailed'));
      if (result.state) setRuleAutomationState(result.state);
      if (result.settings) setAppSettings(result.settings);
    } catch (error) {
      pushToast(error?.message || t('ruleAutomation.saveFailed'), "error");
    }
  }

  async function deleteAutomationRule(ruleId) {
    const result = await window.desktopApi?.deleteAutomationRule?.({ ruleId });
    if (result?.state) setRuleAutomationState(result.state);
    if (result?.settings) setAppSettings(result.settings);
  }

  async function dismissAutomationRuleAction(executionId) {
    const result = await window.desktopApi?.dismissAutomationRuleAction?.({ executionId });
    if (result?.state) setRuleAutomationState(result.state);
  }

  async function approvePendingAdminRuleActions() {
    if (adminRuleApprovalBusy || pendingAdminRuleActions.length === 0) return;
    setAdminRuleApprovalBusy(true);
    try {
      const result = await window.desktopApi?.approvePendingAdminRuleActions?.();
      if (result?.state) setRuleAutomationState(result.state);
      if (!result?.ok) {
        throw new Error(result?.message || t('ruleAutomation.adminApprovalFailed'));
      }
    } catch (error) {
      pushToast(error?.message || t('ruleAutomation.adminApprovalFailed'), "error");
      setAdminRuleApprovalBusy(false);
    }
  }

  async function executeAutomationRuleAction(execution, { skipConfirmation = false } = {}) {
    if (execution?.blockedReason === 'awaitingAdmin') {
      await approvePendingAdminRuleActions();
      return;
    }
    const confirmationBypassed = skipConfirmation || (
      execution?.action?.type === 'runTweak' &&
      execution?.action?.bypassConfirmation === true
    );
    if (!confirmationBypassed) {
      const confirmed = await requestSettingsConfirmation({
        title: t('ruleAutomation.confirmTitle'),
        message: t('ruleAutomation.confirmBody', { rule: execution.ruleName }),
        confirmLabel: t('ruleAutomation.execute'),
        tone: 'warning'
      });
      if (!confirmed) return;
    }
    let ok = false;
    let message = '';
    try {
      const prepared = await window.desktopApi?.executeAutomationRuleAction?.({ executionId: execution.id, confirmed: true });
      if (!prepared?.ok) throw new Error(prepared?.message || t('automation.actionFailed'));
      if (!prepared.requiresRenderer) {
        if (prepared.state) setRuleAutomationState(prepared.state);
        return;
      }
      if (execution.action.type === 'runOptimization') {
        const result = await runOneClickOptimization(execution.action.optimizationId, { automatic: skipConfirmation && isAdmin });
        ok = Boolean(result?.ok);
        message = result?.message || result?.code || '';
      } else if (execution.action.type === 'runTweak') {
        const tweak = tweaks.find((entry) => String(entry.id) === String(execution.action.tweakId));
        if (!tweak) throw new Error(t('ruleAutomation.tweakUnavailable'));
        const containerType = String(tweak?.containerType || tweak?.container_type || '')
          .trim()
          .toLowerCase()
          .replace(/[_\s]+/g, '-');
        const recommendedSelection = String(
          tweak?.recommendedSelection ||
          tweak?.recommended_selection ||
          tweak?.selections?.find?.((entry) => entry?.recommended)?.value ||
          tweak?.selections?.[0]?.value ||
          ''
        ).trim();
        const configuredTarget = String(execution.action.tweakTargetValue || '').trim();
        let result;
        if (containerType === 'timer-resolution') {
          result = await applyTimerResolution(
            tweak,
            configuredTarget || recommendedSelection || '0.5',
            { suppressNotifications: confirmationBypassed }
          );
        } else if (containerType === 'power-plan') {
          result = await applyPowerPlan(tweak, { suppressNotifications: confirmationBypassed });
        } else if (containerType === 'one-shot-selection') {
          result = await applyOneShotSelection(
            tweak,
            configuredTarget || recommendedSelection,
            { suppressNotifications: confirmationBypassed }
          );
        } else if (containerType === 'range-selection') {
          const configuredNumber = Number(configuredTarget);
          result = await applyRangeSelection(
            tweak,
            configuredTarget && Number.isFinite(configuredNumber)
              ? configuredNumber
              : normalizeRangeConfig(tweak).recommendedValue,
            { suppressNotifications: confirmationBypassed }
          );
        } else if (containerType === 'fix') {
          result = await applyFix(tweak, { suppressNotifications: confirmationBypassed });
        } else if (containerType === 'one-shot-action') {
          result = await applyOneShotAction(tweak, { suppressNotifications: confirmationBypassed });
        } else {
          result = await toggleTweak(tweak, true, { suppressNotifications: confirmationBypassed });
        }
        ok = Boolean(result?.ok);
        message = result?.message || result?.code || '';
      }
    } catch (error) {
      message = error?.message || t('automation.actionFailed');
      pushToast(message, "error");
    }
    const completed = await window.desktopApi?.completeAutomationRuleAction?.({ executionId: execution.id, ok, message });
    if (completed?.state) setRuleAutomationState(completed.state);
  }

  function isCriticalTweak(tweak) {
    const risk = String(tweak?.riskLevel || tweak?.risk_level || tweak?.risk || '').trim().toLowerCase();
    const tags = Array.isArray(tweak?.tags) ? tweak.tags : [];
    return risk === 'high' || risk === 'critical' || tags.some((tag) => String(tag || '').toLowerCase().includes('critical'));
  }

  function buildAppSettingsSnapshot() {
    return {
      theme,
      language: i18n.language || '',
      settings: appSettings
    };
  }

  async function createBeforeApplyBackup(tweak, targets = [tweak]) {
    if (!appSettings?.backupData?.backupBeforeApplyingTweaks) {
      return { ok: true, skipped: true };
    }

    if (!window.desktopApi?.createBackup) {
      return {
        ok: false,
        code: 'BACKUP_API_NOT_AVAILABLE',
        message: i18n.t('interfaceText.backup_manager_is_unavailable_so_the_tweak_was_not_applied_e15e8')
      };
    }

    const scope = ['tweakStates', 'appSettings'];
    const snapshotTweaks = targets.map(toBackupTweakEntry).filter((entry) => entry.id);
    const result = await window.desktopApi.createBackup({
      engine: 'nova',
      type: 'beforeApply',
      name: `Before applying ${String(tweak?.name || 'tweak').slice(0, 80)}`,
      description: i18n.t('interfaceText.automatic_nova_config_backup_before_applying_a_tweak_de66d'),
      scope,
      snapshot: {
        tweakStates: {
          capturedAt: new Date().toISOString(),
          captureStatus: snapshotTweaks.length ? 'complete' : 'unavailable',
          itemCount: snapshotTweaks.length,
          summary: i18n.t('interfaceText.tweak_state_snapshot_before_apply_77b61'),
          data: snapshotTweaks
        },
        appSettings: {
          capturedAt: new Date().toISOString(),
          captureStatus: 'complete',
          itemCount: 1,
          summary: i18n.t('interfaceText.app_settings_snapshot_before_apply_463ca'),
          data: buildAppSettingsSnapshot()
        }
      }
    });

    if (!result?.ok) {
      return {
        ok: false,
        code: result?.code || 'BACKUP_CREATE_FAILED',
        message: result?.message || i18n.t('tweaks.confirm.backupBeforeApplyFailed')
      };
    }

    return result;
  }

  async function rememberRebootPendingTweak(tweak) {
    const id = String(tweak?.id || '').trim();
    if (!id || !normalizeRebootRequired(tweak)) {
      return;
    }

    const marker = await getCurrentBootMarker();

    setRebootPendingTweakIds((previous) => {
      const entriesById = new Map(readStoredRebootPendingEntries().map((entry) => [entry.id, entry]));
      for (const previousId of previous.map((entry) => String(entry)).filter(Boolean)) {
        if (!entriesById.has(previousId)) {
          entriesById.set(previousId, {
            id: previousId,
            markedAt: 0,
            bootStartedAt: 0
          });
        }
      }

      entriesById.set(id, {
        id,
        markedAt: marker.markedAt,
        bootStartedAt: marker.bootStartedAt
      });

      const nextEntries = Array.from(entriesById.values());
      writeStoredRebootPendingEntries(nextEntries);
      return nextEntries.map((entry) => entry.id);
    });

    setTweaks((previous) =>
      previous.map((item) =>
        String(item.id) === id
          ? {
              ...item,
              rebootPending: true
            }
          : item
      )
    );
  }

  function recordTweakActionLog(tweak, entry = {}) {
    const timestamp = new Date().toISOString();
    const nextEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      tweakId: String(tweak?.id || ''),
      tweakName: String(tweak?.name || ''),
      category: String(tweak?.category || ''),
      subcategory: String(tweak?.subcategory || ''),
      action: String(entry.action || ''),
      targetState: String(entry.targetState || ''),
      result: String(entry.result || ''),
      code: String(entry.code || ''),
      riskLevel: normalizeRiskLevel(tweak),
      requiresAdmin: normalizeRequiresAdmin(tweak),
      rebootRequired: normalizeRebootRequired(tweak),
      premium: false,
      compatibility: getTweakCompatibilityState(tweak, systemDetection).status,
      durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Math.trunc(Number(entry.durationMs))) : 0,
      message: redactActionLogMessage(entry.message).replace(/\s+/g, ' ').slice(0, 500)
    };

    setTweakActionLogs((previous) => {
      const next = [nextEntry, ...previous].slice(0, 1000);
      writeStoredArray(TWEAK_ACTION_LOG_STORAGE_KEY, next);
      return next;
    });
  }

  async function exportTweakActionLogs() {
    const rows = Array.isArray(tweakActionLogs) ? tweakActionLogs : [];
    if (!window.desktopApi?.exportTweakActionLogCsv) {
      return { ok: false, message: t('errors.apiUnavailable') };
    }
    return window.desktopApi.exportTweakActionLogCsv({ rows });
  }

  async function toggleTweak(tweak, nextEnabled, options = {}) {
    function buildExecutionErrorToast(result, fallbackCode = 'EXECUTION_FAILED') {
      const code = String(result?.code || fallbackCode || '').trim();
      if (code === 'ADMIN_BROKER_CANCELLED') {
        return t('tweaks.confirm.adminAccessDeniedMessage', { name: tweak.name });
      }
      const message = typeof result?.message === 'string' ? result.message.trim() : '';
      const stderr = typeof result?.stderr === 'string' ? result.stderr.trim() : '';
      const backendMessage = typeof result?.details?.message === 'string' ? result.details.message.trim() : '';
      const backendScript = typeof result?.details?.script === 'string' ? result.details.script.trim() : '';
      const localInstallMessage = code === 'TWEAK_NOT_INSTALLED_LOCALLY'
        ? backendMessage || i18n.t('interfaceText.this_tweak_is_not_included_in_this_nova_tweaks_version_bf1f2')
        : code === 'TWEAK_SCRIPT_MISSING'
          ? i18n.t('interfaceText.the_bundled_script_could_not_be_resolved_for_this_tweak_fd3e3')
          : code === 'REMOTE_TWEAK_SCRIPT_UNAVAILABLE'
            ? backendMessage || (backendScript
              ? `${backendScript} is not included in this app version.`
              : i18n.t('interfaceText.the_powershell_script_is_not_included_in_this_app_version_1277e'))
          : '';
      const detailSource = message || stderr;
      const firstLine = detailSource ? String(detailSource).split(/\r?\n/).find(Boolean) || '' : '';
      const detailText = localInstallMessage || firstLine;
      const detail = detailText.length > 180 ? `${detailText.slice(0, 180)}...` : detailText;
      const base = t('toasts.tweakFailed', { name: tweak.name });
      return `${base}${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`;
    }

    const scriptParams = options?.params && typeof options.params === 'object' ? options.params : {};
    const successMessageOption = options?.successMessage;
    const successMessage = typeof successMessageOption === 'string' ? successMessageOption.trim() : '';
    const successMessageFactory = typeof successMessageOption === 'function' ? successMessageOption : null;
    const suppressNotifications = Boolean(options?.suppressNotifications);
    const deferSuccessNotification = Boolean(options?.deferSuccessNotification) && nextEnabled && !suppressNotifications;
    const isStatelessExecution = isStatelessExecutionTweak(tweak);
    const targetState = nextEnabled ? 'enabled' : 'disabled';
    const actionLogAction = isStatelessExecution ? 'execute' : nextEnabled ? 'enable' : 'disable';
    const modeLabel = isStatelessExecution ? i18n.t('tweaks.oneShotAction.executeButton') : nextEnabled ? i18n.t('apply') : i18n.t('undo');
    if (!window.desktopApi?.runTweak && !window.desktopApi?.apiExecuteTweak && !window.desktopApi?.executeTweak) {
      const failedResult = {
        ok: false,
        code: 'API_NOT_AVAILABLE',
        message: t('errors.apiUnavailable'),
        stdout: '',
        stderr: t('errors.apiUnavailable')
      };

      setExecution({
        open: false,
        status: 'error',
        tweakName: tweak.name,
        tweakId: tweak.id,
        mode: modeLabel,
        progress: 100,
        stdout: '',
        stderr: t('errors.apiUnavailable'),
        code: 'API_NOT_AVAILABLE',
        message: buildExecutionErrorToast(failedResult, 'API_NOT_AVAILABLE'),
        startedAt: Date.now(),
        endedAt: Date.now()
      });

      recordTweakActionLog(tweak, {
        action: actionLogAction,
        targetState: isStatelessExecution ? '' : targetState,
        result: 'failed',
        code: failedResult.code,
        message: failedResult.message
      });
      return failedResult;
    }

    const compatibilityState = getTweakCompatibilityState(tweak, systemDetection);
    if (!suppressNotifications && nextEnabled && appSettings?.safety?.showCompatibilityWarnings !== false && compatibilityState.status === 'warning') {
      const confirmed = await requestSettingsConfirmation({
        title: t('tweaks.confirm.compatibilityTitle', { defaultValue: 'Compatibility warning' }),
        message: t('tweaks.confirm.compatibilityMessage', {
          defaultValue: '{{name}} may not be suitable for this system. {{warning}}',
          name: tweak.name,
          warning: compatibilityState.warning || ''
        }),
        confirmLabel: t('common.continue'),
        tone: 'warning'
      });
      if (!confirmed) {
        recordTweakActionLog(tweak, {
          action: actionLogAction,
          targetState: isStatelessExecution ? '' : targetState,
          result: 'cancelled',
          code: 'COMPATIBILITY_CANCELLED',
          message: compatibilityState.warning || t('tweaks.confirm.cancelled')
        });
        return {
          ok: false,
          code: 'USER_CANCELLED',
          message: t('tweaks.confirm.cancelled')
        };
      }
    }

    if (!suppressNotifications && nextEnabled && appSettings?.safety?.confirmCriticalTweaks && isCriticalTweak(tweak)) {
      const confirmed = await requestSettingsConfirmation({
        title: t('tweaks.confirm.criticalTitle'),
        message: t('tweaks.confirm.criticalMessage', { name: tweak.name }),
        confirmLabel: t('tweaks.confirm.applyTweak'),
        tone: 'danger'
      });
      if (!confirmed) {
        recordTweakActionLog(tweak, {
          action: actionLogAction,
          targetState: isStatelessExecution ? '' : targetState,
          result: 'cancelled',
          code: 'HIGH_RISK_CANCELLED',
          message: t('tweaks.confirm.cancelled')
        });
        return {
          ok: false,
          code: 'USER_CANCELLED',
          message: t('tweaks.confirm.cancelled')
        };
      }
    }

    if (!suppressNotifications && nextEnabled && appSettings?.safety?.warnBeforeRestartRequiredTweaks && tweak?.rebootRequired) {
      const confirmed = await requestSettingsConfirmation({
        title: t('tweaks.confirm.restartTitle'),
        message: t('tweaks.confirm.restartMessage', { name: tweak.name }),
        confirmLabel: t('common.continue'),
        tone: 'warning'
      });
      if (!confirmed) {
        recordTweakActionLog(tweak, {
          action: actionLogAction,
          targetState: isStatelessExecution ? '' : targetState,
          result: 'cancelled',
          code: 'REBOOT_WARNING_CANCELLED',
          message: t('tweaks.confirm.cancelled')
        });
        return {
          ok: false,
          code: 'USER_CANCELLED',
          message: t('tweaks.confirm.cancelled')
        };
      }
    }

    if (!isStatelessExecution && !suppressNotifications && nextEnabled && appSettings?.backupData?.backupBeforeApplyingTweaks) {
      const backupResult = await createBeforeApplyBackup(tweak);
      if (!backupResult?.ok) {
        pushToast(backupResult?.message || t('tweaks.confirm.backupBeforeApplyFailed'), "error");
        recordTweakActionLog(tweak, {
          action: actionLogAction,
          targetState,
          result: 'blocked',
          code: backupResult?.code || 'BACKUP_CREATE_FAILED',
          message: backupResult?.message || t('tweaks.confirm.backupBeforeApplyFailed')
        });
        return backupResult;
      }
      pushToast(t('tweaks.confirm.backupBeforeApplyCreated'), "success");
    }

    const startedAt = Date.now();

    if (!isStatelessExecution && window.desktopApi?.getTweakConfig) {
      try {
        const configResult = await window.desktopApi.getTweakConfig({ id: tweak.id });
        if (!configResult?.ok) {
          const failedResult = {
            ok: false,
            code: configResult?.code || 'TWEAK_CONFIG_LOAD_FAILED',
            message: configResult?.message || t('errors.executionFailed'),
            stdout: '',
            stderr: configResult?.message || t('errors.executionFailed')
          };
          const failedMessage = buildExecutionErrorToast(failedResult, failedResult.code);

          setExecution({
            open: false,
            status: 'error',
            tweakName: tweak.name,
            tweakId: tweak.id,
            mode: modeLabel,
            progress: 100,
            stdout: '',
            stderr: failedResult.stderr,
            code: failedResult.code,
            message: failedMessage,
            startedAt,
            endedAt: Date.now()
          });

          return failedResult;
        }
      } catch (_error) {
        // Keep execution path resilient if config prefetch fails unexpectedly.
      }
    }

    setExecution({
      open: false,
      status: 'running',
      tweakName: tweak.name,
      tweakId: tweak.id,
      mode: modeLabel,
      progress: 0,
      stdout: '',
      stderr: '',
      code: '',
      message: t('tweaks.running', { defaultValue: 'Executing tweak...' }),
      startedAt,
      endedAt: null
    });
    setGlobalOperation({
      id: `tweak:${tweak.id}`,
      label: `${tweak.name} (${modeLabel})`,
      status: 'running'
    });

    try {
      const result = window.desktopApi?.runTweak
        ? await window.desktopApi.runTweak({
            id: tweak.id,
            targetState,
            params: scriptParams,
            timeoutMs: 60000
          })
        : window.desktopApi?.apiExecuteTweak
        ? await window.desktopApi.apiExecuteTweak({
            id: tweak.id,
            targetState,
            params: scriptParams,
            timeoutMs: 60000
          })
        : await window.desktopApi.executeTweak({
            id: tweak.id,
            targetState,
            params: scriptParams,
            timeoutMs: 60000
          });

      const adminAccessDenied = result?.ok !== true && result?.code === 'ADMIN_BROKER_CANCELLED';
      if (adminAccessDenied) {
        await waitForRendererDelay(ADMIN_ACCESS_DENIED_FEEDBACK_DELAY_MS);
      }

      const successful = Boolean(result?.ok);
      const endedAt = Date.now();
      let completeDeferredSuccess = null;
      const executionMessage = successful ? '' : buildExecutionErrorToast(result, 'EXECUTION_FAILED');

      setExecution({
        open: false,
        status: successful && deferSuccessNotification ? "idle" : successful ? "success" : "error",
        tweakName: tweak.name,
        tweakId: tweak.id,
        mode: modeLabel,
        progress: 100,
        stdout: result?.stdout || '',
        stderr: result?.stderr || '',
        code: successful ? '' : result?.code || 'EXECUTION_FAILED',
        message: executionMessage,
        startedAt,
        endedAt
      });

      if (successful) {
        if (!isStatelessExecution) {
          const currentState = normalizeTweakState(result?.currentState || targetState);
        const resolvedSelectedOption =
          typeof result?.selectedOption === 'string' && result.selectedOption.trim()
            ? result.selectedOption.trim()
            : typeof scriptParams?.Selection === 'string' && scriptParams.Selection.trim()
              ? scriptParams.Selection.trim()
              : '';
        const isTimerResolutionTweak = String(tweak?.containerType || '').trim().toLowerCase() === 'timer_resolution';
        const selectedResolutionFromResult = normalizeResolutionString(
          result?.selectedResolution ??
          result?.selected_resolution ??
          result?.activeResolution ??
          result?.active_resolution
        );
        const selectedResolutionFromParams = normalizeResolutionString(
          scriptParams?.Resolution ??
          scriptParams?.resolution
        );
        const resolvedSelectedResolution = selectedResolutionFromResult || selectedResolutionFromParams;
        const currentResolutionFromResult = normalizeResolutionString(
          result?.currentResolution ??
          result?.current_resolution
        );
        const resolvedCurrentResolution = currentResolutionFromResult || resolvedSelectedResolution;
        const isRangeSelectionTweak = String(tweak?.containerType || '').trim().toLowerCase() === 'range_selection';
        const rangeValueFromResult = normalizeOptionalNumber(
          result?.currentValue ??
          result?.current_value ??
          result?.parsedDetails?.currentValue ??
          result?.parsedDetails?.current_value
        );
        const rangeValueFromParams = normalizeOptionalNumber(scriptParams?.Value);
        const resolvedRangeValue = rangeValueFromResult !== null
          ? rangeValueFromResult
          : rangeValueFromParams !== null
            ? rangeValueFromParams
            : null;
          setTweaks((previous) =>
            previous.map((item) =>
              item.id === tweak.id
                ? {
                    ...item,
                    currentState,
                    status: currentState,
                    ...(isTimerResolutionTweak
                      ? {
                          selectedResolution:
                            resolvedSelectedResolution ||
                            normalizeResolutionString(item?.selectedResolution) ||
                            normalizeResolutionString(item?.currentResolution),
                          currentResolution:
                            resolvedCurrentResolution ||
                            resolvedSelectedResolution ||
                            normalizeResolutionString(item?.currentResolution) ||
                            normalizeResolutionString(item?.selectedResolution)
                        }
                      : {}),
                    ...(resolvedSelectedOption
                      ? { selectedOption: resolvedSelectedOption }
                      : {}),
                    ...(isRangeSelectionTweak && Number.isFinite(resolvedRangeValue)
                      ? { currentValue: resolvedRangeValue }
                      : {})
                  }
                : item
            )
          );
        }

        const dynamicSuccessMessage = (() => {
          if (!successMessageFactory) {
            return '';
          }

          try {
            const nextMessage = successMessageFactory(result);
            return typeof nextMessage === 'string' ? nextMessage.trim() : '';
          } catch (_error) {
            return '';
          }
        })();
        const resolvedSuccessMessage = dynamicSuccessMessage || successMessage || (
          nextEnabled
            ? t('toasts.tweakEnabled', { name: tweak.name })
            : t('toasts.tweakDisabled', { name: tweak.name })
        );
        completeDeferredSuccess = () => {
          setExecution((previous) =>
            previous.startedAt === startedAt && previous.tweakId === tweak.id
              ? { ...previous, status: 'success', message: resolvedSuccessMessage }
              : previous
          );
        };

        if (!deferSuccessNotification) {
          completeDeferredSuccess();
        }

        if (nextEnabled && normalizeRebootRequired(tweak)) {
          await rememberRebootPendingTweak(tweak);
          if (!suppressNotifications) {
            pushToast(t('tweaks.rebootPendingToast', { defaultValue: '{{name}} requires a reboot to finish applying.', name: tweak.name }), 'warning');
          }
        }
        recordDashboardActivity(
          isStatelessExecution
            ? `Tweak executed: ${tweak.name}`
            : nextEnabled
              ? `Tweak enabled: ${tweak.name}`
              : `Tweak disabled: ${tweak.name}`,
          isStatelessExecution || nextEnabled ? "success" : 'warning'
        );
      }

      recordTweakActionLog(tweak, {
        action: actionLogAction,
        targetState: isStatelessExecution ? '' : targetState,
        result: successful ? "success" : 'failed',
        code: successful ? '' : result?.code || 'EXECUTION_FAILED',
        durationMs: endedAt - startedAt,
        message: successful ? '' : result?.message || result?.stderr || ''
      });

      if (adminAccessDenied && !suppressNotifications) {
        pushToast(executionMessage, 'warning');
      }

      if (
        !successful &&
        !adminAccessDenied &&
        !suppressNotifications &&
        isAdmin === false &&
        (result?.code === 'ADMIN_REQUIRED' || normalizeRequiresAdmin(tweak))
      ) {
        const restartAsAdmin = await requestSettingsConfirmation({
          title: t('tweaks.confirm.adminRequiredTitle'),
          message: t('tweaks.confirm.adminRequiredMessage', { name: tweak.name }),
          confirmLabel: t('status.elevate'),
          tone: 'warning'
        });
        if (restartAsAdmin) {
          const elevationResult = await handleRequestAdminRelaunch();
          if (!elevationResult?.ok) {
            pushToast(t('status.elevationFailed'), "error");
          }
        }
      }

      const normalizedResult = { ...result };
      if (isStatelessExecution) {
        delete normalizedResult.currentState;
        delete normalizedResult.status;
      }
      return {
        ...normalizedResult,
        ...(!isStatelessExecution
          ? { currentState: normalizeTweakState(result?.currentState || targetState) }
          : {}),
        ...(completeDeferredSuccess
          ? { completeDeferredSuccess }
          : {})
      };
    } catch (error) {
      const endedAt = Date.now();

      setExecution({
        open: false,
        status: 'error',
        tweakName: tweak.name,
        tweakId: tweak.id,
        mode: modeLabel,
        progress: 100,
        stdout: '',
        stderr: error?.message || t('errors.executionFailed'),
        code: 'UNEXPECTED_UI_ERROR',
        message: buildExecutionErrorToast(
          {
            code: 'UNEXPECTED_UI_ERROR',
            message: error?.message || t('errors.executionFailed'),
            stderr: ''
          },
          'UNEXPECTED_UI_ERROR'
        ),
        startedAt,
        endedAt
      });

      recordTweakActionLog(tweak, {
        action: actionLogAction,
        targetState: isStatelessExecution ? '' : targetState,
        result: 'failed',
        code: 'UNEXPECTED_UI_ERROR',
        durationMs: endedAt - startedAt,
        message: error?.message || t('errors.executionFailed')
      });
      return {
        ok: false,
        code: 'UNEXPECTED_UI_ERROR',
        message: error?.message || t('errors.executionFailed')
      };
    } finally {
      setGlobalOperation((previous) =>
        previous.id === `tweak:${tweak.id}`
          ? { ...previous, status: 'idle' }
          : previous
      );
    }
  }

  async function applyTimerResolution(tweak, resolutionValue, options = {}) {
    const normalizedResolution = normalizeResolutionString(resolutionValue) || '0.5';

    return toggleTweak(tweak, true, {
      params: {
        Resolution: normalizedResolution
      },
      successMessage: (result) => {
        const effectiveResolution = normalizeResolutionString(
          result?.selectedResolution ??
          result?.selected_resolution ??
          result?.currentResolution ??
          result?.current_resolution
        ) || normalizedResolution;
        return `${t('toasts.tweakApplied', { name: tweak.name })} (${effectiveResolution} ms)`;
      },
      suppressNotifications: Boolean(options?.suppressNotifications)
    });
  }

  async function applyPowerPlan(tweak, options = {}) {
    const result = await toggleTweak(tweak, true, {
      successMessage: t('toasts.tweakApplied', { name: tweak.name }),
      suppressNotifications: Boolean(options?.suppressNotifications)
    });

    if (result?.ok) {
      setQuickstartStepCompleted('applyNovaPowerPlan', true);
      setTweaks((previous) =>
        previous.map((item) => {
          if (String(item?.containerType || '').toLowerCase() !== 'power_plan') {
            return item;
          }

          const isSelectedPlan = item.id === tweak.id;
          return {
            ...item,
            currentState: isSelectedPlan ? 'enabled' : 'disabled',
            status: isSelectedPlan ? 'enabled' : 'disabled'
          };
        })
      );
    }

    return result;
  }

  async function applyOneShotSelection(tweak, optionValue, options = {}) {
    const selection = String(optionValue || '').trim();
    if (!selection) {
      return {
        ok: false,
        code: 'SELECTION_REQUIRED',
        message: t('tweaks.oneShotSelection.selectionRequired')
      };
    }

    return toggleTweak(tweak, true, {
      params: {
        Selection: selection
      },
      successMessage: `${t('toasts.tweakApplied', { name: tweak.name })} (${selection})`,
      suppressNotifications: Boolean(options?.suppressNotifications)
    });
  }

  async function applyRangeSelection(tweak, value, options = {}) {
    const range = normalizeRangeConfig(tweak);
    const numericValue = Number(value);
    const stepOffset = Number.isFinite(numericValue)
      ? (numericValue - range.min) / range.step
      : Number.NaN;
    const isStepAligned = Number.isFinite(stepOffset) && Math.abs(stepOffset - Math.round(stepOffset)) < 1e-8;
    if (!Number.isFinite(numericValue) || numericValue < range.min || numericValue > range.max || !isStepAligned) {
      return {
        ok: false,
        code: 'RANGE_VALUE_INVALID',
        message: t('tweaks.range.invalidValue')
      };
    }

    return toggleTweak(tweak, true, {
      params: {
        [range.parameter]: numericValue
      },
      successMessage: (result) => {
        const appliedValue = normalizeOptionalNumber(
          result?.currentValue ??
          result?.current_value ??
          result?.parsedDetails?.currentValue ??
          result?.parsedDetails?.current_value
        );
        const effectiveValue = appliedValue !== null ? appliedValue : numericValue;
        return `${t('toasts.tweakApplied', { name: tweak.name })} (${effectiveValue}${range.unit})`;
      },
      suppressNotifications: Boolean(options?.suppressNotifications)
    });
  }

  async function applyOneShotAction(tweak, options = {}) {
    return toggleTweak(tweak, true, {
      successMessage: (result) => {
        const scriptMessage = typeof result?.message === 'string' ? result.message.trim() : '';
        return scriptMessage || t('toasts.tweakApplied', { name: tweak.name });
      },
      suppressNotifications: Boolean(options?.suppressNotifications)
    });
  }

  function createFixResultPayload(tweak, result) {
    const parsedDetailsFromResult =
      result?.parsedDetails &&
      typeof result.parsedDetails === 'object' &&
      !Array.isArray(result.parsedDetails)
        ? result.parsedDetails
        : null;
    const parsedDetailsFromError =
      result?.details?.parsed?.details &&
      typeof result.details.parsed.details === 'object' &&
      !Array.isArray(result.details.parsed.details)
        ? result.details.parsed.details
        : null;

    return {
      ok: Boolean(result?.ok),
      tweakName: typeof tweak?.name === 'string' ? tweak.name.trim() : '',
      message: typeof result?.message === 'string' ? result.message.trim() : '',
      code: typeof result?.code === 'string' ? result.code.trim() : '',
      exitCode: Number.isFinite(result?.exitCode)
        ? Number(result.exitCode)
        : Number.isFinite(result?.details?.exitCode)
          ? Number(result.details.exitCode)
          : null,
      durationMs: Number.isFinite(result?.durationMs)
        ? Number(result.durationMs)
        : Number.isFinite(result?.details?.durationMs)
          ? Number(result.details.durationMs)
          : null,
      stdout: typeof result?.stdout === 'string'
        ? result.stdout
        : typeof result?.details?.stdout === 'string'
          ? result.details.stdout
          : '',
      stderr: typeof result?.stderr === 'string'
        ? result.stderr
        : typeof result?.details?.stderr === 'string'
          ? result.details.stderr
          : '',
      parsedDetails: parsedDetailsFromResult || parsedDetailsFromError || null
    };
  }

  async function applyFix(tweak, options = {}) {
    const suppressNotifications = Boolean(options?.suppressNotifications);
    const result = await toggleTweak(tweak, true, {
      successMessage: (result) => {
        const scriptMessage = typeof result?.message === 'string' ? result.message.trim() : '';
        return scriptMessage || t('toasts.tweakApplied', { name: tweak.name });
      },
      suppressNotifications
    });

    if (!suppressNotifications) {
      const code = String(result?.code || '').trim();
      if (code !== 'AUTH_REQUIRED' && code !== 'PREMIUM_REQUIRED') {
        setFixResultModal({
          open: true,
          payload: createFixResultPayload(tweak, result)
        });
      }
    }

    return result;
  }

  async function runOneClickOptimization(optimizationId, { automatic = false } = {}) {
    if (oneClickOptimization.runningId) {
      return { ok: false, code: 'ONE_CLICK_ALREADY_RUNNING' };
    }

    const labels = {
      cleanup: t('tweaks.oneClick.cleanup.title'),
      network: t('tweaks.oneClick.network.title'),
      cpu: t('tweaks.oneClick.cpu.title'),
      storage: t('tweaks.oneClick.storage.title')
    };
    const label = labels[optimizationId] || optimizationId;
    const { targets, runnable, alreadyApplied } = partitionOneClickOptimizationTargets(tweaks, optimizationId);
    const incompatible = runnable.filter((tweak) => (
      getTweakCompatibilityState(tweak, systemDetection).status === 'warning'
    ));
    const executable = runnable.filter((tweak) => !incompatible.includes(tweak));
    const skippedBeforeRun = alreadyApplied.length + incompatible.length;

    if (!targets.length) {
      setOneClickOptimization(createOneClickOptimizationState({
        optimizationId,
        completedId: optimizationId,
        phase: "idle"
      }));
      pushToast(t('tweaks.oneClick.noRecommended'), 'info');
      return { ok: false, code: 'NO_RECOMMENDED_TWEAKS' };
    }

    if (!executable.length) {
      setOneClickOptimization(createOneClickOptimizationState({
        optimizationId,
        completedId: optimizationId,
        phase: "success",
        total: targets.length,
        skipped: skippedBeforeRun,
        message: t('tweaks.oneClick.nothingToApply')
      }));
      pushToast(t('tweaks.oneClick.nothingToApply'), 'info');
      return { ok: true, successful: 0, failed: 0, skipped: skippedBeforeRun };
    }

    const requiresAdmin = executable.some((tweak) => normalizeRequiresAdmin(tweak));
    const requiresRestart = executable.some((tweak) => normalizeRebootRequired(tweak));
    const confirmed = automatic || await requestSettingsConfirmation({
      title: t('tweaks.oneClick.confirmTitle', { name: label }),
      message: t('tweaks.oneClick.confirmMessage', {
        count: executable.length,
        admin: requiresAdmin ? `\n${t('tweaks.oneClick.adminNotice')}` : '',
        restart: requiresRestart ? `\n${t('tweaks.oneClick.restartNotice')}` : ''
      }),
      confirmLabel: t('tweaks.oneClick.run'),
      tone: 'warning'
    });

    if (!confirmed) {
      return { ok: false, code: 'USER_CANCELLED' };
    }

    const normalizeContainerType = (tweak) => String(tweak?.containerType || tweak?.container_type || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const recommendedSelection = (tweak) => String(
      tweak?.recommendedSelection ||
      tweak?.recommended_selection ||
      tweak?.selections?.find?.((entry) => entry?.recommended)?.value ||
      ''
    ).trim();
    const preflight = await window.desktopApi?.apiPreflightTweaks?.({
      jobs: executable.map((tweak) => {
        const containerType = normalizeContainerType(tweak);
        let params = {};
        if (containerType === 'timer_resolution' || containerType === 'timerresolution') {
          params = { Resolution: recommendedSelection(tweak) || '0.5' };
        } else if (containerType === 'one_shot_selection' || containerType === 'oneshotselection') {
          params = { Selection: recommendedSelection(tweak) };
        } else if (containerType === 'range_selection' || containerType === 'rangeselection') {
          const range = normalizeRangeConfig(tweak);
          params = { [String(range.parameter || 'Value')]: range.recommendedValue };
        }
        return { id: String(tweak?.id || ''), targetState: 'enabled', params };
      })
    });
    if (!preflight?.ok) {
      pushToast(preflight?.message || preflight?.code || i18n.t('interfaceText.tweak_batch_preflight_failed_7051b'), "error");
      return { ok: false, code: preflight?.code || 'TWEAK_BATCH_PREFLIGHT_FAILED' };
    }

    if ((preflight.requiresAdmin || requiresAdmin) && !isAdmin) {
      const adminResult = await handleRequestAdminRelaunch();
      if (!adminResult?.ok) {
        pushToast(t('status.elevationFailed'), "error");
        return { ok: false, code: adminResult?.code || 'ADMIN_BROKER_CANCELLED' };
      }
    }

    setOneClickOptimization(createOneClickOptimizationState({
      open: !automatic,
      optimizationId,
      runningId: optimizationId,
      phase: 'backup',
      current: 0,
      total: executable.length,
      skipped: skippedBeforeRun,
      requiresRestart
    }));

    const backupResult = await createBeforeApplyBackup({ name: label }, executable);
    if (!backupResult?.ok) {
      setOneClickOptimization(createOneClickOptimizationState({
        open: !automatic,
        optimizationId,
        completedId: optimizationId,
        phase: "error",
        current: 0,
        total: executable.length,
        failed: executable.length,
        skipped: skippedBeforeRun,
        message: backupResult?.message || t('tweaks.confirm.backupBeforeApplyFailed')
      }));
      pushToast(backupResult?.message || t('tweaks.confirm.backupBeforeApplyFailed'), "error");
      return backupResult;
    }

    let successful = 0;
    let failed = 0;
    const failures = [];
    let successfulRestartRequired = false;
    for (const [index, tweak] of executable.entries()) {
      setOneClickOptimization((previous) => ({
        ...previous,
        phase: 'applying',
        currentTweakName: tweak.name || tweak.id || '',
        current: index + 1,
        total: executable.length
      }));
      const containerType = normalizeContainerType(tweak);
      let result;

      if (containerType === 'timer_resolution' || containerType === 'timerresolution') {
        result = await applyTimerResolution(tweak, recommendedSelection(tweak) || '0.5', { suppressNotifications: true });
      } else if (containerType === 'power_plan' || containerType === 'powerplan') {
        result = await applyPowerPlan(tweak, { suppressNotifications: true });
      } else if (containerType === 'one_shot_selection' || containerType === 'oneshotselection') {
        const selection = recommendedSelection(tweak);
        result = selection
          ? await applyOneShotSelection(tweak, selection, { suppressNotifications: true })
          : { ok: false, code: 'RECOMMENDED_SELECTION_MISSING' };
      } else if (containerType === 'range_selection' || containerType === 'rangeselection') {
        result = await applyRangeSelection(tweak, normalizeRangeConfig(tweak).recommendedValue, { suppressNotifications: true });
      } else if (containerType === 'fix') {
        result = await applyFix(tweak, { suppressNotifications: true });
      } else if (containerType === 'one_shot_action' || containerType === 'oneshotaction') {
        result = await applyOneShotAction(tweak, { suppressNotifications: true });
      } else {
        result = await toggleTweak(tweak, true, { suppressNotifications: true });
      }

      if (result?.ok) {
        successful += 1;
        successfulRestartRequired ||= normalizeRebootRequired(tweak);
      } else {
        failed += 1;
        failures.push(`${tweak.name || tweak.id}: ${result?.message || result?.code || t('automation.actionFailed')}`);
      }
      setOneClickOptimization((previous) => ({
        ...previous,
        successful,
        failed
      }));
    }

    const skipped = skippedBeforeRun;
    const completionPhase = failed === 0 ? "success" : successful > 0 ? 'partial' : "error";
    const summaryMessage = [t('tweaks.oneClick.summary', { successful, failed, skipped }), ...failures].join('\n');
    setOneClickOptimization(createOneClickOptimizationState({
      open: !automatic,
      optimizationId,
      completedId: optimizationId,
      phase: completionPhase,
      current: executable.length,
      total: executable.length,
      successful,
      failed,
      skipped,
      requiresRestart: successfulRestartRequired,
      message: summaryMessage
    }));
    pushToast(
      summaryMessage,
      failed ? 'warning' : "success"
    );
    recordDashboardActivity(
      t('dashboard.activity.oneClickCompleted', { name: label, successful, failed }),
      failed ? 'warning' : "success"
    );

    return { ok: failed === 0, successful, failed, skipped, message: summaryMessage };
  }

  function closeOneClickOptimization() {
    if (oneClickOptimization.runningId) {
      return;
    }
    setOneClickOptimization(createOneClickOptimizationState());
  }

  async function loadRestoreTweakCatalog(requiredIds = []) {
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(requiredIds) ? requiredIds : [])
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      )
    );
    const currentCatalog = Array.isArray(tweaks) ? tweaks : [];
    const currentIds = new Set(currentCatalog.map((entry) => String(entry?.id || '').trim()).filter(Boolean));
    const hasRequiredEntries = currentCatalog.length > 0 && normalizedIds.every((id) => currentIds.has(id));

    if (hasRequiredEntries) {
      return {
        ok: true,
        tweaks: currentCatalog
      };
    }

    if (!window.desktopApi?.listTweaks) {
      return {
        ok: false,
        code: 'API_NOT_AVAILABLE',
        message: t('errors.apiUnavailable'),
        tweaks: currentCatalog
      };
    }

    try {
      const result = await window.desktopApi.listTweaks();

      if (!result?.ok) {
        return {
          ok: false,
          code: result?.code || 'LOAD_FAILED',
          message: result?.message || t('errors.failedToLoadTweaksApi'),
          tweaks: currentCatalog
        };
      }

      const incomingTweaks = Array.isArray(result.tweaks) ? result.tweaks : [];
      const normalizedTweaks = incomingTweaks.map((tweak) => normalizeTweakForUi(tweak));

      setTweaks(normalizedTweaks);
      hasLoadedTweaksRef.current = true;

      return {
        ok: true,
        tweaks: normalizedTweaks
      };
    } catch (_error) {
      return {
        ok: false,
        code: 'LOAD_FAILED',
        message: t('errors.failedToLoadTweaksApi'),
        tweaks: currentCatalog
      };
    }
  }

  async function handleRestoreBackup(restorePlan) {
    const plan = restorePlan && typeof restorePlan === 'object' ? restorePlan : null;
    const selectedScopeIds = Array.isArray(plan?.scope)
      ? Array.from(new Set(plan.scope.map((scopeId) => String(scopeId || '').trim()).filter(Boolean)))
      : [];

    if (!plan || plan.origin !== 'nova' || !selectedScopeIds.length) {
      return {
        ok: false,
        partial: false,
        appliedScopes: [],
        errorCount: 1,
        errors: [
          {
            code: 'INVALID_RESTORE_PLAN',
            message: t('backup.notifications.restoreFailed')
          }
        ],
        requiresRestart: false,
        adminRequired: false
      };
    }

    const snapshot = plan.snapshot && typeof plan.snapshot === 'object' ? plan.snapshot : {};
    const tweakRestoreScopeIds = selectedScopeIds.filter((scopeId) => RESTORE_TWEAK_SCOPE_IDS.has(scopeId));
    const restoreEntryMap = collectRestoreEntryMap(snapshot, tweakRestoreScopeIds);
    let preflightRequiresAdmin = false;
    if (restoreEntryMap.size) {
      const jobs = Array.from(restoreEntryMap.values()).flatMap((entry) => {
        const containerType = String(entry.containerType || '').trim().toLowerCase();
        if (containerType === 'one_shot_action' || containerType === 'fix') return [];
        if (containerType === 'power_plan' && entry.currentState !== 'enabled') return [];
        let params = {};
        if (containerType === 'timer_resolution' && entry.currentState === 'enabled') {
          params = { Resolution: entry.selectedResolution || '0.5' };
        } else if (containerType === 'one_shot_selection') {
          if (!entry.selectedOption) return [];
          params = { Selection: entry.selectedOption };
        } else if (containerType === 'range_selection') {
          if (!Number.isFinite(entry.currentValue)) return [];
          params = { Value: entry.currentValue };
        }
        return [{ id: entry.id, targetState: entry.currentState, params }];
      });
      if (jobs.length) {
        const preflight = await window.desktopApi?.apiPreflightTweaks?.({ jobs });
        if (!preflight?.ok) {
          return {
            ok: false,
            partial: false,
            appliedScopes: [],
            errorCount: 1,
            errors: [{ code: preflight?.code || 'TWEAK_BATCH_PREFLIGHT_FAILED', message: preflight?.message || t('backup.notifications.restoreFailed') }],
            requiresRestart: false,
            adminRequired: Boolean(plan.adminRequired)
          };
        }
        preflightRequiresAdmin = Boolean(preflight.requiresAdmin);
      }
    }

    if ((plan.adminRequired || preflightRequiresAdmin) && !isAdmin) {
      const adminResult = await handleRequestAdminRelaunch();
      if (!adminResult?.ok) {
        return {
          ok: false,
          partial: false,
          appliedScopes: [],
          errorCount: 1,
          errors: [{
            code: adminResult?.code || 'ADMIN_BROKER_CANCELLED',
            message: t('status.elevationFailed')
          }]
        };
      }
    }

    const appliedScopeSet = new Set();
    const restoreErrors = [];
    let requiresRestart = false;

    if (selectedScopeIds.includes('appSettings')) {
      try {
        const appSettingsData = snapshot?.appSettings?.data && typeof snapshot.appSettings.data === 'object'
          ? snapshot.appSettings.data
          : {};
        const restoredTheme = appSettingsData.theme === 'light' || appSettingsData.theme === 'dark'
          ? appSettingsData.theme
          : '';
        const restoredLanguage = normalizeBackupLanguage(appSettingsData.language);

        if (appSettingsData.settings && typeof appSettingsData.settings === 'object') {
          const result = await updateAppSettings(appSettingsData.settings);
          if (!result?.ok) throw new Error(result?.message || i18n.t('interfaceText.unable_to_restore_app_settings_f476b'));
        }

        if (restoredTheme) {
          setTheme(restoredTheme);
        }

        if (restoredLanguage) {
          await i18n.changeLanguage(restoredLanguage);
        }

        appliedScopeSet.add('appSettings');
      } catch (error) {
        restoreErrors.push({
          scopeId: 'appSettings',
          code: 'APP_SETTINGS_RESTORE_FAILED',
          message: error?.message || t('backup.notifications.restoreFailed')
        });
      }
    }

    tweakRestoreScopeIds
      .filter((scopeId) => !Array.isArray(snapshot?.[scopeId]?.data) || snapshot[scopeId].data.length === 0)
      .forEach((scopeId) => appliedScopeSet.add(scopeId));

    if (tweakRestoreScopeIds.length && restoreEntryMap.size) {
        const catalogResult = await loadRestoreTweakCatalog(Array.from(restoreEntryMap.keys()));
        if (!catalogResult.ok) {
          restoreErrors.push({
            scopeId: tweakRestoreScopeIds[0],
            code: catalogResult.code || 'LOAD_FAILED',
            message: catalogResult.message || t('errors.failedToLoadTweaksApi')
          });
        } else {
          const tweakCatalog = Array.isArray(catalogResult.tweaks) ? catalogResult.tweaks : [];
          const tweakCatalogMap = new Map(
            tweakCatalog
              .map((entry) => [String(entry?.id || '').trim(), entry])
              .filter(([id]) => id)
          );
          const standardEntries = [];
          const timerEntries = [];
          const rangeEntries = [];
          const powerPlanEntries = [];
          const oneShotEntries = [];

          for (const restoreEntry of restoreEntryMap.values()) {
            const liveTweak = tweakCatalogMap.get(restoreEntry.id);
            if (!liveTweak) {
              restoreErrors.push({
                scopeId: restoreEntry.sourceScopeIds?.[0] || tweakRestoreScopeIds[0],
                code: 'RESTORE_TWEAK_NOT_FOUND',
                message: t('backup.notifications.restoreMissingTweak', {
                  name: restoreEntry.name || restoreEntry.id
                })
              });
              continue;
            }

            const effectiveTweak = {
              ...liveTweak,
              name: liveTweak.name || restoreEntry.name,
              currentState: normalizeTweakState(liveTweak.currentState),
              status: liveTweak.status || normalizeTweakState(liveTweak.currentState),
              containerType: String(liveTweak.containerType || restoreEntry.containerType || '').trim().toLowerCase(),
              selectedResolution:
                (typeof liveTweak.selectedResolution === 'string' && liveTweak.selectedResolution.trim())
                  ? liveTweak.selectedResolution.trim()
                  : restoreEntry.selectedResolution,
              selectedOption:
                (typeof liveTweak.selectedOption === 'string' && liveTweak.selectedOption.trim())
                  ? liveTweak.selectedOption.trim()
                  : restoreEntry.selectedOption,
              currentValue: normalizeOptionalNumber(liveTweak.currentValue) ?? restoreEntry.currentValue,
              requiresAdmin: Boolean(liveTweak.requiresAdmin ?? restoreEntry.requiresAdmin),
              rebootRequired: Boolean(liveTweak.rebootRequired ?? restoreEntry.rebootRequired)
            };
            const payload = {
              liveTweak: effectiveTweak,
              restoreEntry
            };

            if (effectiveTweak.containerType === 'power_plan') {
              powerPlanEntries.push(payload);
              continue;
            }

            if (effectiveTweak.containerType === 'timer_resolution') {
              timerEntries.push(payload);
              continue;
            }

            if (effectiveTweak.containerType === 'one_shot_selection') {
              oneShotEntries.push(payload);
              continue;
            }

            if (effectiveTweak.containerType === 'range_selection') {
              rangeEntries.push(payload);
              continue;
            }

            if (effectiveTweak.containerType === 'one_shot_action') {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              continue;
            }

            if (effectiveTweak.containerType === 'fix') {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              continue;
            }

            standardEntries.push(payload);
          }

          const orderedStandardEntries = [...standardEntries].sort((left, right) => {
            if (left.restoreEntry.currentState === right.restoreEntry.currentState) {
              return 0;
            }
            return left.restoreEntry.currentState === 'disabled' ? -1 : 1;
          });

          for (const { liveTweak, restoreEntry } of orderedStandardEntries) {
            const desiredEnabled = restoreEntry.currentState === 'enabled';
            const currentEnabled = liveTweak.currentState === 'enabled';

            if (currentEnabled === desiredEnabled) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              continue;
            }

            const result = await toggleTweak(liveTweak, desiredEnabled, {
              suppressNotifications: true
            });

            if (result?.ok) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              if (restoreEntry.rebootRequired || restoreEntry.sourceScopeIds.includes('bootBcd')) {
                requiresRestart = true;
              }
            } else {
              restoreErrors.push({
                scopeId: restoreEntry.sourceScopeIds?.[0] || tweakRestoreScopeIds[0],
                code: result?.code || 'RESTORE_TWEAK_FAILED',
                message: result?.message || t('toasts.tweakFailed', { name: liveTweak.name })
              });
            }
          }

          const desiredPowerPlan = powerPlanEntries.find(({ restoreEntry }) => restoreEntry.currentState === 'enabled');
          if (desiredPowerPlan) {
            const isAlreadySelected = desiredPowerPlan.liveTweak.currentState === 'enabled';
            if (isAlreadySelected) {
              desiredPowerPlan.restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
            } else {
              const result = await applyPowerPlan(desiredPowerPlan.liveTweak, {
                suppressNotifications: true
              });

              if (result?.ok) {
                desiredPowerPlan.restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
                if (desiredPowerPlan.restoreEntry.rebootRequired || desiredPowerPlan.restoreEntry.sourceScopeIds.includes('bootBcd')) {
                  requiresRestart = true;
                }
              } else {
                restoreErrors.push({
                  scopeId: desiredPowerPlan.restoreEntry.sourceScopeIds?.[0] || tweakRestoreScopeIds[0],
                  code: result?.code || 'RESTORE_POWER_PLAN_FAILED',
                  message: result?.message || t('toasts.tweakFailed', { name: desiredPowerPlan.liveTweak.name })
                });
              }
            }
          } else {
            powerPlanEntries.forEach(({ restoreEntry }) => {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
            });
          }

          for (const { liveTweak, restoreEntry } of timerEntries) {
            const desiredEnabled = restoreEntry.currentState === 'enabled';
            const desiredResolution = restoreEntry.selectedResolution || liveTweak.selectedResolution || '0.5';
            const currentEnabled = liveTweak.currentState === 'enabled';
            const currentResolution = typeof liveTweak.selectedResolution === 'string' ? liveTweak.selectedResolution.trim() : '';
            const needsApply = desiredEnabled
              ? !currentEnabled || currentResolution !== desiredResolution
              : currentEnabled;

            if (!needsApply) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              continue;
            }

            const result = desiredEnabled
              ? await applyTimerResolution(liveTweak, desiredResolution, { suppressNotifications: true })
              : await toggleTweak(liveTweak, false, { suppressNotifications: true });

            if (result?.ok) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              if (restoreEntry.rebootRequired || restoreEntry.sourceScopeIds.includes('bootBcd')) {
                requiresRestart = true;
              }
            } else {
              restoreErrors.push({
                scopeId: restoreEntry.sourceScopeIds?.[0] || tweakRestoreScopeIds[0],
                code: result?.code || 'RESTORE_TIMER_PROFILE_FAILED',
                message: result?.message || t('toasts.tweakFailed', { name: liveTweak.name })
              });
            }
          }

          for (const { liveTweak, restoreEntry } of oneShotEntries) {
            const desiredOption = String(restoreEntry.selectedOption || liveTweak.selectedOption || '').trim();
            const currentOption = String(liveTweak.selectedOption || '').trim();

            if (!desiredOption || desiredOption === currentOption) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              continue;
            }

            const result = await applyOneShotSelection(liveTweak, desiredOption, {
              suppressNotifications: true
            });

            if (result?.ok) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              if (restoreEntry.rebootRequired || restoreEntry.sourceScopeIds.includes('bootBcd')) {
                requiresRestart = true;
              }
            } else {
              restoreErrors.push({
                scopeId: restoreEntry.sourceScopeIds?.[0] || tweakRestoreScopeIds[0],
                code: result?.code || 'RESTORE_ONE_SHOT_SELECTION_FAILED',
                message: result?.message || t('toasts.tweakFailed', { name: liveTweak.name })
              });
            }
          }

          for (const { liveTweak, restoreEntry } of rangeEntries) {
            const desiredValue = normalizeOptionalNumber(restoreEntry.currentValue);
            const currentValue = normalizeOptionalNumber(liveTweak.currentValue);

            if (desiredValue === null || (currentValue !== null && currentValue === desiredValue)) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
              continue;
            }

            const result = await applyRangeSelection(liveTweak, desiredValue, {
              suppressNotifications: true
            });

            if (result?.ok) {
              restoreEntry.sourceScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
            } else {
              restoreErrors.push({
                scopeId: restoreEntry.sourceScopeIds?.[0] || tweakRestoreScopeIds[0],
                code: result?.code || 'RESTORE_RANGE_SELECTION_FAILED',
                message: result?.message || t('toasts.tweakFailed', { name: liveTweak.name })
              });
            }
          }
        }
    } else if (tweakRestoreScopeIds.length) {
      tweakRestoreScopeIds.forEach((scopeId) => appliedScopeSet.add(scopeId));
    }

    return {
      ok: restoreErrors.length === 0,
      partial: restoreErrors.length > 0 && appliedScopeSet.size > 0,
      appliedScopes: Array.from(appliedScopeSet),
      errorCount: restoreErrors.length,
      errors: restoreErrors,
      requiresRestart,
      adminRequired: Boolean(plan.adminRequired)
    };
  }

  const backupStateSnapshot = useMemo(() => {
    if (activeSection !== 'backup') {
      return null;
    }

    return {
      tweaks: tweaks.map(toBackupTweakEntry).filter((entry) => entry.id),
      theme,
      language: i18n.language || '',
      settings: appSettings
    };
  }, [activeSection, appSettings, i18n.language, theme, tweaks]);

  async function prepareBackupStateSnapshot() {
    let snapshotTweaks = tweaks;

    if (window.desktopApi?.listTweaks) {
      try {
        const result = await window.desktopApi.listTweaks();
        if (result?.ok && Array.isArray(result.tweaks) && result.tweaks.length) {
          const rebootPendingSet = new Set(rebootPendingTweakIds.map((id) => String(id)));
          const normalizedTweaks = result.tweaks.map((tweak) => {
            const normalized = normalizeTweakForUi(tweak);
            return {
              ...normalized,
              rebootPending: rebootPendingSet.has(String(normalized.id))
            };
          });
          setTweaks(normalizedTweaks);
          hasLoadedTweaksRef.current = true;
          snapshotTweaks = normalizedTweaks;
        }
      } catch (_error) {
        // Fall back to the last in-memory tweak state; the backup panel validates that it is usable.
      }
    }

    return {
      tweaks: snapshotTweaks.map(toBackupTweakEntry).filter((entry) => entry.id),
      theme,
      language: i18n.language || '',
      settings: appSettings
    };
  }

  const isGameRuntimeSection = renderedSection === 'session-monitoring' || renderedSection === 'game-mode';
  const gameModeView = renderedSection === 'session-monitoring' ? 'session-monitoring' : 'game-mode';
  const sectionSuspenseFallback = activeSection === 'tweaks'
    ? null
    : <SectionLoadingSkeleton sectionId={activeSection} label={t('common.loading')} />;
  const sectionLoadingFallback = showSectionFallback
    ? sectionSuspenseFallback
    : null;

  const navItems = [
    { id: 'session-monitoring', label: t('nav.sessionMonitoring'), subtitle: t('nav.sessionMonitoringSubtitle') },
    { id: 'game-mode', label: t('nav.gameMode'), subtitle: t('nav.gameModeSubtitle') },
    { id: 'dashboard', label: t('nav.dashboard'), subtitle: t('nav.dashboardSubtitle') },
    { id: 'overview', label: t('nav.overview'), subtitle: t('nav.overviewSubtitle') },
    { id: 'automation', label: t('nav.automation'), subtitle: t('nav.automationSubtitle'), badge: processAutomationState.unreadCount },
    { id: 'tweaks', label: t('nav.tweaks'), subtitle: t('nav.tweaksSubtitle') },
    { id: 'apps', label: t('nav.apps'), subtitle: t('nav.appsSubtitle') },
    { id: 'backup', label: t('nav.backup'), subtitle: t('nav.backupSubtitle') },
    { id: 'settings', label: t('nav.settings'), subtitle: t('nav.settingsSubtitle') }
  ];

  const commandPaletteCommands = [
    ...navItems.map((item) => ({
      id: `navigate:${item.id}`,
      label: item.label,
      description: item.subtitle,
      group: t('commandPalette.groups.navigation'),
      keywords: `navigate open page ${item.id}`,
      icon: LayoutGrid,
      onSelect: () => handleSelectSection(item.id)
    })),
    ...(activeSection === 'tweaks' ? [
      {
        id: 'tweaks:reset-filters',
        label: t('commandPalette.actions.resetFilters'),
        description: t('commandPalette.actions.resetFiltersDescription'),
        group: t('commandPalette.groups.currentPage'),
        icon: RotateCcw,
        onSelect: resetTweakFilters
      },
      {
        id: 'tweaks:refresh',
        label: t('commandPalette.actions.refreshTweaks'),
        description: t('commandPalette.actions.refreshTweaksDescription'),
        group: t('commandPalette.groups.currentPage'),
        icon: RefreshCw,
        onSelect: () => refreshTweaksTwoPhase({ notify: true })
      }
    ] : []),
    ...(activeSection === 'apps' ? [
      {
        id: 'apps:clear-search',
        label: t('commandPalette.actions.clearAppSearch'),
        description: t('commandPalette.actions.clearAppSearchDescription'),
        group: t('commandPalette.groups.currentPage'),
        icon: Search,
        onSelect: () => {
          setAppsSearchTerm('');
          setStartupSearchTerm('');
        }
      },
      {
        id: 'apps:refresh',
        label: t('commandPalette.actions.refreshApps'),
        description: t('commandPalette.actions.refreshAppsDescription'),
        group: t('commandPalette.groups.currentPage'),
        icon: RefreshCw,
        onSelect: () => {
          void loadInstalledApps({ notify: true, includeAuth: true });
          void loadStartupEntries({ notify: true, includeAuth: true });
        }
      }
    ] : []),
    ...(activeSection === 'overview' ? [
      {
        id: 'overview:customize',
        label: t('commandPalette.actions.customizeOverview'),
        description: t('commandPalette.actions.customizeOverviewDescription'),
        group: t('commandPalette.groups.currentPage'),
        icon: SlidersHorizontal,
        onSelect: () => window.dispatchEvent(new CustomEvent('nova:overview-customize'))
      },
      {
        id: 'overview:reset-session',
        label: t('commandPalette.actions.resetSession'),
        description: t('commandPalette.actions.resetSessionDescription'),
        group: t('commandPalette.groups.currentPage'),
        icon: RotateCcw,
        onSelect: () => {
          sessionStorage.removeItem(SESSION_CLEANED_BYTES_STORAGE_KEY);
          window.dispatchEvent(new CustomEvent('nova:overview-reset-session'));
        }
      }
    ] : [])
  ];

  const handleRequestAdminRelaunch = useCallback(async () => {
    const requestAccess = window.desktopApi?.requestAdminAccess || window.desktopApi?.requestAdminRelaunch;
    if (!requestAccess) {
      return { ok: false, code: 'ADMIN_BROKER_UNAVAILABLE' };
    }
    try {
      const result = await requestAccess({ reason: 'manual' });
      if (result?.state) {
        setAdminAccessState(result.state);
        setIsAdmin(Boolean(result.state.ready || result.state.alreadyElevated));
      }
      return result;
    } catch (_error) {
      return { ok: false, code: 'ADMIN_BROKER_FAILED' };
    }
  }, []);

  return (
    <div
      data-section={activeSection}
      className={`app-shell app-grid-bg min-h-screen text-[var(--text-primary)] ${activeSection === 'tweaks' ? 'is-tweaks-section' : ''}`}
    >
      <AppTitleBar />
      <SidebarNavigation
        items={navItems}
        activeSection={activeSection}
        onSelect={handleSelectSection}
        onPrefetch={handlePrefetchSection}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        adminStatus={adminStatusLabel}
        isAdmin={isAdmin}
        onRequestAdminRelaunch={handleRequestAdminRelaunch}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSupport={() => window.desktopApi?.openExternalUrl?.({ url: SUPPORT_URL })}
      />

      <CommandPalette
        open={commandPaletteOpen}
        commands={commandPaletteCommands}
        onClose={() => setCommandPaletteOpen(false)}
        title={t('commandPalette.title')}
        placeholder={t('commandPalette.placeholder')}
      />

      <div className="app-content-shell">
        <header className="app-mobile-header sticky z-20 bg-[color:var(--bg-overlay)] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3 md:px-8">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="app-region-no-drag inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)] md:hidden"
            >
              <DotsMenuIcon className="h-4 w-4" />
              {t('common.menu')}
            </button>
            <div className="hidden md:block" />
          </div>
        </header>

        <main className={`app-main-content relative mx-auto px-4 pb-10 pt-6 md:px-8 md:pt-7 ${activeSection === 'tweaks' ? 'max-w-[1440px]' : activeSection === 'overview' ? 'overview-main-viewport max-w-[1440px]' : 'max-w-[1180px]'} ${activeSection === 'dashboard' ? 'dashboard-main-viewport' : ''}`}>
          {sectionIsChanging && sectionLoadingFallback ? (
            <div className="absolute inset-x-4 top-6 z-10 md:inset-x-8 md:top-7">
              {sectionLoadingFallback}
            </div>
          ) : null}
          <div
            className={sectionIsChanging ? 'invisible pointer-events-none select-none' : ''}
            aria-hidden={sectionIsChanging || undefined}
            inert={sectionIsChanging ? '' : undefined}
          >
          <Suspense fallback={sectionSuspenseFallback}>
          {renderedSection === 'dashboard' ? (
            <Dashboard
              onNavigateSection={handleSelectSection}
              onQuickstartNavigate={handleQuickstartNavigate}
              onOpenUpdateNotes={openUpdateNotesModal}
              quickstartCompletion={quickstartCompletion}
              theme={theme}
              onThemeChange={handleThemeChange}
              activeTweaksCount={activeTweaksCount}
              activePowerPlanName={activePowerPlanName}
              appMetadata={appMetadata}
              totalTweaksCount={tweaks.length}
              startupDisabledCount={startupDisabledCount}
              startupTotalCount={dashboardStartupEntries.length}
              recentActivities={dashboardActivity}
              onRecordActivity={recordDashboardActivity}
              cleanupRecommendedCount={getOneClickOptimizationTargets(tweaks, 'cleanup').length}
              oneClickOptimization={oneClickOptimization}
              onRunOneClickOptimization={runOneClickOptimization}
            />
          ) : null}

          {renderedSection === 'overview' ? <OverviewPanel onNavigateSettings={() => handleSelectSection('settings')} /> : null}

          {renderedSection === 'automation' ? (
            <AutomationPanel
              state={processAutomationState}
              rulesState={ruleAutomationDisplayState}
              tweaks={tweaks}
              tweakCatalogStatus={
                isLoadingTweaks
                  ? 'loading'
                  : tweaksError
                    ? "error"
                    : 'ready'
              }
              busy={processAutomationBusy}
              onSaveRule={saveAutomationRule}
              onDeleteRule={deleteAutomationRule}
              onExecuteRule={executeAutomationRuleAction}
              onDismissRule={dismissAutomationRuleAction}
              onUpdateSettings={updateProcessAutomationSettings}
              onDismissAlert={(alert) => runProcessAutomationAction('dismissProcessAlert', alert)}
              onExcludeAlert={(alert) => runProcessAutomationAction('excludeProcessAlert', alert)}
              onRequestClose={(alert) => runProcessAutomationAction('requestCloseProcess', alert)}
              onForceTerminate={forceTerminateProcess}
              onClearHistory={clearProcessAutomationHistory}
            />
          ) : null}

          {isBootstrapLoading && renderedSection === 'apps' ? (
            <PageSection className="overflow-hidden p-0">
              <ListSkeleton rows={5} label={t('common.loading')} />
            </PageSection>
          ) : null}

          {isBootstrapLoading && renderedSection === 'tweaks' ? (
            <PageSection className="p-5">
              <LoadingIndicator label={t('common.loading')} />
            </PageSection>
          ) : null}

          {!isBootstrapLoading && renderedSection === 'tweaks' ? (
            <TweaksPanel
              tweaks={filteredTweaks}
              rawTweaks={tweaks}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              selectedCategory={selectedCategory}
              onCategoryChange={handleCategoryChange}
              selectedSubcategory={selectedSubcategory}
              onSubcategoryChange={setSelectedSubcategory}
              categoryStats={categoryStats}
              recommendedFilter={recommendedFilter}
              onRecommendedFilterChange={setRecommendedFilter}
              riskFilter={riskFilter}
              onRiskFilterChange={setRiskFilter}
              tagFilter={tagFilter}
              onTagFilterChange={setTagFilter}
              requiresAdminFilter={requiresAdminFilter}
              onRequiresAdminFilterChange={setRequiresAdminFilter}
              rebootRequiredFilter={rebootRequiredFilter}
              onRebootRequiredFilterChange={setRebootRequiredFilter}
              compatibilityFilter={compatibilityFilter}
              onCompatibilityFilterChange={setCompatibilityFilter}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              availableTags={availableTweakTags}
              loading={tweaksPanelLoading}
              refreshingStates={isRefreshingTweakStates}
              reloadDisabled={tweakReloadBlockedUntil > Date.now()}
              checkingStateTweakIds={checkingStateTweakIds}
              errorCode={tweaksError}
              onReload={() => refreshTweaksTwoPhase({ notify: true })}
              onToggleTweak={toggleTweak}
              onApplyTimerResolution={applyTimerResolution}
              onApplyPowerPlan={applyPowerPlan}
              onApplyOneShotSelection={applyOneShotSelection}
              onApplyRangeSelection={applyRangeSelection}
              onApplyOneShotAction={applyOneShotAction}
              onApplyFix={applyFix}
              onPreflightTweaks={(jobs) => window.desktopApi?.apiPreflightTweaks?.({ jobs })}
              onRequestAdminAccess={handleRequestAdminRelaunch}
              hasAdminAccess={Boolean(isAdmin)}
              onCreateRestorePoint={() => handleQuickstartNavigate('createRestorePoint')}
              oneClickOptimization={oneClickOptimization}
              onRunOneClickOptimization={runOneClickOptimization}
              showRiskLabels={appSettings?.safety?.showRiskLabels !== false}
              showCompatibilityWarnings={appSettings?.safety?.showCompatibilityWarnings !== false}
              mascotAnimationEnabled={appSettings?.preferences?.mascotAnimationEnabled === true}
              reducedMotion={appSettings?.preferences?.reducedMotion === true}
            />
          ) : null}

          {!isBootstrapLoading && renderedSection === 'apps' ? (
            <AppsPanel
              apps={filteredApps}
              rawApps={installedApps}
              searchTerm={appsSearchTerm}
              onSearchChange={setAppsSearchTerm}
              sortBy={appsSort}
              onSortChange={setAppsSort}
              showAppxPackages={showAppxPackages}
              onToggleShowAppxPackages={setShowAppxPackages}
              showTechnicalComponents={showTechnicalComponents}
              onToggleShowTechnicalComponents={setShowTechnicalComponents}
              loading={appsPanelLoading}
              detailsLoading={isLoadingAppDetails}
              errorCode={appsError}
              activeUninstallAppId={activeAppUninstallId}
              activeOptimizeAppId={activeAppOptimizeId}
              onReload={() => loadInstalledApps({ notify: true, includeAuth: true })}
              onRequestUninstall={handleRequestUninstallApp}
              onOptimize={handleOptimizeApp}
              onViewOptimization={handleViewAppOptimization}
              onRestoreOptimization={handleRestoreAppOptimizations}
              startupEntries={filteredStartupEntries}
              rawStartupEntries={startupEntries}
              startupSourceEntries={startupSourceEntries}
              startupStandardCount={startupStandardCount}
              startupAdditionalCount={startupAdditionalCount}
              showAdditionalStartupSources={showAdditionalStartupSources}
              onToggleShowAdditionalStartupSources={setShowAdditionalStartupSources}
              startupSearchTerm={startupSearchTerm}
              onStartupSearchChange={setStartupSearchTerm}
              startupSortBy={startupSort}
              onStartupSortChange={setStartupSort}
              navigationRequest={appsNavigationRequest}
              startupLoading={startupPanelLoading}
              startupErrorCode={startupEntriesError}
              activeStartupToggleId={activeStartupToggleId}
              activeStartupTypeChangeId={activeStartupTypeChangeId}
              onReloadStartup={() => loadStartupEntries({ notify: true, includeAuth: true })}
              onToggleStartupEnabled={handleToggleStartupEntry}
              onChangeStartupType={handleChangeStartupEntryType}
            />
          ) : null}

          {isGameRuntimeSection ? (
            <GameModePanel
              active
              view={gameModeView}
              onRuntimeStatusChange={setGlobalOperation}
            />
          ) : null}

          {renderedSection === 'backup' ? (
            <BackupRestorePanel
              onNotify={pushToast}
              appStateSnapshot={backupStateSnapshot}
              onPrepareSnapshot={prepareBackupStateSnapshot}
              onRestoreBackup={handleRestoreBackup}
              quickstartNavigationRequest={backupQuickstartNavigationRequest}
              onQuickstartEvent={handleBackupQuickstartEvent}
              onOperationStatus={updateGlobalOperationStatus}
            />
          ) : null}

          {renderedSection === 'settings' ? (
            <SettingsPanel
              settings={appSettings}
              metadata={appMetadata}
              loading={settingsLoading}
              error={settingsError}
              onUpdateSettings={updateAppSettings}
              onSetAdvancedSensorMonitoring={setAdvancedSensorMonitoring}
              onRefreshSettings={() => loadAppSettings({ notify: true })}
              onExportSettings={() => window.desktopApi?.exportSettings
                ? window.desktopApi.exportSettings()
                : { ok: false, message: t('settingsPanel.messages.exportUnavailable') }}
              onImportSettings={async () => {
                if (!window.desktopApi?.importSettings) {
                  return { ok: false, message: t('settingsPanel.messages.importUnavailable') };
                }
                const result = await window.desktopApi.importSettings();
                if (result?.ok && result.settings) {
                  applyLoadedSettings(result.settings);
                }
                return result;
              }}
              onResetSettings={resetAppSettings}
              onChooseBackupLocation={chooseBackupLocation}
              onExportDiagnostics={() => window.desktopApi?.exportDiagnosticReport
                ? window.desktopApi.exportDiagnosticReport()
                : { ok: false, message: t('settingsPanel.messages.diagnosticUnavailable') }}
              onExportTweakActionLogs={exportTweakActionLogs}
              onOpenLogsFolder={() => window.desktopApi?.openLogsFolder
                ? window.desktopApi.openLogsFolder()
                : { ok: false, message: t('settingsPanel.messages.logsUnavailable') }}
              onClearCache={() => window.desktopApi?.clearAppCache
                ? window.desktopApi.clearAppCache()
                : { ok: false, message: t('settingsPanel.messages.cacheUnavailable') }}
              onNotify={pushToast}
              onOperationStatus={updateGlobalOperationStatus}
            />
          ) : null}
          </Suspense>
          </div>
        </main>
      </div>
      <ModalShell
        open={updateNotesModalOpen}
        title={updateNotes?.title || t('dashboard.updateNotes.title', { defaultValue: 'Update Notes' })}
        description={updateNotes?.version ? t('dashboard.updateNotes.version', { defaultValue: 'Version {{version}}', version: updateNotes.version }) : ''}
        onClose={() => setUpdateNotesModalOpen(false)}
        closeLabel={t('common.close')}
        size="lg"
      >
        {updateNotesLoading ? (
          <div className="grid gap-3" role="status" aria-label={t('common.loading')} aria-busy="true">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : (
          <div className="update-notes-modal">
            <div className="relative overflow-hidden rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-500/15 via-[var(--surface-elevated)] to-violet-500/10 p-4">
              <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-blue-500/15 blur-3xl" />
              <div className="relative flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-blue-400/25 bg-blue-500/15 text-blue-300 shadow-[0_8px_28px_rgba(59,130,246,0.14)]">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{i18n.t('interfaceText.local_by_design_145b1')}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{i18n.t('interfaceText.tweaks_and_scripts_ship_with_this_app_version_no_account_or_nova__ad1e3')}</p>
                </div>
              </div>
              <div className="relative mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-black/15 px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                  <PackageCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> {i18n.t('interfaceText.bundled_integrity_dc010')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-black/15 px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" /> {i18n.t('interfaceText.no_login_7918f')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-black/15 px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                  <RefreshCw className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" /> {i18n.t('interfaceText.manual_releases_0e497')}
                </span>
              </div>
            </div>
            {updateNotes?.updatedAt ? <p className="mt-4 text-xs font-medium text-[var(--text-muted)]">{updateNotes.updatedAt}</p> : null}
            {updateNotes?.body ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[var(--text-secondary)]">{updateNotes.body}</p> : null}
            {updateNotes?.downloadUrl || updateNotes?.sha256 || updateNotes?.minimumSupportedVersion ? (
              <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-secondary)]">
                {updateNotes.downloadUrl ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm"
                    onClick={() => window.desktopApi?.openExternalUrl?.({ url: updateNotes.downloadUrl })}
                  >
                    {t('dashboard.updateNotes.download', { defaultValue: 'Open download' })}
                  </button>
                ) : null}
                {updateNotes.sha256 ? <p className="mt-3 break-all font-mono text-xs">SHA256: {updateNotes.sha256}</p> : null}
                {updateNotes.minimumSupportedVersion ? (
                  <p className="mt-2 text-xs">
                    {t('dashboard.updateNotes.minimumSupportedVersion', {
                      defaultValue: 'Minimum supported version: {{version}}',
                      version: updateNotes.minimumSupportedVersion
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
            {updateNotes?.items?.length ? (
              <ul className="mt-3 space-y-2">
                {updateNotes.items.map((item, index) => (
                  <li key={`${item}-${index}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </ModalShell>
      <ConfirmModal
        open={uninstallAppConfirm.open}
        title={t('apps.confirmUninstallTitle')}
        message={t('apps.confirmUninstallMessage', {
          name: uninstallAppConfirm?.app?.name || ''
        })}
        confirmLabel={t('apps.uninstall')}
        cancelLabel={t('common.cancel')}
        loading={Boolean(activeAppUninstallId)}
        onCancel={() => {
          if (!activeAppUninstallId) {
            setUninstallAppConfirm({ open: false, app: null });
          }
        }}
        onConfirm={confirmUninstallApp}
      />
      <ConfirmModal
        open={settingsConfirm.open}
        title={settingsConfirm.title}
        message={settingsConfirm.message}
        confirmLabel={settingsConfirm.confirmLabel}
        cancelLabel={t('common.cancel')}
        tone={settingsConfirm.tone}
        onCancel={() => resolveSettingsConfirmation(false)}
        onConfirm={() => resolveSettingsConfirmation(true)}
      />
      <FixResultModal
        open={fixResultModal.open}
        payload={fixResultModal.payload}
        onClose={() => setFixResultModal({ open: false, payload: null })}
      />
      <OneClickOptimizationModal
        state={oneClickOptimization}
        onClose={closeOneClickOptimization}
      />
      <AppOptimizationModal
        state={appOptimizationModal}
        onClose={closeAppOptimizationModal}
        onApplyRecommended={(actionIds) => {
          const appEntry = appOptimizationModal.app || appOptimizationModal.analysis?.app;
          if (appEntry) void startAppOptimization(appEntry, actionIds);
        }}
        onApplyAction={(actionId) => {
          const appEntry = appOptimizationModal.app || appOptimizationModal.analysis?.app;
          if (appEntry) void startAppOptimization(appEntry, [actionId]);
        }}
        onConfirmClose={confirmAppOptimizationClose}
        onCancel={cancelAppOptimization}
        onReset={resetAppOptimizations}
      />
      <ProcessAlertCard
        alert={processAutomationState.currentAlerts?.[0]}
        onClose={(alert) => runProcessAutomationAction('requestCloseProcess', alert)}
        onDismiss={(alert) => runProcessAutomationAction('dismissProcessAlert', alert)}
        onForce={forceTerminateProcess}
        onOpen={() => handleSelectSection('automation')}
      />
      <RuleNotificationOverlay
        notifications={ruleNotifications}
        onDismiss={dismissRuleNotification}
      />
      {!processAutomationState.currentAlerts?.length && highlightedPendingRuleAction && !adminRuleApprovalBusy && (pendingAdminRuleActions.length > 0 || activeSection !== 'automation') ? (
        <aside className="fixed right-5 top-20 z-[64] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[var(--warning)]/40 bg-[var(--surface-strong)] p-4 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--warning)]">{t(highlightedPendingRuleAction.blockedReason === 'awaitingAdmin' ? 'ruleAutomation.awaitingAdmin' : 'ruleAutomation.pendingAction')}</p>
          {pendingAdminRuleActions.length > 0 ? (
            <>
              <p className="mt-1 font-semibold">{t('ruleAutomation.adminApprovalSummary', { count: pendingAdminRuleActions.length })}</p>
              <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1" aria-label={t('ruleAutomation.adminApprovalSummary', { count: pendingAdminRuleActions.length })}>
                {pendingAdminRuleActions.map((execution) => (
                  <li key={execution.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-2">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{execution.ruleName}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{t(`ruleAutomation.actions.${execution.action.type}`)}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="mt-1 font-semibold">{highlightedPendingRuleAction.ruleName}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t(`ruleAutomation.actions.${highlightedPendingRuleAction.action.type}`)}</p>
            </>
          )}
          <div className="mt-3 flex gap-2"><Button size="sm" variant="primary" onClick={() => executeAutomationRuleAction(highlightedPendingRuleAction)}>{t(highlightedPendingRuleAction.blockedReason === 'awaitingAdmin' ? 'ruleAutomation.approveAdmin' : 'ruleAutomation.execute')}</Button><Button size="sm" variant="ghost" onClick={() => handleSelectSection('automation')}>{t('ruleAutomation.open')}</Button></div>
        </aside>
      ) : null}
      <GlobalOperationStatus
        execution={execution}
        operation={globalOperation}
        t={t}
        suppressed={oneClickOptimization.open || appOptimizationModal.open}
      />
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        offsetTop={['running', 'success', 'error'].includes(execution?.status) || globalOperation?.status === 'running'}
      />
    </div>
  );
}

export default App;
