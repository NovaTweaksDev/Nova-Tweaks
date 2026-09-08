import i18n from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useTranslation } from 'react-i18next';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as SelectPrimitive from '@radix-ui/react-select';
import { useAppPortalContainer } from './ui/useAppPortalContainer';
import {
  Activity,
  BatteryCharging,
  Check,
  CircleCheck,
  ChevronDown,
  CircuitBoard,
  Clock,
  Cpu,
  DatabaseBackup,
  FileText,
  Gpu,
  HardDrive,
  HeartPulse,
  History,
  Maximize2,
  MemoryStick,
  MonitorCog,
  Pencil,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Thermometer,
  Trash2,
  Wifi,
  X
} from 'lucide-react';
import HardwareDetailsModal from './HardwareDetailsModal';
import AdvancedSensorsPrompt from './AdvancedSensorsPrompt';
import { IconContainer, LoadingSpinner, ModalShell, PageHeadingSignal, PageSection, PageShell } from './ui';
import { bundledHardwareCatalogs } from '../utils/hardwareCatalog';

const HISTORY_LIMIT = 60;
const DASHBOARD_CURRENT_LAYOUT_STORAGE_KEY = 'nova-tweaks:dashboard-current-layout:v1';
const DASHBOARD_SAVED_LAYOUTS_STORAGE_KEY = 'nova-tweaks:dashboard-saved-layouts:v1';
const DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY = 'nova-tweaks:dashboard-active-layout:v1';
const TOP_WIDGET_IDS = ['createBackup', 'lastBackup', 'activeTweaks', 'windowsVersion', 'activePowerPlan'];
const SECONDARY_WIDGET_IDS = ['systemUptime', 'cpuTemperature', 'gpuTemperature', 'memoryUsage'];
const SIDE_WIDGET_IDS = ['recentActivity', 'systemHealth', 'temperaturePeaks'];
const QUICK_ACTION_IDS = ['powerPlan', 'gameMode', 'cleanTemporaryFiles'];
const DEFAULT_DASHBOARD_LAYOUT = Object.freeze({
  topWidget: 'createBackup',
  secondaryWidget: 'systemUptime',
  sideWidget: 'recentActivity',
  quickActions: QUICK_ACTION_IDS
});
const DETAIL_BIT_UNITS = [
  { threshold: 1_000_000_000_000, suffix: 'Tbit/s', fractionDigits: 2 },
  { threshold: 1_000_000_000, suffix: 'Gbit/s', fractionDigits: 2 },
  { threshold: 1_000_000, suffix: 'Mbit/s', fractionDigits: 2 },
  { threshold: 1_000, suffix: 'kbit/s', fractionDigits: 1 }
];
const MOTHERBOARD_VENDOR_HINTS = [
  'Micro-Star International Co., Ltd.',
  'ASUSTeK COMPUTER INC.',
  'Gigabyte Technology Co., Ltd.',
  'ASRock',
  'BIOSTAR Group',
  'EVGA',
  'Dell Inc.',
  'Hewlett-Packard',
  'HP',
  'LENOVO',
  'Acer',
  'MSI',
  'ASUS',
  'Gigabyte'
];
const LUCIDE_ICON_PROPS = {
  size: 18,
  strokeWidth: 1.8
};

function normalizeDashboardLayout(value) {
  const source = value && typeof value === 'object' ? value : {};
  const quickActions = Array.isArray(source.quickActions)
    ? QUICK_ACTION_IDS.filter((id) => source.quickActions.includes(id))
    : DEFAULT_DASHBOARD_LAYOUT.quickActions;

  return {
    topWidget: TOP_WIDGET_IDS.includes(source.topWidget) ? source.topWidget : DEFAULT_DASHBOARD_LAYOUT.topWidget,
    secondaryWidget: SECONDARY_WIDGET_IDS.includes(source.secondaryWidget) ? source.secondaryWidget : DEFAULT_DASHBOARD_LAYOUT.secondaryWidget,
    sideWidget: SIDE_WIDGET_IDS.includes(source.sideWidget) ? source.sideWidget : DEFAULT_DASHBOARD_LAYOUT.sideWidget,
    quickActions: quickActions.length ? quickActions : DEFAULT_DASHBOARD_LAYOUT.quickActions
  };
}

function readStoredDashboardLayout() {
  try {
    return normalizeDashboardLayout(JSON.parse(localStorage.getItem(DASHBOARD_CURRENT_LAYOUT_STORAGE_KEY) || 'null'));
  } catch (_error) {
    return normalizeDashboardLayout(null);
  }
}

function readSavedDashboardLayouts() {
  try {
    const stored = JSON.parse(localStorage.getItem(DASHBOARD_SAVED_LAYOUTS_STORAGE_KEY) || '[]');
    return Array.isArray(stored)
      ? stored
        .filter((entry) => entry?.id && String(entry?.name || '').trim() && entry?.layout)
        .map((entry) => ({
          id: String(entry.id),
          name: String(entry.name).trim(),
          layout: normalizeDashboardLayout(entry.layout)
        }))
      : [];
  } catch (_error) {
    return [];
  }
}

function readActiveDashboardLayoutId() {
  try {
    return localStorage.getItem(DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY) || '';
  } catch (_error) {
    return '';
  }
}

function dashboardLayoutsMatch(left, right) {
  return JSON.stringify(normalizeDashboardLayout(left)) === JSON.stringify(normalizeDashboardLayout(right));
}

function createEmptySystemDetection() {
  return {
    updatedAt: 0,
    cpu: {
      detected: false,
      name: ''
    },
    gpu: {
      detected: false,
      primary: '',
      secondary: [],
      all: []
    },
    ram: {
      detected: false,
      totalBytes: null,
      label: '',
      type: '',
      speedMTs: null,
      manufacturer: '',
      partNumber: '',
      moduleCount: 0
    },
    motherboard: {
      detected: false,
      name: ''
    }
  };
}

function normalizeTextValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const text = normalizeTextValue(value);
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(text);
  }

  return normalized;
}

function normalizeSystemDetection(payload) {
  const fallback = createEmptySystemDetection();
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const cpuName = normalizeTextValue(payload?.cpu?.name);
  const gpuPrimary = normalizeTextValue(payload?.gpu?.primary);
  const gpuSecondary = normalizeStringArray(payload?.gpu?.secondary);
  const gpuAll = normalizeStringArray(payload?.gpu?.all);
  const ramLabel = normalizeTextValue(payload?.ram?.label);
  const ramTotalBytes = Number(payload?.ram?.totalBytes);
  const ramType = normalizeTextValue(payload?.ram?.type);
  const ramSpeedMTs = Number(payload?.ram?.speedMTs);
  const ramManufacturer = normalizeTextValue(payload?.ram?.manufacturer);
  const ramPartNumber = normalizeTextValue(payload?.ram?.partNumber);
  const ramModuleCount = Number(payload?.ram?.moduleCount);
  const motherboardName = normalizeTextValue(payload?.motherboard?.name);

  return {
    updatedAt: Number(payload?.updatedAt) || Date.now(),
    cpu: {
      detected: Boolean(payload?.cpu?.detected) && Boolean(cpuName),
      name: cpuName
    },
    gpu: {
      detected: Boolean(payload?.gpu?.detected) && Boolean(gpuPrimary),
      primary: gpuPrimary,
      secondary: gpuSecondary.filter((name) => name.toLowerCase() !== gpuPrimary.toLowerCase()),
      all: gpuAll.length ? gpuAll : [gpuPrimary, ...gpuSecondary].filter(Boolean)
    },
    ram: {
      detected: Boolean(payload?.ram?.detected) && Number.isFinite(ramTotalBytes) && ramTotalBytes > 0,
      totalBytes: Number.isFinite(ramTotalBytes) && ramTotalBytes > 0 ? ramTotalBytes : null,
      label: ramLabel,
      type: ramType,
      speedMTs: Number.isFinite(ramSpeedMTs) && ramSpeedMTs > 0 ? Math.round(ramSpeedMTs) : null,
      manufacturer: ramManufacturer,
      partNumber: ramPartNumber,
      moduleCount: Number.isFinite(ramModuleCount) && ramModuleCount > 0 ? Math.trunc(ramModuleCount) : 0
    },
    motherboard: {
      detected: Boolean(payload?.motherboard?.detected) && Boolean(motherboardName),
      name: motherboardName
    }
  };
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(100, number));
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatGigabytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return '0.00 GB';
  }
  return `${number.toFixed(2)} GB`;
}

function normalizeTemperature(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 150) {
    return null;
  }

  return number;
}

function formatTemperature(value, locale, fallback) {
  const number = normalizeTemperature(value);
  return number === null
    ? fallback
    : `${formatLocalizedNumber(number, locale, 1)} \u00b0C`;
}

function formatRamBytes(value, locale) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }

  const gib = bytes / (1024 ** 3);
  if (gib >= 100) {
    return `${formatLocalizedNumber(gib, locale, 0)} GB`;
  }

  if (gib >= 10) {
    return `${formatLocalizedNumber(gib, locale, 1)} GB`;
  }

  return `${formatLocalizedNumber(gib, locale, 2)} GB`;
}

function formatRamTypeLabel(value, t) {
  const type = normalizeTextValue(value);
  if (!type) {
    return '';
  }

  const normalized = type.toLowerCase();
  if (normalized === 'mixed') {
    return t('dashboard.systemDetection.ramType.mixed');
  }

  if (normalized === 'unknown') {
    return t('dashboard.systemDetection.ramType.unknown');
  }

  return type;
}

function buildRamFallbackLabel(ram, locale, t) {
  if (!ram || typeof ram !== 'object') {
    return '';
  }

  const segments = [];
  const capacityLabel = formatRamBytes(ram.totalBytes, locale);
  const typeLabel = formatRamTypeLabel(ram.type, t);
  const speedMTs = Number(ram.speedMTs);
  const speedLabel = Number.isFinite(speedMTs) && speedMTs > 0 ? `${formatLocalizedNumber(speedMTs, locale, 0)} MT/s` : '';
  const vendorLabel = normalizeTextValue(ram.manufacturer) || normalizeTextValue(ram.partNumber);

  if (capacityLabel) {
    segments.push(capacityLabel);
  }

  if (typeLabel) {
    segments.push(typeLabel);
  }

  if (speedLabel) {
    segments.push(speedLabel);
  }

  if (vendorLabel) {
    segments.push(vendorLabel);
  }

  return segments.join(' \u00b7 ');
}

function normalizeHardwareName(value) {
  return normalizeTextValue(value).replace(/\s+/g, ' ');
}

function splitCpuCardLines(value) {
  const normalized = normalizeHardwareName(value);
  if (!normalized) {
    return { primary: '', secondary: '' };
  }

  const coreSuffixMatch = normalized.match(/\s+(\d+\s*[- ]?Core Processor)$/i);
  if (coreSuffixMatch && coreSuffixMatch.index > 0) {
    return {
      primary: normalized.slice(0, coreSuffixMatch.index).trim(),
      secondary: normalizeHardwareName(coreSuffixMatch[1])
    };
  }

  const clockMatch = normalized.match(/\s+@\s+([0-9.]+\s*GHz)$/i);
  if (clockMatch && clockMatch.index > 0) {
    return {
      primary: normalized.slice(0, clockMatch.index).trim(),
      secondary: `@ ${normalizeHardwareName(clockMatch[1])}`
    };
  }

  const commaIndex = normalized.indexOf(',');
  if (commaIndex > 0 && commaIndex < normalized.length - 1 && normalized.length > 48) {
    return {
      primary: normalized.slice(0, commaIndex).trim(),
      secondary: normalized.slice(commaIndex + 1).trim()
    };
  }

  return { primary: normalized, secondary: '' };
}

function splitMotherboardCardLines(value) {
  const normalized = normalizeHardwareName(value);
  if (!normalized) {
    return { primary: '', secondary: '' };
  }

  const lowerName = normalized.toLowerCase();
  for (const hint of MOTHERBOARD_VENDOR_HINTS) {
    const vendor = normalizeHardwareName(hint);
    if (!vendor) {
      continue;
    }

    const lowerVendor = vendor.toLowerCase();
    const vendorIndex = lowerName.indexOf(lowerVendor);
    if (vendorIndex === -1) {
      continue;
    }

    if (vendorIndex === 0) {
      const model = normalized.slice(vendor.length).replace(/^[,\-/| ]+/, '').trim();
      if (model) {
        return { primary: model, secondary: vendor };
      }
      break;
    }

    const leadingModel = normalized.slice(0, vendorIndex).replace(/[,\-/| ]+$/, '').trim();
    if (leadingModel) {
      return { primary: leadingModel, secondary: vendor };
    }
  }

  const pipeSplit = normalized.split(/\s*\|\s*/).map((part) => normalizeHardwareName(part)).filter(Boolean);
  if (pipeSplit.length >= 2) {
    return { primary: pipeSplit[0], secondary: pipeSplit.slice(1).join(' | ') };
  }

  return { primary: normalized, secondary: '' };
}

function buildRamCardLines(ram, locale, t) {
  const capacityLabel = formatRamBytes(ram?.totalBytes, locale);
  const typeLabel = formatRamTypeLabel(ram?.type, t);
  const speedNumber = Number(ram?.speedMTs);
  const speedLabel = Number.isFinite(speedNumber) && speedNumber > 0 ? `${formatLocalizedNumber(speedNumber, locale, 0)} MT/s` : '';
  const vendorLabel = normalizeHardwareName(ram?.manufacturer) || normalizeHardwareName(ram?.partNumber);

  let primary = [capacityLabel, typeLabel].filter(Boolean).join(' ');
  let secondary = [speedLabel, vendorLabel].filter(Boolean).join(' \u00b7 ');

  if (!primary || !secondary) {
    const fallbackLabel = normalizeHardwareName(ram?.label) || buildRamFallbackLabel(ram, locale, t);
    if (fallbackLabel) {
      const fallbackParts = fallbackLabel
        .split(/\s*(?:\u00b7|\|)\s*/u)
        .map((part) => normalizeHardwareName(part))
        .filter(Boolean);

      if (!primary && fallbackParts.length > 0) {
        primary = fallbackParts.shift() || '';
      }

      if (!secondary && fallbackParts.length > 0) {
        secondary = fallbackParts.join(' \u00b7 ');
      }

      if (!primary && !secondary) {
        primary = fallbackLabel;
      }
    }
  }

  return { primary, secondary };
}
function normalizeRateBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return number;
}

function formatLocalizedNumber(value, locale, maximumFractionDigits) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function formatRate(value, locale) {
  const number = normalizeRateBytes(value);
  return formatRateBitsDetailed(number, locale);
}

function formatRateBitsDetailed(value, locale) {
  const bytesPerSecond = normalizeRateBytes(value);
  if (bytesPerSecond <= 0) {
    return '0 bit/s';
  }

  const bitsPerSecond = bytesPerSecond * 8;

  for (const { threshold, suffix, fractionDigits } of DETAIL_BIT_UNITS) {
    if (bitsPerSecond >= threshold) {
      return `${formatLocalizedNumber(bitsPerSecond / threshold, locale, fractionDigits)} ${suffix}`;
    }
  }

  return `${formatLocalizedNumber(bitsPerSecond, locale, 0)} bit/s`;
}

function normalizeMetrics(metrics) {
  const memoryNumber = Number(metrics?.memoryUsedGB ?? metrics?.memoryUsage ?? metrics?.memory);

  return {
    cpu: clampPercent(metrics?.cpu ?? metrics?.cpuLoad),
    cpuTemp: normalizeTemperature(metrics?.cpuTemp),
    memory: Number.isFinite(memoryNumber) ? Math.max(0, memoryNumber) : 0,
    gpu: clampPercent(metrics?.gpu ?? metrics?.gpuLoad),
    gpuTemp: normalizeTemperature(metrics?.gpuTemp),
    networkIn: Math.max(0, Number(metrics?.networkIn) || 0),
    networkOut: Math.max(0, Number(metrics?.networkOut) || 0),
    timestamp: Number(metrics?.timestamp) || Date.now()
  };
}

function appendHistory(previous, sample) {
  const next = {
    timestamps: [...previous.timestamps, sample.timestamp],
    cpu: [...previous.cpu, sample.cpu],
    memory: [...previous.memory, sample.memory],
    gpu: [...previous.gpu, sample.gpu],
    networkIn: [...previous.networkIn, sample.networkIn],
    networkOut: [...previous.networkOut, sample.networkOut]
  };

  if (next.timestamps.length <= HISTORY_LIMIT) {
    return next;
  }

  return {
    timestamps: next.timestamps.slice(-HISTORY_LIMIT),
    cpu: next.cpu.slice(-HISTORY_LIMIT),
    memory: next.memory.slice(-HISTORY_LIMIT),
    gpu: next.gpu.slice(-HISTORY_LIMIT),
    networkIn: next.networkIn.slice(-HISTORY_LIMIT),
    networkOut: next.networkOut.slice(-HISTORY_LIMIT)
  };
}

function createInitialMetricsState() {
  return {
    current: {
      cpu: 0,
      cpuTemp: null,
      memory: 0,
      gpu: 0,
      gpuTemp: null,
      networkIn: 0,
      networkOut: 0,
      timestamp: Date.now()
    },
    history: {
      timestamps: [],
      cpu: [],
      memory: [],
      gpu: [],
      networkIn: [],
      networkOut: []
    }
  };
}

const dashboardRuntimeCache = {
  metricsState: createInitialMetricsState(),
  systemDetection: createEmptySystemDetection(),
  systemDetectionCapturedAt: 0,
  systemUptime: {
    milliseconds: 0,
    capturedAt: 0
  },
  lastBackup: null,
  gameModeActive: false,
  customWidgetCapturedAt: 0,
  temperaturePeaks: {
    cpu: null,
    gpu: null
  }
};

function createFallbackMetrics(previous) {
  const baseline = previous || {
    cpu: 35,
    memory: 12.5,
    gpu: 28,
    networkIn: 40 * 1024,
    networkOut: 12 * 1024
  };

  const cpu = clampPercent(baseline.cpu + (Math.random() * 10 - 5));
  const memory = Math.max(0, baseline.memory + (Math.random() * 0.3 - 0.15));
  const gpu = clampPercent(baseline.gpu + (Math.random() * 12 - 6));
  const networkIn = Math.max(0, baseline.networkIn + (Math.random() * 80 * 1024 - 40 * 1024));
  const networkOut = Math.max(0, baseline.networkOut + (Math.random() * 30 * 1024 - 15 * 1024));

  return {
    cpu,
    cpuTemp: null,
    memory,
    gpu,
    gpuTemp: null,
    networkIn,
    networkOut,
    timestamp: Date.now()
  };
}

function formatUptime(milliseconds) {
  const totalMinutes = Math.max(1, Math.floor(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatActivityTime(timestamp, now = Date.now()) {
  const elapsedMs = Math.max(0, Number(now || Date.now()) - Number(timestamp || 0));
  const minutes = Math.floor(elapsedMs / 60000);

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(value, locale, fallback) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp);
}

function formatWindowsVersion(metadata, fallback) {
  const platform = String(metadata?.platform || '').toLowerCase();
  const release = String(metadata?.release || '').trim();
  if (platform !== 'win32' || !release) {
    return fallback;
  }

  const build = Number.parseInt(release.split('.')[2] || '', 10);
  if (Number.isFinite(build) && build >= 22000) {
    return `Windows 11 · ${release}`;
  }
  if (Number.isFinite(build) && build >= 10240) {
    return `Windows 10 · ${release}`;
  }
  return `Windows · ${release}`;
}

function DashboardTopIcon({ icon: Icon, tone = 'accent' }) {
  return (
    <IconContainer className={`dashboard-top-row-icon dashboard-top-row-icon--${tone}`}>
      <Icon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
    </IconContainer>
  );
}

function BackupHeroIllustration() {
  return (
    <svg className="dashboard-top-row-backup-hero" viewBox="0 0 210 160" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="backupHeroAccent" x1="34" y1="18" x2="165" y2="138" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--accent-secondary)" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id="backupHeroSurface" x1="64" y1="105" x2="148" y2="145" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--surface-hover)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--surface)" stopOpacity="0.26" />
        </linearGradient>
      </defs>
      <ellipse className="dashboard-top-row-backup-orbit" cx="111" cy="79" rx="77" ry="28" transform="rotate(-24 111 79)" />
      <path className="dashboard-top-row-backup-platform" d="M54 116 103 91c5-3 13-3 18 0l44 22c5 3 5 8 0 10l-49 25c-5 3-13 3-18 0l-44-22c-5-3-5-8 0-10Z" />
      <path className="dashboard-top-row-backup-platform dashboard-top-row-backup-platform--lower" d="M63 129 105 108c4-2 10-2 14 0l37 18c4 2 4 6 0 8l-42 21c-4 2-10 2-14 0l-37-18c-4-2-4-6 0-8Z" />
      <g className="dashboard-top-row-backup-core">
        <ellipse cx="111" cy="54" rx="28" ry="13" fill="url(#backupHeroAccent)" />
        <path d="M83 54v51c0 7 13 13 28 13s28-6 28-13V54c0 7-13 13-28 13S83 61 83 54Z" fill="url(#backupHeroAccent)" opacity="0.68" />
        <path d="M83 73c0 7 13 13 28 13s28-6 28-13M83 92c0 7 13 13 28 13s28-6 28-13" fill="none" stroke="var(--text-primary)" strokeOpacity="0.24" strokeWidth="2" />
        <path d="M92 51c6-5 29-7 39 0" fill="none" stroke="var(--text-primary)" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path className="dashboard-top-row-backup-shield" d="M111 22 141 34v28c0 24-15 39-30 46-15-7-30-22-30-46V34l30-12Z" />
      <circle className="dashboard-top-row-backup-node dashboard-top-row-backup-node--left" cx="39" cy="101" r="4" />
      <circle className="dashboard-top-row-backup-node dashboard-top-row-backup-node--right" cx="176" cy="40" r="5" />
    </svg>
  );
}

function BackupCard({ t, onAction }) {
  return (
    <article className="dashboard-top-row-card dashboard-top-row-card--backup">
      <BackupHeroIllustration />
      <div className="dashboard-top-row-card-content dashboard-top-row-card-content--backup">
        <div className="dashboard-top-row-card-header">
          <div className="dashboard-top-row-title-group">
            <DashboardTopIcon icon={DatabaseBackup} tone="accent" />
            <h2 className="dashboard-top-row-label">{t('dashboard.actions.createBackup.title')}</h2>
          </div>
        </div>

        <div className="dashboard-top-row-copy">
          <p className="dashboard-top-row-headline">{t('dashboard.actions.createBackup.primary')}</p>
          <p className="dashboard-top-row-description">{t('dashboard.actions.createBackup.secondary')}</p>
        </div>

        <div className="dashboard-top-row-footer dashboard-top-row-footer--backup">
          <button type="button" onClick={onAction} className="ui-btn ui-btn-primary dashboard-top-row-primary-button">
            <DatabaseBackup {...LUCIDE_ICON_PROPS} className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('dashboard.actions.createBackup.action')}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function DashboardFeatureVisual({ variant }) {
  if (variant === 'activeTweaks') {
    return (
      <div className="dashboard-feature-visual dashboard-feature-visual--tweaks" aria-hidden="true">
        <span className="dashboard-feature-tweaks-icon">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.55} />
        </span>
        <span className="dashboard-feature-visual-caption">{i18n.t('interfaceText.active_c7263')}</span>
        <span className="dashboard-feature-grid">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </span>
      </div>
    );
  }

  if (variant === 'windowsVersion') {
    return (
      <div className="dashboard-feature-visual dashboard-feature-visual--windows" aria-hidden="true">
        <span className="dashboard-feature-window-mark">
          {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
        </span>
      </div>
    );
  }

  const VisualIcon = variant === 'lastBackup' ? History : BatteryCharging;
  return (
    <div className={`dashboard-feature-visual dashboard-feature-visual--${variant}`} aria-hidden="true">
      <span className="dashboard-feature-orbit" />
      <span className="dashboard-feature-orbit dashboard-feature-orbit--inner" />
      <VisualIcon className="dashboard-feature-visual-icon" strokeWidth={1.5} />
    </div>
  );
}

function DashboardInfoCard({ variant, icon: Icon, title, value, description, actionLabel = '', onAction = null }) {
  const valueLength = String(value || '').trim().length;
  const usesCompactLayout = variant === 'windowsVersion' || variant === 'activePowerPlan' || variant === 'lastBackup';
  const valueDensityClass = usesCompactLayout && valueLength > 40
    ? 'dashboard-top-row-card--dense-value'
    : usesCompactLayout
      ? 'dashboard-top-row-card--compact-value'
      : '';

  return (
    <article className={`dashboard-top-row-card dashboard-top-row-card--feature dashboard-top-row-card--${variant} ${valueDensityClass}`}>
      <DashboardFeatureVisual variant={variant} />
      <div className="dashboard-top-row-card-content dashboard-top-row-card-content--feature">
        <div className="dashboard-top-row-card-header">
          <div className="dashboard-top-row-title-group">
            <DashboardTopIcon icon={Icon} tone="accent" />
            <h2 className="dashboard-top-row-label">{title}</h2>
          </div>
        </div>
        <div className="dashboard-top-row-copy">
          <p className="dashboard-top-row-headline dashboard-top-row-headline--feature" title={String(value || '')}>{value}</p>
          <p className="dashboard-top-row-description">{description}</p>
        </div>
        {actionLabel && typeof onAction === 'function' ? (
          <div className="dashboard-top-row-footer dashboard-top-row-footer--backup">
            <button type="button" onClick={onAction} className="ui-btn ui-btn-secondary ui-btn-sm">
              <span className="truncate">{actionLabel}</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function UptimeSparkline() {
  return (
    <svg className="dashboard-top-row-sparkline" viewBox="0 0 240 86" role="img" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id="uptimeSparklineStroke" x1="0" y1="0" x2="240" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--dashboard-top-row-accent)" stopOpacity="0.7" />
          <stop offset="1" stopColor="var(--dashboard-top-row-accent)" />
        </linearGradient>
        <linearGradient id="uptimeSparklineFill" x1="0" y1="24" x2="0" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--dashboard-top-row-accent)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--dashboard-top-row-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="dashboard-top-row-sparkline-grid" d="M2 72H238M2 58H238M2 44H238M2 30H238" />
      <path d="M4 68 C28 51 48 55 68 59 C92 64 106 33 132 33 C158 33 162 65 190 62 C211 60 220 41 236 29 L236 86 L4 86 Z" fill="url(#uptimeSparklineFill)" />
      <path className="dashboard-top-row-sparkline-line" d="M4 68 C28 51 48 55 68 59 C92 64 106 33 132 33 C158 33 162 65 190 62 C211 60 220 41 236 29" />
      <circle className="dashboard-top-row-sparkline-dot" cx="236" cy="29" r="4" />
    </svg>
  );
}

function LiveMetricCard({ icon: Icon, title, value, description, accent = 'var(--accent)' }) {
  return (
    <article className="dashboard-top-row-card dashboard-top-row-card--uptime" style={{ '--dashboard-top-row-accent': accent }}>
      <div className="dashboard-top-row-card-content">
        <div className="dashboard-top-row-card-header">
          <div className="dashboard-top-row-title-group">
            <DashboardTopIcon icon={Icon} tone="accent" />
            <h2 className="dashboard-top-row-label">{title}</h2>
          </div>
        </div>

        <div className="dashboard-top-row-uptime-body">
          <p className="dashboard-top-row-uptime-value">{value}</p>
          <p className="dashboard-top-row-description">{description}</p>
        </div>

        <UptimeSparkline />
      </div>
    </article>
  );
}

function OverviewMetricCard({ icon: Icon, label, value, detail, detailIcon: DetailIcon, accent = 'var(--accent)' }) {
  return (
    <article className="dashboard-metric-card ui-card-subtle min-h-[128px] p-4 pb-5">
      <div className="flex items-center justify-between gap-3">
        <IconContainer
          className="h-10 w-10"
          style={{
            color: accent,
            background: `color-mix(in srgb, ${accent} 9%, var(--surface-elevated))`,
            borderColor: `color-mix(in srgb, ${accent} 18%, var(--border))`
          }}
        >
          <Icon {...LUCIDE_ICON_PROPS} className="h-[18px] w-[18px]" aria-hidden="true" />
        </IconContainer>
        <p className="flex items-center justify-end gap-1 text-right text-[12px] font-medium text-[var(--text-muted)]">
          {DetailIcon ? <DetailIcon {...LUCIDE_ICON_PROPS} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
          <span>{detail}</span>
        </p>
      </div>

      <div className="mt-5 min-w-0">
        <p className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</p>
        <p className="mt-1.5 max-w-full truncate whitespace-nowrap text-[1.26rem] font-semibold leading-none text-[var(--text-primary)] [font-variant-numeric:tabular-nums]" title={String(value || '')}>
          {value}
        </p>
      </div>
    </article>
  );
}

function DashboardSectionTitle({ icon: Icon, title }) {
  return (
    <div className="dashboard-section-title flex items-center gap-2.5">
      <IconContainer className="dashboard-section-title__icon h-8 w-8 shrink-0 text-[var(--accent)]">
        <Icon {...LUCIDE_ICON_PROPS} className="h-4 w-4" aria-hidden="true" />
      </IconContainer>
      <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">{title}</h2>
    </div>
  );
}

function HardwareIcon({ type, className = 'h-5 w-5' }) {
  if (type === 'cpu') {
    return <Cpu {...LUCIDE_ICON_PROPS} className={className} aria-hidden="true" />;
  }

  if (type === 'gpu') {
    return <Gpu {...LUCIDE_ICON_PROPS} className={className} aria-hidden="true" />;
  }

  if (type === 'ram') {
    return <MemoryStick {...LUCIDE_ICON_PROPS} className={className} aria-hidden="true" />;
  }

  if (type === 'mb') {
    return <CircuitBoard {...LUCIDE_ICON_PROPS} className={className} aria-hidden="true" />;
  }

  return <HardDrive {...LUCIDE_ICON_PROPS} className={className} aria-hidden="true" />;
}

function HardwareStatusTile({ card, unavailableLabel }) {
  return (
    <div className={`dashboard-top-row-hardware-tile ${card.detected ? 'is-detected' : ''}`}>
      <IconContainer className={`dashboard-top-row-hardware-icon ${card.detected ? 'is-detected' : ''}`}>
        <HardwareIcon type={card.icon} className="h-4 w-4" />
      </IconContainer>
      <div className="dashboard-top-row-hardware-copy">
        <p className="dashboard-top-row-hardware-label">{card.label}</p>
        <p className="dashboard-top-row-hardware-primary" title={card.primary || unavailableLabel}>
          {card.primary || unavailableLabel}
        </p>
        {card.secondary ? (
          <p className="dashboard-top-row-hardware-secondary" title={card.secondary}>{card.secondary}</p>
        ) : null}
      </div>
      <CircleCheck
        {...LUCIDE_ICON_PROPS}
        className={`dashboard-top-row-hardware-check ${card.detected ? 'is-detected' : ''}`}
        aria-hidden="true"
      />
    </div>
  );
}

function SystemDetectionSummaryCard({
  cards,
  title,
  subtitle,
  unavailableLabel,
  detailsLabel,
  onOpenDetails,
  rescanLabel,
  onRescan,
  isRescanning
}) {
  return (
    <article className="dashboard-top-row-card dashboard-top-row-card--detection">
      <div className="dashboard-top-row-card-content">
        <div className="dashboard-top-row-card-header">
          <div className="dashboard-top-row-title-group">
            <DashboardTopIcon icon={MonitorCog} tone="accent" />
            <div className="min-w-0">
              <h2 className="dashboard-top-row-label">{title}</h2>
              <p className="dashboard-top-row-subtitle">{subtitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {typeof onOpenDetails === 'function' ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm dashboard-top-row-rescan-button"
                onClick={onOpenDetails}
                title={detailsLabel}
              >
                <Maximize2 {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                <span className="truncate">{detailsLabel}</span>
              </button>
            ) : null}
            {typeof onRescan === 'function' ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm dashboard-top-row-rescan-button"
                onClick={onRescan}
                disabled={isRescanning}
              >
                {isRescanning ? <LoadingSpinner className="h-[18px] w-[18px]" /> : <RefreshCw {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
                <span className="truncate">{rescanLabel}</span>
              </button>
            ) : null}
          </div>
        </div>
        <div className="dashboard-top-row-hardware-grid">
          {cards.map((card) => (
            <HardwareStatusTile key={card.key} card={card} unavailableLabel={unavailableLabel} />
          ))}
        </div>
      </div>
    </article>
  );
}

function QuickActionButton({ icon: Icon, label, detail = '', primary = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-[13px] font-semibold transition ${
        disabled
          ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-muted)] opacity-65'
          :
        primary
          ? 'border-[color:color-mix(in_srgb,var(--accent)_42%,var(--border))] bg-[linear-gradient(105deg,color-mix(in_srgb,var(--accent)_17%,var(--surface-elevated)),var(--surface-elevated))] text-[var(--text-primary)] hover:border-[color:color-mix(in_srgb,var(--accent)_62%,var(--border))]'
          : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[var(--border)] hover:bg-[var(--surface-hover)]'
      }`}
    >
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${primary ? 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface))] text-[var(--accent)]' : 'border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)] group-hover:text-[var(--accent)]'}`}>
        <Icon {...LUCIDE_ICON_PROPS} className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--text-muted)]">{detail}</span> : null}
      </span>
    </button>
  );
}

function DashboardContextMenu({ children, title, options, selectedIds, keepOpen = false, onSelect, portalContainer }) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal container={portalContainer}>
        <ContextMenuPrimitive.Content className="z-[320] w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--surface-strong)_96%,transparent)] p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.48)] backdrop-blur-xl">
          <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</p>
          {options.map((option) => {
            const OptionIcon = option.icon;
            const selected = selectedIds.includes(option.id);
            return (
              <ContextMenuPrimitive.CheckboxItem
                key={option.id}
                checked={selected}
                onSelect={(event) => {
                  if (keepOpen) {
                    event.preventDefault();
                  }
                  onSelect(option.id);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition ${
                  selected
                    ? 'bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--surface-elevated))]'
                    : 'hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)]'
                }`}
              >
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--surface))] text-[var(--accent)]' : 'border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)]'}`}>
                  <OptionIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{option.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{option.description}</span>
                </span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" /> : null}
              </ContextMenuPrimitive.CheckboxItem>
            );
          })}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

const PERFORMANCE_METRIC_OPTIONS = [
  { value: 'cpu', label: 'CPU', icon: Cpu },
  { value: 'gpu', label: 'GPU', icon: Gpu }
];

function PerformanceMetricSelect({ value, onValueChange, portalContainer, label }) {
  const activeOption = PERFORMANCE_METRIC_OPTIONS.find((option) => option.value === value) || PERFORMANCE_METRIC_OPTIONS[0];
  const ActiveIcon = activeOption.icon;

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className="nova-dropdown-trigger group flex h-9 min-w-[112px] items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--surface-elevated))] px-3 text-left text-[12px] font-semibold text-[var(--text-primary)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--accent)_12%,transparent)] outline-none transition hover:border-[color:color-mix(in_srgb,var(--accent)_58%,var(--border))] hover:bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--surface-hover))] focus-visible:border-[var(--accent)] focus-visible:shadow-[var(--ui-focus-ring)] data-[state=open]:border-[color:color-mix(in_srgb,var(--accent)_72%,var(--border))] data-[state=open]:bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--surface-elevated))] data-[state=open]:shadow-[var(--ui-focus-ring)]"
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-data-[state=open]:rotate-180 group-data-[state=open]:text-[var(--accent)]" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal container={portalContainer}>
        <SelectPrimitive.Content
          position="popper"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="nova-dropdown-content z-30 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--border))] bg-[color:color-mix(in_srgb,var(--surface-strong)_94%,transparent)] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.38),inset_0_1px_0_color-mix(in_srgb,var(--accent)_10%,transparent)] backdrop-blur-xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <SelectPrimitive.Viewport className="space-y-1">
            {PERFORMANCE_METRIC_OPTIONS.map((option) => {
              const OptionIcon = option.icon;

              return (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="nova-dropdown-item group/item relative flex h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 pr-8 text-[12px] font-semibold text-[var(--text-secondary)] outline-none transition data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--text-primary)] data-[state=checked]:bg-[color:color-mix(in_srgb,var(--accent)_15%,var(--surface-elevated))] data-[state=checked]:text-[var(--text-primary)]"
                >
                  <OptionIcon className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-data-[state=checked]/item:text-[var(--accent)]" aria-hidden="true" />
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center justify-center text-[var(--accent)]">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function Dashboard({
  onNavigateSection,
  onQuickstartNavigate,
  onOpenUpdateNotes,
  activeTweaksCount = 0,
  activePowerPlanName = '',
  appMetadata = null,
  username = '',
  recentActivities = [],
  onRecordActivity,
  cleanupRecommendedCount = 0,
  oneClickOptimization = null,
  onRunOneClickOptimization
}) {
  const portalContainer = useAppPortalContainer();
  const { t, i18n } = useTranslation();
  const activeLocale = i18n.resolvedLanguage || i18n.language || undefined;

  const [now, setNow] = useState(() => Date.now());
  const [systemUptimeMs, setSystemUptimeMs] = useState(() => {
    const elapsed = dashboardRuntimeCache.systemUptime.capturedAt
      ? Date.now() - dashboardRuntimeCache.systemUptime.capturedAt
      : 0;
    return dashboardRuntimeCache.systemUptime.milliseconds + Math.max(0, elapsed);
  });
  const [selectedPerformanceMetric, setSelectedPerformanceMetric] = useState('cpu');
  const [metricsState, setMetricsState] = useState(() => dashboardRuntimeCache.metricsState);
  const [systemDetection, setSystemDetection] = useState(() => dashboardRuntimeCache.systemDetection);
  const [isRescanningSystem, setIsRescanningSystem] = useState(false);
  const [isHardwareDetailsOpen, setIsHardwareDetailsOpen] = useState(false);
  const [isHardwareCatalogLoading, setIsHardwareCatalogLoading] = useState(false);
  const [hardwareCatalogs, setHardwareCatalogs] = useState(() => bundledHardwareCatalogs);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [dashboardLayout, setDashboardLayout] = useState(readStoredDashboardLayout);
  const [savedLayouts, setSavedLayouts] = useState(readSavedDashboardLayouts);
  const [activeLayoutId, setActiveLayoutId] = useState(readActiveDashboardLayoutId);
  const [newLayoutName, setNewLayoutName] = useState('');
  const [renamingLayoutId, setRenamingLayoutId] = useState('');
  const [renamingLayoutName, setRenamingLayoutName] = useState('');
  const [lastBackup, setLastBackup] = useState(() => dashboardRuntimeCache.lastBackup);
  const [gameModeActive, setGameModeActive] = useState(() => dashboardRuntimeCache.gameModeActive);
  const [temperaturePeaks, setTemperaturePeaks] = useState(() => dashboardRuntimeCache.temperaturePeaks);
  const current = metricsState.current;
  const history = metricsState.history;

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_CURRENT_LAYOUT_STORAGE_KEY, JSON.stringify(dashboardLayout));
    } catch (_error) {
      // The active layout remains usable for this session when local storage is unavailable.
    }
  }, [dashboardLayout]);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_SAVED_LAYOUTS_STORAGE_KEY, JSON.stringify(savedLayouts));
    } catch (_error) {
      // Saved layouts remain usable for this session when local storage is unavailable.
    }
  }, [savedLayouts]);

  useEffect(() => {
    try {
      if (activeLayoutId) {
        localStorage.setItem(DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY, activeLayoutId);
      } else {
        localStorage.removeItem(DASHBOARD_ACTIVE_LAYOUT_STORAGE_KEY);
      }
    } catch (_error) {
      // The active selection remains usable for this session when local storage is unavailable.
    }
  }, [activeLayoutId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (Date.now() - dashboardRuntimeCache.customWidgetCapturedAt < 15_000) {
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    async function refreshUptime() {
      if (!window.desktopApi?.getSystemUptime) {
        return;
      }

      try {
        const result = await window.desktopApi.getSystemUptime();
        const seconds = Number(result?.uptimeSeconds);
        if (!cancelled && result?.ok && Number.isFinite(seconds)) {
          const milliseconds = Math.max(0, seconds * 1000);
          dashboardRuntimeCache.systemUptime = {
            milliseconds,
            capturedAt: Date.now()
          };
          setSystemUptimeMs(milliseconds);
        }
      } catch (_error) {
        // Keep the card empty if the host uptime API is unavailable.
      }
    }

    if (Date.now() - dashboardRuntimeCache.systemUptime.capturedAt >= 60_000) {
      void refreshUptime();
    }
    timer = window.setInterval(refreshUptime, 60000);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomWidgetData() {
      const [backupResult, gameModeResult] = await Promise.allSettled([
        window.desktopApi?.listBackups?.(),
        window.desktopApi?.getGameModeState?.()
      ]);

      if (cancelled) {
        return;
      }

      if (backupResult.status === 'fulfilled' && backupResult.value?.ok) {
        const backups = [
          ...(Array.isArray(backupResult.value?.backups) ? backupResult.value.backups : []),
          ...(Array.isArray(backupResult.value?.windowsRestorePoints) ? backupResult.value.windowsRestorePoints : [])
        ];
        const latest = backups
          .filter((entry) => Number.isFinite(Date.parse(entry?.createdAt || '')))
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
        dashboardRuntimeCache.lastBackup = latest;
        setLastBackup(latest);
      }

      if (gameModeResult.status === 'fulfilled' && gameModeResult.value?.ok) {
        const active = Boolean(gameModeResult.value?.state?.active);
        dashboardRuntimeCache.gameModeActive = active;
        setGameModeActive(active);
      }

      dashboardRuntimeCache.customWidgetCapturedAt = Date.now();
    }

    void loadCustomWidgetData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let fallbackTimer = null;
    let unsubscribe = () => {};

    const pushMetrics = (incoming) => {
      const sample = normalizeMetrics(incoming);
      setMetricsState((previous) => {
        const next = {
          current: sample,
          history: appendHistory(previous.history, sample)
        };
        dashboardRuntimeCache.metricsState = next;
        return next;
      });
    };

    async function bootstrapMetrics() {
      if (window.desktopApi?.onMetricsUpdate) {
        unsubscribe = window.desktopApi.onMetricsUpdate((payload) => {
          pushMetrics(payload);
        });
        return;
      }

      fallbackTimer = window.setInterval(() => {
        setMetricsState((previous) => {
          const next = createFallbackMetrics(previous.current);
          const nextState = {
            current: next,
            history: appendHistory(previous.history, next)
          };
          dashboardRuntimeCache.metricsState = nextState;
          return nextState;
        });
      }, 2000);
    }

    void bootstrapMetrics();

    return () => {
      unsubscribe();
      if (fallbackTimer) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, []);

  useEffect(() => {
    setTemperaturePeaks((previous) => {
      const next = {
        cpu: current.cpuTemp === null ? previous.cpu : Math.max(previous.cpu || 0, current.cpuTemp),
        gpu: current.gpuTemp === null ? previous.gpu : Math.max(previous.gpu || 0, current.gpuTemp)
      };
      dashboardRuntimeCache.temperaturePeaks = next;
      return next;
    });
  }, [current.cpuTemp, current.gpuTemp]);

  const refreshSystemDetection = async ({ showLoading = true } = {}) => {
    if (!window.desktopApi?.getSystemDetection) {
      return;
    }

    if (showLoading) {
      setIsRescanningSystem(true);
    }

    try {
      const result = await window.desktopApi.getSystemDetection();
      if (result?.ok && result?.detection) {
        const detection = normalizeSystemDetection(result.detection);
        dashboardRuntimeCache.systemDetection = detection;
        dashboardRuntimeCache.systemDetectionCapturedAt = Date.now();
        setSystemDetection(detection);
      }
    } catch (_error) {
      // Keep fallback detection state when hardware snapshot is unavailable.
    } finally {
      if (showLoading) {
        setIsRescanningSystem(false);
      }
    }
  };

  useEffect(() => {
    if (Date.now() - dashboardRuntimeCache.systemDetectionCapturedAt < 60_000) {
      return;
    }
    void refreshSystemDetection({ showLoading: false });
  }, []);

  useEffect(() => {
    if (!isHardwareDetailsOpen || !window.desktopApi?.getHardwareCatalogs) {
      return undefined;
    }

    let cancelled = false;
    setIsHardwareCatalogLoading(true);

    window.desktopApi.getHardwareCatalogs()
      .then((result) => {
        if (
          !cancelled &&
          result?.ok &&
          Array.isArray(result?.catalogs?.cpu?.cpus) &&
          Array.isArray(result?.catalogs?.gpu?.gpus)
        ) {
          setHardwareCatalogs(result.catalogs);
        }
      })
      .catch(() => {
        // Bundled catalogs remain active when the server is unavailable.
      })
      .finally(() => {
        if (!cancelled) {
          setIsHardwareCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isHardwareDetailsOpen]);

  const chartData = useMemo(() => {
    return history.timestamps.map((timestamp, index) => ({
      time: formatTime(timestamp),
      cpu: history.cpu[index] || 0,
      memory: history.memory[index] || 0,
      gpu: history.gpu[index] || 0,
      networkIn: history.networkIn[index] || 0,
      networkOut: history.networkOut[index] || 0
    }));
  }, [history]);

  const gpuSecondaryCount = systemDetection.gpu.secondary.length;
  const gpuPrimary = normalizeHardwareName(systemDetection.gpu.primary);
  const gpuSecondary = systemDetection.gpu.detected && gpuSecondaryCount > 0
    ? t('dashboard.systemDetection.gpuAdditionalDetected', { count: gpuSecondaryCount })
    : '';
  const cpuLines = splitCpuCardLines(systemDetection.cpu.name);
  const ramLines = buildRamCardLines(systemDetection.ram, activeLocale, t);
  const motherboardLines = splitMotherboardCardLines(systemDetection.motherboard.name);
  const unavailableLabel = t('dashboard.systemDetection.unavailable');
  const temperatureUnavailableLabel = t('dashboard.performance.temperatureUnavailable');
  const cpuTemperature = formatTemperature(current.cpuTemp, activeLocale, temperatureUnavailableLabel);
  const gpuTemperature = formatTemperature(current.gpuTemp, activeLocale, temperatureUnavailableLabel);
  const processorName = normalizeHardwareName(systemDetection.cpu.name) || unavailableLabel;
  const gpuName = gpuPrimary || unavailableLabel;

  const detectionCards = [
    {
      key: 'gpu',
      label: t('dashboard.systemDetection.labels.gpu'),
      detected: systemDetection.gpu.detected,
      primary: gpuPrimary,
      secondary: gpuSecondary,
      icon: 'gpu'
    },
    {
      key: 'cpu',
      label: t('dashboard.systemDetection.labels.cpu'),
      detected: systemDetection.cpu.detected,
      primary: cpuLines.primary,
      secondary: cpuLines.secondary,
      icon: 'cpu'
    },
    {
      key: 'ram',
      label: t('dashboard.systemDetection.labels.ram'),
      detected: systemDetection.ram.detected,
      primary: ramLines.primary,
      secondary: ramLines.secondary,
      icon: 'ram'
    },
    {
      key: 'mb',
      label: t('dashboard.systemDetection.labels.mb'),
      detected: systemDetection.motherboard.detected,
      primary: motherboardLines.primary,
      secondary: motherboardLines.secondary,
      icon: 'mb'
    }
  ];
  const uptime = systemUptimeMs > 0 ? formatUptime(systemUptimeMs) : '--';
  const selectedMetricColor = selectedPerformanceMetric === 'gpu' ? 'var(--accent-secondary)' : 'var(--accent)';
  const selectedMetricName = selectedPerformanceMetric === 'gpu' ? gpuName : processorName;

  const recordDashboardAction = (label, tone = 'accent') => {
    if (typeof onRecordActivity === 'function') {
      onRecordActivity(label, tone);
    }
  };

  const openBackup = () => {
    recordDashboardAction(t('dashboard.activity.createBackupOpened'), 'accent');
    if (typeof onQuickstartNavigate === 'function') {
      onQuickstartNavigate('createBackup');
    } else {
      onNavigateSection?.('backup');
    }
  };

  const openPowerPlan = () => {
    recordDashboardAction(t('dashboard.activity.applyPowerplanOpened'), 'accent');
    if (typeof onQuickstartNavigate === 'function') {
      onQuickstartNavigate('applyNovaPowerPlan');
    } else {
      onNavigateSection?.('tweaks');
    }
  };

  const openCleanup = () => {
    recordDashboardAction(t('dashboard.activity.oneClickCleanupStarted'), 'accent');
    onRunOneClickOptimization?.('cleanup');
  };

  const openGameMode = () => {
    recordDashboardAction(t('dashboard.activity.gameModeOpened'), gameModeActive ? "success" : 'accent');
    onNavigateSection?.('game-mode');
  };

  const activeSavedLayout = savedLayouts.find((entry) => entry.id === activeLayoutId) || null;
  const activeLayoutModified = Boolean(activeSavedLayout && !dashboardLayoutsMatch(activeSavedLayout.layout, dashboardLayout));
  const activeLayoutLabel = activeSavedLayout
    ? `${activeSavedLayout.name}${activeLayoutModified ? ` · ${t('dashboard.customize.modified')}` : ''}`
    : t('dashboard.customize.unsaved');

  function updateDashboardLayout(patch) {
    setDashboardLayout((previous) => normalizeDashboardLayout({ ...previous, ...patch }));
  }

  function toggleQuickAction(actionId) {
    setDashboardLayout((previous) => {
      const selected = previous.quickActions.includes(actionId);
      if (selected && previous.quickActions.length === 1) {
        return previous;
      }
      const quickActions = selected
        ? previous.quickActions.filter((id) => id !== actionId)
        : QUICK_ACTION_IDS.filter((id) => previous.quickActions.includes(id) || id === actionId);
      return normalizeDashboardLayout({ ...previous, quickActions });
    });
  }

  function saveDashboardLayout() {
    const name = newLayoutName.trim();
    if (!name) {
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSavedLayouts((previous) => [...previous, { id, name, layout: normalizeDashboardLayout(dashboardLayout) }]);
    setActiveLayoutId(id);
    setNewLayoutName('');
  }

  function updateActiveDashboardLayout() {
    if (!activeLayoutId) {
      return;
    }
    setSavedLayouts((previous) => previous.map((entry) => (
      entry.id === activeLayoutId
        ? { ...entry, layout: normalizeDashboardLayout(dashboardLayout) }
        : entry
    )));
  }

  function applyDashboardLayout(entry) {
    setDashboardLayout(normalizeDashboardLayout(entry.layout));
    setActiveLayoutId(entry.id);
  }

  function saveRenamedDashboardLayout() {
    const name = renamingLayoutName.trim();
    if (!renamingLayoutId || !name) {
      return;
    }
    setSavedLayouts((previous) => previous.map((entry) => (
      entry.id === renamingLayoutId ? { ...entry, name } : entry
    )));
    setRenamingLayoutId('');
    setRenamingLayoutName('');
  }

  function deleteDashboardLayout(id) {
    setSavedLayouts((previous) => previous.filter((entry) => entry.id !== id));
    if (activeLayoutId === id) {
      setActiveLayoutId('');
    }
  }

  function resetDashboardLayout() {
    setDashboardLayout(normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT));
    setActiveLayoutId('');
  }

  const topWidgetOptions = [
    { id: 'createBackup', icon: DatabaseBackup, label: t('dashboard.actions.createBackup.title'), description: t('dashboard.customize.widgets.createBackup') },
    { id: 'lastBackup', icon: History, label: t('dashboard.widgets.lastBackup.title'), description: t('dashboard.customize.widgets.lastBackup') },
    { id: 'activeTweaks', icon: ShieldCheck, label: t('dashboard.widgets.activeTweaks.title'), description: t('dashboard.customize.widgets.activeTweaks') },
    { id: 'windowsVersion', icon: MonitorCog, label: t('dashboard.widgets.windowsVersion.title'), description: t('dashboard.customize.widgets.windowsVersion') },
    { id: 'activePowerPlan', icon: BatteryCharging, label: t('dashboard.widgets.activePowerPlan.title'), description: t('dashboard.customize.widgets.activePowerPlan') }
  ];
  const secondaryWidgetOptions = [
    { id: 'systemUptime', icon: Clock, label: t('dashboard.cards.systemUptime'), description: t('dashboard.customize.widgets.systemUptime') },
    { id: 'cpuTemperature', icon: Cpu, label: t('dashboard.widgets.liveMetrics.cpuTemperature'), description: t('dashboard.customize.widgets.cpuTemperature') },
    { id: 'gpuTemperature', icon: Gpu, label: t('dashboard.widgets.liveMetrics.gpuTemperature'), description: t('dashboard.customize.widgets.gpuTemperature') },
    { id: 'memoryUsage', icon: MemoryStick, label: t('dashboard.widgets.liveMetrics.memoryUsage'), description: t('dashboard.customize.widgets.memoryUsage') }
  ];
  const sideWidgetOptions = [
    { id: 'recentActivity', icon: History, label: t('dashboard.recentActivity.title'), description: t('dashboard.customize.widgets.recentActivity') },
    { id: 'systemHealth', icon: HeartPulse, label: t('dashboard.widgets.systemHealth.title'), description: t('dashboard.customize.widgets.systemHealth') },
    { id: 'temperaturePeaks', icon: Thermometer, label: t('dashboard.widgets.temperaturePeaks.title'), description: t('dashboard.customize.widgets.temperaturePeaks') }
  ];
  const quickActionOptions = [
    { id: 'powerPlan', icon: BatteryCharging, label: t('dashboard.quickActions.applyPowerplan'), description: t('dashboard.customize.actions.powerPlan') },
    { id: 'gameMode', icon: Power, label: t('dashboard.quickActions.gameMode'), description: t('dashboard.customize.actions.gameMode') },
    { id: 'cleanTemporaryFiles', icon: Trash2, label: t('dashboard.quickActions.oneClickCleanup'), description: t('dashboard.customize.actions.oneClickCleanup') }
  ];
  const quickActions = {
    powerPlan: {
      icon: BatteryCharging,
      label: t('dashboard.quickActions.applyPowerplan'),
      detail: activePowerPlanName || t('dashboard.widgets.activePowerPlan.unavailable'),
      onClick: openPowerPlan
    },
    gameMode: {
      icon: Power,
      label: t('dashboard.quickActions.gameMode'),
      detail: gameModeActive ? t('dashboard.quickActions.gameModeActive') : t('dashboard.quickActions.gameModeInactive'),
      onClick: openGameMode
    },
    cleanTemporaryFiles: {
      icon: Trash2,
      label: t('dashboard.quickActions.oneClickCleanup'),
      detail: oneClickOptimization?.runningId === 'cleanup'
        ? t('tweaks.oneClick.runningProgress', {
            current: oneClickOptimization.current,
            total: oneClickOptimization.total
          })
        : t('dashboard.quickActions.oneClickCleanupDetail', { count: cleanupRecommendedCount }),
      disabled: !cleanupRecommendedCount || Boolean(oneClickOptimization?.runningId),
      onClick: openCleanup
    }
  };

  const lastBackupLabel = lastBackup
    ? formatDateTime(lastBackup.createdAt, activeLocale, t('dashboard.common.unavailable'))
    : t('dashboard.widgets.lastBackup.none');
  const windowsVersionLabel = formatWindowsVersion(appMetadata, t('dashboard.common.unavailable'));
  const activePowerPlanLabel = activePowerPlanName || t('dashboard.widgets.activePowerPlan.unavailable');
  const cpuTemperatureValue = normalizeTemperature(current.cpuTemp);
  const gpuTemperatureValue = normalizeTemperature(current.gpuTemp);
  const healthDanger = (cpuTemperatureValue !== null && cpuTemperatureValue >= 90)
    || (gpuTemperatureValue !== null && gpuTemperatureValue >= 85);
  const healthWarning = healthDanger
    || (cpuTemperatureValue !== null && cpuTemperatureValue >= 75)
    || (gpuTemperatureValue !== null && gpuTemperatureValue >= 75)
    || current.cpu >= 95
    || current.gpu >= 95;
  const healthTone = healthDanger ? 'danger' : healthWarning ? 'warning' : "success";
  const healthLabel = healthDanger
    ? t('dashboard.widgets.systemHealth.critical')
    : healthWarning
      ? t('dashboard.widgets.systemHealth.attention')
      : t('dashboard.widgets.systemHealth.good');

  let topWidget = null;
  if (dashboardLayout.topWidget === 'lastBackup') {
    topWidget = (
      <DashboardInfoCard
        variant="lastBackup"
        icon={History}
        title={t('dashboard.widgets.lastBackup.title')}
        value={lastBackupLabel}
        description={lastBackup?.name || t('dashboard.widgets.lastBackup.description')}
        actionLabel={t('dashboard.widgets.lastBackup.action')}
        onAction={() => onNavigateSection?.('backup')}
      />
    );
  } else if (dashboardLayout.topWidget === 'activeTweaks') {
    topWidget = (
      <DashboardInfoCard
        variant="activeTweaks"
        icon={ShieldCheck}
        title={t('dashboard.widgets.activeTweaks.title')}
        value={String(activeTweaksCount)}
        description={t('dashboard.widgets.activeTweaks.description')}
        actionLabel={t('dashboard.widgets.activeTweaks.action')}
        onAction={() => onNavigateSection?.('tweaks')}
      />
    );
  } else if (dashboardLayout.topWidget === 'windowsVersion') {
    topWidget = (
      <DashboardInfoCard
        variant="windowsVersion"
        icon={MonitorCog}
        title={t('dashboard.widgets.windowsVersion.title')}
        value={windowsVersionLabel}
        description={t('dashboard.widgets.windowsVersion.description')}
      />
    );
  } else if (dashboardLayout.topWidget === 'activePowerPlan') {
    topWidget = (
      <DashboardInfoCard
        variant="activePowerPlan"
        icon={BatteryCharging}
        title={t('dashboard.widgets.activePowerPlan.title')}
        value={activePowerPlanLabel}
        description={t('dashboard.widgets.activePowerPlan.description')}
        actionLabel={t('dashboard.widgets.activePowerPlan.action')}
        onAction={openPowerPlan}
      />
    );
  } else {
    topWidget = <BackupCard t={t} onAction={openBackup} />;
  }

  let secondaryWidget = null;
  if (dashboardLayout.secondaryWidget === 'cpuTemperature') {
    secondaryWidget = (
      <LiveMetricCard
        icon={Cpu}
        title={t('dashboard.widgets.liveMetrics.cpuTemperature')}
        value={cpuTemperature}
        description={`${formatPercent(current.cpu)} ${t('dashboard.widgets.liveMetrics.load')}`}
        accent="var(--accent)"
      />
    );
  } else if (dashboardLayout.secondaryWidget === 'gpuTemperature') {
    secondaryWidget = (
      <LiveMetricCard
        icon={Gpu}
        title={t('dashboard.widgets.liveMetrics.gpuTemperature')}
        value={gpuTemperature}
        description={`${formatPercent(current.gpu)} ${t('dashboard.widgets.liveMetrics.load')}`}
        accent="var(--accent-secondary)"
      />
    );
  } else if (dashboardLayout.secondaryWidget === 'memoryUsage') {
    secondaryWidget = (
      <LiveMetricCard
        icon={MemoryStick}
        title={t('dashboard.widgets.liveMetrics.memoryUsage')}
        value={formatGigabytes(current.memory)}
        description={t('dashboard.widgets.liveMetrics.memoryDescription')}
      />
    );
  } else {
    secondaryWidget = (
      <LiveMetricCard
        icon={Clock}
        title={t('dashboard.cards.systemUptime')}
        value={uptime}
        description={t('dashboard.cards.runningSmoothly')}
      />
    );
  }

  return (
    <PageShell className="dashboard-shell gap-4 md:gap-5">
      <header className="dashboard-header ui-page-header flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="ui-page-heading min-w-0">
          <PageHeadingSignal />
          <div className="min-w-0">
            <h1 className="dashboard-title text-[1.7rem] font-semibold leading-tight text-[var(--text-primary)] md:text-[1.95rem]">
              {t('dashboard.localGreetingPrefix', { defaultValue: 'Welcome to' })}{' '}
              <span className="text-[var(--accent)]">Nova Tweaks</span>
            </h1>
            <p className="dashboard-subtitle mt-1 text-[13px] font-medium text-[var(--text-secondary)]">
              {t('dashboard.localWelcome', { defaultValue: 'Everything is ready on this device.' })}
            </p>
            <p className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">{t('dashboard.customize.rightClickHint')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
          <span className="max-w-48 truncate text-xs font-semibold text-[var(--text-muted)]" title={activeLayoutLabel}>{activeLayoutLabel}</span>
          <button
            type="button"
            onClick={() => setLayoutsOpen(true)}
            className="ui-btn ui-btn-secondary ui-btn-sm"
          >
            <Settings2 {...LUCIDE_ICON_PROPS} aria-hidden="true" />
            <span>{t('dashboard.customize.layoutsAction')}</span>
          </button>
          <button
            type="button"
            onClick={onOpenUpdateNotes}
            className="dashboard-update-notes-button ui-btn ui-btn-secondary ui-btn-sm"
          >
            <FileText {...LUCIDE_ICON_PROPS} aria-hidden="true" />
            <span>{t('dashboard.updateNotes.open', { defaultValue: 'Update Notes' })}</span>
          </button>
        </div>
      </header>

      <AdvancedSensorsPrompt onOpenSettings={() => onNavigateSection?.('settings')} />

      <ModalShell
        open={layoutsOpen}
        title={t('dashboard.customize.savedLayouts')}
        description={t('dashboard.customize.savedLayoutsDescription')}
        onClose={() => setLayoutsOpen(false)}
        closeLabel={t('common.close')}
        size="lg"
        overlayClassName="dashboard-customize-modal-overlay"
        contentClassName="max-h-[72vh] overflow-y-auto"
      >
        <div className="space-y-5">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <div className="flex justify-end">
              <button type="button" onClick={resetDashboardLayout} className="inline-flex h-8 items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--accent)]">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('dashboard.customize.reset')}
              </button>
            </div>

            <label className="mt-4 block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="dashboard-layout-name">
              {t('dashboard.customize.nameLabel')}
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="dashboard-layout-name"
                value={newLayoutName}
                onChange={(event) => setNewLayoutName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newLayoutName.trim()) {
                    saveDashboardLayout();
                  }
                }}
                className="ui-input min-w-0 flex-1"
                placeholder={t('dashboard.customize.namePlaceholder')}
              />
              <button
                type="button"
                onClick={saveDashboardLayout}
                disabled={!newLayoutName.trim()}
                className="ui-btn ui-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {t('dashboard.customize.save')}
              </button>
              {activeSavedLayout && activeLayoutModified ? (
                <button type="button" onClick={updateActiveDashboardLayout} className="ui-btn ui-btn-secondary">
                  {t('dashboard.customize.update')}
                </button>
              ) : null}
            </div>

            <div className="mt-3 space-y-2">
              {savedLayouts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--text-muted)]">
                  {t('dashboard.customize.empty')}
                </p>
              ) : savedLayouts.map((entry) => (
                <div key={entry.id} className={`flex items-center gap-2 rounded-lg border p-2 ${activeLayoutId === entry.id ? 'border-[color:color-mix(in_srgb,var(--accent)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--surface)_92%)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                  {renamingLayoutId === entry.id ? (
                    <>
                      <input
                        autoFocus
                        value={renamingLayoutName}
                        onChange={(event) => setRenamingLayoutName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveRenamedDashboardLayout();
                          if (event.key === 'Escape') {
                            setRenamingLayoutId('');
                            setRenamingLayoutName('');
                          }
                        }}
                        className="ui-input h-8 min-w-0 flex-1"
                        aria-label={t('dashboard.customize.renameLabel')}
                      />
                      <button type="button" onClick={saveRenamedDashboardLayout} disabled={!renamingLayoutName.trim()} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--accent)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40" title={t('dashboard.customize.confirmRename')}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => { setRenamingLayoutId(''); setRenamingLayoutName(''); }} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]" title={t('common.cancel')}>
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => applyDashboardLayout(entry)} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-[var(--text-primary)]">
                        {entry.name}
                      </button>
                      <button type="button" onClick={() => { setRenamingLayoutId(entry.id); setRenamingLayoutName(entry.name); }} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--accent)]" title={t('dashboard.customize.rename')}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => deleteDashboardLayout(entry.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" title={t('dashboard.customize.delete')}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </ModalShell>

      <section className="dashboard-top-row">
        <DashboardContextMenu
          title={t('dashboard.customize.topWidget')}
          options={topWidgetOptions}
          selectedIds={[dashboardLayout.topWidget]}
          onSelect={(optionId) => updateDashboardLayout({ topWidget: optionId })}
          portalContainer={portalContainer}
        >
          <div data-testid="dashboard-top-widget" className="contents" title={t('dashboard.customize.rightClickHint')}>
            {topWidget}
          </div>
        </DashboardContextMenu>
        <DashboardContextMenu
          title={t('dashboard.customize.secondaryWidget')}
          options={secondaryWidgetOptions}
          selectedIds={[dashboardLayout.secondaryWidget]}
          onSelect={(optionId) => updateDashboardLayout({ secondaryWidget: optionId })}
          portalContainer={portalContainer}
        >
          <div data-testid="dashboard-secondary-widget" className="contents" title={t('dashboard.customize.rightClickHint')}>
            {secondaryWidget}
          </div>
        </DashboardContextMenu>
        <SystemDetectionSummaryCard
          cards={detectionCards}
          title={t('dashboard.systemDetection.title')}
          subtitle={t('dashboard.systemDetection.snapshot')}
          unavailableLabel={unavailableLabel}
          detailsLabel={t('dashboard.systemDetection.details.open')}
          onOpenDetails={() => setIsHardwareDetailsOpen(true)}
          rescanLabel={t('dashboard.systemDetection.rescan')}
          onRescan={window.desktopApi?.getSystemDetection ? () => refreshSystemDetection() : null}
          isRescanning={isRescanningSystem}
        />
      </section>

      <HardwareDetailsModal
        open={isHardwareDetailsOpen}
        onClose={() => setIsHardwareDetailsOpen(false)}
        systemDetection={systemDetection}
        catalogs={hardwareCatalogs}
        isCatalogLoading={isHardwareCatalogLoading}
        onOpenExternal={(url) => window.desktopApi?.openExternalUrl?.({ url })}
      />

      <div className="dashboard-main-row grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="dashboard-performance-column min-h-0">
          <PageSection className="dashboard-performance-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <DashboardSectionTitle icon={Activity} title={t('dashboard.performance.title')} />
                <p className="mt-1 truncate pl-10 text-[12px] font-medium text-[var(--text-muted)]">
                  @ {selectedMetricName}
                </p>
              </div>
              <PerformanceMetricSelect
                value={selectedPerformanceMetric}
                onValueChange={setSelectedPerformanceMetric}
                portalContainer={portalContainer}
                label={t('dashboard.systemMetrics.selector')}
              />
            </div>

            <div className="dashboard-performance-chart mt-5 h-[290px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-3 md:h-[320px] xl:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 5" stroke="color-mix(in srgb, var(--chart-grid) 58%, transparent)" vertical={false} />
                  <XAxis dataKey="time" stroke="color-mix(in srgb, var(--text-muted) 76%, transparent)" minTickGap={28} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    stroke="color-mix(in srgb, var(--text-muted) 72%, transparent)"
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                    width={42}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={false}
                    formatter={(value) => formatPercent(Number(value))}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 14,
                      color: 'var(--text-primary)',
                      boxShadow: 'var(--card-shadow-item)'
                    }}
                  />
                  <Line type="monotone" dataKey={selectedPerformanceMetric} stroke={selectedMetricColor} strokeWidth={2.4} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="dashboard-metric-grid mt-4 mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewMetricCard icon={Cpu} label={t('dashboard.metricsCards.cpu')} value={formatPercent(current.cpu)} detail={cpuTemperature} detailIcon={Thermometer} accent="var(--accent)" />
              <OverviewMetricCard icon={Gpu} label={t('dashboard.metricsCards.gpu')} value={formatPercent(current.gpu)} detail={gpuTemperature} detailIcon={Thermometer} accent="var(--accent-secondary)" />
              <OverviewMetricCard icon={MemoryStick} label={t('dashboard.metricsCards.memory')} value={formatGigabytes(current.memory)} detail={t('dashboard.performance.used')} accent="#8B5CF6" />
              <OverviewMetricCard icon={Wifi} label={t('dashboard.metricsCards.networkUsage', { defaultValue: 'Network Usage' })} value={formatRate(current.networkIn, activeLocale)} detail={t('dashboard.performance.inbound')} accent="#06B6D4" />
            </div>
            <div className="dashboard-performance-bottom-space" aria-hidden="true" />
          </PageSection>
        </div>

        <aside className="dashboard-side-panel">
          <DashboardContextMenu
            title={t('dashboard.customize.quickActions')}
            options={quickActionOptions}
            selectedIds={dashboardLayout.quickActions}
            keepOpen
            onSelect={toggleQuickAction}
            portalContainer={portalContainer}
          >
            <div data-testid="dashboard-quick-actions-widget" className="contents" title={t('dashboard.customize.rightClickHint')}>
              <PageSection className="dashboard-quick-actions-card p-5">
                <DashboardSectionTitle icon={Settings2} title={t('dashboard.quickActions.title')} />
                <div className="dashboard-quick-action-list mt-4 space-y-2.5">
                  {dashboardLayout.quickActions.map((actionId, index) => {
                    const action = quickActions[actionId];
                    return action ? (
                      <QuickActionButton
                        key={actionId}
                        icon={action.icon}
                        label={action.label}
                        detail={action.detail}
                        primary={index === 0}
                        disabled={action.disabled}
                        onClick={action.onClick}
                      />
                    ) : null;
                  })}
                </div>
              </PageSection>
            </div>
          </DashboardContextMenu>

          <DashboardContextMenu
            title={t('dashboard.customize.sideWidget')}
            options={sideWidgetOptions}
            selectedIds={[dashboardLayout.sideWidget]}
            onSelect={(optionId) => updateDashboardLayout({ sideWidget: optionId })}
            portalContainer={portalContainer}
          >
            <div data-testid="dashboard-side-widget" className="contents" title={t('dashboard.customize.rightClickHint')}>
            <PageSection className="dashboard-recent-activity-card p-5">
            {dashboardLayout.sideWidget === 'systemHealth' ? (
              <>
                <DashboardSectionTitle icon={HeartPulse} title={t('dashboard.widgets.systemHealth.title')} />
                <div className={`dashboard-health-visual dashboard-health-visual--${healthTone} mt-4`}>
                  <div className="dashboard-health-hero">
                    <span className="dashboard-health-orb">
                      <HeartPulse className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-muted)]">{t('dashboard.widgets.systemHealth.overall')}</p>
                      <p className="mt-0.5 text-lg font-semibold text-[var(--text-primary)]">{healthLabel}</p>
                    </div>
                  </div>
                  <div className="dashboard-health-metrics">
                    {[
                      { label: t('dashboard.widgets.systemHealth.cpu'), load: current.cpu, temperature: cpuTemperature },
                      { label: t('dashboard.widgets.systemHealth.gpu'), load: current.gpu, temperature: gpuTemperature }
                    ].map((metric) => (
                      <div key={metric.label} className="dashboard-health-metric">
                        <div className="flex items-center justify-between gap-2">
                          <span>{metric.label}</span>
                          <strong>{formatPercent(metric.load)} · {metric.temperature}</strong>
                        </div>
                        <span className="dashboard-health-track">
                          <i style={{ width: `${Math.max(3, metric.load)}%` }} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : dashboardLayout.sideWidget === 'temperaturePeaks' ? (
              <>
                <DashboardSectionTitle icon={Thermometer} title={t('dashboard.widgets.temperaturePeaks.title')} />
                <p className="mt-1 pl-10 text-[11px] text-[var(--text-muted)]">{t('dashboard.widgets.temperaturePeaks.description')}</p>
                <div className="dashboard-temperature-peak-grid mt-4">
                  {[
                    { id: 'cpu', label: t('dashboard.widgets.temperaturePeaks.cpu'), value: temperaturePeaks.cpu },
                    { id: 'gpu', label: t('dashboard.widgets.temperaturePeaks.gpu'), value: temperaturePeaks.gpu }
                  ].map((metric) => (
                    <div key={metric.id} className={`dashboard-temperature-peak dashboard-temperature-peak--${metric.id}`}>
                      <span className="dashboard-temperature-gauge" aria-hidden="true">
                        <i style={{ height: `${metric.value === null ? 8 : Math.max(12, Math.min(100, metric.value))}%` }} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{metric.label}</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
                          {formatTemperature(metric.value, activeLocale, temperatureUnavailableLabel)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <DashboardSectionTitle icon={History} title={t('dashboard.recentActivity.title')} />
                <div className="dashboard-recent-activity-list mt-4">
                  {recentActivities.length === 0 ? (
                    <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3.5 text-[13px] text-[var(--text-muted)]">
                      {t('dashboard.recentActivity.empty')}
                    </p>
                  ) : (
                    <div className="dashboard-recent-activity-scroll space-y-1.5 pr-1 [scrollbar-color:var(--scrollbar-thumb)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--scrollbar-thumb-hover)] [&::-webkit-scrollbar-track]:bg-transparent">
                      {recentActivities.map((activity) => (
                        <div key={activity.id} className="flex h-8 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: activity.color || 'var(--accent)' }}
                            aria-hidden="true"
                          />
                          <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">{activity.label}</p>
                          <p className="shrink-0 text-right text-[11px] text-[var(--text-muted)]">{formatActivityTime(activity.timestamp, now)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            </PageSection>
            </div>
          </DashboardContextMenu>
        </aside>
      </div>
    </PageShell>
  );
}

export default Dashboard;
