import i18n from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SelectPrimitive from '@radix-ui/react-select';
import { useAppPortalContainer } from './ui/useAppPortalContainer';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  BatteryCharging,
  Bookmark,
  BrushCleaning,
  ChevronDown,
  Check,
  CircleAlert,
  Cpu,
  FileText,
  Filter,
  Gamepad2,
  HardDrive,
  Info,
  ListFilter,
  Lock,
  Pencil,
  Play,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Search,
  Save,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Wifi,
  X
} from 'lucide-react';
import CategoryIcon from './CategoryIcon';
import SubcategoryIcon from './SubcategoryIcon';
import MopSparklesIcon from './MopSparklesIcon';
import UnifiedTweakCard from './UnifiedTweakCard';
import TweakDetailPanel from './TweakDetailPanel';
import NetworkTestModal from './NetworkTestModal';
import { Button, LoadingIndicator, ModalShell, PageHeadingSignal, PageShell, PremiumBadge } from './ui';
import { getOrderedCategories, getOrderedSubcategories } from '../constants/tweakTaxonomy';
import { TWEAK_PROFILE_DEFINITIONS, normalizeTweakProfiles } from '../constants/tweakProfiles';
import { getContainerType, normalizePremium, normalizeRecommended, normalizeRequiresAdmin } from '../utils/tweakMetadata';
import { getCategoryAccentStyle } from '../constants/categoryAccents';
import {
  getOneClickOptimizationForTab,
  getOneClickOptimizationTargets
} from '../utils/oneClickOptimizations.mjs';
import {
  SHARED_LIST_GAP_CLASS,
  TWEAK_LIST_GRID_CLASS,
  TWEAK_LIST_HEADER_PADDING_CLASS,
  SHARED_LIST_HEADER_DIVIDER_CLASS
} from '../constants/listLayout';

const SAVED_TWEAK_VIEWS_STORAGE_KEY = 'nova-tweaks:saved-tweak-views:v1';

function readSavedTweakViews() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_TWEAK_VIEWS_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((entry) => entry?.id && entry?.name && entry?.filters) : [];
  } catch (_error) {
    return [];
  }
}

function normalizeContainerType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'powerplan' || normalized === 'power_plans') return 'power_plan';
  if (normalized === 'timerresolution' || normalized === 'timer_resolutions') return 'timer_resolution';
  if (normalized === 'oneshotselection' || normalized === 'one_shot' || normalized === 'one_shot_selections') return 'one_shot_selection';
  if (normalized === 'oneshotaction' || normalized === 'one_shot_action' || normalized === 'one_shot_actions') return 'one_shot_action';
  if (normalized === 'fix' || normalized === 'fixes') return 'fix';
  if (normalized === 'normal' || normalized === 'normaltweak' || normalized === 'normal_tweaks') return 'normal_tweak';
  return normalized || 'normal_tweak';
}

function CollapsibleDashboardPanel({ id, icon: Icon, title, subtitle, summary, open, onToggle, allowOpenOverflow = false, children }) {
  return (
    <section className={`${open && allowOpenOverflow ? 'overflow-visible' : 'overflow-hidden'} rounded-lg border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)]`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_48%,transparent)]"
        aria-expanded={open}
        aria-controls={id}
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--surface-elevated)_89%)] text-[var(--accent)]">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text-primary)]">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">{subtitle}</span>
        </span>
        <span className="hidden max-w-[42%] truncate text-xs font-medium text-[var(--text-secondary)] sm:block">{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} className="motion-tab-panel border-t border-[var(--border)] p-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, detail, active = false, onClick = null, loading = false }) {
  const { t } = useTranslation();
  const toneClass = 'text-[var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface-strong)_86%)] border-[color:color-mix(in_srgb,var(--accent)_18%,var(--border))]';

  return (
    <button
      type="button"
      onClick={onClick || undefined}
      disabled={loading}
      className={`tech-hover-lift w-full rounded-lg border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)] p-4 text-left transition ${
        onClick ? 'hover:border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] hover:bg-[var(--surface-hover)]' : ''
      } ${active ? 'border-[color:color-mix(in_srgb,var(--accent)_44%,var(--border))]' : ''}`}
    >
      <div className="flex items-start gap-4">
        <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-muted)]">{label}</p>
          {loading ? (
            <LoadingIndicator label={t('common.loading')} compact className="mt-2 border-0 bg-transparent p-0" />
          ) : (
            <>
              <p className="mt-2 text-3xl font-semibold leading-none text-[var(--text-primary)]">{value}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function uniqueStrings(items) {
  const seen = new Set();
  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeCompatibilityValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    return String(value.label || value.name || value.title || value.value || value.note || value.message || '').trim();
  }
  return '';
}

function toCompatibilityItems(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map(normalizeCompatibilityValue));
  }

  const normalized = normalizeCompatibilityValue(value);
  return normalized ? [normalized] : [];
}

function formatCompatibilityGroupLabel(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  if (lower === 'os' || lower === 'windows') return 'Windows';
  if (lower === 'devices' || lower === 'device') return normalized;
  if (lower === 'notes' || lower === 'note') return normalized;

  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getCompatibilityGroups(tweak, t) {
  const compatibility = tweak?.compatibility;
  if (!compatibility) {
    return [];
  }

  if (typeof compatibility === 'string' || Array.isArray(compatibility)) {
    const items = toCompatibilityItems(compatibility);
    return items.length ? [{ label: t('tweaks.technical.compatibility'), items }] : [];
  }

  if (typeof compatibility !== 'object') {
    return [];
  }

  const preferredKeys = ['os', 'windows', 'devices', 'device', 'notes', 'note'];
  const entries = Object.entries(compatibility);
  const sortedEntries = [
    ...preferredKeys
      .map((key) => entries.find(([entryKey]) => entryKey === key))
      .filter(Boolean),
    ...entries.filter(([key]) => !preferredKeys.includes(key))
  ];

  return sortedEntries
    .map(([key, value]) => ({
      label: t(`tweaks.technical.compatibilityGroups.${key}`, { defaultValue: formatCompatibilityGroupLabel(key) }),
      items: toCompatibilityItems(value)
    }))
    .filter((group) => group.items.length > 0);
}

function getTechnicalDetailItems(tweak) {
  const source = tweak?.technical_details ?? tweak?.technicalDetails ?? tweak?.technical ?? tweak?.details;
  if (source === undefined || source === null) {
    return [];
  }

  if (Array.isArray(source)) {
    return uniqueStrings(source.map((item) => (
      typeof item === 'object' && item !== null
        ? item.message || item.text || item.value || JSON.stringify(item)
        : item
    )));
  }

  if (typeof source === 'object') {
    return uniqueStrings(Object.entries(source).map(([key, value]) => {
      const normalizedValue = typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : String(value ?? '').trim();
      return normalizedValue ? `${formatCompatibilityGroupLabel(key)}: ${normalizedValue}` : '';
    }));
  }

  return uniqueStrings(String(source).split(/\n+/));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitTitleAndDescription(value, fallbackTitle) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { title: fallbackTitle, description: '' };
  }

  const labeledMatch = normalized.match(/^(.{4,72}?)(?:\s+-\s+|:\s+)(.+)$/);
  if (labeledMatch?.[1] && labeledMatch?.[2]) {
    return {
      title: labeledMatch[1].trim(),
      description: labeledMatch[2].trim()
    };
  }

  const sentenceMatch = normalized.match(/^([^.!?]{8,86}[.!?])\s+(.+)$/);
  if (sentenceMatch?.[1] && sentenceMatch?.[2]) {
    return {
      title: sentenceMatch[1].trim(),
      description: sentenceMatch[2].trim()
    };
  }

  return {
    title: fallbackTitle,
    description: normalized
  };
}

function normalizeWarningEntry(warning, t) {
  const fallbackTitle = t('tweaks.technical.warningItemTitle', { defaultValue: 'Review before applying' });

  if (warning && typeof warning === 'object') {
    const rawTitle = String(warning.title || warning.label || warning.name || '').trim();
    const rawMessage = String(warning.message || warning.description || warning.text || warning.value || '').trim();

    if (rawMessage) {
      const splitMessage = splitTitleAndDescription(rawMessage, rawTitle || fallbackTitle);
      const title = rawTitle || splitMessage.title;
      const titlePrefix = title ? new RegExp(`^${escapeRegExp(title)}\\s*[:\\-]\\s*`, 'i') : null;
      const description = rawTitle
        ? rawMessage.replace(titlePrefix, '').trim() || splitMessage.description
        : splitMessage.description;

      return {
        title,
        description: description || rawMessage
      };
    }

    if (rawTitle) {
      return {
        title: fallbackTitle,
        description: rawTitle
      };
    }

    return null;
  }

  const splitWarning = splitTitleAndDescription(warning, fallbackTitle);
  return splitWarning.description ? splitWarning : null;
}

function getWarningEntries(tweak, t) {
  const rawWarnings = [
    ...(Array.isArray(tweak?.warnings) ? tweak.warnings : []),
    ...(Array.isArray(tweak?.ai?.warnings) ? tweak.ai.warnings : []),
    ...(Array.isArray(tweak?.ai?.risks) ? tweak.ai.risks : [])
  ];
  const seen = new Set();

  return rawWarnings
    .map((warning) => normalizeWarningEntry(warning, t))
    .filter(Boolean)
    .filter((entry) => {
      const key = `${entry.title}::${entry.description}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTechnicalSummary(detailItems, t) {
  const cleanItems = uniqueStrings(detailItems);
  if (!cleanItems.length) {
    return t('tweaks.technical.noTechnicalDetails', { defaultValue: 'No technical details available.' });
  }
  return cleanItems.join(' ');
}

function TweakInfoSection({ icon: Icon, title, tone = 'accent', children }) {
  return (
    <section className={`tweak-info-section tweak-info-section--${tone}`}>
      <div className="tweak-info-section-header">
        <span className="tweak-info-section-icon" aria-hidden="true">
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <h3 className="tweak-info-section-title">{title}</h3>
      </div>
      <div className="tweak-info-section-body">{children}</div>
    </section>
  );
}

function WarningList({ tweak }) {
  const { t } = useTranslation();
  const entries = getWarningEntries(tweak, t);
  if (!entries.length) {
    return (
      <p className="tweak-info-empty-row">
        {t('tweaks.technical.noWarnings')}
      </p>
    );
  }

  return (
    <div className="tweak-info-row-stack">
      {entries.map((entry) => (
        <article key={`${entry.title}-${entry.description}`} className="tweak-info-row">
          <span className="tweak-info-row-icon" aria-hidden="true">
            <CircleAlert className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="tweak-info-row-title">{entry.title}</h4>
            <p className="tweak-info-row-description">{entry.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function CompatibilityList({ groups }) {
  const { t } = useTranslation();
  if (!groups.length) {
    return (
      <p className="tweak-info-empty-row">
        {t('tweaks.technical.noCompatibility')}
      </p>
    );
  }

  return (
    <div className="tweak-info-compat-grid">
      {groups.map((group, groupIndex) => (
        <div key={`${group.label}-${groupIndex}`} className="tweak-info-compat-group">
          <p className="tweak-info-compat-label">{group.label}</p>
          <div className="tweak-info-compat-items">
            {group.items.map((item) => (
              <span key={`${group.label}-${item}`} className="tweak-info-compat-pill">
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
                <span className="truncate">{item}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SecondaryTweakDetails({ tweak, showCompatibilityWarnings = true }) {
  const { t } = useTranslation();
  const technicalItems = getTechnicalDetailItems(tweak);
  const compatibilityGroups = getCompatibilityGroups(tweak, t);

  return (
    <div className="tweak-info-sheet">
      <TweakInfoSection icon={AlertTriangle} title={t('tweaks.technical.warnings')} tone="warning">
        <WarningList tweak={tweak} />
      </TweakInfoSection>

      <TweakInfoSection icon={FileText} title={t('tweaks.technical.technicalDetails', { defaultValue: 'Technical Details' })}>
        <p className="tweak-info-summary">{getTechnicalSummary(technicalItems, t)}</p>
      </TweakInfoSection>

      {showCompatibilityWarnings ? (
        <TweakInfoSection icon={BadgeCheck} title={t('tweaks.technical.compatibility')} tone="success">
          <CompatibilityList groups={compatibilityGroups} />
        </TweakInfoSection>
      ) : null}
    </div>
  );
}

function getStableTweakId(tweak) {
  return String(tweak?.id || tweak?.name || '').trim();
}

function readFavoriteIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('nova-tweaks:favorites') || '[]');
    return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function FilterDropdown({ icon: Icon, label, value, options, onChange, portalContainer }) {
  const { t } = useTranslation();
  const activeOption = options.find((option) => option.value === value) || options[0];

  return (
    <div className="relative min-w-0">
      <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger asChild>
        <button
          type="button"
          className="nova-dropdown-trigger tech-hover-lift flex h-11 w-full items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-left text-sm text-[var(--text-primary)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] hover:bg-[var(--surface-hover)]"
        >
          <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-[var(--text-muted)]">{label}: </span>
            {activeOption?.label || t('tweaks.filters.all')}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        </button>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer}>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={6}
          className="nova-dropdown-content z-30 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-1 shadow-[0_18px_42px_rgba(0,0,0,0.32)]"
        >
          <SelectPrimitive.Viewport>
          {options.map((option) => {
            const active = option.value === value;
            const OptionIcon = option.icon;
            return (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={`nova-dropdown-item ${active ? 'is-active ' : ''}flex w-full cursor-default items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition ${
                  active
                    ? 'bg-[color:color-mix(in_srgb,var(--accent)_16%,var(--surface)_84%)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--hover-layer)] hover:text-[var(--text-primary)] focus:bg-[var(--hover-layer)] focus:text-[var(--text-primary)]'
                }`}
              >
                <SelectPrimitive.ItemText asChild>
                  <span className="flex min-w-0 items-center gap-2">
                    {OptionIcon ? <OptionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                    <span className="min-w-0 truncate">{option.label}</span>
                  </span>
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            );
          })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

function QuickActionsPanel({
  rawTweaks,
  selectedCategory,
  selectedSubcategory,
  onCreateRestorePoint,
  onToggleTweak,
  oneClickOptimization,
  onRunOneClickOptimization,
  canUsePremium,
  onOpenNetworkTest
}) {
  const { t } = useTranslation();
  const [bulkAction, setBulkAction] = useState('');
  const restorePointEnabled = typeof onCreateRestorePoint === 'function';
  const optimization = getOneClickOptimizationForTab(selectedCategory, selectedSubcategory);
  const optimizationTargets = useMemo(
    () => optimization ? getOneClickOptimizationTargets(rawTweaks, optimization.id) : [],
    [optimization, rawTweaks]
  );
  const optimizationIcons = {
    cleanup: MopSparklesIcon,
    network: Wifi,
    cpu: Cpu,
    storage: HardDrive
  };
  const OptimizationIcon = optimization ? optimizationIcons[optimization.id] || SlidersHorizontal : SlidersHorizontal;
  const optimizationRunning = Boolean(oneClickOptimization?.runningId);
  const toggleableTweaks = useMemo(() => {
    const source = Array.isArray(rawTweaks) ? rawTweaks : [];
    return source.filter((tweak) => getContainerType(tweak) === 'normal_tweak' && (!normalizePremium(tweak) || canUsePremium));
  }, [canUsePremium, rawTweaks]);
  const enabledTargets = useMemo(() => (
    toggleableTweaks.filter((tweak) => String(tweak?.currentState || tweak?.status || '').toLowerCase() === 'enabled')
  ), [toggleableTweaks]);
  const canRunBulk = typeof onToggleTweak === 'function';

  async function runBulkAction(action, targets, nextEnabled) {
    if (!canRunBulk || bulkAction || !targets.length) {
      return;
    }

    setBulkAction(action);
    try {
      for (const tweak of targets) {
        await onToggleTweak(tweak, nextEnabled, { suppressNotifications: true });
      }
    } finally {
      setBulkAction('');
    }
  }

  return (
    <aside className="ui-right-panel p-5">
      <div className="tech-panel-header">
        <h3 className="tech-panel-title text-base font-semibold text-[var(--text-primary)]">{t('tweaks.quickActions.title')}</h3>
      </div>
      <div className="mt-4 space-y-3">
        {String(selectedCategory || '').toLowerCase() === 'network' ? (
          <button
            type="button"
            onClick={onOpenNetworkTest}
            className="tech-hover-lift flex w-full items-center gap-3 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-3 text-left text-sm font-medium text-[var(--text-primary)] transition hover:border-cyan-400/45 hover:bg-cyan-400/[0.11]"
          >
            <Activity className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t('networkTest.quickAction')}</span>
              <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--text-muted)]">{t('networkTest.quickActionHint')}</span>
            </span>
            <Play className="h-4 w-4 text-cyan-400" />
          </button>
        ) : null}
        {optimization ? (
          <button
            type="button"
            onClick={() => onRunOneClickOptimization?.(optimization.id)}
            disabled={!onRunOneClickOptimization || optimizationRunning || optimizationTargets.length === 0}
            title={optimizationTargets.length
              ? t('tweaks.oneClick.applyTitle', { count: optimizationTargets.length })
              : t('tweaks.oneClick.noRecommended')}
            className={`tech-hover-lift flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition ${
              onRunOneClickOptimization && !optimizationRunning && optimizationTargets.length
                ? 'border-[color:color-mix(in_srgb,var(--success)_26%,var(--border))] bg-[color:color-mix(in_srgb,var(--success)_8%,var(--surface-elevated)_92%)] text-[var(--text-primary)] hover:border-[color:color-mix(in_srgb,var(--success)_44%,var(--border))] hover:bg-[color:color-mix(in_srgb,var(--success)_12%,var(--surface-elevated)_88%)]'
                : 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] opacity-65'
            }`}
          >
            <OptimizationIcon className="h-4 w-4 shrink-0 text-[var(--success)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t(`tweaks.oneClick.${optimization.id}.title`)}</span>
              <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--text-muted)]">
                {oneClickOptimization?.runningId === optimization.id
                  ? t('tweaks.oneClick.runningProgress', {
                      current: oneClickOptimization.current,
                      total: oneClickOptimization.total
                    })
                  : optimizationTargets.length
                    ? t('tweaks.oneClick.recommendedCount', { count: optimizationTargets.length })
                    : t('tweaks.oneClick.noRecommended')}
              </span>
            </span>
            <span className="font-tech text-xs text-[var(--text-muted)]">{optimizationTargets.length}</span>
          </button>
        ) : null}
        {oneClickOptimization?.completedId && oneClickOptimization.completedId === optimization?.id ? (
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {t('tweaks.oneClick.summary', oneClickOptimization)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => runBulkAction('disable', enabledTargets, false)}
          disabled={!canRunBulk || bulkAction || enabledTargets.length === 0}
          title={enabledTargets.length > 0 ? t('tweaks.quickActions.disableAllTitle', { count: enabledTargets.length }) : t('tweaks.quickActions.noEnabled')}
          className={`tech-hover-lift flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition ${
            canRunBulk && !bulkAction && enabledTargets.length > 0
              ? 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] hover:bg-[var(--surface-hover)]'
              : 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] opacity-65'
          }`}
        >
          <X className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{bulkAction === 'disable' ? t('tweaks.quickActions.disablingTweaks') : t('tweaks.quickActions.disableAll')}</span>
          <span className="font-tech text-xs text-[var(--text-muted)]">{enabledTargets.length}</span>
        </button>
        <button
          type="button"
          onClick={onCreateRestorePoint}
          disabled={!restorePointEnabled}
          title={restorePointEnabled ? t('tweaks.quickActions.restorePointTitle') : t('tweaks.quickActions.restorePointUnavailable')}
          className={`tech-hover-lift flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition ${
            restorePointEnabled
              ? 'border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface-elevated)_90%)] text-[var(--text-primary)] hover:border-[color:color-mix(in_srgb,var(--accent)_48%,var(--border))] hover:bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--surface-elevated)_86%)]'
              : 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] opacity-65'
          }`}
        >
          <RefreshCw className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-1 truncate">{t('tweaks.quickActions.createRestorePoint')}</span>
        </button>
      </div>
    </aside>
  );
}

const PROFILE_ICON_COMPONENTS = {
  battery: BatteryCharging,
  brush: BrushCleaning,
  gamepad: Gamepad2,
  lock: Lock,
  shield: ShieldCheck,
  sparkles: SlidersHorizontal,
  wifi: Wifi
};

const PROFILE_TONE_VALUES = {
  success: 'var(--success)',
  accent: 'var(--accent)',
  efficiency: '#48c78e',
  privacy: '#d084ff',
  network: '#4fb6ff',
  cleanup: 'var(--warning)'
};

function getProfileToneStyle(profile) {
  return {
    '--profile-tone': PROFILE_TONE_VALUES[profile?.tone] || 'var(--accent)'
  };
}

function getProfileEntry(tweak, profileId) {
  return normalizeTweakProfiles(tweak?.profiles).find((entry) => entry.id === profileId) || null;
}

function getProfileParam(profileEntry, ...names) {
  const params = profileEntry?.params && typeof profileEntry.params === 'object' ? profileEntry.params : {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      const value = params[name];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return '';
}

function getRecommendedSelectionValue(tweak) {
  const direct = String(tweak?.recommendedSelection || tweak?.recommended_selection || '').trim();
  if (direct) {
    return direct;
  }

  const options = Array.isArray(tweak?.selections) ? tweak.selections : Array.isArray(tweak?.options) ? tweak.options : [];
  const first = options[0];
  if (typeof first === 'string' || typeof first === 'number') {
    return String(first).trim();
  }
  return String(first?.value || first?.id || first?.label || first?.name || '').trim();
}

function TweakProfilesPanel({
  rawTweaks,
  expanded,
  onToggleExpanded,
  canUsePremium,
  onToggleTweak,
  onApplyTimerResolution,
  onApplyPowerPlan,
  onApplyOneShotSelection,
  onApplyRangeSelection,
  onApplyOneShotAction,
  onApplyFix,
  onPreflightTweaks,
  onRequestAdminAccess,
  hasAdminAccess,
  onReload,
  showRiskLabels,
  showCompatibilityWarnings
}) {
  const { t } = useTranslation();
  const portalContainer = useAppPortalContainer();
  const [activeProfile, setActiveProfile] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [detailTweak, setDetailTweak] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState(TWEAK_PROFILE_DEFINITIONS[0]?.id || '');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const profileTweaksById = useMemo(() => {
    const source = Array.isArray(rawTweaks) ? rawTweaks : [];
    return TWEAK_PROFILE_DEFINITIONS.reduce((accumulator, profile) => {
      accumulator[profile.id] = source
        .map((tweak) => ({ tweak, profileEntry: getProfileEntry(tweak, profile.id) }))
        .filter((entry) => entry.profileEntry)
        .sort((left, right) => String(left.tweak?.name || '').localeCompare(String(right.tweak?.name || '')));
      return accumulator;
    }, {});
  }, [rawTweaks]);

  const selectedProfile = TWEAK_PROFILE_DEFINITIONS.find((profile) => profile.id === selectedProfileId) || TWEAK_PROFILE_DEFINITIONS[0] || null;
  const selectedProfileEntries = selectedProfile ? profileTweaksById[selectedProfile.id] || [] : [];
  const SelectedProfileIcon = PROFILE_ICON_COMPONENTS[selectedProfile?.icon] || SlidersHorizontal;
  const ActiveProfileIcon = PROFILE_ICON_COMPONENTS[activeProfile?.icon] || SlidersHorizontal;
  const activeEntries = activeProfile ? profileTweaksById[activeProfile.id] || [] : [];
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const runnableEntries = activeEntries.filter(({ tweak }) => !normalizePremium(tweak) || canUsePremium);
  const selectedEntries = activeEntries.filter(({ tweak }) => checkedIdSet.has(String(tweak?.id || '')) && (!normalizePremium(tweak) || canUsePremium));
  const canRunProfile = selectedEntries.length > 0 && !running;
  const summary = results
    ? {
        successful: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok && result.status !== 'skipped').length,
        skipped: results.filter((result) => result.status === 'skipped').length
      }
    : null;

  function openProfile(profile) {
    const entries = profileTweaksById[profile.id] || [];
    setActiveProfile(profile);
    setCheckedIds(
      entries
        .filter(({ tweak, profileEntry }) => profileEntry.defaultChecked !== false && (!normalizePremium(tweak) || canUsePremium))
        .map(({ tweak }) => String(tweak.id))
    );
    setResults(null);
  }

  function setAllChecked(nextChecked) {
    setCheckedIds(nextChecked ? runnableEntries.map(({ tweak }) => String(tweak.id)) : []);
  }

  function toggleChecked(tweakId) {
    const id = String(tweakId || '');
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  }

  async function applyProfileEntry(tweak, profileEntry) {
    const containerType = normalizeContainerType(tweak?.containerType);
    if (containerType === 'timer_resolution') {
      const resolution = getProfileParam(profileEntry, 'Resolution', 'resolution') || getRecommendedSelectionValue(tweak) || '0.5';
      return onApplyTimerResolution?.(tweak, resolution, { suppressNotifications: true });
    }

    if (containerType === 'power_plan') {
      return onApplyPowerPlan?.(tweak, { suppressNotifications: true });
    }

    if (containerType === 'one_shot_selection') {
      const selection = getProfileParam(profileEntry, 'Selection', 'selection') || getRecommendedSelectionValue(tweak);
      return onApplyOneShotSelection?.(tweak, selection, { suppressNotifications: true });
    }

    if (containerType === 'range_selection') {
      const parameter = String(tweak?.range?.parameter || 'Value').trim() || 'Value';
      const value = Number(getProfileParam(profileEntry, parameter, 'Value', 'value') || tweak?.range?.recommendedValue || tweak?.range?.recommended_value);
      return onApplyRangeSelection?.(tweak, value, { suppressNotifications: true });
    }

    if (containerType === 'one_shot_action') {
      return onApplyOneShotAction?.(tweak, { suppressNotifications: true });
    }

    if (containerType === 'fix') {
      return onApplyFix?.(tweak, { suppressNotifications: true });
    }

    return onToggleTweak?.(tweak, true, { suppressNotifications: true });
  }

  async function runProfile() {
    if (!canRunProfile) {
      return;
    }

    const jobs = selectedEntries.map(({ tweak, profileEntry }) => {
      const containerType = normalizeContainerType(tweak?.containerType);
      let params = {};
      if (containerType === 'timer_resolution') {
        params = { Resolution: getProfileParam(profileEntry, 'Resolution', 'resolution') || getRecommendedSelectionValue(tweak) || '0.5' };
      } else if (containerType === 'one_shot_selection') {
        params = { Selection: getProfileParam(profileEntry, 'Selection', 'selection') || getRecommendedSelectionValue(tweak) };
      } else if (containerType === 'range_selection') {
        const parameter = String(tweak?.range?.parameter || 'Value').trim() || 'Value';
        params = { [parameter]: Number(getProfileParam(profileEntry, parameter, 'Value', 'value') || tweak?.range?.recommendedValue || tweak?.range?.recommended_value) };
      }
      return { id: String(tweak?.id || ''), targetState: 'enabled', params };
    });
    const preflight = await onPreflightTweaks?.(jobs);
    if (!preflight?.ok) {
      setResults(selectedEntries.map(({ tweak }) => ({
        tweak,
        ok: false,
        status: 'skipped',
        message: preflight?.code || 'TWEAK_BATCH_PREFLIGHT_FAILED'
      })));
      return;
    }
    const requiresAdmin = Boolean(preflight.requiresAdmin || selectedEntries.some(({ tweak }) => normalizeRequiresAdmin(tweak)));
    if (requiresAdmin && !hasAdminAccess) {
      const approval = await onRequestAdminAccess?.({ reason: 'tweak-profile' });
      if (!approval?.ok) {
        setResults(selectedEntries.map(({ tweak }) => ({
          tweak,
          ok: false,
          status: 'skipped',
          message: approval?.code || 'ADMIN_BROKER_CANCELLED'
        })));
        return;
      }
    }

    setRunning(true);
    setResults([]);
    const nextResults = [];
    try {
      for (const { tweak, profileEntry } of activeEntries) {
        const tweakId = String(tweak?.id || '');
        if (!checkedIdSet.has(tweakId)) {
          nextResults.push({ tweak, ok: false, status: 'skipped', message: t('tweaks.profiles.skipped', { defaultValue: 'Skipped' }) });
          setResults([...nextResults]);
          continue;
        }

        if (normalizePremium(tweak) && !canUsePremium) {
          nextResults.push({ tweak, ok: false, status: 'skipped', message: t('account.premiumRequired') });
          setResults([...nextResults]);
          continue;
        }

        const result = await applyProfileEntry(tweak, profileEntry);
        nextResults.push({
          tweak,
          ok: Boolean(result?.ok),
          status: result?.ok ? "success" : 'failed',
          message: result?.message || result?.code || ''
        });
        setResults([...nextResults]);
      }

      await onReload?.();
    } finally {
      setRunning(false);
    }
  }

  if (!TWEAK_PROFILE_DEFINITIONS.length) {
    return null;
  }

  return (
    <>
      <CollapsibleDashboardPanel
        id="tweak-profiles-panel-content"
        icon={ShieldCheck}
        title={t('tweaks.profiles.title', { defaultValue: 'Profiles' })}
        subtitle={t('tweaks.profiles.description', { defaultValue: 'Apply curated tweak groups and choose every tweak before anything changes.' })}
        summary={selectedProfile
          ? `${t(selectedProfile.titleKey, { defaultValue: selectedProfile.title })} | ${t('tweaks.profiles.tweakCount', { count: selectedProfileEntries.length, defaultValue: '{{count}} tweaks' })}`
          : t('tweaks.profiles.chooseProfile', { defaultValue: 'Choose profile' })}
        open={expanded}
        onToggle={onToggleExpanded}
        allowOpenOverflow
      >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,448px)] lg:items-start">
        <div className="flex min-w-0 items-start gap-3 pt-0.5" style={getProfileToneStyle(selectedProfile)}>
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--profile-tone)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--profile-tone)_12%,var(--surface-elevated)_88%)] text-[var(--profile-tone)]">
            <SelectedProfileIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {selectedProfile ? t(selectedProfile.titleKey, { defaultValue: selectedProfile.title }) : t('tweaks.profiles.chooseProfile', { defaultValue: 'Choose profile' })}
            </h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              {selectedProfile ? t(selectedProfile.descriptionKey, { defaultValue: selectedProfile.description }) : t('tweaks.profiles.description', { defaultValue: 'Apply curated tweak groups and choose every tweak before anything changes.' })}
            </p>
            <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">
              {t('tweaks.profiles.tweakCount', { count: selectedProfileEntries.length, defaultValue: '{{count}} tweaks' })}
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end">
          <div className="grid gap-1.5 text-xs font-medium text-[var(--text-muted)]">
            <span>{t('tweaks.profiles.chooseProfile', { defaultValue: 'Choose profile' })}</span>
            <span className="relative block" style={getProfileToneStyle(selectedProfile)}>
              <SelectPrimitive.Root
                value={selectedProfileId}
                onValueChange={(profileId) => {
                  setSelectedProfileId(profileId);
                  setResults(null);
                }}
                open={profileMenuOpen}
                onOpenChange={setProfileMenuOpen}
              >
                <SelectPrimitive.Trigger asChild>
                  <button
                    type="button"
                    className="nova-dropdown-trigger tech-hover-lift flex h-11 w-full min-w-0 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-left text-sm font-semibold text-[var(--text-primary)] outline-none transition hover:border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] focus-visible:border-[color:color-mix(in_srgb,var(--accent)_45%,var(--border))]"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--profile-tone)_12%,var(--surface)_88%)] text-[var(--profile-tone)]">
                      <SelectedProfileIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {selectedProfile ? t(selectedProfile.titleKey, { defaultValue: selectedProfile.title }) : t('tweaks.profiles.chooseProfile', { defaultValue: 'Choose profile' })} ({selectedProfileEntries.length})
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition ${profileMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal container={portalContainer}>
                  <SelectPrimitive.Content
                    position="popper"
                    align="start"
                    sideOffset={6}
                    className="nova-dropdown-content z-30 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_45px_rgba(0,0,0,0.28)]"
                  >
                    <SelectPrimitive.Viewport>
                  {TWEAK_PROFILE_DEFINITIONS.map((profile) => {
                    const entries = profileTweaksById[profile.id] || [];
                    const ProfileOptionIcon = PROFILE_ICON_COMPONENTS[profile.icon] || SlidersHorizontal;
                    const active = selectedProfile?.id === profile.id;
                    return (
                      <SelectPrimitive.Item
                        key={profile.id}
                        value={profile.id}
                        disabled={entries.length === 0}
                        className={`nova-dropdown-item ${active ? 'is-active ' : ''}flex w-full min-w-0 cursor-default items-center gap-3 px-3 py-2.5 text-left outline-none transition ${active ? 'bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface-elevated)_90%)]' : 'hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)]'} data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50`}
                        style={getProfileToneStyle(profile)}
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--profile-tone)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--profile-tone)_10%,var(--surface-elevated)_90%)] text-[var(--profile-tone)]">
                          <ProfileOptionIcon className="h-4 w-4" />
                        </span>
                        <SelectPrimitive.ItemText asChild>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{t(profile.titleKey, { defaultValue: profile.title })}</span>
                            <span className="block truncate text-xs font-medium text-[var(--text-muted)]">{entries.length} {i18n.t('tweaks.metrics.tweaks')}</span>
                          </span>
                        </SelectPrimitive.ItemText>
                        {active ? <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" /> : null}
                      </SelectPrimitive.Item>
                    );
                  })}
                    </SelectPrimitive.Viewport>
                  </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
              </SelectPrimitive.Root>
            </span>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="h-11 w-full justify-center whitespace-nowrap"
            onClick={() => selectedProfile && openProfile(selectedProfile)}
            disabled={!selectedProfile || selectedProfileEntries.length === 0}
            leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          >
            {t('tweaks.profiles.openProfile', { defaultValue: 'Open profile' })}
          </Button>
        </div>
      </div>
      </CollapsibleDashboardPanel>

      <ModalShell
        open={Boolean(activeProfile)}
        title={activeProfile ? t(activeProfile.titleKey, { defaultValue: activeProfile.title }) : ''}
        description={t('tweaks.profiles.modalDescription', { defaultValue: 'Choose the tweaks you want from this profile before applying it.' })}
        onClose={() => {
          if (!running) {
            setActiveProfile(null);
            setResults(null);
          }
        }}
        closeOnBackdrop={!running}
        closeOnEscape={!running}
        closeDisabled={running}
        size="xl"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setAllChecked(false)} disabled={running || runnableEntries.length === 0}>
              {t('tweaks.profiles.clearAll', { defaultValue: 'Clear all' })}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAllChecked(true)} disabled={running || runnableEntries.length === 0}>
              {t('tweaks.profiles.selectAll', { defaultValue: 'Select all' })}
            </Button>
            <Button variant="primary" size="sm" onClick={runProfile} loading={running} disabled={!canRunProfile} leftIcon={<Play className="h-3.5 w-3.5" />}>
              {t('tweaks.profiles.applySelected', { count: selectedEntries.length, defaultValue: 'Apply selected ({{count}})' })}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          {activeProfile ? (
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3" style={getProfileToneStyle(activeProfile)}>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--profile-tone)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--profile-tone)_12%,var(--surface)_88%)] text-[var(--profile-tone)]">
                <ActiveProfileIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{t(activeProfile.titleKey, { defaultValue: activeProfile.title })}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t(activeProfile.descriptionKey, { defaultValue: activeProfile.description })}</p>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            {activeEntries.map(({ tweak, profileEntry }) => {
              const id = String(tweak?.id || '');
              const locked = normalizePremium(tweak) && !canUsePremium;
              const checked = checkedIdSet.has(id);
              const params = profileEntry?.params && Object.keys(profileEntry.params).length
                ? Object.entries(profileEntry.params).map(([key, value]) => `${key}: ${value}`).join(', ')
                : '';
              return (
                <label key={id} className={`tweak-profile-modal-row ${locked ? 'is-locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={running || locked}
                    onChange={() => toggleChecked(id)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface)_72%,var(--surface-strong)_28%)] text-[var(--text-muted)]">
                    <SubcategoryIcon category={tweak.category || 'General'} subcategory={tweak.subcategory || 'System'} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold text-[var(--text-primary)] ${locked ? 'premium-name-blur' : ''}`}>{tweak.name || id}</span>
                    <span className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                      <span>{tweak.category || 'General'} / {tweak.subcategory || 'System'}</span>
                      {params ? <span>{params}</span> : null}
                      {locked ? <PremiumBadge locked label={t('tweaks.premiumBadge')} /> : null}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setDetailTweak(tweak);
                    }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_35%,var(--border))] hover:text-[var(--accent)]"
                    aria-label={t('tweakDetails.title')}
                    title={t('tweakDetails.title')}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </label>
              );
            })}
          </div>

          {summary ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-primary)]">
              <p className="font-semibold">{t('tweaks.profiles.summary', { successful: summary.successful, failed: summary.failed, skipped: summary.skipped, defaultValue: 'Done: {{successful}} applied, {{failed}} failed, {{skipped}} skipped.' })}</p>
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                {results.map((result) => (
                  <p key={`${result.tweak?.id}-${result.status}`} className={result.ok ? 'text-[var(--success)]' : result.status === 'skipped' ? 'text-[var(--text-muted)]' : 'text-[var(--warning)]'}>
                    {result.tweak?.name || result.tweak?.id}: {result.ok ? t('tweaks.profiles.applied', { defaultValue: 'Applied' }) : result.message || result.status}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(detailTweak)}
        title={detailTweak
          ? (
            <span className={normalizePremium(detailTweak) && !canUsePremium ? 'premium-name-blur' : undefined}>
              {detailTweak.name || t('tweakDetails.title')}
            </span>
          )
          : t('tweakDetails.title')}
        onClose={() => setDetailTweak(null)}
        size="md"
      >
        {detailTweak ? (
          <TweakDetailPanel
            tweak={detailTweak}
            onClose={() => setDetailTweak(null)}
            showRiskLabels={showRiskLabels}
            showCategoryAccent={false}
            blurName={normalizePremium(detailTweak) && !canUsePremium}
          />
        ) : null}
      </ModalShell>
    </>
  );
}

function TweaksPanel({
  tweaks,
  rawTweaks,
  searchTerm,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedSubcategory,
  onSubcategoryChange,
  categoryStats,
  recommendedFilter,
  onRecommendedFilterChange,
  riskFilter,
  onRiskFilterChange,
  tagFilter,
  onTagFilterChange,
  requiresAdminFilter = 'all',
  onRequiresAdminFilterChange,
  rebootRequiredFilter = 'all',
  onRebootRequiredFilterChange,
  premiumFilter = 'all',
  onPremiumFilterChange,
  compatibilityFilter = 'all',
  onCompatibilityFilterChange,
  statusFilter = 'all',
  onStatusFilterChange,
  availableTags = [],
  loading,
  refreshingStates,
  reloadDisabled = false,
  checkingStateTweakIds = [],
  errorCode,
  onReload,
  onToggleTweak,
  onApplyTimerResolution,
  onApplyPowerPlan,
  onApplyOneShotSelection,
  onApplyRangeSelection,
  onApplyOneShotAction,
  onApplyFix,
  onPreflightTweaks,
  onRequestAdminAccess,
  hasAdminAccess = false,
  onCreateRestorePoint,
  oneClickOptimization = null,
  onRunOneClickOptimization,
  canUsePremium = true,
  showRiskLabels = true,
  showCompatibilityWarnings = true,
  mascotAnimationEnabled = false,
  reducedMotion = false
}) {
  const { t } = useTranslation();
  const portalContainer = useAppPortalContainer();
  const [selectedDetailTweak, setSelectedDetailTweak] = useState(null);
  const [technicalTweak, setTechnicalTweak] = useState(null);
  const [networkTestOpen, setNetworkTestOpen] = useState(false);
  const [networkTestState, setNetworkTestState] = useState({ status: 'idle', phase: 'ready', progress: 0, result: null, error: '' });
  const [mtuActionState, setMtuActionState] = useState({ busy: false, error: '' });

  useEffect(() => {
    const unsubscribe = window.desktopApi?.onExtendedNetworkTestUpdate?.((nextState) => {
      if (nextState) setNetworkTestState(nextState);
    });
    return () => unsubscribe?.();
  }, []);

  async function openNetworkTest() {
    setNetworkTestOpen(true);
    setMtuActionState({ busy: false, error: '' });
    try {
      const response = await window.desktopApi?.getExtendedNetworkTestState?.();
      if (response?.state) setNetworkTestState(response.state);
    } catch (_error) {
      // The modal can still expose a retryable error state.
    }
  }

  async function startNetworkTest() {
    setMtuActionState({ busy: false, error: '' });
    const response = await window.desktopApi?.startExtendedNetworkTest?.();
    if (response?.state) setNetworkTestState(response.state);
  }

  async function cancelNetworkTest() {
    await window.desktopApi?.cancelExtendedNetworkTest?.();
  }

  async function applyRecommendedMtu() {
    setMtuActionState({ busy: true, error: '' });
    try {
      const response = await window.desktopApi?.applyRecommendedMtu?.();
      if (response?.state) setNetworkTestState(response.state);
      setMtuActionState({
        busy: false,
        error: response?.ok ? '' : response?.code === 'ADMIN_REQUIRED'
          ? t('networkTest.mtu.adminRequired')
          : response?.message || t('networkTest.mtu.applyFailed')
      });
    } catch (_error) {
      setMtuActionState({ busy: false, error: t('networkTest.mtu.applyFailed') });
    }
  }

  async function resetMtu() {
    setMtuActionState({ busy: true, error: '' });
    try {
      const response = await window.desktopApi?.resetMtu?.();
      if (response?.state) setNetworkTestState(response.state);
      setMtuActionState({
        busy: false,
        error: response?.ok ? '' : response?.code === 'ADMIN_REQUIRED'
          ? t('networkTest.mtu.adminRequired')
          : response?.message || t('networkTest.mtu.resetFailed')
      });
    } catch (_error) {
      setMtuActionState({ busy: false, error: t('networkTest.mtu.resetFailed') });
    }
  }
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openCategoryMenu, setOpenCategoryMenu] = useState(null);
  const [sortMode, setSortMode] = useState('name');
  const [favoriteFilter, setFavoriteFilter] = useState(false);
  const [profilesExpanded, setProfilesExpanded] = useState(false);
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');
  const [renamingViewId, setRenamingViewId] = useState('');
  const [renamingViewName, setRenamingViewName] = useState('');
  const [savedViews, setSavedViews] = useState(readSavedTweakViews);
  const [favoriteIds, setFavoriteIds] = useState(() => readFavoriteIds());
  const initialLoading = Boolean(loading) && (!Array.isArray(rawTweaks) || rawTweaks.length === 0);
  const refreshingCatalog = Boolean(loading) && Array.isArray(rawTweaks) && rawTweaks.length > 0;
  const checkingStateTweakIdSet = useMemo(
    () => new Set((Array.isArray(checkingStateTweakIds) ? checkingStateTweakIds : []).map((id) => String(id))),
    [checkingStateTweakIds]
  );

  const activeDetailTweak = useMemo(() => {
    if (!selectedDetailTweak) return null;
    return rawTweaks.find((tweak) => tweak.id === selectedDetailTweak.id) || selectedDetailTweak;
  }, [selectedDetailTweak, rawTweaks]);

  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const metrics = useMemo(() => {
    const source = Array.isArray(rawTweaks) ? rawTweaks : [];
    return {
      total: source.length,
      enabled: source.filter((tweak) => String(tweak?.currentState || tweak?.status || '').toLowerCase() === 'enabled').length,
      recommended: source.filter((tweak) => normalizeRecommended(tweak)).length,
      favorites: source.filter((tweak) => favoriteIdSet.has(getStableTweakId(tweak))).length
    };
  }, [favoriteIdSet, rawTweaks]);

  const orderedCategories = useMemo(() => getOrderedCategories(categoryStats), [categoryStats]);
  const subcategoryStatsByCategory = useMemo(() => {
    const counts = {};
    for (const tweak of Array.isArray(rawTweaks) ? rawTweaks : []) {
      const category = String(tweak?.category || '').trim();
      const subcategory = String(tweak?.subcategory || '').trim();
      if (!category || !subcategory) continue;
      counts[category] ||= {};
      counts[category][subcategory] = (counts[category][subcategory] || 0) + 1;
    }
    return counts;
  }, [rawTweaks]);
  const categoryMode = selectedCategory !== 'all';

  const visibleTweaks = useMemo(() => {
    const source = favoriteFilter
      ? tweaks.filter((tweak) => favoriteIdSet.has(getStableTweakId(tweak)))
      : tweaks;
    const sorted = [...source];
    const compareByName = (left, right) => String(left.name || '').localeCompare(String(right.name || ''));
    const compareByStatus = (left, right) => String(right.currentState || '').localeCompare(String(left.currentState || '')) || compareByName(left, right);
    const getCategoryViewSortRank = (tweak) => {
      const recommended = normalizeRecommended(tweak);
      const premium = normalizePremium(tweak);
      if (recommended && premium) {
        return 0;
      }

      if (recommended) {
        return 1;
      }

      return premium ? 2 : 3;
    };
    const compareCategoryViewPriority = (left, right) => {
      if (!categoryMode) {
        return 0;
      }

      return getCategoryViewSortRank(left) - getCategoryViewSortRank(right);
    };

    if (sortMode === 'status') {
      sorted.sort((left, right) => compareCategoryViewPriority(left, right) || compareByStatus(left, right));
      return sorted;
    }
    sorted.sort((left, right) => compareCategoryViewPriority(left, right) || compareByName(left, right));
    return sorted;
  }, [categoryMode, favoriteFilter, favoriteIdSet, sortMode, tweaks]);

  function toggleFavorite(tweak) {
    const id = getStableTweakId(tweak);
    if (!id) return;
    setFavoriteIds((previous) => {
      const nextSet = new Set(previous);
      if (nextSet.has(id)) {
        nextSet.delete(id);
      } else {
        nextSet.add(id);
      }
      const next = Array.from(nextSet);
      window.localStorage.setItem('nova-tweaks:favorites', JSON.stringify(next));
      return next;
    });
  }

  function persistSavedViews(nextViews) {
    localStorage.setItem(SAVED_TWEAK_VIEWS_STORAGE_KEY, JSON.stringify(nextViews));
    setSavedViews(nextViews);
  }

  function saveCurrentView() {
    const name = savedViewName.trim();
    if (!name) return;
    const nextView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      filters: {
        searchTerm,
        selectedCategory,
        selectedSubcategory,
        recommendedFilter,
        riskFilter,
        tagFilter,
        requiresAdminFilter,
        rebootRequiredFilter,
        premiumFilter,
        compatibilityFilter,
        statusFilter,
        favoriteFilter,
        sortMode
      }
    };
    persistSavedViews([nextView, ...savedViews].slice(0, 8));
    setSavedViewName('');
  }

  function startRenamingView(view) {
    setRenamingViewId(view.id);
    setRenamingViewName(view.name);
  }

  function saveRenamedView() {
    const name = renamingViewName.trim();
    if (!renamingViewId || !name) return;
    persistSavedViews(savedViews.map((view) => view.id === renamingViewId ? { ...view, name } : view));
    setRenamingViewId('');
    setRenamingViewName('');
  }

  function applySavedView(view) {
    const filters = view?.filters || {};
    onSearchChange(filters.searchTerm || '');
    onCategoryChange(filters.selectedCategory || 'all');
    onSubcategoryChange(filters.selectedSubcategory || 'all');
    onRecommendedFilterChange(filters.recommendedFilter || 'all');
    onRiskFilterChange(filters.riskFilter || 'all');
    onTagFilterChange(filters.tagFilter || 'all');
    onRequiresAdminFilterChange(filters.requiresAdminFilter || 'all');
    onRebootRequiredFilterChange(filters.rebootRequiredFilter || 'all');
    onPremiumFilterChange(filters.premiumFilter || 'all');
    onCompatibilityFilterChange(filters.compatibilityFilter || 'all');
    onStatusFilterChange(filters.statusFilter || 'all');
    setFavoriteFilter(Boolean(filters.favoriteFilter));
    setSortMode(filters.sortMode === 'status' ? 'status' : 'name');
    setSavedViewsOpen(false);
  }

  function deleteSavedView(id) {
    persistSavedViews(savedViews.filter((view) => view.id !== id));
  }

  function renderTweakCard(tweak) {
    const containerType = normalizeContainerType(tweak?.containerType);
    const isExecutionTweak = containerType === 'one_shot_action' || containerType === 'fix';
    const isCheckingState = !isExecutionTweak && checkingStateTweakIdSet.has(String(tweak.id));
    const selectHandler =
      containerType === 'timer_resolution'
        ? onApplyTimerResolution
        : containerType === 'power_plan'
          ? onApplyPowerPlan
          : onApplyOneShotSelection;
    const executeHandler = containerType === 'fix' ? onApplyFix : onApplyOneShotAction;

    return (
      <UnifiedTweakCard
        key={tweak.id}
        tweak={tweak}
        onToggle={onToggleTweak}
        mascotAnimationEnabled={mascotAnimationEnabled}
        reducedMotion={reducedMotion}
        onSelect={selectHandler}
        onRange={onApplyRangeSelection}
        onExecute={executeHandler}
        onOpenDetails={setSelectedDetailTweak}
        onOpenSubcategory={(selectedTweak) => {
          const category = String(selectedTweak?.category || '').trim();
          const subcategory = String(selectedTweak?.subcategory || '').trim();
          if (category) {
            onCategoryChange(category);
          }
          if (subcategory) {
            onSubcategoryChange(subcategory);
          }
          setOpenCategoryMenu(null);
        }}
        onOpenTechnicalDetails={setTechnicalTweak}
        isFavorite={favoriteIdSet.has(getStableTweakId(tweak))}
        onToggleFavorite={toggleFavorite}
        isSelected={activeDetailTweak?.id === tweak.id}
        disabled={isCheckingState}
        isCheckingState={isCheckingState}
        showCategoryAccent={categoryMode}
      />
    );
  }

  return (
    <PageShell className="tweaks-shell relative">
      <div className="pb-4">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <header className="ui-page-header grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
              <div className="ui-page-heading min-w-0">
                <PageHeadingSignal />
                <div className="min-w-0">
                  <h1 className="ui-page-title">{selectedCategory === 'all' ? t('tweaks.pageTitle') : t('tweaks.categoryTitle', { category: t(`tweaks.categories.${selectedCategory}`, { defaultValue: selectedCategory }) })}</h1>
                  <p className="ui-page-description">{t('tweaks.pageDescription')}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <label className="ui-input-shell h-12 w-full min-w-0 sm:w-[360px]">
                  <Search className="h-5 w-5 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={t('tweaks.searchPlaceholderShort')}
                    className="ui-input"
                  />
                </label>
                <PopoverPrimitive.Root open={savedViewsOpen} onOpenChange={setSavedViewsOpen}>
                  <PopoverPrimitive.Trigger asChild>
                    <button
                      type="button"
                      className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border text-[var(--text-muted)] transition ${savedViewsOpen ? 'border-[color:color-mix(in_srgb,var(--accent)_58%,var(--border))] bg-[var(--active-layer)] text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'}`}
                      title={t('tweaks.savedViews.title')}
                      aria-label={t('tweaks.savedViews.title')}
                    >
                      <Bookmark className="h-5 w-5" />
                    </button>
                  </PopoverPrimitive.Trigger>
                  <PopoverPrimitive.Portal container={portalContainer}>
                    <PopoverPrimitive.Content
                      align="end"
                      sideOffset={8}
                      className="z-50 w-80 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 shadow-[0_20px_48px_rgba(0,0,0,0.38)]"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{t('tweaks.savedViews.title')}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{t('tweaks.savedViews.description')}</p>
                      </div>
                      <label className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">
                        <span>{t('tweaks.savedViews.nameLabel')}</span>
                      </label>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          value={savedViewName}
                          onChange={(event) => setSavedViewName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && savedViewName.trim()) saveCurrentView();
                          }}
                          placeholder={t('tweaks.savedViews.namePlaceholder')}
                          className="ui-input min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3"
                          aria-label={t('tweaks.savedViews.nameLabel')}
                        />
                        <button type="button" onClick={saveCurrentView} disabled={!savedViewName.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('tweaks.savedViews.save')} title={t('tweaks.savedViews.save')}>
                          <Save className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 max-h-52 space-y-1 overflow-y-auto">
                        {savedViews.length ? savedViews.map((view) => (
                          <div key={view.id} className="flex items-center gap-2 rounded-lg border border-transparent p-1 hover:border-[var(--border)] hover:bg-[var(--surface-hover)]">
                            {renamingViewId === view.id ? (
                              <>
                                <input
                                  value={renamingViewName}
                                  onChange={(event) => setRenamingViewName(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && renamingViewName.trim()) saveRenamedView();
                                    if (event.key === 'Escape') setRenamingViewId('');
                                  }}
                                  className="ui-input h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2 text-xs"
                                  aria-label={t('tweaks.savedViews.renameLabel')}
                                  autoFocus
                                />
                                <button type="button" onClick={saveRenamedView} disabled={!renamingViewName.trim()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--accent)] transition hover:bg-[var(--active-layer)] disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('tweaks.savedViews.confirmRename')} title={t('tweaks.savedViews.confirmRename')}>
                                  <Save className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => setRenamingViewId('')} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" aria-label={t('common.cancel')} title={t('common.cancel')}>
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => applySavedView(view)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                                  {view.name}
                                </button>
                                <button type="button" onClick={() => startRenamingView(view)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--accent)]" aria-label={t('tweaks.savedViews.rename')} title={t('tweaks.savedViews.rename')}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => deleteSavedView(view.id)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[color:var(--danger-soft)] hover:text-[var(--danger)]" aria-label={t('tweaks.savedViews.delete')} title={t('tweaks.savedViews.delete')}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )) : <p className="px-2 py-4 text-center text-xs text-[var(--text-muted)]">{t('tweaks.savedViews.empty')}</p>}
                      </div>
                    </PopoverPrimitive.Content>
                  </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((value) => !value)}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border text-[var(--text-muted)] transition ${
                    filtersOpen
                      ? 'border-[color:color-mix(in_srgb,var(--accent)_58%,var(--border))] bg-[var(--active-layer)] text-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_20%,transparent)]'
                      : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                  title={t('tweaks.filters.title')}
                  aria-label={t('tweaks.filters.title')}
                >
                  <Filter className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode((value) => (value === 'name' ? 'status' : 'name'))}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  title={t(sortMode === 'name' ? 'tweaks.sortByStatus' : 'tweaks.sortByName')}
                  aria-label={t('tweaks.sortTweaks')}
                >
                  <ListFilter className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={onReload}
                  disabled={loading || refreshingStates || reloadDisabled}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  title={t('tweaks.reloadTweaks')}
                  aria-label={t('tweaks.reloadTweaks')}
                >
                  <RefreshCw className={`h-5 w-5 ${loading || refreshingStates ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </header>

            <TweakProfilesPanel
              rawTweaks={rawTweaks}
              expanded={profilesExpanded}
              onToggleExpanded={() => setProfilesExpanded((value) => !value)}
              canUsePremium={canUsePremium}
              onToggleTweak={onToggleTweak}
              onApplyTimerResolution={onApplyTimerResolution}
              onApplyPowerPlan={onApplyPowerPlan}
              onApplyOneShotSelection={onApplyOneShotSelection}
              onApplyRangeSelection={onApplyRangeSelection}
              onApplyOneShotAction={onApplyOneShotAction}
              onApplyFix={onApplyFix}
              onPreflightTweaks={onPreflightTweaks}
              onRequestAdminAccess={onRequestAdminAccess}
              hasAdminAccess={hasAdminAccess}
              onReload={onReload}
              showRiskLabels={showRiskLabels}
              showCompatibilityWarnings={showCompatibilityWarnings}
            />

            <CollapsibleDashboardPanel
              id="tweak-metrics-panel-content"
              icon={SlidersHorizontal}
              title={t('tweaks.metrics.sectionTitle', { defaultValue: 'Tweak overview' })}
              subtitle={t('tweaks.metrics.sectionDescription', { defaultValue: 'Review catalog totals, enabled tweaks, recommendations and favorites.' })}
              summary={t('tweaks.metrics.sectionSummary', {
                total: metrics.total,
                enabled: metrics.enabled,
                defaultValue: '{{total}} total | {{enabled}} enabled'
              })}
              open={metricsExpanded}
              onToggle={() => setMetricsExpanded((value) => !value)}
            >
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                <MetricCard loading={initialLoading} icon={SlidersHorizontal} label={t('tweaks.metrics.total')} value={metrics.total} detail={t('tweaks.metrics.available')} />
                <MetricCard loading={initialLoading} icon={Check} label={t('tweaks.metrics.enabled')} value={metrics.enabled} detail={t('tweaks.metrics.tweaks')} />
                <MetricCard loading={initialLoading} icon={Star} label={t('tweaks.metrics.recommended')} value={metrics.recommended} detail={t('tweaks.metrics.tweaks')} />
                <MetricCard
                  loading={initialLoading}
                  icon={Star}
                  label={t('tweaks.metrics.favorites')}
                  value={metrics.favorites}
                  detail={favoriteFilter ? t('tweaks.metrics.filtered') : t('tweaks.metrics.tweaks')}
                  active={favoriteFilter}
                  onClick={() => setFavoriteFilter((value) => !value)}
                />
              </div>
            </CollapsibleDashboardPanel>

            <main className="tweaks-list-panel min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)]">
            <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-5 pt-3">
              <button
                type="button"
                onClick={() => {
                  setOpenCategoryMenu(null);
                  onCategoryChange('all');
                }}
                className={`relative inline-flex shrink-0 items-center gap-2 pb-3 text-sm font-medium transition ${
                  selectedCategory === 'all'
                    ? 'text-[var(--text-primary)] after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-[var(--text-muted)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="text-[var(--accent)]"><CategoryIcon category="all" className="h-4 w-4" /></span>
                {t('tweaks.allTweaks')}
                <span className="text-xs tabular-nums text-[var(--accent)]">{metrics.total}</span>
              </button>
              {orderedCategories.map((category) => {
                const activeCategory = selectedCategory === category;
                const showTabAccent = categoryMode && activeCategory;
                const categoryLabel = t(`tweaks.categories.${category}`, { defaultValue: category });
                const categorySubcategoryStats = subcategoryStatsByCategory[category] || {};
                const categorySubcategories = getOrderedSubcategories(category, categorySubcategoryStats);
                const menuOpen = openCategoryMenu === category;

                return (
                  <div
                    key={category}
                    data-category-menu-root={category}
                    style={getCategoryAccentStyle(category)}
                    className={`relative inline-flex shrink-0 items-center pb-3 transition after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:rounded-full ${
                      showTabAccent
                        ? 'after:bg-[var(--category-accent)]'
                        : activeCategory
                          ? 'after:bg-[var(--text-muted)]'
                          : 'after:bg-transparent'
                    }`}
                  >
                    <DropdownMenuPrimitive.Root
                      open={menuOpen}
                      onOpenChange={(nextOpen) => setOpenCategoryMenu(nextOpen ? category : null)}
                    >
                      <DropdownMenuPrimitive.Trigger asChild>
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1.5 text-sm font-medium transition ${
                            showTabAccent
                              ? 'text-[var(--category-accent)]'
                              : activeCategory
                                ? 'text-[var(--text-primary)]'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className="text-[var(--category-accent)]">
                            <CategoryIcon category={category} className="h-4 w-4" />
                          </span>
                          {categoryLabel}
                          <span className="text-xs tabular-nums text-[var(--category-accent)]">{categoryStats[category] || 0}</span>
                        </button>
                      </DropdownMenuPrimitive.Trigger>

                      <DropdownMenuPrimitive.Portal container={portalContainer}>
                        <DropdownMenuPrimitive.Content
                          align="end"
                          sideOffset={7}
                          style={getCategoryAccentStyle(category)}
                          className="nova-dropdown-content z-50 w-60 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--category-accent)_24%,var(--border))] bg-[var(--surface-strong)] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.38)]"
                        >
                        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2">
                          <CategoryIcon category={category} className="h-4 w-4 text-[var(--category-accent)]" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-primary)]">{categoryLabel}</span>
                          <span className="text-[10px] tabular-nums text-[var(--category-accent)]">{categoryStats[category] || 0}</span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {categorySubcategories.map((subcategory) => {
                            const count = categorySubcategoryStats[subcategory] || 0;
                            const activeSubcategory = activeCategory && selectedSubcategory === subcategory;
                            const subcategoryLabel = t(`tweaks.subcategories.${subcategory}`, { defaultValue: subcategory });

                            return (
                              <DropdownMenuPrimitive.Item key={subcategory} asChild disabled={!count}>
                                <button
                                  type="button"
                                  disabled={!count}
                                  onClick={() => {
                                    onCategoryChange(category);
                                    onSubcategoryChange(subcategory);
                                  }}
                                  className={`nova-dropdown-item ${activeSubcategory ? 'is-active ' : ''}flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none transition ${
                                    !count
                                      ? 'cursor-not-allowed text-[var(--text-muted)] opacity-40'
                                      : activeSubcategory
                                        ? 'bg-[color:color-mix(in_srgb,var(--category-accent)_14%,var(--surface))] text-[var(--text-primary)]'
                                        : 'text-[var(--text-muted)] hover:bg-[var(--hover-layer)] hover:text-[var(--text-primary)] focus:bg-[var(--hover-layer)] focus:text-[var(--text-primary)]'
                                  }`}
                                >
                                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-elevated)] ${activeSubcategory ? 'text-[var(--category-accent)]' : ''}`}>
                                    <SubcategoryIcon category={category} subcategory={subcategory} className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{subcategoryLabel}</span>
                                  <span className="font-tech text-[10px] tabular-nums text-[var(--text-muted)]">{count}</span>
                                  {activeSubcategory ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--category-accent)]" aria-hidden="true" /> : null}
                                </button>
                              </DropdownMenuPrimitive.Item>
                            );
                          })}
                        </div>
                        </DropdownMenuPrimitive.Content>
                      </DropdownMenuPrimitive.Portal>
                    </DropdownMenuPrimitive.Root>
                  </div>
                );
              })}
            </div>

            {filtersOpen ? (
              <div className="grid gap-3 border-b border-[var(--border)] px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={Filter}
                  label={t('tweaks.filters.recommended')}
                  value={recommendedFilter}
                  onChange={onRecommendedFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    { value: 'yes', label: t('tweaks.filters.recommended'), icon: Star },
                    { value: 'no', label: t('tweaks.filters.notRecommended', { defaultValue: 'Not recommended' }) }
                  ]}
                />
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={AlertTriangle}
                  label={t('tweaks.filters.risk')}
                  value={riskFilter}
                  onChange={onRiskFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    { value: 'low', label: t('tweakDetails.risk.low'), icon: ArrowDown },
                    { value: 'medium', label: t('tweakDetails.risk.medium'), icon: ArrowUpDown },
                    { value: 'high', label: t('tweakDetails.risk.high'), icon: ArrowUp }
                  ]}
                />
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={ShieldAlert}
                  label={t('tweaks.filters.requiresAdmin', { defaultValue: 'Requires admin' })}
                  value={requiresAdminFilter}
                  onChange={onRequiresAdminFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    { value: 'yes', label: t('tweakDetails.yes') },
                    { value: 'no', label: t('tweakDetails.no') }
                  ]}
                />
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={RefreshCw}
                  label={t('tweaks.filters.rebootRequired', { defaultValue: 'Reboot required' })}
                  value={rebootRequiredFilter}
                  onChange={onRebootRequiredFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    { value: 'yes', label: t('tweakDetails.yes') },
                    { value: 'no', label: t('tweakDetails.no') }
                  ]}
                />
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={BadgeCheck}
                  label={t('tweaks.filters.compatibility', { defaultValue: 'Compatibility' })}
                  value={compatibilityFilter}
                  onChange={onCompatibilityFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    { value: 'compatible', label: t('tweaks.filters.compatible', { defaultValue: 'Compatible' }) },
                    { value: 'warning', label: t('tweaks.filters.warning', { defaultValue: 'Warning' }) },
                    { value: "unknown", label: t('tweakDetails.unknown') }
                  ]}
                />
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={Check}
                  label={t('tweakDetails.status')}
                  value={statusFilter}
                  onChange={onStatusFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    { value: 'enabled', label: t('tweaks.state.enabled'), icon: Check },
                    { value: 'disabled', label: t('tweaks.state.disabled'), icon: X },
                    { value: 'reboot_required', label: t('tweaks.rebootRequired') }
                  ]}
                />
                <FilterDropdown
                  portalContainer={portalContainer}
                  icon={Tag}
                  label={t('tweakDetails.tags')}
                  value={tagFilter}
                  onChange={onTagFilterChange}
                  options={[
                    { value: 'all', label: t('tweaks.filters.all') },
                    ...availableTags.map((tag) => ({ value: tag, label: tag }))
                  ]}
                />
              </div>
            ) : null}

            <div className={`grid ${TWEAK_LIST_GRID_CLASS} ${SHARED_LIST_GAP_CLASS} border-b border-[var(--border)] ${TWEAK_LIST_HEADER_PADDING_CLASS} py-3 text-xs font-semibold uppercase text-[var(--text-muted)] max-md:hidden`}>
              <span aria-hidden="true" />
              <span>{t('tweaks.table.tweak')}</span>
              <span className={`text-center ${SHARED_LIST_HEADER_DIVIDER_CLASS}`}>{t('tweakDetails.category')}</span>
              <span className={`text-center ${SHARED_LIST_HEADER_DIVIDER_CLASS}`}>{t('tweakDetails.status')}</span>
              <span className={`text-center ${SHARED_LIST_HEADER_DIVIDER_CLASS}`}>{t('apps.actionsLabel')}</span>
              <span aria-hidden="true" />
            </div>

            <div className="space-y-[10px] p-4 pb-5">
              {refreshingCatalog ? <LoadingIndicator label={t('tweaks.refreshing')} compact className="mx-2 my-1" /> : null}
              {refreshingStates ? <LoadingIndicator label={t('tweaks.loadingStates')} compact className="mx-2 my-1" /> : null}
              {initialLoading ? <LoadingIndicator label={t('common.loading')} className="mx-2 my-1" /> : null}
              {errorCode ? (
                <div className="rounded-xl border border-[var(--danger)]/50 bg-[color:var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
                  <p>{t('errors.failedToLoadTweaksApi')}</p>
                  <Button type="button" onClick={onReload} variant="secondary" size="sm" className="mt-3" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
                    {t('tweaks.reload')}
                  </Button>
                </div>
              ) : null}
              {!initialLoading && !errorCode && rawTweaks.length === 0 ? <p className="px-2 py-6 text-sm text-[var(--text-muted)]">{t('tweaks.empty')}</p> : null}
              {!initialLoading && !errorCode && rawTweaks.length > 0 && tweaks.length === 0 ? <p className="px-2 py-6 text-sm text-[var(--text-muted)]">{t('tweaks.noMatch')}</p> : null}
              {!initialLoading && !errorCode && tweaks.length > 0 && visibleTweaks.length === 0 ? <p className="px-2 py-6 text-sm text-[var(--text-muted)]">{t('tweaks.noFavoriteMatch')}</p> : null}
              {!initialLoading && !errorCode && visibleTweaks.length > 0 ? visibleTweaks.map(renderTweakCard) : null}
            </div>
            {!initialLoading && !errorCode && visibleTweaks.length > 0 ? (
              <footer className="tweaks-list-footer">
                <span>{t('tweaks.resultsVisible', {
                  visible: visibleTweaks.length,
                  total: metrics.total,
                  defaultValue: '{{visible}} of {{total}} tweaks shown'
                })}</span>
              </footer>
            ) : null}
            </main>
          </div>

          <div className="tweaks-side-panel min-w-0 space-y-4 lg:sticky">
            <TweakDetailPanel
              tweak={activeDetailTweak}
              onClose={() => setSelectedDetailTweak(null)}
              showRiskLabels={showRiskLabels}
              showCategoryAccent={categoryMode}
              blurName={Boolean(activeDetailTweak && normalizePremium(activeDetailTweak) && !canUsePremium)}
            />
            <QuickActionsPanel
              rawTweaks={rawTweaks}
              selectedCategory={selectedCategory}
              selectedSubcategory={selectedSubcategory}
              onCreateRestorePoint={onCreateRestorePoint}
              onToggleTweak={onToggleTweak}
              oneClickOptimization={oneClickOptimization}
              onRunOneClickOptimization={onRunOneClickOptimization}
              canUsePremium={canUsePremium}
              onOpenNetworkTest={openNetworkTest}
            />
          </div>
        </div>
      </div>

      <NetworkTestModal
        open={networkTestOpen}
        state={networkTestState}
        onStart={startNetworkTest}
        onCancel={cancelNetworkTest}
        onApplyMtu={applyRecommendedMtu}
        onResetMtu={resetMtu}
        mtuActionState={mtuActionState}
        onClose={() => setNetworkTestOpen(false)}
        onShowTweaks={(subcategory) => {
          onCategoryChange?.('Network');
          onSubcategoryChange?.(subcategory);
          setNetworkTestOpen(false);
        }}
      />

      <ModalShell
        open={Boolean(technicalTweak)}
        title={technicalTweak
          ? (
            <span className={normalizePremium(technicalTweak) && !canUsePremium ? 'premium-name-blur' : undefined}>
              {technicalTweak.name || t('tweakDetails.title')}
            </span>
          )
          : t('tweakDetails.title')}
        onClose={() => setTechnicalTweak(null)}
        size="lg"
        className="border-[color:color-mix(in_srgb,var(--accent)_18%,var(--border))]"
        contentClassName="bg-[color:color-mix(in_srgb,var(--surface)_86%,var(--surface-elevated)_14%)]"
        footer={technicalTweak ? (
          <div className="tweak-info-modal-footer">
            <span className="tweak-info-footer-note">
              <Info className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              <span>{t('tweaks.technical.footerNote', { defaultValue: 'Review warnings and technical details before applying this tweak.' })}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => setTechnicalTweak(null)}>
              {t('common.close', { defaultValue: 'Close' })}
            </Button>
          </div>
        ) : null}
      >
        {technicalTweak ? (
          <SecondaryTweakDetails tweak={technicalTweak} showCompatibilityWarnings={showCompatibilityWarnings} />
        ) : null}
      </ModalShell>
    </PageShell>
  );
}

export default TweaksPanel;
