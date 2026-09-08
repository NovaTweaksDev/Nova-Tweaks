import i18n from '../i18n';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {
  AppWindow,
  BrushCleaning,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  FileDown,
  Filter,
  Gamepad2,
  Globe,
  Grid2X2,
  MoreHorizontal,
  Package,
  PieChart,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Wrench
} from 'lucide-react';
import { Button, ListSkeleton, LoadingIndicator, LoadingSpinner, PageHeadingSignal, PageSection, PageShell, SegmentedControl, Skeleton, Switch } from './ui';
import { useAppPortalContainer } from './ui/useAppPortalContainer';
import {
  APPS_LIST_HEADER_PADDING_CLASS,
  SHARED_LIST_ACTIONS_CLASS,
  SHARED_LIST_CATEGORY_CELL_CLASS,
  SHARED_LIST_CHEVRON_CELL_CLASS,
  SHARED_LIST_GAP_CLASS,
  SHARED_LIST_GRID_CLASS,
  SHARED_LIST_HEADER_DIVIDER_CLASS,
  SHARED_LIST_ICON_CELL_CLASS,
  SHARED_LIST_MAIN_CELL_CLASS,
  SHARED_LIST_ROW_MIN_HEIGHT_CLASS,
  SHARED_LIST_ROW_PADDING_CLASS,
  SHARED_LIST_STATUS_CELL_CLASS
} from '../constants/listLayout';

const PAGE_SIZE = 8;
const FILTERS = [
  { id: 'all', labelKey: 'apps.tabs.allApps', icon: Grid2X2 },
  { id: 'startup', labelKey: 'apps.tabs.startup', icon: RefreshCw }
];
const CACHE_ACTION_ID = 'cache.cleanup';

function getOptimizationActions(app) {
  return Array.isArray(app?.optimization?.actions) ? app.optimization.actions : [];
}

function getTabOptimizationActions(app) {
  return getOptimizationActions(app).filter((action) => (
    action?.supported !== false &&
    action?.kind !== 'startup' &&
    action?.id !== 'startup.disable'
  ));
}

function getCacheOptimizationAction(app) {
  return getOptimizationActions(app).find((action) => action?.id === CACHE_ACTION_ID && action?.supported !== false) || null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toIconSrc(iconPath, iconDataUrl) {
  const rawDataUrl = normalizeText(iconDataUrl);
  if (rawDataUrl.startsWith('data:image/')) return rawDataUrl;

  const rawPath = normalizeText(iconPath);
  if (!rawPath || !/\.(ico|png|jpg|jpeg|webp|bmp)$/i.test(rawPath)) return '';

  const normalizedPath = rawPath.replace(/\\/g, '/');
  const withPrefix = normalizedPath.match(/^[a-zA-Z]:\//) ? `file:///${normalizedPath}` : `file://${normalizedPath}`;
  return encodeURI(withPrefix);
}

function isSystemApp(app) {
  const installType = normalizeKey(app?.installType);
  const source = normalizeKey(app?.source);
  const reason = normalizeKey(app?.uninstallReason);
  return Boolean(app?.isSystemComponent) ||
    installType === 'system' ||
    installType === 'framework' ||
    source === 'system' ||
    reason === 'appx_non_removable' ||
    reason === 'appx_framework';
}

function getAppCategory(app) {
  const name = normalizeKey(app?.name);
  const publisher = normalizeKey(app?.publisher);
  const installType = normalizeKey(app?.installType);
  const source = normalizeKey(app?.source);
  const haystack = `${name} ${publisher}`;

  if (isSystemApp(app)) return 'System';
  if (source === 'appx' || installType === 'store') return 'Store';
  if (/\b(chrome|firefox|edge|opera|brave|vivaldi|browser)\b/.test(haystack)) return 'Browser';
  if (/\b(steam|epic games|riot|battle\.net|ubisoft|ea app|minecraft|game|gaming)\b/.test(haystack)) return "Gaming";
  if (/\b(visual studio|vscode|sdk|runtime|node|python|git|developer|jetbrains)\b/.test(haystack)) return 'Development';
  if (/\b(driver|utility|tools|updater|assistant|manager|control|nvidia|amd|intel)\b/.test(haystack)) return "Utility";
  return "App";
}

function getCategoryLabel(category) {
  if (category === 'Browser') return i18n.t('apps.categories.Browser');
  if (category === 'Development') return i18n.t('apps.categories.Development');
  if (category === 'Gaming') return i18n.t('apps.categories.Gaming');
  if (category === 'System') return i18n.t('apps.categories.System');
  if (category === 'Store') return i18n.t('apps.categories.Store');
  if (category === 'Utility') return i18n.t('apps.categories.Utility');
  return i18n.t('apps.categories.App');
}

function localizeAppCategory(category, t) {
  return t(`apps.categories.${category}`, { defaultValue: getCategoryLabel(category) });
}

function localizeRuntimeStatus(status, t) {
  const label = String(status?.label || '').toLowerCase();
  if (label === 'running') return t('apps.runtimeStatus.running');
  if (label === 'stopped') return t('apps.runtimeStatus.stopped');
  return t('apps.runtimeStatus.unknown');
}

function localizeImpact(impact, t) {
  const level = String(impact?.level || '').toLowerCase();
  return t(`apps.impact.${level}`, { defaultValue: impact?.label || t('apps.impact.none') });
}

function getFallbackIcon(category) {
  if (category === 'Browser') return Globe;
  if (category === 'System') return Cpu;
  if (category === 'Utility' || category === 'Development') return Wrench;
  if (category === 'Gaming') return Gamepad2;
  return Package;
}

function getAccentStyle() {
  return { '--category-accent': 'var(--accent)' };
}

function getAppSizeBytes(app) {
  const raw = app?.sizeBytes ?? app?.installSizeBytes ?? app?.size ?? app?.installSize ?? app?.estimatedSize;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 10_000_000 ? value : value * 1024;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / (1024 ** 2))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function getInstallDate(app) {
  return normalizeText(app?.installDate || app?.installedAt || app?.dateInstalled) || '--';
}

function getInstallPath(app) {
  return normalizeText(app?.installLocation || app?.installPath || app?.path || app?.location);
}

function getStartupEntryPublisher(entry, allApps = []) {
  const entryName = normalizeKey(entry?.name);
  if (!entryName) return '';
  const match = allApps.find((app) => {
    const appName = normalizeKey(app?.name);
    return appName === entryName || appName.includes(entryName) || entryName.includes(appName);
  });
  return normalizeText(match?.publisher);
}

function getStartupMatches(app, startupEntries) {
  const appName = normalizeKey(app?.name);
  if (!appName) return [];
  return (Array.isArray(startupEntries) ? startupEntries : []).filter((entry) => {
    const entryName = normalizeKey(entry?.name);
    const command = normalizeKey(entry?.command);
    const sourcePath = normalizeKey(entry?.sourcePath);
    return entryName === appName ||
      entryName.includes(appName) ||
      appName.includes(entryName) ||
      command.includes(appName) ||
      sourcePath.includes(appName);
  });
}

function isStartupEnabled(app, startupEntries) {
  return getStartupMatches(app, startupEntries).some((entry) => Boolean(entry?.enabled));
}

function getRuntimeStatus(app) {
  const explicitStatus = normalizeKey(app?.runtimeStatus || app?.processStatus || app?.status);
  const runningFlag = app?.isRunning ?? app?.running ?? app?.processActive;

  if (runningFlag === true || Number(app?.processId) > 0 || explicitStatus === 'running' || explicitStatus === 'active') {
    return { label: i18n.t('apps.runtimeStatus.running'), running: true };
  }
  if (runningFlag === false || explicitStatus === 'stopped' || explicitStatus === 'inactive' || explicitStatus === 'not_running') {
    return { label: i18n.t('apps.runtimeStatus.stopped'), running: false };
  }
  return { label: i18n.t('tweakDetails.unknown'), running: false };
}

function getStartupImpactFromEntry(entry) {
  const explicit = normalizeKey(entry?.startupImpact || entry?.impact);
  if (explicit.includes('high')) return { label: i18n.t('tweakDetails.risk.high'), level: 'high', dots: 3 };
  if (explicit.includes('medium') || explicit.includes('moderate')) return { label: i18n.t('tweakDetails.risk.medium'), level: 'medium', dots: 2 };
  if (explicit.includes('low')) return { label: i18n.t('tweakDetails.risk.low'), level: 'low', dots: 2 };
  if (explicit.includes('none') || explicit.includes('disabled')) return { label: i18n.t('apps.impact.none'), level: 'none', dots: 0 };
  return entry?.enabled ? { label: i18n.t('tweakDetails.risk.medium'), level: 'medium', dots: 2 } : { label: i18n.t('apps.impact.none'), level: 'none', dots: 0 };
}

function getStartupImpact(app, startupEntries) {
  const matches = getStartupMatches(app, startupEntries);
  const explicit = normalizeKey(
    app?.startupImpact ||
    app?.impact ||
    matches.find((entry) => entry?.startupImpact || entry?.impact)?.startupImpact ||
    matches.find((entry) => entry?.startupImpact || entry?.impact)?.impact
  );

  if (explicit.includes('high')) return { label: i18n.t('tweakDetails.risk.high'), level: 'high', dots: 3 };
  if (explicit.includes('medium') || explicit.includes('moderate')) return { label: i18n.t('tweakDetails.risk.medium'), level: 'medium', dots: 2 };
  if (explicit.includes('low')) return { label: i18n.t('tweakDetails.risk.low'), level: 'low', dots: 2 };
  if (explicit.includes('none') || explicit.includes('disabled')) return { label: i18n.t('apps.impact.none'), level: 'none', dots: 0 };

  const enabledMatch = matches.find((entry) => Boolean(entry?.enabled));
  return enabledMatch ? getStartupImpactFromEntry(enabledMatch) : { label: i18n.t('apps.impact.none'), level: 'none', dots: 0 };
}

function AppIcon({ app, className = 'h-10 w-10', fallbackIcon }) {
  const category = getAppCategory(app);
  const FallbackIcon = fallbackIcon || getFallbackIcon(category);
  const iconSrc = toIconSrc(app?.iconPath, app?.iconDataUrl);
  const [iconLoadFailed, setIconLoadFailed] = useState(false);

  useEffect(() => {
    setIconLoadFailed(false);
  }, [iconSrc]);

  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] text-[var(--text-muted)] ${className}`}>
      {iconSrc && !iconLoadFailed ? (
        <img src={iconSrc} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setIconLoadFailed(true)} />
      ) : (
        <FallbackIcon className="h-5 w-5" aria-hidden="true" />
      )}
    </span>
  );
}

const ToolbarIconButton = forwardRef(function ToolbarIconButton(
  { children, active = false, label, onClick, disabled = false, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border text-[var(--text-muted)] transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-[color:color-mix(in_srgb,var(--accent)_58%,var(--border))] bg-[var(--active-layer)] text-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_20%,transparent)]'
          : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
      }`}
      {...props}
    >
      {children}
    </button>
  );
});

function FilterMenu({ open, showAppxPackages, showTechnicalComponents, onToggleShowAppxPackages, onToggleShowTechnicalComponents }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuPrimitive.Content
      align="end"
      sideOffset={8}
      className="nova-dropdown-content z-30 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-2 shadow-[0_18px_42px_rgba(0,0,0,0.32)]"
    >
      <FilterOption active={Boolean(showAppxPackages)} label={t('apps.showStoreApps')} onClick={() => onToggleShowAppxPackages?.(!showAppxPackages)} />
      <FilterOption active={Boolean(showTechnicalComponents)} label={t('apps.showTechnicalComponentsShort')} onClick={() => onToggleShowTechnicalComponents?.(!showTechnicalComponents)} />
    </DropdownMenuPrimitive.Content>
  );
}

function FilterOption({ active, label, onClick }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={active}
      onCheckedChange={onClick}
      onSelect={(event) => event.preventDefault()}
      className={`nova-dropdown-item ${active ? 'is-active ' : ''}flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
        active
          ? 'bg-[color:color-mix(in_srgb,var(--accent)_16%,var(--surface)_84%)] text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--hover-layer)] hover:text-[var(--text-primary)]'
      } outline-none focus:bg-[var(--hover-layer)] focus:text-[var(--text-primary)]`}
    >
      <span>{label}</span>
      {active ? <CheckCircle2 className="h-4 w-4" /> : null}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function StatCard({ icon: Icon, label, value, detail, loading = false }) {
  return (
    <article className="apps-stat-card w-full rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)] p-4 text-left">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_12%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface-strong)_86%)] text-[var(--accent)]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-muted)]">{label}</p>
          <p className="mt-2 text-3xl font-semibold leading-none text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">{loading ? <Skeleton className="h-7 w-16" /> : value}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{loading ? <Skeleton className="h-2.5 w-20" /> : detail}</p>
        </div>
      </div>
    </article>
  );
}

function CategoryTabs({ activeTab, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-7 overflow-x-auto border-b border-[var(--border)] px-5 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {FILTERS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`relative inline-flex shrink-0 items-center gap-2 pb-3 text-sm font-medium transition ${
            activeTab === id
              ? 'text-[var(--accent)] after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Icon className="h-4 w-4" />
          <span className="whitespace-nowrap">{t(labelKey)}</span>
          {id === 'startup' ? <span className="h-2 w-2 rounded-full bg-[var(--success)]" /> : null}
        </button>
      ))}
    </div>
  );
}

function StatusCell({ status, loading = false }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
        <LoadingSpinner className="h-3.5 w-3.5" />
        {t('apps.loadingStatus')}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
      <span className={`h-2.5 w-2.5 rounded-full ${status.running ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} />
      {localizeRuntimeStatus(status, t)}
    </span>
  );
}

function StartupStatusCell({ enabled }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
      <span className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} />
      {enabled ? t('apps.startup.status.enabled') : t('apps.startup.status.disabled')}
    </span>
  );
}

function AppActionMenu({ app, onOpen, onClose, onCopyInfo }) {
  const { t } = useTranslation();

  const installPath = getInstallPath(app);
  const canOpenLocation = Boolean(installPath && window.desktopApi?.openPath);

  return (
    <DropdownMenuPrimitive.Content
      align="end"
      sideOffset={7}
      className="nova-dropdown-content z-40 w-52 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.34)]"
    >
      {canOpenLocation ? <ActionMenuItem icon={<Package className="h-4 w-4" />} onClick={() => { onOpen?.(installPath); onClose?.(); }}>{t('apps.openLocation')}</ActionMenuItem> : null}
      <ActionMenuItem icon={<FileDown className="h-4 w-4" />} onClick={() => { onCopyInfo?.(app); onClose?.(); }}>{t('apps.copyInfo')}</ActionMenuItem>
    </DropdownMenuPrimitive.Content>
  );
}

function ActionMenuItem({ icon, children, disabled = false, loading = false, onClick }) {
  return (
    <DropdownMenuPrimitive.Item asChild disabled={disabled}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="nova-dropdown-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] outline-none transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus:bg-[var(--surface-hover)] focus:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <LoadingSpinner /> : icon}
        <span>{children}</span>
      </button>
    </DropdownMenuPrimitive.Item>
  );
}

function AppActionButton({ icon, label, disabled = false, loading = false, danger = false, expanded, menuTrigger = false, onClick }) {
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'hover:border-[color:color-mix(in_srgb,var(--danger)_38%,var(--border))] hover:text-[var(--danger)]'
          : 'hover:border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] hover:text-[var(--accent)]'
      }`}
      aria-label={label}
      aria-expanded={expanded}
    >
      {loading ? <LoadingSpinner className="h-4 w-4" /> : icon}
    </button>
  );

  return (
    <span className="group/action relative inline-flex">
      {menuTrigger ? <DropdownMenuPrimitive.Trigger asChild>{button}</DropdownMenuPrimitive.Trigger> : button}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+0.45rem)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface-strong)] px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-[var(--text-primary)] opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-within/action:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function AppRow({ app, startupEntries, detailsLoading = false, menuOpen, canCleanCache, uninstallBusy, optimizeBusy, portalContainer, onToggleMenu, onCloseMenu, onUninstall, onClearCache, onCopyInfo, onOpenLocation }) {
  const { t } = useTranslation();
  const category = getAppCategory(app);
  const publisher = normalizeText(app.publisher) || t('apps.unknownPublisher');
  const version = normalizeText(app.version);
  const status = getRuntimeStatus(app);
  const impact = getStartupImpact(app, startupEntries);
  const canUninstall = Boolean(app?.canUninstall) && !isSystemApp(app);
  const cacheAction = getCacheOptimizationAction(app);
  const cacheNeedsCleanup = Boolean(cacheAction?.needsChange);
  const size = detailsLoading ? '--' : formatBytes(getAppSizeBytes(app));
  const metaItems = [
    version ? t('apps.versionValue', { version }) : '',
    size !== '--' ? size : '',
    impact.label !== 'None' ? t('apps.startupImpactShort', { impact: localizeImpact(impact, t) }) : ''
  ].filter(Boolean);

  return (
    <article
      style={getAccentStyle()}
      className={`apps-row group grid ${SHARED_LIST_ROW_MIN_HEIGHT_CLASS} ${SHARED_LIST_GRID_CLASS} items-center ${SHARED_LIST_GAP_CLASS} rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_78%,var(--surface-strong)_22%)] ${SHARED_LIST_ROW_PADDING_CLASS} text-left transition-[background-color,border-color,box-shadow] duration-200 hover:border-[color:color-mix(in_srgb,var(--category-accent)_24%,var(--border))] hover:bg-[var(--surface-hover)]`}
    >
      <div className={SHARED_LIST_ICON_CELL_CLASS}>
        <AppIcon app={app} />
      </div>

      <div className={SHARED_LIST_MAIN_CELL_CLASS}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="line-clamp-2 text-[14px] font-semibold leading-5 text-[var(--text-primary)]" title={app.name}>{app.name}</h4>
          {isSystemApp(app) ? <span className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent)]">{t('apps.protected')}</span> : null}
        </div>
        <p className="mt-1 truncate text-xs font-medium text-[var(--text-secondary)]" title={publisher}>{publisher}</p>
        {metaItems.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {metaItems.slice(0, 3).map((item) => <span key={item} className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{item}</span>)}
          </div>
        ) : null}
      </div>

      <p className={`truncate text-center text-sm font-medium text-[var(--text-secondary)] ${SHARED_LIST_CATEGORY_CELL_CLASS}`}>{localizeAppCategory(category, t)}</p>
      <div className={`flex items-center justify-center ${SHARED_LIST_STATUS_CELL_CLASS}`}><StatusCell status={status} loading={detailsLoading} /></div>

      <span className={`relative ${SHARED_LIST_ACTIONS_CLASS}`}>
        {cacheAction ? (
          <AppActionButton
            icon={<BrushCleaning className="h-[18px] w-[18px]" />}
            label={optimizeBusy
              ? t('apps.optimization.cleaningCache', { defaultValue: 'Cleaning cache...' })
              : cacheNeedsCleanup
                ? t('apps.optimization.cleanCache', { defaultValue: 'Clean cache' })
                : t('apps.optimization.cacheClean', { defaultValue: 'Cache is clean' })}
            disabled={!canCleanCache || !cacheNeedsCleanup || optimizeBusy || uninstallBusy}
            loading={optimizeBusy}
            onClick={() => {
              onCloseMenu?.();
              onClearCache?.(app);
            }}
          />
        ) : null}
        <AppActionButton
          icon={<Trash2 className="h-[18px] w-[18px]" />}
          label={uninstallBusy ? t('apps.uninstalling') : t('apps.uninstall')}
          disabled={!canUninstall || uninstallBusy || optimizeBusy}
          loading={uninstallBusy}
          danger
          onClick={() => {
            onCloseMenu?.();
            onUninstall?.(app);
          }}
        />
        <DropdownMenuPrimitive.Root
          open={menuOpen}
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              onToggleMenu(app);
            } else {
              onCloseMenu?.();
            }
          }}
        >
          <AppActionButton
            icon={<MoreHorizontal className="h-5 w-5" />}
            label={t('apps.moreActions')}
            expanded={menuOpen}
            menuTrigger
          />
          <DropdownMenuPrimitive.Portal container={portalContainer}>
            <AppActionMenu app={app} onOpen={onOpenLocation} onClose={onCloseMenu} onCopyInfo={onCopyInfo} />
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      </span>
      <span className={SHARED_LIST_CHEVRON_CELL_CLASS} aria-hidden="true" />
    </article>
  );
}

function StartupRow({ entry, allApps, toggleBusy, onToggleEnabled }) {
  const { t } = useTranslation();
  const publisher = getStartupEntryPublisher(entry, allApps);
  const impact = getStartupImpactFromEntry(entry);
  const startupType = normalizeText(entry?.startupKind || entry?.startupType) || t('apps.startup.entry');
  const source = normalizeText(entry?.sourcePath || entry?.command);

  return (
    <article
      style={getAccentStyle()}
      className={`group grid ${SHARED_LIST_ROW_MIN_HEIGHT_CLASS} ${SHARED_LIST_GRID_CLASS} items-center ${SHARED_LIST_GAP_CLASS} rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_78%,var(--surface-strong)_22%)] ${SHARED_LIST_ROW_PADDING_CLASS} text-left transition-[background-color,border-color,box-shadow] duration-200 hover:border-[color:color-mix(in_srgb,var(--category-accent)_24%,var(--border))] hover:bg-[var(--surface-hover)]`}
    >
      <div className={SHARED_LIST_ICON_CELL_CLASS}>
        <AppIcon app={entry} fallbackIcon={AppWindow} />
      </div>
      <div className={SHARED_LIST_MAIN_CELL_CLASS}>
        <h4 className="block min-w-0 max-w-full truncate text-[14px] font-semibold leading-5 text-[var(--text-primary)]" title={entry.name}>{entry.name}</h4>
        <div className="mt-1.5 flex min-w-0 max-w-full gap-1.5 overflow-hidden">
          {[publisher || startupType, impact.label !== 'None' ? t('apps.impactShort', { impact: localizeImpact(impact, t) }) : t('apps.impact.noneImpact'), source].filter(Boolean).slice(0, 3).map((item) => (
            <span key={item} title={item} className="min-w-0 max-w-[14rem] shrink truncate rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{item}</span>
          ))}
        </div>
      </div>

      <p className={`truncate text-center text-sm font-medium text-[var(--text-secondary)] ${SHARED_LIST_CATEGORY_CELL_CLASS}`} title={startupType}>{startupType}</p>
      <div className={`flex items-center justify-center ${SHARED_LIST_STATUS_CELL_CLASS}`}><StartupStatusCell enabled={Boolean(entry.enabled)} /></div>

      <span className={SHARED_LIST_ACTIONS_CLASS}>
        {toggleBusy ? <LoadingSpinner /> : null}
        <Switch checked={Boolean(entry.enabled)} disabled={!entry?.canToggle || toggleBusy} onChange={(nextEnabled) => onToggleEnabled?.(entry, nextEnabled)} ariaLabel={entry.enabled ? t('apps.startup.toggleOff') : t('apps.startup.toggleOn')} />
      </span>
      <span className={SHARED_LIST_CHEVRON_CELL_CLASS} aria-hidden="true" />
    </article>
  );
}

function StartupManager({ apps, startupEntries }) {
  const { t } = useTranslation();
  const summary = useMemo(() => {
    const hasStartupEntries = Array.isArray(startupEntries) && startupEntries.length > 0;
    const source = hasStartupEntries ? startupEntries : (Array.isArray(apps) ? apps : []);
    const enabledItems = source.filter((item) => (
      hasStartupEntries ? Boolean(item?.enabled) : isStartupEnabled(item, startupEntries)
    ));
    const counts = enabledItems.reduce((accumulator, item) => {
      const impact = hasStartupEntries ? getStartupImpactFromEntry(item) : getStartupImpact(item, startupEntries);
      accumulator[impact.level] += 1;
      return accumulator;
    }, { high: 0, medium: 0, low: 0, none: 0 });

    return {
      counts,
      enabledCount: enabledItems.length,
      totalCount: source.length
    };
  }, [apps, startupEntries]);

  const { counts, enabledCount, totalCount } = summary;
  const total = Math.max(1, enabledCount);
  const highEnd = (counts.high / total) * 360;
  const mediumEnd = highEnd + (counts.medium / total) * 360;
  const lowEnd = mediumEnd + (counts.low / total) * 360;
  const donut = `conic-gradient(var(--danger) 0deg ${highEnd}deg, var(--warning) ${highEnd}deg ${mediumEnd}deg, var(--success) ${mediumEnd}deg ${lowEnd}deg, color-mix(in_srgb,var(--text-muted)_30%,transparent) ${lowEnd}deg 360deg)`;

  return (
    <PageSection className="p-5">
      <h2 className="ui-section-title">{t('apps.startup.managerTitle')}</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{t('apps.startup.managerDescription')}</p>
      <div className="mt-5 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-4">
        <div className="relative h-28 w-28 rounded-full p-3" style={{ background: donut }}>
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[var(--surface)] text-center">
            <span className="text-2xl font-semibold text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">{enabledCount}</span>
            <span className="text-xs text-[var(--text-muted)]">{t('apps.startup.status.enabled')}</span>
            <span className="mt-0.5 text-[10px] leading-none text-[var(--text-muted)]">{t('apps.startup.totalEntriesShort', { count: totalCount })}</span>
          </div>
        </div>
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase text-[var(--text-muted)]">{t('apps.startup.enabledImpactBreakdown')}</p>
          <LegendRow color="bg-[var(--danger)]" label={t('apps.impact.highImpact')} value={counts.high} />
          <LegendRow color="bg-[var(--warning)]" label={t('apps.impact.mediumImpact')} value={counts.medium} />
          <LegendRow color="bg-[var(--success)]" label={t('apps.impact.lowImpact')} value={counts.low} />
          <LegendRow color="bg-[color:color-mix(in_srgb,var(--text-muted)_38%,transparent)]" label={t('apps.impact.noneImpact')} value={counts.none} />
        </div>
      </div>
    </PageSection>
  );
}

function LegendRow({ color, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="inline-flex min-w-0 items-center gap-2 text-[var(--text-secondary)]">
        <span className={`h-3 w-3 shrink-0 rounded-full ${color}`} />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold text-[var(--text-secondary)] [font-variant-numeric:tabular-nums]">{value}</span>
    </div>
  );
}

function Pagination({ page, pageCount, start, end, total, itemLabel = "apps", onPageChange }) {
  const { t } = useTranslation();
  const pages = useMemo(() => {
    if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
    const result = [1];
    if (page > 3) result.push('gap-left');
    for (let current = Math.max(2, page - 1); current <= Math.min(pageCount - 1, page + 1); current += 1) result.push(current);
    if (page < pageCount - 2) result.push('gap-right');
    result.push(pageCount);
    return result;
  }, [page, pageCount]);

  return (
    <div className="flex min-h-[72px] items-center justify-between gap-4 border-t border-[var(--border)] px-5">
      <p className="text-sm text-[var(--text-muted)]">{t('apps.pagination.showing', { start: total === 0 ? 0 : start + 1, end, total, itemLabel: t(itemLabel) })}</p>
      <div className="flex items-center gap-2">
        <PageButton disabled={page <= 1} onClick={() => onPageChange(page - 1)} ariaLabel={t('apps.pagination.previous')}><ChevronLeft className="h-4 w-4" /></PageButton>
        {pages.map((item) => item === 'gap-left' || item === 'gap-right'
          ? <span key={item} className="px-2 text-sm text-[var(--text-muted)]">...</span>
          : <PageButton key={item} active={item === page} onClick={() => onPageChange(item)}>{item}</PageButton>)}
        <PageButton disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} ariaLabel={t('apps.pagination.next')}><ChevronRight className="h-4 w-4" /></PageButton>
      </div>
    </div>
  );
}

function PageButton({ children, active = false, disabled = false, onClick, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? 'border-[var(--accent)] bg-[var(--active-layer)] text-[var(--accent)]'
          : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function TableHeader({ activeTab }) {
  const { t } = useTranslation();
  return (
    <div className={`grid ${SHARED_LIST_GRID_CLASS} ${SHARED_LIST_GAP_CLASS} border-b border-[var(--border)] ${APPS_LIST_HEADER_PADDING_CLASS} py-3 text-xs font-semibold uppercase text-[var(--text-muted)] max-md:hidden`}>
      <span aria-hidden="true" />
      <span>{activeTab === 'startup' ? t('apps.startup.entry') : t('apps.table.app')}</span>
      <span className={`text-center ${SHARED_LIST_HEADER_DIVIDER_CLASS}`}>{t('tweakDetails.category')}</span>
      <span className={`text-center ${SHARED_LIST_HEADER_DIVIDER_CLASS}`}>{t('tweakDetails.status')}</span>
      <span className={`text-center ${SHARED_LIST_HEADER_DIVIDER_CLASS}`}>{t('apps.actionsLabel')}</span>
      <span aria-hidden="true" />
    </div>
  );
}

function OptimizationRow({ app, busy, onApply, onView, onRestore }) {
  const { t } = useTranslation();
  const actions = getTabOptimizationActions(app);
  const analyzed = app?.optimization?.analyzed === true;
  const recommendedActions = analyzed
    ? actions.filter((action) => action?.recommended && action?.needsChange && action?.reversible !== false)
    : [];
  const reviewActions = analyzed
    ? actions.filter((action) => action?.needsChange && !recommendedActions.includes(action))
    : actions;
  const restoreAvailable = Boolean(app?.optimization?.restoreAvailable);
  const description = t('apps.optimization.rowDescription', {
    count: actions.length,
    defaultValue: `${actions.length} verified settings and targeted cleanup options.`
  });
  const pendingCount = recommendedActions.length + reviewActions.length;
  const stateLabel = pendingCount > 0
    ? t('apps.optimization.pendingChanges', { count: pendingCount, defaultValue: `${pendingCount} changes available` })
    : restoreAvailable
      ? t('apps.optimization.settingsSaved', { defaultValue: 'Previous settings saved' })
      : t('apps.optimization.noPendingChanges', { defaultValue: 'No changes pending' });

  return (
    <article className="apps-row group grid gap-3 border-b border-[var(--border-subtle)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--hover-layer)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <AppIcon app={app} />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-[var(--text-primary)]">{app.name}</h4>
          <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={description}>{description}</p>
          <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${pendingCount > 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${pendingCount > 0 ? 'bg-[var(--accent)]' : restoreAvailable ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} aria-hidden="true" />
            {stateLabel}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onView?.(app)}>
          {t('apps.optimization.details', { defaultValue: 'Optimization details' })}
        </Button>
        {restoreAvailable ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onRestore?.(app)} leftIcon={<RotateCcw className="h-3.5 w-3.5" />}>
            {t('apps.optimization.restore', { defaultValue: 'Restore saved settings' })}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={pendingCount > 0 ? 'primary' : 'secondary'}
          disabled={busy || (recommendedActions.length === 0 && reviewActions.length === 0)}
          onClick={() => analyzed && recommendedActions.length > 0
            ? onApply?.(app, recommendedActions.map((action) => action.id))
            : onView?.(app)}
          leftIcon={busy ? <LoadingSpinner /> : pendingCount > 0 ? <Wrench className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
        >
          {analyzed && recommendedActions.length > 0
            ? t('apps.optimization.applyRecommended', { count: recommendedActions.length, defaultValue: `Apply ${recommendedActions.length} changes` })
            : reviewActions.length > 0
              ? t('apps.optimization.reviewOptions', { count: reviewActions.length, defaultValue: `Review ${reviewActions.length} options` })
              : t('apps.optimization.upToDate', { defaultValue: 'Up to date' })}
        </Button>
      </div>
    </article>
  );
}

function OptimizationsView({ apps, loading, errorCode, activeOptimizeAppId, onReload, onApply, onView, onRestore }) {
  const { t } = useTranslation();
  const optimizableApps = useMemo(() => (Array.isArray(apps) ? apps : []).filter((app) => (
    getTabOptimizationActions(app).length > 0
  )), [apps]);
  const recommendedCount = optimizableApps.reduce((total, app) => total + getTabOptimizationActions(app).filter((action) => (
    action?.recommended && action?.needsChange && action?.reversible !== false
  )).length, 0);
  const restoreCount = optimizableApps.filter((app) => Boolean(app?.optimization?.restoreAvailable)).length;

  return (
    <div className="motion-tab-panel">
      <section className="apps-table-panel overflow-hidden rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('apps.optimization.libraryTitle', { defaultValue: 'App optimizations' })}</h2>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-muted)]">{t('apps.optimization.libraryDescription', { defaultValue: 'Verified app settings and targeted cache cleanup. Apps with only a Windows startup action are omitted.' })}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span><strong className="mr-1.5 font-semibold tabular-nums text-[var(--text-primary)]">{recommendedCount}</strong>{t('apps.optimization.pending', { defaultValue: 'pending' })}</span>
            <span className="h-4 w-px bg-[var(--border)]" aria-hidden="true" />
            <span><strong className="mr-1.5 font-semibold tabular-nums text-[var(--text-primary)]">{restoreCount}</strong>{t('apps.optimization.restorePoints', { defaultValue: 'restore points' })}</span>
          </div>
        </div>
        {loading && optimizableApps.length === 0 ? <ListSkeleton rows={5} label={t('common.loading')} /> : null}
        {errorCode ? <ErrorBlock message={t('apps.loadError')} onReload={onReload} /> : null}
        {!loading && !errorCode && optimizableApps.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
            <ShieldCheck className="h-7 w-7 text-[var(--text-muted)]" />
            <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{t('apps.optimization.noneDetected', { defaultValue: 'No meaningful app optimizations detected' })}</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-muted)]">{t('apps.optimization.noneDetectedDescription', { defaultValue: 'Nova omits apps where Windows startup is the only available action.' })}</p>
          </div>
        ) : null}
        {optimizableApps.length > 0 ? (
          <div>
            {loading ? <LoadingIndicator label={t('apps.refreshing')} compact className="mx-2 my-1" /> : null}
            {optimizableApps.map((app) => (
              <OptimizationRow
                key={app.id}
                app={app}
                busy={String(activeOptimizeAppId) === String(app.id)}
                onApply={onApply}
                onView={onView}
                onRestore={onRestore}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AppsPanel({
  apps,
  rawApps,
  searchTerm,
  onSearchChange,
  showAppxPackages,
  onToggleShowAppxPackages,
  showTechnicalComponents,
  onToggleShowTechnicalComponents,
  loading,
  detailsLoading = false,
  errorCode,
  activeUninstallAppId = '',
  activeOptimizeAppId = '',
  onReload,
  onRequestUninstall,
  onOptimize,
  onViewOptimization,
  onRestoreOptimization,
  startupEntries = [],
  rawStartupEntries = [],
  startupStandardCount = 0,
  startupAdditionalCount = 0,
  showAdditionalStartupSources = false,
  onToggleShowAdditionalStartupSources,
  navigationRequest = null,
  startupLoading = false,
  startupErrorCode = '',
  activeStartupToggleId = '',
  onReloadStartup,
  onToggleStartupEnabled
}) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState('installed');
  const [activeTab, setActiveTab] = useState('all');
  const [actionMenuId, setActionMenuId] = useState('');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const portalContainer = useAppPortalContainer();

  useEffect(() => {
    if (navigationRequest?.target === 'startup') {
      setActiveView('installed');
      setActiveTab('startup');
      setPage(1);
    }
  }, [navigationRequest]);

  const appSource = Array.isArray(apps) ? apps : [];
  const allApps = Array.isArray(rawApps) ? rawApps : appSource;
  const startupSource = Array.isArray(startupEntries) ? startupEntries : [];
  const allStartupEntries = Array.isArray(rawStartupEntries) && rawStartupEntries.length > 0 ? rawStartupEntries : startupSource;
  const normalizedSearch = normalizeKey(searchTerm);
  const initialAppsLoading = Boolean(loading) && allApps.length === 0;
  const refreshingApps = Boolean(loading) && allApps.length > 0;
  const initialStartupLoading = Boolean(startupLoading) && allStartupEntries.length === 0;
  const refreshingStartup = Boolean(startupLoading) && allStartupEntries.length > 0;

  const visibleApps = useMemo(() => appSource.filter((app) => {
    const name = normalizeKey(app?.name);
    const publisher = normalizeKey(app?.publisher);
    return !normalizedSearch || name.includes(normalizedSearch) || publisher.includes(normalizedSearch);
  }), [appSource, normalizedSearch]);

  const visibleStartupEntries = useMemo(() => (Array.isArray(startupSource) ? startupSource : []).filter((entry) => {
    if (!normalizedSearch) return true;
    const name = normalizeKey(entry?.name);
    const publisher = normalizeKey(getStartupEntryPublisher(entry, allApps));
    const command = normalizeKey(entry?.command);
    const sourcePath = normalizeKey(entry?.sourcePath);
    return name.includes(normalizedSearch) || publisher.includes(normalizedSearch) || command.includes(normalizedSearch) || sourcePath.includes(normalizedSearch);
  }), [allApps, normalizedSearch, startupSource]);

  const activeRowsTotal = activeTab === 'startup' ? visibleStartupEntries.length : visibleApps.length;
  const pageCount = Math.max(1, Math.ceil(activeRowsTotal / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, activeRowsTotal);
  const pageApps = visibleApps.slice(start, end);
  const pageStartupEntries = visibleStartupEntries.slice(start, end);

  useEffect(() => {
    setPage(1);
    setActionMenuId('');
  }, [activeTab, activeView, normalizedSearch, showAppxPackages, showTechnicalComponents]);

  const metrics = useMemo(() => {
    const totalBytes = allApps.reduce((sum, app) => sum + getAppSizeBytes(app), 0);
    return {
      total: `${visibleApps.length} (${allApps.length})`,
      enabled: detailsLoading ? '--' : allApps.filter((app) => getRuntimeStatus(app).running || isStartupEnabled(app, allStartupEntries)).length,
      storage: detailsLoading ? '--' : totalBytes > 0 ? formatBytes(totalBytes) : '--',
      updates: allApps.filter((app) => Boolean(app?.updateAvailable || app?.hasUpdate)).length
    };
  }, [allApps, allStartupEntries, detailsLoading, visibleApps]);

  async function copyAppInfo(app) {
    const status = getRuntimeStatus(app);
    const impact = getStartupImpact(app, allStartupEntries);
    const lines = [
      `${t('apps.exportFields.name')}: ${app?.name || ''}`,
      `${t('apps.publisherLabel')}: ${app?.publisher || ''}`,
      `${t('apps.version')}: ${app?.version || ''}`,
      `${t('tweakDetails.status')}: ${localizeRuntimeStatus(status, t)}`,
      `${t('apps.startupImpact')}: ${localizeImpact(impact, t)}`,
      `${t('apps.storageUsed')}: ${formatBytes(getAppSizeBytes(app))}`,
      getInstallDate(app) !== '--' ? `${t('apps.installedOn')}: ${getInstallDate(app)}` : ''
    ].filter(Boolean);
    try {
      await navigator.clipboard?.writeText(lines.join('\n'));
    } catch (_error) {
      // Clipboard access can be unavailable in restricted renderer contexts.
    }
  }

  async function openLocation(path) {
    if (!path || !window.desktopApi?.openPath) return;
    try {
      await window.desktopApi.openPath({ path });
    } catch (_error) {
      // Opening paths is optional and only used when an exposed desktop API exists.
    }
  }

  return (
    <PageShell className="apps-shell relative">
      <div className="pb-6">
        <div className="grid gap-5">
          <header className="ui-page-header grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="ui-page-heading min-w-0">
              <PageHeadingSignal />
              <div className="min-w-0">
                <h1 className="ui-page-title">{t('apps.title')}</h1>
                <p className="ui-page-description">{t('apps.description')}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 xl:justify-end">
              <label className="ui-input-shell h-12 w-full min-w-0 sm:w-[360px]">
                <Search className="h-5 w-5 text-[var(--text-muted)]" />
                <input type="text" value={searchTerm} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={t('apps.searchPlaceholderShort')} className="ui-input" />
              </label>
              {activeView === 'installed' ? (
                <DropdownMenuPrimitive.Root open={filterOpen} onOpenChange={setFilterOpen}>
                  <DropdownMenuPrimitive.Trigger asChild>
                    <ToolbarIconButton label={t('apps.filterApps')} active={filterOpen}>
                      <Filter className="h-5 w-5" />
                    </ToolbarIconButton>
                  </DropdownMenuPrimitive.Trigger>
                  <DropdownMenuPrimitive.Portal container={portalContainer}>
                    <FilterMenu
                      open={filterOpen}
                      showAppxPackages={showAppxPackages}
                      showTechnicalComponents={showTechnicalComponents}
                      onToggleShowAppxPackages={onToggleShowAppxPackages}
                      onToggleShowTechnicalComponents={onToggleShowTechnicalComponents}
                    />
                  </DropdownMenuPrimitive.Portal>
                </DropdownMenuPrimitive.Root>
              ) : null}
              <ToolbarIconButton label={t('apps.reloadApps')} onClick={() => { onReload?.(); onReloadStartup?.(); }} disabled={loading || detailsLoading}>
                {loading || detailsLoading ? <LoadingSpinner className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
              </ToolbarIconButton>
            </div>
          </header>

          <SegmentedControl
            value={activeView}
            onChange={setActiveView}
            ariaLabel={t('apps.views.label', { defaultValue: 'Apps view' })}
            className="w-full sm:w-fit"
            itemClassName="min-w-36"
            options={[
              { id: 'installed', label: t('apps.views.installed', { defaultValue: 'Installed apps' }) },
              { id: 'optimizations', label: t('apps.views.optimizations', { defaultValue: 'Optimizations' }) }
            ]}
          />

          {activeView === 'installed' ? (
          <div className="motion-tab-panel grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard loading={initialAppsLoading} icon={Grid2X2} label={t('apps.metrics.total')} value={metrics.total} detail={t('apps.metrics.installed')} />
          <StatCard loading={initialAppsLoading} icon={CheckCircle2} label={t('apps.metrics.enabled')} value={metrics.enabled} detail={detailsLoading ? t('apps.metrics.calculating') : t('apps.metrics.runningOrStartup')} />
          <StatCard loading={initialAppsLoading} icon={PieChart} label={t('apps.metrics.storageUsed')} value={metrics.storage} detail={detailsLoading ? t('apps.metrics.calculating') : t('apps.metrics.acrossAllApps')} />
          <StatCard loading={initialAppsLoading} icon={Download} label={t('apps.metrics.updatesAvailable')} value={metrics.updates} detail={t('apps.tabs.apps')} />
        </div>
        <main className="apps-table-panel min-w-0 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)]">
          <CategoryTabs activeTab={activeTab} onChange={setActiveTab} />
          {activeTab === 'startup' && Number(startupStandardCount) > 0 ? (
            <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3 text-sm">
              <p className="min-w-0 text-[var(--text-muted)]">{t('apps.startup.standardOnlyHint', { count: Number(startupStandardCount) })}</p>
              {Number(startupAdditionalCount) > 0 ? (
                <label className="inline-flex shrink-0 items-center gap-3 text-xs font-medium text-[var(--text-secondary)]">
                  <span>{t('apps.startup.showAdditionalSources')}</span>
                  <Switch checked={Boolean(showAdditionalStartupSources)} onChange={(nextChecked) => onToggleShowAdditionalStartupSources?.(nextChecked)} ariaLabel={t('apps.startup.showAdditionalSources')} />
                </label>
              ) : null}
            </div>
          ) : null}
          <TableHeader activeTab={activeTab} />

          {activeTab === 'all' && initialAppsLoading ? <ListSkeleton rows={5} label={t('common.loading')} /> : null}
          {activeTab === 'startup' && initialStartupLoading ? <ListSkeleton rows={5} label={t('common.loading')} /> : null}
          {activeTab === 'all' && errorCode ? <ErrorBlock message={t('apps.loadError')} onReload={onReload} /> : null}
          {activeTab === 'startup' && startupErrorCode ? <ErrorBlock message={t('apps.startup.loadError')} onReload={onReloadStartup} /> : null}
          {activeTab === 'all' && !initialAppsLoading && !errorCode && allApps.length === 0 ? <div className="p-5 text-sm text-[var(--text-muted)]">{t('apps.empty')}</div> : null}
          {activeTab === 'all' && !initialAppsLoading && !errorCode && allApps.length > 0 && visibleApps.length === 0 ? <div className="p-5 text-sm text-[var(--text-muted)]">{t('apps.noMatch')}</div> : null}
          {activeTab === 'startup' && !initialStartupLoading && !startupErrorCode && startupSource.length === 0 ? <div className="p-5 text-sm text-[var(--text-muted)]">{t('apps.startup.empty')}</div> : null}
          {activeTab === 'startup' && !initialStartupLoading && !startupErrorCode && startupSource.length > 0 && visibleStartupEntries.length === 0 ? <div className="p-5 text-sm text-[var(--text-muted)]">{t('apps.startup.noMatch')}</div> : null}

          {activeTab === 'all' && !initialAppsLoading && !errorCode && pageApps.length > 0 ? (
            <div key="apps-tab-all" className="motion-tab-panel space-y-2 p-3">
              {refreshingApps ? <LoadingIndicator label={t('apps.refreshing')} compact className="mx-2 my-1" /> : null}
              {detailsLoading ? <LoadingIndicator label={t('apps.loadingDetails')} compact className="mx-2 my-1" /> : null}
              {pageApps.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  startupEntries={allStartupEntries}
                  detailsLoading={detailsLoading}
                  menuOpen={String(actionMenuId) === String(app.id)}
                  canCleanCache={Boolean(onOptimize)}
                  uninstallBusy={String(activeUninstallAppId) === String(app.id)}
                  optimizeBusy={String(activeOptimizeAppId) === String(app.id)}
                  portalContainer={portalContainer}
                  onToggleMenu={(entry) => {
                    setActionMenuId((current) => current === entry.id ? '' : entry.id);
                  }}
                  onCloseMenu={() => setActionMenuId('')}
                  onUninstall={onRequestUninstall}
                  onClearCache={(entry) => onOptimize?.(entry, [CACHE_ACTION_ID])}
                  onCopyInfo={copyAppInfo}
                  onOpenLocation={openLocation}
                />
              ))}
            </div>
          ) : null}

          {activeTab === 'startup' && !initialStartupLoading && !startupErrorCode && pageStartupEntries.length > 0 ? (
            <div key="apps-tab-startup" className="motion-tab-panel space-y-2 p-3">
              {refreshingStartup ? <LoadingIndicator label={t('apps.startup.refreshing')} compact className="mx-2 my-1" /> : null}
              {pageStartupEntries.map((entry) => (
                <StartupRow key={entry.id} entry={entry} allApps={allApps} toggleBusy={String(activeStartupToggleId) === String(entry.id)} onToggleEnabled={onToggleStartupEnabled} />
              ))}
            </div>
          ) : null}

          <Pagination page={safePage} pageCount={pageCount} start={start} end={end} total={activeRowsTotal} itemLabel={activeTab === 'startup' ? 'apps.pagination.startupEntries' : 'apps.pagination.apps'} onPageChange={setPage} />
        </main>

        {activeTab === 'startup' ? <div className="motion-tab-panel"><StartupManager apps={visibleApps.length > 0 ? visibleApps : allApps} startupEntries={startupSource} /></div> : null}
          </div>
          ) : (
            <OptimizationsView
              apps={visibleApps}
              loading={loading}
              errorCode={errorCode}
              activeOptimizeAppId={activeOptimizeAppId}
              onReload={onReload}
              onApply={onOptimize}
              onView={(entry) => onViewOptimization?.(entry, 'reversible')}
              onRestore={onRestoreOptimization}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}

function ErrorBlock({ message, onReload }) {
  const { t } = useTranslation();
  return (
    <div className="p-5 text-sm text-[var(--danger)]">
      <p>{message}</p>
      <Button type="button" onClick={onReload} variant="secondary" size="sm" className="mt-3" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>{t('apps.reload')}</Button>
    </div>
  );
}

export default AppsPanel;
