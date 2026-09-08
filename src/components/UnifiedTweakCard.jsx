import { useEffect, useMemo, useState } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Activity, AlertTriangle, Check, Info, Minus, MoreVertical, Play, SlidersHorizontal, Star, WandSparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SubcategoryIcon from './SubcategoryIcon';
import CategoryIcon from './CategoryIcon';
import MascotToggle from './MascotToggle';
import { Button, LoadingSpinner, ModalShell, PremiumBadge, Switch } from './ui';
import {
  getActionType,
  getStatusTextClass,
  getStatusTone,
  getTweakStatusLabel,
  normalizePremium,
  normalizeRangeConfig,
  normalizeRecommended,
  normalizeSelectionOptions
} from '../utils/tweakMetadata';
import { getCategoryAccentStyle } from '../constants/categoryAccents';
import { useAppPortalContainer } from './ui/useAppPortalContainer';
import {
  SHARED_LIST_ACTIONS_CLASS,
  SHARED_LIST_CATEGORY_CELL_CLASS,
  SHARED_LIST_CHEVRON_CELL_CLASS,
  SHARED_LIST_GAP_CLASS,
  TWEAK_LIST_GRID_CLASS,
  TWEAK_LIST_ICON_CELL_CLASS,
  SHARED_LIST_MAIN_CELL_CLASS,
  SHARED_LIST_STATUS_CELL_CLASS,
  TWEAK_ROW_PRIMARY_ACTION_SLOT_CLASS,
  TWEAK_ROW_PRIMARY_BUTTON_CLASS
} from '../constants/listLayout';

function getSelectionValue(tweak) {
  return String(
    tweak?.selectedOption ||
    tweak?.selected_option ||
    tweak?.selectedResolution ||
    tweak?.selected_resolution ||
    tweak?.currentResolution ||
    tweak?.current_resolution ||
    ''
  ).trim();
}

function normalizeOptionalRangeValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function localizeStatus(label, t) {
  const normalized = String(label || '').toLowerCase();
  if (normalized === 'enabled') return t('tweaks.state.enabled');
  if (normalized === 'disabled') return t('tweaks.state.disabled');
  if (normalized === 'pending') return t('tweaks.state.pending');
  if (normalized === 'ready') return t('tweaks.oneShotAction.ready');
  if (normalized === 'reboot required' || normalized === 'restart required') return t('tweaks.rebootRequired', { defaultValue: 'Reboot required' });
  return label;
}

function localizeTaxonomy(value, type, t) {
  const safeValue = value || 'System';
  return t(`tweaks.${type}.${safeValue}`, { defaultValue: safeValue });
}

function StatusIcon({ tone }) {
  const Icon = tone === 'ready'
    ? Activity
    : tone === 'enabled'
      ? Check
      : tone === 'disabled'
        ? X
        : tone === 'warning'
          ? AlertTriangle
          : Minus;
  const toneClass = tone === 'ready'
    ? 'text-[var(--accent)]'
    : tone === 'enabled'
      ? 'text-[color:color-mix(in_srgb,var(--success)_72%,var(--text-muted))]'
      : tone === 'warning'
        ? 'text-[var(--warning)]'
        : 'text-[var(--text-muted)]';

  return <Icon className={`h-3.5 w-3.5 shrink-0 ${toneClass}`} strokeWidth={2} aria-hidden="true" />;
}

function UnifiedTweakCard({
  tweak,
  onToggle,
  onExecute,
  onSelect,
  onRange,
  onOpenDetails,
  onOpenSubcategory,
  onOpenTechnicalDetails,
  isFavorite = false,
  onToggleFavorite,
  isSelected = false,
  disabled,
  isCheckingState = false,
  showCategoryAccent = false,
  mascotAnimationEnabled = false,
  reducedMotion = false
}) {
  const { t } = useTranslation();
  const portalContainer = useAppPortalContainer();
  const [enabled, setEnabled] = useState(tweak.currentState === 'enabled');
  const [loading, setLoading] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const selectionOptions = useMemo(() => normalizeSelectionOptions(tweak), [tweak]);
  const rangeConfig = useMemo(() => normalizeRangeConfig(tweak), [tweak]);
  const currentSelection = getSelectionValue(tweak);
  const [pendingSelection, setPendingSelection] = useState(currentSelection || selectionOptions[0]?.value || '');
  const currentRangeValue = normalizeOptionalRangeValue(tweak?.currentValue ?? tweak?.current_value);
  const initialRangeValue = currentRangeValue !== null
    ? Math.min(rangeConfig.max, Math.max(rangeConfig.min, currentRangeValue))
    : rangeConfig.recommendedValue;
  const [pendingRangeValue, setPendingRangeValue] = useState(initialRangeValue);
  const rangeProgress = rangeConfig.max > rangeConfig.min
    ? ((pendingRangeValue - rangeConfig.min) / (rangeConfig.max - rangeConfig.min)) * 100
    : 0;

  useEffect(() => {
    setEnabled(tweak.currentState === 'enabled');
  }, [tweak.currentState, tweak.id]);

  useEffect(() => {
    setPendingSelection(currentSelection || selectionOptions[0]?.value || '');
  }, [currentSelection, selectionOptions, tweak.id]);

  useEffect(() => {
    setPendingRangeValue(initialRangeValue);
  }, [initialRangeValue, tweak.id]);

  const actionType = getActionType(tweak);
  const isSelection = actionType === 'one_shot_selection' || actionType === 'timer_resolution';
  const isRange = actionType === 'range_selection';
  const isPowerPlan = actionType === 'power_plan';
  const isExecute = actionType === 'one_shot_action';
  const isPremiumTweak = normalizePremium(tweak);
  const isRecommendedTweak = normalizeRecommended(tweak);
  const actionDisabled = loading || disabled || isCheckingState;
  const statusLabel = getTweakStatusLabel({
    ...tweak,
    currentState: enabled ? 'enabled' : tweak.currentState
  });
  const statusTone = getStatusTone({
    ...tweak,
    currentState: enabled ? 'enabled' : tweak.currentState
  });
  const localizedStatusLabel = isCheckingState
    ? t('common.loading')
    : localizeStatus(statusLabel, t);
  const statusTextClass = isCheckingState
    ? 'text-[var(--text-muted)]'
    : statusTone === 'ready'
      ? 'text-[var(--accent)]'
      : statusTone === 'enabled'
        ? 'text-[color:color-mix(in_srgb,var(--success)_72%,var(--text-muted))]'
        : getStatusTextClass(statusTone);
  const accentStyle = getCategoryAccentStyle(tweak.category);
  const selectedClass = showCategoryAccent
    ? 'border-[color:color-mix(in_srgb,var(--category-accent)_42%,var(--border))] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--category-accent)_10%,transparent)]'
    : 'border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)]';
  const idleClass = showCategoryAccent
    ? 'border-[color:color-mix(in_srgb,var(--border)_52%,transparent)] bg-[color:color-mix(in_srgb,var(--surface)_78%,var(--surface-strong)_22%)] hover:border-[color:color-mix(in_srgb,var(--category-accent)_20%,var(--border))] hover:bg-[var(--surface-hover)]'
    : 'border-[color:color-mix(in_srgb,var(--border)_52%,transparent)] bg-[color:color-mix(in_srgb,var(--surface)_78%,var(--surface-strong)_22%)] hover:border-[color:color-mix(in_srgb,var(--text-muted)_22%,var(--border))] hover:bg-[var(--surface-hover)]';
  const iconClass = showCategoryAccent
    ? 'border-[color:color-mix(in_srgb,var(--category-accent)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--category-accent)_8%,var(--surface-elevated))] text-[var(--category-accent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--category-accent)_12%,transparent)]'
    : 'border-[color:color-mix(in_srgb,var(--category-accent)_18%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--category-accent)_6%,var(--surface-elevated))] text-[color:color-mix(in_srgb,var(--category-accent)_72%,var(--text-muted))] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--category-accent)_8%,transparent)]';
  const taxonomyLabel = tweak.subcategory
    ? localizeTaxonomy(tweak.subcategory, 'subcategories', t)
    : localizeTaxonomy(tweak.category || 'System', 'categories', t);

  async function toggle(_nextChecked, options = {}) {
    if (actionDisabled) return;
    const nextEnabled = !enabled;
    setLoading(true);
    try {
      const result = await onToggle?.(tweak, nextEnabled, options);
      if (result?.ok) {
        const nextState = result.currentState === 'enabled' ? 'enabled' : nextEnabled ? 'enabled' : 'disabled';
        setEnabled(nextState === 'enabled');
      }
      return result;
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (actionDisabled) return;
    setLoading(true);
    try {
      await onExecute?.(tweak);
    } finally {
      setLoading(false);
    }
  }

  async function applySelection() {
    if (actionDisabled) return;
    const selection = pendingSelection || currentSelection || selectionOptions[0]?.value || '';
    setLoading(true);
    try {
      await onSelect?.(tweak, selection);
      setSelectionOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function applyRange() {
    if (actionDisabled || !Number.isFinite(pendingRangeValue)) return;
    setLoading(true);
    try {
      const result = await onRange?.(tweak, pendingRangeValue);
      if (result?.ok) {
        setRangeOpen(false);
      }
    } finally {
      setLoading(false);
    }
  }

  function openSelection(event) {
    event.stopPropagation();
    if (actionDisabled) return;
    if (!selectionOptions.length) {
      void applySelection();
      return;
    }
    setSelectionOpen(true);
  }

  function openRange(event) {
    event.stopPropagation();
    if (actionDisabled) return;
    setPendingRangeValue(initialRangeValue);
    setRangeOpen(true);
  }

  function renderPrimaryAction() {
    if (isPowerPlan) {
      return (
        <button type="button" onClick={openSelection} disabled={actionDisabled} className={TWEAK_ROW_PRIMARY_BUTTON_CLASS}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('apply')}
        </button>
      );
    }

    if (isSelection) {
      return (
        <button type="button" onClick={openSelection} disabled={actionDisabled} className={TWEAK_ROW_PRIMARY_BUTTON_CLASS}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('tweaks.oneShotSelection.selectOption')}
        </button>
      );
    }

    if (isRange) {
      return (
        <button type="button" onClick={openRange} disabled={actionDisabled} className={TWEAK_ROW_PRIMARY_BUTTON_CLASS}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('tweaks.range.adjust')}
        </button>
      );
    }

    if (isExecute) {
      return (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void execute();
          }}
          disabled={actionDisabled}
          className={TWEAK_ROW_PRIMARY_BUTTON_CLASS}
        >
          <Play className="h-3.5 w-3.5" />
          <span className="relative top-px leading-none">{t('tweaks.oneShotAction.executeButton')}</span>
        </button>
      );
    }

    return (
      <span onClick={(event) => event.stopPropagation()} className="inline-flex items-center justify-center">
        {mascotAnimationEnabled ? (
          <MascotToggle
            checked={enabled}
            disabled={actionDisabled}
            reducedMotion={reducedMotion}
            onChange={toggle}
            ariaLabel={enabled ? t('tweaks.toggleOff') : t('tweaks.toggleOn')}
          />
        ) : (
          <Switch
            checked={enabled}
            disabled={actionDisabled}
            onChange={toggle}
            ariaLabel={enabled ? t('tweaks.toggleOff') : t('tweaks.toggleOn')}
          />
        )}
      </span>
    );
  }

  return (
    <>
      <article
        style={accentStyle}
        className={`tech-hover-lift tweak-hover-marker group relative grid min-h-[80px] cursor-pointer ${TWEAK_LIST_GRID_CLASS} items-center ${SHARED_LIST_GAP_CLASS} rounded-lg border px-5 py-4 transition-[background-color,border-color,box-shadow,transform] duration-200 md:h-[80px] md:py-0 ${
          isSelected ? selectedClass : idleClass
        } ${isSelected ? 'is-selected' : ''} ${isPremiumTweak ? 'tweak-card-premium' : ''}`}
        onClick={() => onOpenDetails?.(tweak)}
      >
        <div className={TWEAK_LIST_ICON_CELL_CLASS}>
          <span className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconClass}`}>
            <SubcategoryIcon category={tweak.category} subcategory={tweak.subcategory} className="h-5 w-5" />
            {isPremiumTweak ? (
              <PremiumBadge
                compact
                className="absolute -left-1.5 -top-1.5"
                label={t('tweaks.premiumBadge')}
              />
            ) : null}
          </span>
        </div>

        <div className={SHARED_LIST_MAIN_CELL_CLASS}>
          <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-6">
            <h4 className="min-w-0 truncate text-[16px] font-semibold leading-6 text-[var(--text-primary)]" title={tweak.name}>
              <span>{tweak.name || t('tweaks.untitled', { defaultValue: 'Unnamed Tweak' })}</span>
            </h4>
            {isRecommendedTweak ? (
              <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--surface-elevated))] px-2.5 text-[9px] font-semibold leading-none tracking-[0.025em] text-[var(--accent)] shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_5%,transparent)]">
                <WandSparkles className="h-3 w-3 shrink-0 opacity-90" aria-hidden="true" />
                {t('tweaks.oneShotSelection.recommendedBadge')}
              </span>
            ) : null}
          </div>
        </div>

        <div className={`flex items-center justify-center gap-2 ${SHARED_LIST_CATEGORY_CELL_CLASS}`}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenSubcategory?.(tweak);
            }}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:text-[var(--text-primary)]"
            title={taxonomyLabel}
            aria-label={t('tweaks.openSubcategories', {
              defaultValue: `Open ${taxonomyLabel}`
            })}
          >
            {showCategoryAccent && tweak.subcategory ? (
              <SubcategoryIcon category={tweak.category} subcategory={tweak.subcategory} className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CategoryIcon category={tweak.category} className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{taxonomyLabel}</span>
          </button>
        </div>

        <div className={`flex w-full max-w-full items-center justify-center overflow-hidden text-center text-xs font-medium ${SHARED_LIST_STATUS_CELL_CLASS}`}>
          <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-2">
            <span className="inline-flex shrink-0 items-center justify-center">
              {loading || isCheckingState ? (
                <LoadingSpinner className="h-3.5 w-3.5" />
              ) : <StatusIcon tone={statusTone} />}
            </span>
            <span className={`min-w-0 truncate ${statusTextClass}`} title={localizedStatusLabel}>
              {localizedStatusLabel}
            </span>
          </span>
        </div>

        <div className={SHARED_LIST_ACTIONS_CLASS}>
          <div className="flex w-full items-center justify-end gap-2">
            <div className={TWEAK_ROW_PRIMARY_ACTION_SLOT_CLASS}>
              {renderPrimaryAction()}
            </div>
            <DropdownMenuPrimitive.Root>
              <DropdownMenuPrimitive.Trigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="nova-dropdown-trigger nova-menu-trigger inline-flex h-9 w-9 shrink-0 items-center justify-center border text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={t('common.moreActions', { defaultValue: 'More actions' })}
                  title={t('common.moreActions', { defaultValue: 'More actions' })}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal container={portalContainer || undefined}>
                <DropdownMenuPrimitive.Content
                  align="end"
                  sideOffset={7}
                  onClick={(event) => event.stopPropagation()}
                  className="nova-dropdown-content z-[320] min-w-48"
                >
                  <DropdownMenuPrimitive.Item
                    onSelect={(event) => {
                      event.stopPropagation();
                      onOpenTechnicalDetails?.(tweak);
                    }}
                    className="nova-dropdown-item flex cursor-default items-center gap-2.5 px-2.5 py-2 text-sm text-[var(--text-secondary)]"
                  >
                    <Info className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                    {t('tweakDetails.title')}
                  </DropdownMenuPrimitive.Item>
                  <DropdownMenuPrimitive.Item
                    onSelect={(event) => {
                      event.stopPropagation();
                      onToggleFavorite?.(tweak);
                    }}
                    className={`nova-dropdown-item ${isFavorite ? 'is-active ' : ''}flex cursor-default items-center gap-2.5 px-2.5 py-2 text-sm text-[var(--text-secondary)]`}
                  >
                    <Star className="h-4 w-4 text-[var(--warning)]" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
                    {isFavorite ? t('favorites.remove') : t('favorites.add')}
                  </DropdownMenuPrimitive.Item>
                </DropdownMenuPrimitive.Content>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>
          </div>
        </div>
        <div className={SHARED_LIST_CHEVRON_CELL_CLASS} aria-hidden="true" />
      </article>

      <ModalShell
        open={selectionOpen}
        title={tweak?.name || t('tweaks.oneShotSelection.modalTitle')}
        description={currentSelection ? t('tweaks.oneShotSelection.currentSelectionValue', { value: currentSelection }) : t('tweaks.oneShotSelection.modalDescription')}
        onClose={() => {
          if (!loading) setSelectionOpen(false);
        }}
        closeOnEscape={!loading}
        closeOnBackdrop={!loading}
        closeDisabled={loading}
        size="md"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setSelectionOpen(false)} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={applySelection} loading={loading} disabled={!pendingSelection} leftIcon={<Check className="h-3.5 w-3.5" />}>
              {t('apply')}
            </Button>
          </>
        )}
      >
        <fieldset className="space-y-2" disabled={loading}>
          {selectionOptions.map((option, index) => (
            <label
              key={`${option.value}-${index}`}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:border-[var(--accent)]/40"
            >
              <input
                type="radio"
                name={`selection-${String(tweak?.id || 'tweak')}`}
                value={option.value}
                checked={pendingSelection === option.value}
                onChange={(event) => setPendingSelection(event.target.value)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.recommended ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--accent)]">
                  {t('tweaks.oneShotSelection.recommendedOption')}
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
      </ModalShell>

      <ModalShell
        open={rangeOpen}
        title={tweak?.name || t('tweaks.range.modalTitle')}
        description={currentRangeValue !== null
          ? t('tweaks.range.currentValue', {
              value: currentRangeValue,
              unit: rangeConfig.unit
            })
          : t('tweaks.range.modalDescription')}
        onClose={() => {
          if (!loading) setRangeOpen(false);
        }}
        closeOnEscape={!loading}
        closeOnBackdrop={!loading}
        closeDisabled={loading}
        size="md"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setRangeOpen(false)} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={applyRange} loading={loading} disabled={!Number.isFinite(pendingRangeValue)} leftIcon={<Check className="h-3.5 w-3.5" />}>
              {t('apply')}
            </Button>
          </>
        )}
      >
        <fieldset className="space-y-5" disabled={loading}>
          <div className="flex items-end justify-between gap-4">
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t('tweaks.range.value')}</span>
            <output
              htmlFor={`range-${String(tweak?.id || 'tweak')}`}
              className="rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[var(--active-layer)] px-3 py-1.5 text-lg font-semibold tabular-nums text-[var(--accent)]"
            >
              {pendingRangeValue}{rangeConfig.unit}
            </output>
          </div>
          <input
            id={`range-${String(tweak?.id || 'tweak')}`}
            type="range"
            min={rangeConfig.min}
            max={rangeConfig.max}
            step={rangeConfig.step}
            value={pendingRangeValue}
            onChange={(event) => setPendingRangeValue(Number(event.target.value))}
            className="nova-range-input w-full cursor-pointer"
            style={{ '--range-progress': `${Math.min(100, Math.max(0, rangeProgress))}%` }}
            aria-label={t('tweaks.range.value')}
            aria-valuetext={`${pendingRangeValue}${rangeConfig.unit}`}
          />
          <div className="flex justify-between text-xs font-medium tabular-nums text-[var(--text-muted)]">
            <span>{rangeConfig.min}{rangeConfig.unit}</span>
            <span>{rangeConfig.max}{rangeConfig.unit}</span>
          </div>
        </fieldset>
      </ModalShell>
    </>
  );
}

export default UnifiedTweakCard;
