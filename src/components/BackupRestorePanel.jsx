import i18n from '../i18n';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  DatabaseBackup,
  Eye,
  FolderOpen,
  HardDrive,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { Button, LoadingSpinner, ModalShell, PageHeadingSignal, PageShell, Skeleton, StatusPill, Switch } from './ui';
import { BACKUP_LIST_HEADER_DIVIDER_CLASS } from '../constants/listLayout';

const PAGE_SIZE = 8;
const DEFAULT_SCOPE_SELECTION = [
  'tweakStates',
  'powerPlans',
  'timerProfiles',
  'registryChanges',
  'appSettings'
];
const WINDOWS_RESTORE_SCOPE = ['systemRestore', 'bootBcd', 'registryChanges'];
const BOOT_SCOPE_CATEGORIES = new Set(['boot']);
const BOOT_SCOPE_SUBCATEGORIES = new Set(['kernel', 'hypervisor', 'startup', 'boot']);
const TIMER_SCOPE_SUBCATEGORIES = new Set(['timer', 'timer resolution']);
const SERVICE_SCOPE_SUBCATEGORIES = new Set(['services']);
const REGISTRY_SCOPE_EXCLUDED_CONTAINER_TYPES = new Set(['power_plan', 'timer_resolution', 'range_selection', 'one_shot_action', 'fix']);
const REGISTRY_SCOPE_EXCLUDED_CATEGORY_KEYS = new Set(['boot']);
const REGISTRY_SCOPE_EXCLUDED_SUBCATEGORY_KEYS = new Set(['power plans', 'services']);

const DEFAULT_SETTINGS = {
  automaticBackupsEnabled: false,
  frequencyDays: 7,
  cleanOlderThanDays: 30,
  maxStorageBytes: 0
};

function joinClasses(...values) {
  return values.filter(Boolean).join(' ');
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isRegistryBackedTweakEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const containerType = String(entry.containerType || '').trim().toLowerCase();
  const categoryKey = String(entry.categoryKey || '').trim().toLowerCase();
  const subcategoryKey = String(entry.subcategoryKey || '').trim().toLowerCase();

  return !REGISTRY_SCOPE_EXCLUDED_CONTAINER_TYPES.has(containerType)
    && !REGISTRY_SCOPE_EXCLUDED_CATEGORY_KEYS.has(categoryKey)
    && !REGISTRY_SCOPE_EXCLUDED_SUBCATEGORY_KEYS.has(subcategoryKey);
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const frequencyDays = Number.parseInt(String(source.frequencyDays ?? DEFAULT_SETTINGS.frequencyDays), 10);
  const cleanOlderThanDays = Number.parseInt(String(source.cleanOlderThanDays ?? DEFAULT_SETTINGS.cleanOlderThanDays), 10);
  const maxStorageBytes = Number.parseInt(String(source.maxStorageBytes ?? DEFAULT_SETTINGS.maxStorageBytes), 10);

  return {
    automaticBackupsEnabled: source.automaticBackupsEnabled === true,
    frequencyDays: Number.isInteger(frequencyDays) && frequencyDays > 0 ? frequencyDays : DEFAULT_SETTINGS.frequencyDays,
    cleanOlderThanDays: Number.isInteger(cleanOlderThanDays) && cleanOlderThanDays > 0
      ? cleanOlderThanDays
      : DEFAULT_SETTINGS.cleanOlderThanDays,
    maxStorageBytes: Number.isInteger(maxStorageBytes) && maxStorageBytes > 0 ? maxStorageBytes : 0
  };
}

function getBackupTimestamp(backup) {
  const value = Date.parse(backup?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function isOldBackup(backup, days = 30) {
  const cutoff = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return Date.now() - getBackupTimestamp(backup) > cutoff;
}

function formatBytes(sizeBytes) {
  const value = Number(sizeBytes);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex <= 1 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) {
    return i18n.t('tweakDetails.unknown');
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function formatRelativeTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) {
    return i18n.t('backup.status.none');
  }

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absSeconds < 60) {
    return formatter.format(diffSeconds, 'second');
  }
  if (absSeconds < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), 'minute');
  }
  if (absSeconds < 86400) {
    return formatter.format(Math.round(diffSeconds / 3600), 'hour');
  }
  if (absSeconds < 2592000) {
    return formatter.format(Math.round(diffSeconds / 86400), 'day');
  }
  return formatter.format(Math.round(diffSeconds / 2592000), 'month');
}

function normalizeTypeLabel(type) {
  if (type === 'restorePoint') {
    return i18n.t('interfaceText.backup_dd969');
  }
  if (type === 'automatic' || type === 'auto' || type === 'beforeApply') {
    return i18n.t('backup.badges.automatic');
  }
  return i18n.t('backup.types.manual');
}

function getBackupSizeLabel(backup) {
  if (backup?.origin === 'windows' || backup?.type === 'restorePoint') {
    return i18n.t('backup.history.systemManagedSize');
  }

  return formatBytes(backup?.sizeBytes);
}

function getBackupLocationLabel(backup, storageRoot = '') {
  if (backup?.origin === 'windows' || backup?.type === 'restorePoint') {
    return i18n.t('interfaceText.windows_system_restore_970fa');
  }

  return backup?.path || storageRoot || i18n.t('networkTest.mtu.status.unavailable');
}

function normalizeStatus(backup) {
  const status = String(backup?.status || '').trim().toLowerCase();
  if (status === 'failed' || status === 'running') {
    return status;
  }
  return 'successful';
}

function buildSection(data, captureStatus = 'complete') {
  const itemCount = Array.isArray(data)
    ? data.length
    : data && typeof data === 'object'
      ? Object.keys(data).length
      : 0;

  return {
    capturedAt: new Date().toISOString(),
    captureStatus,
    itemCount,
    data
  };
}

function MetricCard({ icon: Icon, label, value, detail }) {
  return (
    <article className="rounded-2xl border border-[color:color-mix(in_srgb,var(--border)_78%,transparent)] bg-[color:color-mix(in_srgb,var(--surface)_92%,var(--surface-strong)_8%)] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
          <p className="mt-3 truncate text-[1.35rem] font-semibold tracking-normal text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
            {value}
          </p>
          <p className="mt-2 truncate text-xs text-[var(--text-muted)]">{detail}</p>
        </div>
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface)_86%)] text-[var(--accent)]">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  );
}

function StatusBadge({ status }) {
  const normalized = status === 'failed' || status === 'running' ? status : 'successful';
  const toneClass = normalized === 'failed'
    ? 'border-[color:color-mix(in_srgb,var(--danger)_26%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]'
    : normalized === 'running'
      ? 'border-[color:color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning)]'
      : 'border-[color:color-mix(in_srgb,var(--success)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]';

  return (
    <span className={joinClasses('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium capitalize', toneClass)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="truncate">{normalized}</span>
    </span>
  );
}

function Panel({ title, description, children, icon: Icon }) {
  return (
    <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--border)_78%,transparent)] bg-[color:color-mix(in_srgb,var(--surface)_92%,var(--surface-strong)_8%)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.14)]">
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--surface)_88%)] text-[var(--accent)]">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-normal text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{description}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function QuickActionRow({ icon: Icon, title, description, onClick, disabled = false, loading = false, tone = 'neutral' }) {
  const iconClass = tone === 'primary'
    ? 'bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface)_86%)] text-[var(--accent)]'
    : tone === 'warning'
      ? 'bg-[color:color-mix(in_srgb,var(--warning)_12%,var(--surface)_88%)] text-[var(--warning)]'
      : 'bg-[color:color-mix(in_srgb,var(--surface-strong)_72%,var(--surface)_28%)] text-[var(--text-muted)]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_86%,var(--surface-strong)_14%)] px-3 py-2 text-left transition hover:border-[color:color-mix(in_srgb,var(--accent)_42%,var(--border)_58%)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--surface)_94%)] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className={joinClasses('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconClass)}>
        {loading ? <LoadingSpinner /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">{description}</span>
      </span>
    </button>
  );
}

function BackupRestorePanel({
  onNotify,
  appStateSnapshot,
  onPrepareSnapshot,
  onRestoreBackup,
  quickstartNavigationRequest,
  onQuickstartEvent,
  onOperationStatus
}) {
  const { t } = useTranslation();
  const [configBackups, setConfigBackups] = useState([]);
  const [restorePoints, setRestorePoints] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [storage, setStorage] = useState({ rootPath: '', indexPath: '' });
  const [selectedBackupId, setSelectedBackupId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [filter, setFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState('');
  const [detailsBackupId, setDetailsBackupId] = useState('');
  const [confirmState, setConfirmState] = useState({ open: false, kind: '', backupId: '', name: '' });
  const [createModal, setCreateModal] = useState({
    open: false,
    kind: 'backup',
    name: '',
    description: ''
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingRestorePoint, setCreatingRestorePoint] = useState(false);
  const [restoringId, setRestoringId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [error, setError] = useState('');

  const backups = useMemo(
    () => [...restorePoints, ...configBackups],
    [configBackups, restorePoints]
  );

  const selectedBackup = useMemo(
    () => backups.find((backup) => backup.id === selectedBackupId) || backups[0] || null,
    [backups, selectedBackupId]
  );
  const detailsBackup = useMemo(
    () => backups.find((backup) => backup.id === detailsBackupId) || null,
    [backups, detailsBackupId]
  );
  const sortedBackups = useMemo(
    () => [...backups].sort((left, right) => {
      const originDiff = Number(right.origin === 'windows') - Number(left.origin === 'windows');
      if (originDiff !== 0) {
        return originDiff;
      }

      return getBackupTimestamp(right) - getBackupTimestamp(left);
    }),
    [backups]
  );
  const lastRestorePoint = useMemo(
    () => restorePoints.slice().sort((left, right) => getBackupTimestamp(right) - getBackupTimestamp(left))[0] || null,
    [restorePoints]
  );
  const stats = useMemo(() => {
    const total = backups.length;
    const successful = backups.filter((backup) => normalizeStatus(backup) === 'successful').length;
    const failed = backups.filter((backup) => normalizeStatus(backup) === 'failed').length;
    const storageUsed = configBackups.reduce((sum, backup) => sum + (Number(backup.sizeBytes) || 0), 0);
    const oldCount = configBackups.filter((backup) => isOldBackup(backup, settings.cleanOlderThanDays)).length;
    const successRate = total ? Math.round((successful / total) * 100) : 0;

    return {
      total,
      configTotal: configBackups.length,
      restorePointTotal: restorePoints.length,
      successful,
      failed,
      storageUsed,
      oldCount,
      successRate
    };
  }, [backups, configBackups, restorePoints, settings.cleanOlderThanDays]);

  const filteredBackups = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    return sortedBackups.filter((backup) => {
      const status = normalizeStatus(backup);
      if (filter === 'successful' && status !== 'successful') {
        return false;
      }
      if (filter === 'restorePoints' && backup.origin !== 'windows') {
        return false;
      }
      if (filter === 'config' && backup.origin === 'windows') {
        return false;
      }
      if (filter === 'failed' && status !== 'failed') {
        return false;
      }
      if (!query) {
        return true;
      }

      return [
        backup.name,
        backup.description,
        backup.id,
        normalizeTypeLabel(backup.type),
        normalizeStatus(backup),
        ...(Array.isArray(backup.includedItems) ? backup.includedItems : []),
        ...(Array.isArray(backup.scope) ? backup.scope : [])
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [deferredSearchQuery, filter, sortedBackups]);

  const totalPages = Math.max(1, Math.ceil(filteredBackups.length / PAGE_SIZE));
  const pagedBackups = filteredBackups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const initialBackupLoading = loading && backups.length === 0;
  const isBusy = creating || creatingRestorePoint || Boolean(restoringId) || Boolean(deletingId) || cleaning || settingsSaving;

  function notify(message, tone = 'info') {
    if (message) {
      onNotify?.(message, tone);
    }
  }

  function startOperation(id, label, message = i18n.t('interfaceText.action_is_still_running_8be75')) {
    onOperationStatus?.({
      id,
      status: 'running',
      label,
      message
    });
  }

  function finishOperation(id, status, message) {
    onOperationStatus?.({
      id,
      status,
      message
    });
  }

  function buildGeneratedName() {
    const label = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date());

    return `Nova Config Save - ${label}`;
  }

  function buildRestorePointName() {
    const label = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date());

    return `Nova Tweaks Backup - ${label}`;
  }

  function openCreateModal(kind = 'backup') {
    const isConfig = kind === 'config';
    setCreateModal({
      open: true,
      kind: isConfig ? 'config' : 'backup',
      name: isConfig ? buildGeneratedName() : buildRestorePointName(),
      description: isConfig
        ? i18n.t('interfaceText.nova_configuration_before_changes_a3655')
        : i18n.t('interfaceText.system_backup_before_applying_changes_2c055')
    });
  }

  function closeCreateModal() {
    setCreateModal({
      open: false,
      kind: 'backup',
      name: '',
      description: ''
    });
  }

  function buildSnapshot(scopeIds, sourceSnapshot = appStateSnapshot) {
    const sourceTweaks = Array.isArray(sourceSnapshot?.tweaks) ? sourceSnapshot.tweaks : [];
    const snapshotTweaks = sourceTweaks.map((entry) => {
      const category = String(entry?.category || '').trim();
      const subcategory = String(entry?.subcategory || '').trim();
      return {
        id: String(entry?.id || '').trim(),
        name: String(entry?.name || '').trim(),
        category,
        subcategory,
        categoryKey: category.toLowerCase(),
        subcategoryKey: subcategory.toLowerCase(),
        currentState: String(entry?.currentState || entry?.status || '').trim().toLowerCase(),
        status: String(entry?.status || entry?.currentState || '').trim(),
        containerType: String(entry?.containerType || '').trim().toLowerCase(),
        profileLabel: String(entry?.profileLabel || '').trim(),
        selectedResolution: String(entry?.selectedResolution || '').trim(),
        selectedOption: String(entry?.selectedOption || '').trim(),
        currentValue: normalizeOptionalNumber(entry?.currentValue),
        requiresAdmin: Boolean(entry?.requiresAdmin),
        rebootRequired: Boolean(entry?.rebootRequired)
      };
    }).filter((entry) => entry.id);

    const hasTweakSource = snapshotTweaks.length > 0;
    const powerPlanTweaks = snapshotTweaks.filter(
      (entry) => entry.containerType === 'power_plan'
        || entry.subcategoryKey === 'power plans'
        || entry.name.toLowerCase().includes('power plan')
    );
    const timerTweaks = snapshotTweaks.filter(
      (entry) => TIMER_SCOPE_SUBCATEGORIES.has(entry.subcategoryKey)
        || entry.name.toLowerCase().includes('timer resolution')
    );
    const serviceTweaks = snapshotTweaks.filter(
      (entry) => SERVICE_SCOPE_SUBCATEGORIES.has(entry.subcategoryKey)
        || entry.name.toLowerCase().includes('service')
    );
    const registryBackedTweaks = snapshotTweaks.filter(
      (entry) => entry.currentState === 'enabled' && isRegistryBackedTweakEntry(entry)
    );
    const snapshot = {};

    for (const scopeId of scopeIds) {
      if (scopeId === 'tweakStates') {
        snapshot[scopeId] = buildSection(snapshotTweaks, hasTweakSource ? 'complete' : 'unavailable');
      } else if (scopeId === 'powerPlans') {
        snapshot[scopeId] = buildSection(powerPlanTweaks, hasTweakSource ? 'complete' : 'unavailable');
      } else if (scopeId === 'timerProfiles') {
        snapshot[scopeId] = buildSection(timerTweaks, hasTweakSource ? 'complete' : 'unavailable');
      } else if (scopeId === 'registryChanges') {
        snapshot[scopeId] = buildSection(registryBackedTweaks, hasTweakSource ? 'complete' : 'unavailable');
      } else if (scopeId === 'serviceTweaks') {
        snapshot[scopeId] = buildSection(serviceTweaks, hasTweakSource ? 'partial' : 'unavailable');
      } else if (scopeId === 'bootBcd') {
        snapshot[scopeId] = buildSection(
          snapshotTweaks.filter((entry) => BOOT_SCOPE_CATEGORIES.has(entry.categoryKey) || BOOT_SCOPE_SUBCATEGORIES.has(entry.subcategoryKey)),
          hasTweakSource ? 'partial' : 'unavailable'
        );
      } else if (scopeId === 'appSettings') {
        snapshot[scopeId] = buildSection({
          theme: String(sourceSnapshot?.theme || '').trim(),
          language: String(sourceSnapshot?.language || '').trim(),
          settings: sourceSnapshot?.settings && typeof sourceSnapshot.settings === 'object'
            ? sourceSnapshot.settings
            : null,
          backupPreferences: settings
        }, 'complete');
      }
    }

    return snapshot;
  }

  function applyBackupState(result) {
    const nextConfigBackups = Array.isArray(result?.backups) ? result.backups : [];
    const nextRestorePoints = Array.isArray(result?.windowsRestorePoints) ? result.windowsRestorePoints : [];
    const nextBackups = [...nextRestorePoints, ...nextConfigBackups];
    setConfigBackups(nextConfigBackups);
    setRestorePoints(nextRestorePoints);
    setStorage(result?.storage && typeof result.storage === 'object' ? result.storage : { rootPath: '', indexPath: '' });
    if (result?.settings) {
      setSettings(normalizeSettings(result.settings));
    }
    setSelectedBackupId((previous) => {
      if (result?.backup?.id) {
        return result.backup.id;
      }
      if (previous && nextBackups.some((backup) => backup.id === previous)) {
        return previous;
      }
      return nextBackups[0]?.id || '';
    });
  }

  function resolveMessage(result, fallback) {
    return result?.message || fallback;
  }

  async function loadBackups({ quiet = false } = {}) {
    if (!window.desktopApi?.listBackups) {
      setConfigBackups([]);
      setRestorePoints([]);
      setError(t('backup.notifications.apiUnavailable'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.desktopApi.listBackups();
      if (!result?.ok) {
        setConfigBackups([]);
        setRestorePoints([]);
        setError(resolveMessage(result, i18n.t('interfaceText.unable_to_load_backups_from_disk_819e4')));
        if (!quiet) {
          notify(resolveMessage(result, i18n.t('interfaceText.unable_to_load_backups_from_disk_819e4')), "error");
        }
        return;
      }

      applyBackupState(result);
    } catch (loadError) {
      const message = loadError?.message || i18n.t('interfaceText.unable_to_load_backups_from_disk_819e4');
      setConfigBackups([]);
      setRestorePoints([]);
      setError(message);
      if (!quiet) {
        notify(message, "error");
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    if (!window.desktopApi?.getBackupSettings) {
      return;
    }

    const result = await window.desktopApi.getBackupSettings();
    if (result?.ok && result.settings) {
      setSettings(normalizeSettings(result.settings));
    }
  }

  useEffect(() => {
    void loadBackups({ quiet: true });
    void loadSettings();
    // Initial load only; actions refresh with returned persisted state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearchQuery, filter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(1, page), totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!quickstartNavigationRequest) {
      return;
    }

    if (quickstartNavigationRequest.target === 'createBackup') {
      openCreateModal('backup');
      return;
    }

    if (quickstartNavigationRequest.target === 'createRestorePoint') {
      openCreateModal('backup');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickstartNavigationRequest]);

  async function handleCreateRestorePoint(metadata = {}) {
    if (isBusy) {
      return;
    }

    if (!window.desktopApi?.createBackup) {
      notify(t('backup.notifications.apiUnavailable'), "error");
      return;
    }

    setCreatingRestorePoint(true);
    setError('');
    const operationId = 'backup:create-restore-point';
    startOperation(operationId, i18n.t('backup.overview.actions.createBackup'), i18n.t('interfaceText.creating_windows_restore_point_c1481'));

    try {
      const result = await window.desktopApi.createBackup({
        engine: 'windows',
        name: String(metadata.name || '').trim() || buildRestorePointName(),
        description: String(metadata.description || '').trim() || i18n.t('interfaceText.system_backup_before_applying_changes_2c055'),
        scope: WINDOWS_RESTORE_SCOPE
      });

      if (!result?.ok) {
        finishOperation(operationId, "error", resolveMessage(result, i18n.t('interfaceText.unable_to_create_the_backup_ad1fd')));
        return;
      }

      applyBackupState(result);
      finishOperation(operationId, "success", `Backup "${result.backup?.name || i18n.t('interfaceText.nova_tweaks_backup_edfdc')}" created.`);
      onQuickstartEvent?.({ type: 'restore-point-created', backup: result.backup || null });
    } catch (createError) {
      finishOperation(operationId, "error", createError?.message || i18n.t('interfaceText.unable_to_create_the_backup_ad1fd'));
    } finally {
      setCreatingRestorePoint(false);
    }
  }

  async function handleCreateBackup(metadata = {}) {
    if (isBusy) {
      return;
    }

    if (!window.desktopApi?.createBackup) {
      notify(t('backup.notifications.apiUnavailable'), "error");
      return;
    }

    const scope = DEFAULT_SCOPE_SELECTION;
    setCreating(true);
    setError('');
    const operationId = 'backup:create-nova-config';
    startOperation(operationId, i18n.t('interfaceText.save_nova_config_3e108'), i18n.t('interfaceText.capturing_nova_configuration_a4d9e'));

    try {
      const preparedSnapshot = typeof onPrepareSnapshot === 'function'
        ? await onPrepareSnapshot()
        : appStateSnapshot;
      const hasTweakSnapshot = Array.isArray(preparedSnapshot?.tweaks) && preparedSnapshot.tweaks.length > 0;

      if (!hasTweakSnapshot) {
        finishOperation(operationId, "error", i18n.t('interfaceText.unable_to_capture_tweak_states_please_reload_tweaks_and_try_again_98b5e'));
        return;
      }

      const result = await window.desktopApi.createBackup({
        engine: 'nova',
        type: 'manual',
        name: String(metadata.name || '').trim() || buildGeneratedName(),
        description: String(metadata.description || '').trim() || i18n.t('interfaceText.nova_configuration_before_changes_a3655'),
        scope,
        snapshot: buildSnapshot(scope, preparedSnapshot)
      });

      if (!result?.ok) {
        finishOperation(operationId, "error", resolveMessage(result, i18n.t('interfaceText.unable_to_save_nova_config_on_disk_09b10')));
        return;
      }

      applyBackupState(result);
      finishOperation(operationId, "success", `Nova config "${result.backup?.name || i18n.t('interfaceText.nova_backup_86c14')}" saved.`);
      onQuickstartEvent?.({ type: 'backup-created', backup: result.backup || null });
    } catch (createError) {
      finishOperation(operationId, "error", createError?.message || i18n.t('interfaceText.unable_to_save_nova_config_on_disk_09b10'));
    } finally {
      setCreating(false);
    }
  }

  async function handleSubmitCreateModal() {
    const name = createModal.name.trim();
    const description = createModal.description.trim();
    if (!name) {
      notify(i18n.t('interfaceText.please_enter_a_backup_name_51b59'), "error");
      return;
    }

    const metadata = {
      name,
      description
    };
    const kind = createModal.kind;
    closeCreateModal();

    if (kind === 'config') {
      await handleCreateBackup(metadata);
      return;
    }

    await handleCreateRestorePoint(metadata);
  }

  function requestRestore(backup) {
    if (!backup || isBusy) {
      return;
    }

    setConfirmState({
      open: true,
      kind: 'restore',
      backupId: backup.id,
      name: backup.name
    });
  }

  async function handleRestoreBackup(backupId) {
    const backup = backups.find((entry) => entry.id === backupId);
    if (!backup || !window.desktopApi?.restoreBackup) {
      notify(i18n.t('interfaceText.backup_restore_is_unavailable_673c2'), "error");
      return;
    }

    setRestoringId(backupId);
    setError('');
    const operationId = `backup:restore:${backupId}`;
    startOperation(operationId, i18n.t('backup.confirm.restoreTitle'), `Restoring "${backup.name}"...`);

    try {
      const result = await window.desktopApi.restoreBackup({
        id: backup.id,
        scope: Array.isArray(backup.scope) ? backup.scope : DEFAULT_SCOPE_SELECTION
      });

      if (!result?.ok || !result.restorePlan) {
        finishOperation(operationId, "error", resolveMessage(result, i18n.t('backup.notifications.restoreFailed')));
        return;
      }

      if (result.restorePlan.origin === 'windows') {
        finishOperation(operationId, "success", `Backup "${backup.name}" restore has been started. A restart may be required.`);
        await loadBackups({ quiet: true });
        return;
      }

      if (typeof onRestoreBackup !== 'function') {
        finishOperation(operationId, "error", t('backup.notifications.restoreHandlerUnavailable'));
        return;
      }

      const applyResult = await onRestoreBackup(result.restorePlan);
      if (applyResult?.ok) {
        finishOperation(operationId, "success", `Backup "${backup.name}" restored.`);
      } else if (applyResult?.partial) {
        finishOperation(operationId, "success", `Backup "${backup.name}" restored with ${applyResult.errorCount || 0} issue(s).`);
      } else {
        finishOperation(operationId, "error", applyResult?.errors?.[0]?.message || i18n.t('backup.notifications.restoreFailed'));
      }

      await loadBackups({ quiet: true });
    } catch (restoreError) {
      finishOperation(operationId, "error", restoreError?.message || i18n.t('backup.notifications.restoreFailed'));
    } finally {
      setRestoringId('');
    }
  }

  function requestDelete(backup) {
    if (!backup || isBusy) {
      return;
    }

    if (backup.origin === 'windows') {
      notify(i18n.t('interfaceText.system_backups_are_managed_by_windows_and_cannot_be_deleted_here_7abd8'), 'info');
      return;
    }

    setConfirmState({
      open: true,
      kind: 'delete',
      backupId: backup.id,
      name: backup.name
    });
  }

  async function handleDeleteBackup(backupId) {
    if (!window.desktopApi?.deleteBackup) {
      notify(i18n.t('interfaceText.backup_delete_is_unavailable_c16fc'), "error");
      return;
    }

    setDeletingId(backupId);
    setError('');
    const operationId = `backup:delete:${backupId}`;
    startOperation(operationId, i18n.t('backup.confirm.deleteConfigTitle'), i18n.t('interfaceText.deleting_nova_config_c2159'));

    try {
      const result = await window.desktopApi.deleteBackup({ id: backupId });
      if (!result?.ok) {
        finishOperation(operationId, "error", resolveMessage(result, i18n.t('interfaceText.unable_to_delete_the_selected_backup_bf31d')));
        await loadBackups({ quiet: true });
        return;
      }

      applyBackupState(result);
      finishOperation(operationId, "success", i18n.t('interfaceText.nova_config_deleted_8a773'));
    } catch (deleteError) {
      finishOperation(operationId, "error", deleteError?.message || i18n.t('interfaceText.unable_to_delete_the_selected_backup_bf31d'));
    } finally {
      setDeletingId('');
    }
  }

  async function handleOpenBackupFolder() {
    if (!window.desktopApi?.openBackupFolder) {
      notify(i18n.t('interfaceText.open_backup_folder_is_unavailable_811da'), "error");
      return;
    }

    const result = await window.desktopApi.openBackupFolder();
    if (!result?.ok) {
      notify(resolveMessage(result, i18n.t('interfaceText.unable_to_open_the_backup_folder_4542a')), "error");
    }
  }

  function requestCleanOldBackups() {
    if (isBusy) {
      return;
    }

    setConfirmState({
      open: true,
      kind: 'clean',
      backupId: '',
      name: ''
    });
  }

  async function handleCleanOldBackups() {
    if (!window.desktopApi?.cleanOldBackups) {
      notify(i18n.t('interfaceText.backup_cleanup_is_unavailable_ebdf6'), "error");
      return;
    }

    setCleaning(true);
    setError('');
    const operationId = 'backup:clean-old';
    startOperation(operationId, i18n.t('backup.confirm.cleanOldTitle'), i18n.t('interfaceText.removing_old_nova_config_backups_6a58d'));

    try {
      const result = await window.desktopApi.cleanOldBackups({
        olderThanDays: settings.cleanOlderThanDays
      });
      if (!result?.ok) {
        finishOperation(operationId, "error", resolveMessage(result, i18n.t('interfaceText.unable_to_clean_old_backups_69373')));
        return;
      }

      applyBackupState(result);
      finishOperation(operationId, "success", `Removed ${result.deletedCount || 0} old backup file(s).`);
    } catch (cleanError) {
      finishOperation(operationId, "error", cleanError?.message || i18n.t('interfaceText.unable_to_clean_old_backups_69373'));
    } finally {
      setCleaning(false);
    }
  }

  async function updateScheduleDraft(nextSettings) {
    const normalized = normalizeSettings({
      ...settings,
      ...nextSettings
    });
    setSettings(normalized);

    if (!window.desktopApi?.updateBackupSettings) {
      return;
    }

    setSettingsSaving(true);
    try {
      const result = await window.desktopApi.updateBackupSettings(normalized);
      if (result?.ok && result.settings) {
        setSettings(normalizeSettings(result.settings));
      } else if (!result?.ok) {
        notify(resolveMessage(result, i18n.t('interfaceText.unable_to_save_backup_settings_7fc40')), "error");
      }
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleConfirmAction() {
    const { kind, backupId } = confirmState;
    setConfirmState({ open: false, kind: '', backupId: '', name: '' });

    if (kind === 'restore') {
      await handleRestoreBackup(backupId);
    } else if (kind === 'delete') {
      await handleDeleteBackup(backupId);
    } else if (kind === 'clean') {
      await handleCleanOldBackups();
    }
  }

  const confirmTitle = confirmState.kind === 'restore'
    ? t('backup.confirm.restoreTitle')
    : confirmState.kind === 'delete'
      ? t('backup.confirm.deleteConfigTitle')
      : t('backup.confirm.cleanOldTitle');
  const confirmMessage = confirmState.kind === 'restore'
    ? t('backup.confirm.restoreMessage', { name: confirmState.name })
    : confirmState.kind === 'delete'
      ? t('backup.confirm.deleteConfigMessage', { name: confirmState.name })
      : t('backup.confirm.cleanOldMessage', { days: settings.cleanOlderThanDays });
  const confirmLabel = confirmState.kind === 'restore'
    ? t('backup.confirm.restoreAction')
    : confirmState.kind === 'delete'
      ? t('backup.confirm.deleteConfigAction')
      : t('backup.confirm.cleanOldAction');

  return (
    <PageShell className="backup-shell relative font-ui">
      <div className="grid gap-5 pb-6">
        <header className="backup-page-header ui-page-header gap-4">
          <div className="ui-page-heading min-w-0">
            <PageHeadingSignal />
            <div className="min-w-0">
              <h1 className="ui-page-title">{i18n.t('interfaceText.backups_530cc')}</h1>
              <p className="ui-page-description">
                {i18n.t('interfaceText.create_and_manage_system_backups_save_nova_config_is_available_as_b9497')}
              </p>
            </div>
          </div>

          <div className="backup-page-header__actions">
            <label className="ui-input-shell h-12 w-full min-w-0">
              <Search className="h-5 w-5 shrink-0 text-[var(--text-muted)]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={i18n.t('backup.restore.searchPlaceholder')}
                className="ui-input min-w-0 flex-1"
              />
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>

            <label className="ui-select-shell h-12 w-full min-w-0">
              <SlidersHorizontal className="h-4 w-4" />
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="ui-select text-sm"
              >
                <option value="all">{i18n.t('interfaceText.all_entries_f8b99')}</option>
                <option value="restorePoints">{i18n.t('interfaceText.backups_530cc')}</option>
                <option value="config">{i18n.t('interfaceText.nova_configs_30b96')}</option>
                <option value="successful">{i18n.t('scheduledMaintenance.status.success')}</option>
                <option value="failed">{i18n.t('emailVerification.badge.error')}</option>
              </select>
              <ChevronDown className="pointer-events-none h-4 w-4 text-[var(--text-muted)]" />
            </label>

            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => openCreateModal('backup')}
              loading={creatingRestorePoint}
              leftIcon={<Plus className="h-4 w-4" />}
              className="h-12 whitespace-nowrap"
            >
              {i18n.t('backup.quickPanel.createBackupTitle')}
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Archive} label={i18n.t('interfaceText.system_backups_05834')} value={stats.restorePointTotal} detail={`${filteredBackups.length} visible entries`} />
          <MetricCard icon={CheckCircle2} label={i18n.t('scheduledMaintenance.status.success')} value={stats.successful} detail={`${stats.successRate}% success rate`} />
          <MetricCard
            icon={Clock3}
            label={i18n.t('dashboard.widgets.lastBackup.title')}
            value={lastRestorePoint ? formatRelativeTime(lastRestorePoint.createdAt) : i18n.t('apps.impact.none')}
            detail={lastRestorePoint ? formatDateTime(lastRestorePoint.createdAt) : i18n.t('interfaceText.create_your_first_backup_35ac9')}
          />
          <MetricCard icon={HardDrive} label={i18n.t('interfaceText.nova_config_f463b')} value={formatBytes(stats.storageUsed)} detail={`${stats.configTotal} saved config(s)`} />
        </section>

        {error ? (
          <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--danger)_26%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_9%,transparent)] px-4 py-3 text-sm text-[var(--text-primary)]">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
              <div>
                <p className="font-semibold">{i18n.t('interfaceText.backup_data_could_not_be_loaded_cleanly_861dd')}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{error}</p>
              </div>
            </div>
          </div>
        ) : null}

        <main className="grid min-w-0 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative min-h-[560px] min-w-0 xl:min-h-0">
          <section className="absolute inset-0 flex min-w-0 flex-col overflow-hidden rounded-3xl border border-[color:color-mix(in_srgb,var(--accent)_16%,var(--border)_84%)] bg-[color:color-mix(in_srgb,var(--surface)_94%,var(--surface-strong)_6%)] shadow-[0_24px_62px_rgba(0,0,0,0.18)]">
            <div className="flex flex-col gap-3 border-b border-[color:color-mix(in_srgb,var(--border)_76%,transparent)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-normal text-[var(--text-primary)]">{i18n.t('backup.history.title')}</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  System backups first, sorted by newest. Showing {pagedBackups.length} {"of"} {filteredBackups.length}.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => loadBackups()}
                loading={loading}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                {i18n.t('gameMode.detection.refresh')}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="hidden grid-cols-[minmax(170px,1fr)_118px_70px_90px_90px_86px] gap-3 border-b border-[color:color-mix(in_srgb,var(--border)_76%,transparent)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] xl:grid">
                <span className="text-center">{i18n.t('apps.exportFields.name')}</span>
                <span className={`text-center ${BACKUP_LIST_HEADER_DIVIDER_CLASS}`}>{i18n.t('interfaceText.date_time_63ae7')}</span>
                <span className={`text-center ${BACKUP_LIST_HEADER_DIVIDER_CLASS}`}>{i18n.t('backup.history.meta.type')}</span>
                <span className={`text-center ${BACKUP_LIST_HEADER_DIVIDER_CLASS}`}>{i18n.t('backup.history.meta.size')}</span>
                <span className={`text-center ${BACKUP_LIST_HEADER_DIVIDER_CLASS}`}>{i18n.t('common.status')}</span>
                <span className={`text-center ${BACKUP_LIST_HEADER_DIVIDER_CLASS}`}>{i18n.t('apps.actionsLabel')}</span>
              </div>

              {initialBackupLoading ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[var(--border-subtle)] px-4 py-3 xl:grid-cols-[2.25rem_minmax(130px,1fr)_118px_70px_90px_90px_86px]">
                      <Skeleton className="h-9 w-9 rounded-xl" />
                      <span className="grid gap-2">
                        <Skeleton className="h-3 w-32 max-w-full" />
                        <Skeleton className="h-2.5 w-48 max-w-[80%]" />
                      </span>
                      <Skeleton className="hidden h-3 w-20 xl:block" />
                      <Skeleton className="hidden h-3 w-12 xl:block" />
                      <Skeleton className="hidden h-3 w-14 xl:block" />
                      <Skeleton className="hidden h-3 w-14 xl:block" />
                      <Skeleton className="hidden h-8 w-16 rounded-lg xl:block" />
                    </div>
                  ))}
                </div>
              ) : pagedBackups.length ? (
                <div className="divide-y divide-[color:color-mix(in_srgb,var(--border)_72%,transparent)]">
                  {pagedBackups.map((backup, index) => {
                    const status = normalizeStatus(backup);
                    const isRestoring = restoringId === backup.id;
                    const isDeleting = deletingId === backup.id;
                    const busy = isRestoring || isDeleting;
                    const menuOpensUpward = index === pagedBackups.length - 1 && pagedBackups.length > 1;

                    return (
                      <div
                        key={backup.id}
                        className="grid min-w-0 gap-3 px-5 py-4 transition hover:bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)] xl:grid-cols-[minmax(170px,1fr)_118px_70px_90px_90px_86px] xl:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center justify-center gap-3">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] text-[var(--accent)]">
                              {backup.origin === 'windows' ? <ShieldCheck className="h-4 w-4" /> : <DatabaseBackup className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[var(--text-primary)]" title={backup.name}>
                                {backup.name}
                              </p>
                              <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={backup.description || backup.id}>
                                {backup.description || backup.id}
                              </p>
                            </div>
                          </div>
                        </div>

                        <p className="truncate text-center text-xs leading-5 text-[var(--text-muted)] [font-variant-numeric:tabular-nums]" title={formatDateTime(backup.createdAt)}>{formatDateTime(backup.createdAt)}</p>
                        <p className="truncate text-center text-xs font-medium text-[var(--text-primary)]" title={normalizeTypeLabel(backup.type)}>{normalizeTypeLabel(backup.type)}</p>
                        <p className="truncate text-center text-xs text-[var(--text-muted)] [font-variant-numeric:tabular-nums]" title={getBackupSizeLabel(backup)}>{getBackupSizeLabel(backup)}</p>
                        <div className="flex items-center justify-center"><StatusBadge status={status} /></div>

                        <div className="relative flex items-center gap-2 xl:justify-center">
                          <button
                            type="button"
                            onClick={() => requestRestore(backup)}
                            disabled={(isBusy && !isRestoring) || busy}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Restore ${backup.name}`}
                            title={i18n.t('backup.history.actions.restore')}
                          >
                            {isRestoring ? <LoadingSpinner /> : <RotateCcw className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenMenuId((previous) => previous === backup.id ? '' : backup.id)}
                            disabled={busy}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`More actions for ${backup.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {openMenuId === backup.id ? (
                            <div className={joinClasses(
                              'absolute right-0 z-30 w-48 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_18px_54px_rgba(0,0,0,0.28)]',
                              menuOpensUpward ? 'bottom-11' : 'top-11'
                            )}>
                              <button type="button" onClick={() => { setOpenMenuId(''); requestRestore(backup); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-strong)]">
                                <RotateCcw className="h-4 w-4" /> {t('backup.history.actions.restore')}
                              </button>
                              <button type="button" onClick={() => { setOpenMenuId(''); setDetailsBackupId(backup.id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-strong)]">
                                <Eye className="h-4 w-4" /> {t('backup.history.actions.viewDetails')}
                              </button>
                              {backup.origin === 'windows' ? null : (
                                <button type="button" onClick={() => { setOpenMenuId(''); void handleOpenBackupFolder(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-strong)]">
                                  <FolderOpen className="h-4 w-4" /> {t('backup.history.actions.openLocation')}
                                </button>
                              )}
                              {backup.origin === 'windows' ? null : (
                                <button type="button" onClick={() => { setOpenMenuId(''); requestDelete(backup); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--danger)] hover:bg-[color:color-mix(in_srgb,var(--danger)_8%,transparent)]">
                                  <Trash2 className="h-4 w-4" /> {t('backup.history.actions.deleteConfig')}
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[260px] items-center justify-center p-8">
                  <div className="max-w-sm text-center">
                    <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] text-[var(--accent)]">
                      <DatabaseBackup className="h-7 w-7" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
                      {backups.length ? i18n.t('interfaceText.no_entries_match_your_filters_a60d4') : i18n.t('interfaceText.no_backups_yet_2014f')}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                      {backups.length
                        ? i18n.t('interfaceText.adjust_the_search_or_filter_to_find_an_existing_backup_or_nova_co_de533')
                        : i18n.t('interfaceText.create_a_backup_before_applying_larger_tweak_changes_d9521')}
                    </p>
                    {!backups.length ? (
                      <Button type="button" variant="primary" size="md" onClick={() => openCreateModal('backup')} loading={creatingRestorePoint} className="mt-5">
                        {i18n.t('backup.quickPanel.createBackupTitle')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-[color:color-mix(in_srgb,var(--border)_76%,transparent)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[var(--text-muted)]">
                Page {currentPage} {"of"} {totalPages}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1}>
                  {i18n.t('interfaceText.previous_50f94')}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages}>
                  {i18n.t('interfaceText.next_bc981')}
                </Button>
              </div>
            </div>
          </section>
          </div>

          <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border)_80%)] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--surface)_93%)] px-5 py-4 xl:col-start-1 xl:row-start-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface)_86%)] text-[var(--accent)]">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">{i18n.t('interfaceText.your_backups_are_safe_67e92')}</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                    {i18n.t('interfaceText.system_backups_are_handled_through_windows_system_restore_nova_co_1b29d')}
                  </p>
                </div>
              </div>
              <Button type="button" variant="secondary" size="md" onClick={handleOpenBackupFolder} leftIcon={<FolderOpen className="h-4 w-4" />}>
                {i18n.t('interfaceText.nova_config_folder_1faee')}
              </Button>
            </div>
          </section>

          <aside className="min-w-0 space-y-5 xl:col-start-2 xl:row-start-1">
            <Panel title={t('backup.quickPanel.title')} description={t('backup.quickPanel.description')} icon={SlidersHorizontal}>
              <div className="grid gap-2">
                <QuickActionRow icon={Plus} title={t('backup.quickPanel.createBackupTitle')} description={t('backup.quickPanel.createBackupDescription')} onClick={() => openCreateModal('backup')} loading={creatingRestorePoint} tone="primary" />
                <QuickActionRow icon={DatabaseBackup} title={t('backup.quickPanel.saveConfigTitle')} description={t('backup.quickPanel.saveConfigDescription')} onClick={() => openCreateModal('config')} disabled={isBusy && !creating} loading={creating} />
                <QuickActionRow icon={RotateCcw} title={t('backup.quickPanel.restoreBackupTitle')} description={t('backup.quickPanel.restoreBackupDescription')} onClick={() => requestRestore(selectedBackup)} disabled={!selectedBackup || isBusy} loading={Boolean(selectedBackup && restoringId === selectedBackup.id)} />
                <QuickActionRow icon={FolderOpen} title={t('backup.quickPanel.openFolderTitle')} description={t('backup.quickPanel.openFolderDescription')} onClick={handleOpenBackupFolder} />
                <QuickActionRow icon={Trash2} title={t('backup.quickPanel.cleanOldTitle')} description={t('backup.quickPanel.cleanOldDescription')} onClick={requestCleanOldBackups} disabled={!stats.oldCount || isBusy} loading={cleaning} tone="warning" />
                {!stats.oldCount ? (
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    Cleanup is disabled because no Nova config is older than {settings.cleanOlderThanDays} days.
                  </p>
                ) : null}
              </div>
            </Panel>

            <Panel title={i18n.t('interfaceText.backup_schedule_9f498')} description={i18n.t('interfaceText.settings_are_persisted_fa9d9')} icon={CalendarClock}>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface-strong)_58%,transparent)] px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{i18n.t('interfaceText.automatic_backups_8a772')}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {settings.automaticBackupsEnabled ? i18n.t('interfaceText.schedule_is_enabled_eae41') : i18n.t('interfaceText.manual_backups_remain_active_a7129')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={settings.automaticBackupsEnabled ? "success" : 'neutral'}>
                      {settings.automaticBackupsEnabled ? i18n.t('backup.status.enabled') : i18n.t('backup.status.disabled')}
                    </StatusPill>
                    <Switch
                      checked={settings.automaticBackupsEnabled}
                      onChange={(checked) => updateScheduleDraft({ automaticBackupsEnabled: checked })}
                      disabled={settingsSaving}
                      ariaLabel={i18n.t('interfaceText.automatic_backups_8a772')}
                    />
                  </div>
                </div>

                <label className="block">
                  <span className="text-xs font-medium text-[var(--text-muted)]">{i18n.t('interfaceText.frequency_draft_01352')}</span>
                  <span className="ui-select-shell mt-2 h-9 w-full">
                    <select
                      value={settings.frequencyDays}
                      onChange={(event) => updateScheduleDraft({ frequencyDays: Number.parseInt(event.target.value, 10) })}
                      className="ui-select text-sm"
                    >
                      <option value={1}>{i18n.t('interfaceText.every_day_3b2eb')}</option>
                      <option value={3}>{i18n.t('interfaceText.every_3_days_8c5bd')}</option>
                      <option value={7}>{i18n.t('interfaceText.every_7_days_809ad')}</option>
                      <option value={14}>{i18n.t('interfaceText.every_14_days_9c19e')}</option>
                      <option value={30}>{i18n.t('interfaceText.every_30_days_fa625')}</option>
                    </select>
                    <ChevronDown className="pointer-events-none h-4 w-4 text-[var(--text-muted)]" />
                  </span>
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-[var(--text-muted)]">{i18n.t('interfaceText.cleanup_threshold_f0f1a')}</span>
                  <span className="ui-select-shell mt-2 h-9 w-full">
                    <select
                      value={settings.cleanOlderThanDays}
                      onChange={(event) => updateScheduleDraft({ cleanOlderThanDays: Number.parseInt(event.target.value, 10) })}
                      className="ui-select text-sm"
                    >
                      <option value={14}>{i18n.t('interfaceText.older_than_14_days_55758')}</option>
                      <option value={30}>{i18n.t('interfaceText.older_than_30_days_1de70')}</option>
                      <option value={60}>{i18n.t('interfaceText.older_than_60_days_257b0')}</option>
                      <option value={90}>{i18n.t('interfaceText.older_than_90_days_aad55')}</option>
                    </select>
                    <ChevronDown className="pointer-events-none h-4 w-4 text-[var(--text-muted)]" />
                  </span>
                </label>

                {settingsSaving ? <p className="text-xs text-[var(--text-muted)]">{i18n.t('interfaceText.saving_schedule_settings_df25d')}</p> : null}
              </div>
            </Panel>
          </aside>
        </main>

      </div>

      <ConfirmModal
        open={confirmState.open}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        cancelLabel={i18n.t('common.cancel')}
        loading={Boolean(restoringId || deletingId || cleaning)}
        onCancel={() => setConfirmState({ open: false, kind: '', backupId: '', name: '' })}
        onConfirm={handleConfirmAction}
      />

      <ModalShell
        open={createModal.open}
        title={createModal.kind === 'config' ? t('backup.create.saveConfigTitle') : t('backup.create.title')}
        description={createModal.kind === 'config'
          ? t('backup.create.saveConfigDescription')
          : t('backup.create.nameBackupDescription')}
        onClose={closeCreateModal}
        closeLabel={t('common.cancel')}
        closeDisabled={creating || creatingRestorePoint}
        closeOnBackdrop={!creating && !creatingRestorePoint}
        closeOnEscape={!creating && !creatingRestorePoint}
        size="md"
        footer={(
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={closeCreateModal}
              disabled={creating || creatingRestorePoint}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSubmitCreateModal}
              loading={createModal.kind === 'config' ? creating : creatingRestorePoint}
            >
              {createModal.kind === 'config' ? t('backup.create.saveConfigTitle') : t('backup.create.title')}
            </Button>
          </>
        )}
      >
        <div className="grid gap-4">
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">{i18n.t('apps.exportFields.name')}</span>
            <input
              type="text"
              value={createModal.name}
              onChange={(event) => setCreateModal((previous) => ({ ...previous, name: event.target.value }))}
              maxLength={120}
              className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              placeholder={createModal.kind === 'config' ? i18n.t('interfaceText.nova_config_save_before_changes_bdc7c') : i18n.t('interfaceText.nova_tweaks_backup_before_changes_bdf7d')}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">{i18n.t('interfaceText.description_55f8e')}</span>
            <textarea
              value={createModal.description}
              onChange={(event) => setCreateModal((previous) => ({ ...previous, description: event.target.value }))}
              maxLength={240}
              rows={4}
              className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-6 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              placeholder={i18n.t('interfaceText.optional_context_for_this_backup_fd40b')}
            />
          </label>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(detailsBackup)}
        title={detailsBackup?.name || i18n.t('interfaceText.entry_details_72445')}
        description={detailsBackup?.description || ''}
        onClose={() => setDetailsBackupId('')}
        closeLabel={i18n.t('common.close')}
        size="lg"
      >
        {detailsBackup ? (
          <div className="grid gap-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <p className="text-xs text-[var(--text-muted)]">{i18n.t('account.createdAt')}</p>
                <p className="mt-1 font-medium text-[var(--text-primary)]">{formatDateTime(detailsBackup.createdAt)}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <p className="text-xs text-[var(--text-muted)]">{i18n.t('backup.history.meta.size')}</p>
                <p className="mt-1 font-medium text-[var(--text-primary)]">{getBackupSizeLabel(detailsBackup)}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <p className="text-xs text-[var(--text-muted)]">{i18n.t('backup.history.meta.type')}</p>
                <p className="mt-1 font-medium text-[var(--text-primary)]">{normalizeTypeLabel(detailsBackup.type)}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <p className="text-xs text-[var(--text-muted)]">{i18n.t('interfaceText.app_version_055c4')}</p>
                <p className="mt-1 font-medium text-[var(--text-primary)]">{detailsBackup.appVersion || i18n.t('tweakDetails.unknown')}</p>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs text-[var(--text-muted)]">{i18n.t('interfaceText.included_items_cc3b3')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(Array.isArray(detailsBackup.includedItems) && detailsBackup.includedItems.length
                  ? detailsBackup.includedItems
                  : detailsBackup.scope || []
                ).map((item) => (
                  <span key={item} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-primary)]">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs text-[var(--text-muted)]">{i18n.t('gameMode.detection.pathLabel')}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--text-primary)]">{getBackupLocationLabel(detailsBackup, storage.rootPath)}</p>
            </div>
          </div>
        ) : null}
      </ModalShell>
    </PageShell>
  );
}

export default BackupRestorePanel;
