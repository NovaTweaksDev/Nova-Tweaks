import i18n from '../i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {
  Activity,
  AppWindow,
  BellRing,
  Check,
  ChevronDown,
  CircleGauge,
  Clock3,
  Copy,
  Cpu,
  Gamepad2,
  Gauge,
  HardDrive,
  History,
  MemoryStick,
  MoreHorizontal,
  Network,
  Plus,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  Trash2,
  Wifi,
  Workflow,
  X,
  Zap,
  SlidersHorizontal
} from 'lucide-react';
import {
  Button,
  ChoiceCards,
  MetricSlider,
  ModalShell,
  SearchCombobox,
  SegmentedControl,
  StatusPill,
  Switch
} from './ui';
import AutomationAccordionSection from './AutomationAccordionSection';
import { useAppPortalContainer } from './ui/useAppPortalContainer';
import {
  getActionType,
  normalizeRangeConfig,
  normalizeSelectionOptions
} from '../utils/tweakMetadata';

const CONDITION_DEFINITIONS = {
  processRunning: { group: 'process', icon: Activity, boolean: true },
  processStarted: { group: 'process', icon: AppWindow, boolean: true },
  processStopped: { group: 'process', icon: AppWindow, boolean: true },
  processCpu: { group: 'process', icon: Cpu, min: 0, max: 100, step: 1, recommended: 80, unit: '%' },
  processMemory: { group: 'process', icon: MemoryStick, min: 0, max: 32768, step: 128, recommended: 2048, unit: ' MB' },
  processDisk: { group: 'process', icon: HardDrive, min: 0, max: 500, step: 1, recommended: 20, unit: ' MB/s' },
  processNotResponding: { group: 'process', icon: ShieldAlert, boolean: true },
  systemCpu: { group: 'system', icon: Cpu, min: 0, max: 100, step: 1, recommended: 80, unit: '%' },
  systemGpu: { group: 'system', icon: Gauge, min: 0, max: 100, step: 1, recommended: 85, unit: '%' },
  systemMemory: { group: 'system', icon: MemoryStick, min: 0, max: 100, step: 1, recommended: 85, unit: '%' },
  cpuTemperature: { group: 'system', icon: Thermometer, min: 20, max: 110, step: 1, recommended: 85, unit: ' °C' },
  gpuTemperature: { group: 'system', icon: Thermometer, min: 20, max: 110, step: 1, recommended: 85, unit: ' °C' },
  networkLatency: { group: 'network', icon: Wifi, min: 0, max: 500, step: 5, recommended: 100, unit: ' ms' },
  packetLoss: { group: 'network', icon: Network, min: 0, max: 100, step: 1, recommended: 5, unit: '%' },
  gameRunning: { group: 'gaming', icon: Gamepad2, boolean: true },
  gameStarted: { group: 'gaming', icon: Gamepad2, boolean: true },
  gameStopped: { group: 'gaming', icon: Gamepad2, boolean: true }
};

const CONDITION_GROUPS = [
  { id: 'process', icon: Activity },
  { id: 'system', icon: CircleGauge },
  { id: 'network', icon: Wifi },
  { id: 'gaming', icon: Gamepad2 }
];

const ACTION_DEFINITIONS = {
  notify: { icon: BellRing, automatic: true },
  askClose: { icon: ShieldAlert },
  runTweak: { icon: SlidersHorizontal },
  runOptimization: { icon: Zap }
};

const TEMPLATE_DEFINITIONS = [
  { id: 'appStart', icon: AppWindow },
  { id: 'highCpu', icon: Cpu },
  { id: 'unresponsive', icon: ShieldAlert },
  { id: 'gamingPing', icon: Wifi }
];

const NUMERIC_OPERATORS = ['gte', 'gt', 'lte', 'lt'];
const HOLD_PRESETS = [0, 10, 30, 60];
const COOLDOWN_PRESETS = [1, 5, 15, 30, 60];
const controlClass = 'h-10 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]';
const selectControlClass = `${controlClass} nova-native-select`;

function makeId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${suffix}`;
}

function newCondition(type = 'systemCpu') {
  const definition = CONDITION_DEFINITIONS[type] || CONDITION_DEFINITIONS.systemCpu;
  return {
    id: makeId('condition'),
    type,
    operator: definition.boolean ? 'is' : 'gte',
    value: definition.boolean ? true : definition.recommended ?? definition.min ?? 0,
    text: ''
  };
}

function newRule() {
  return {
    id: makeId('rule'),
    name: '',
    enabled: true,
    matchMode: 'all',
    conditions: [newCondition()],
    holdSeconds: 10,
    cooldownMinutes: 15,
    action: {
      type: 'notify',
      message: '',
      tweakId: '',
      tweakTargetValue: '',
      bypassConfirmation: false,
      optimizationId: 'cpu'
    }
  };
}

function getDefaultTweakTarget(tweak) {
  const actionType = getActionType(tweak);
  if (actionType === 'timer_resolution' || actionType === 'one_shot_selection') {
    const options = normalizeSelectionOptions(tweak);
    return String(
      options.find((option) => option.recommended)?.value ||
      tweak?.selectedResolution ||
      tweak?.selectedOption ||
      options[0]?.value ||
      ''
    ).trim();
  }
  if (actionType === 'range_selection') {
    return String(normalizeRangeConfig(tweak).recommendedValue);
  }
  return '';
}

function tweakNeedsTarget(tweak) {
  const actionType = getActionType(tweak);
  return actionType === 'timer_resolution' ||
    actionType === 'one_shot_selection' ||
    actionType === 'range_selection';
}

function selectionLabel(option, actionType) {
  const label = String(option?.label || option?.value || '').trim();
  if (actionType !== 'timer_resolution' || /\bms\b/i.test(label)) return label;
  return `${label} ms`;
}

function createTemplate(templateId, t) {
  const base = newRule();
  if (templateId === 'appStart') {
    return {
      ...base,
      name: t('ruleAutomation.templates.appStart.name'),
      conditions: [newCondition('processStarted')],
      holdSeconds: 0,
      action: { ...base.action, type: 'runTweak' }
    };
  }
  if (templateId === 'unresponsive') {
    return {
      ...base,
      name: t('ruleAutomation.templates.unresponsive.name'),
      conditions: [newCondition('processNotResponding')],
      holdSeconds: 0,
      action: { ...base.action, type: 'askClose' }
    };
  }
  if (templateId === 'gamingPing') {
    return {
      ...base,
      name: t('ruleAutomation.templates.gamingPing.name'),
      conditions: [newCondition('gameRunning'), newCondition('networkLatency')],
      holdSeconds: 15
    };
  }
  return {
    ...base,
    name: t('ruleAutomation.templates.highCpu.name'),
    conditions: [newCondition('systemCpu')]
  };
}

function duplicateRule(rule, t) {
  return {
    ...rule,
    id: makeId('rule'),
    name: `${rule.name} ${t('ruleAutomation.copy')}`,
    conditions: rule.conditions.map((condition) => ({ ...condition, id: makeId('condition') })),
    action: { ...rule.action },
    createdAt: undefined,
    updatedAt: undefined
  };
}

function Field({ children, label, hint = '' }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-[var(--text-muted)]">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {hint ? <span className="font-normal text-[var(--text-muted)]">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function buildConditionGroups(t) {
  return CONDITION_GROUPS.map((group) => ({
    ...group,
    label: t(`ruleAutomation.groups.${group.id}`),
    options: Object.entries(CONDITION_DEFINITIONS)
      .filter(([, definition]) => definition.group === group.id)
      .map(([value, definition]) => ({
        value,
        icon: definition.icon,
        label: t(`ruleAutomation.conditions.${value}`),
        keywords: t(`ruleAutomation.groups.${group.id}`)
      }))
  }));
}

function getConditionUnit(type) {
  return CONDITION_DEFINITIONS[type]?.unit || '';
}

function formatConditionSummary(condition, t) {
  const label = t(`ruleAutomation.conditions.${condition.type}`);
  const filter = String(condition.text || '').trim();
  if (CONDITION_DEFINITIONS[condition.type]?.boolean) {
    return filter ? `${label}: ${filter}` : label;
  }
  return `${label} ${t(`ruleAutomation.operators.${condition.operator}`)} ${condition.value}${getConditionUnit(condition.type)}`;
}

function formatRuleSummary(rule, t) {
  const separator = rule.matchMode === 'all' ? t('ruleAutomation.joinAll') : t('ruleAutomation.joinAny');
  return rule.conditions.map((condition) => formatConditionSummary(condition, t)).join(` ${separator} `);
}

function formatTimestamp(value) {
  if (!Number.isFinite(Number(value))) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(value)));
}

function PresetField({ label, value, options, min, max, unitLabel, immediateLabel, onChange }) {
  return (
    <div className="rule-editor-preset rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <Clock3 className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
          {label}
        </span>
        <label className="flex h-8 w-24 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 focus-within:border-[var(--accent)]">
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            aria-label={label}
            onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}
            className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-[var(--text-primary)] outline-none"
          />
          <span className="ml-1 text-[0.65rem] text-[var(--text-muted)]">{unitLabel}</span>
        </label>
      </div>
      <div className="rule-editor-preset-options mt-3 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rule-editor-preset-option rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-medium transition focus-visible:outline-none focus-visible:shadow-[var(--ui-focus-ring)] ${
              value === option
                ? 'is-active border-[color:color-mix(in_srgb,var(--accent)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--surface))] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {option === 0 ? immediateLabel : `${option} ${unitLabel}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConditionCard({ condition, groups, canRemove, onChange, onRemove, t }) {
  const definition = CONDITION_DEFINITIONS[condition.type] || CONDITION_DEFINITIONS.systemCpu;
  const ConditionIcon = definition.icon;
  const filterType = definition.group === 'process' || definition.group === 'gaming';

  function changeType(type) {
    const nextDefinition = CONDITION_DEFINITIONS[type] || CONDITION_DEFINITIONS.systemCpu;
    onChange({
      type,
      operator: nextDefinition.boolean ? 'is' : 'gte',
      value: nextDefinition.recommended ?? nextDefinition.min ?? 0,
      text: ''
    });
  }

  return (
    <div className="rule-editor-condition rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="flex items-center gap-2">
          <span className="rule-editor-condition-icon inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
            <ConditionIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <SearchCombobox
            value={condition.type}
            groups={groups}
            onChange={changeType}
            ariaLabel={t('ruleAutomation.conditionType')}
            searchPlaceholder={t('ruleAutomation.searchCondition')}
            emptyLabel={t('ruleAutomation.noConditionsFound')}
            className="flex-1"
          />
          <button
            type="button"
            disabled={!canRemove}
            onClick={onRemove}
            aria-label={t('ruleAutomation.removeCondition')}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-[var(--text-muted)] transition hover:border-[color:color-mix(in_srgb,var(--danger)_24%,var(--border))] hover:bg-[color:color-mix(in_srgb,var(--danger)_8%,transparent)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-25"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {filterType ? (
          <div className="mt-3">
            <Field
              label={definition.group === 'gaming' ? t('ruleAutomation.gameFilter') : t('ruleAutomation.processFilter')}
              hint={definition.group === 'process' ? t('ruleAutomation.processFilterHint') : ''}
            >
              <input
                className={`${controlClass} w-full`}
                value={condition.text}
                onChange={(event) => onChange({ text: event.target.value })}
                placeholder={definition.group === 'gaming' ? t('ruleAutomation.gameFilterPlaceholder') : t('ruleAutomation.processFilterPlaceholder')}
              />
            </Field>
          </div>
        ) : null}

        {definition.boolean ? (
          <div className="rule-editor-condition-state mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
            <Check className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
            <span>{t('ruleAutomation.booleanCondition')}</span>
          </div>
        ) : (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[var(--text-muted)]">{t('ruleAutomation.threshold')}</span>
              <select
                className={`${selectControlClass} h-8 w-20 pl-2 pr-7 text-center font-semibold`}
                value={condition.operator}
                aria-label={t('ruleAutomation.operator')}
                onChange={(event) => onChange({ operator: event.target.value })}
              >
                {NUMERIC_OPERATORS.map((operator) => <option key={operator} value={operator}>{t(`ruleAutomation.operators.${operator}`)}</option>)}
              </select>
            </div>
            <MetricSlider
              value={condition.value}
              min={definition.min}
              max={definition.max}
              step={definition.step}
              unit={definition.unit}
              recommended={definition.recommended}
              recommendedLabel={t('ruleAutomation.recommended')}
              ariaLabel={t('ruleAutomation.threshold')}
              onChange={(value) => onChange({ value })}
            />
          </div>
        )}
    </div>
  );
}

function RuleEditor({ rule, open, tweaks, tweakCatalogStatus, onClose, onSave }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(rule || newRule());
  const conditionGroups = useMemo(() => buildConditionGroups(t), [t]);
  const eligibleTweaks = useMemo(() => (tweaks || []).filter((item) => item?.id), [tweaks]);
  const tweakGroups = useMemo(() => {
    const grouped = new Map();
    eligibleTweaks.forEach((item) => {
      const category = String(item.category || t('ruleAutomation.otherTweaks')).trim();
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push({
        value: String(item.id),
        icon: SlidersHorizontal,
        label: item.name || item.id,
        keywords: `${item.description || ''} ${item.subcategory || ''} ${item.premium ? 'premium' : ''}`
      });
    });
    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, options]) => ({
        id: category,
        label: category,
        icon: SlidersHorizontal,
        options: options.sort((left, right) => left.label.localeCompare(right.label))
      }));
  }, [eligibleTweaks, t]);
  const selectedTweak = eligibleTweaks.find((item) => String(item.id) === String(draft.action.tweakId));
  const selectedTweakActionType = selectedTweak ? getActionType(selectedTweak) : '';
  const selectedTweakOptions = selectedTweak ? normalizeSelectionOptions(selectedTweak) : [];
  const selectedTweakRange = selectedTweakActionType === 'range_selection' ? normalizeRangeConfig(selectedTweak) : null;
  const effectiveTweakTargetValue = String(
    draft.action.tweakTargetValue ||
    (selectedTweak ? getDefaultTweakTarget(selectedTweak) : '')
  ).trim();
  const targetRequired = Boolean(selectedTweak && tweakNeedsTarget(selectedTweak));
  const tweakRequiresConfirmation = Boolean(
    selectedTweak && selectedTweakActionType !== 'timer_resolution'
  );
  const bypassesTweakConfirmation = tweakRequiresConfirmation && draft.action.bypassConfirmation === true;
  const valid = draft.name.trim() && draft.conditions.length
    && (draft.action.type !== 'runTweak' || (draft.action.tweakId && (!targetRequired || effectiveTweakTargetValue)))
    && (draft.action.type !== 'askClose' || draft.conditions.some((condition) => condition.type.startsWith('process')));
  const actionOptions = Object.entries(ACTION_DEFINITIONS).map(([value, definition]) => {
    const automatic = definition.automatic || (
      value === 'runTweak' &&
      (selectedTweakActionType === 'timer_resolution' || bypassesTweakConfirmation)
    );
    return {
      value,
      icon: definition.icon,
      label: t(`ruleAutomation.actions.${value}`),
      description: t(`ruleAutomation.actionDescriptions.${value}`),
      badge: automatic ? t('ruleAutomation.automatic') : t('ruleAutomation.confirmationRequired'),
      tone: automatic ? 'neutral' : 'warning'
    };
  });

  function updateCondition(id, patch) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) => condition.id === id ? { ...condition, ...patch } : condition)
    }));
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="xl"
      title={t('ruleAutomation.editorTitle')}
      description={t('ruleAutomation.editorDescription')}
      className="rule-editor-modal"
      contentClassName="rule-editor-modal__content"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            disabled={!valid}
            onClick={() => onSave({
              ...draft,
              name: draft.name.trim(),
              action: {
                ...draft.action,
                tweakTargetValue: draft.action.type === 'runTweak' && targetRequired
                  ? effectiveTweakTargetValue
                  : '',
                bypassConfirmation: draft.action.type === 'runTweak' && tweakRequiresConfirmation
                  ? draft.action.bypassConfirmation === true
                  : false
              }
            })}
          >
            {t('common.save')}
          </Button>
        </>
      )}
    >
      <div className="rule-editor">
        <div className="rule-editor-identity rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label={t('ruleAutomation.name')}>
              <input
                className={`${controlClass} w-full`}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={t('ruleAutomation.namePlaceholder')}
                autoFocus
              />
            </Field>
            <div className="flex items-end gap-2 pb-2 text-sm text-[var(--text-primary)]">
              <Switch checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} ariaLabel={t('ruleAutomation.enabled')} />
              {t('ruleAutomation.enabled')}
            </div>
          </div>
        </div>

        <section className="rule-editor-section rule-editor-conditions rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="rule-editor-section-icon inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
                <Workflow className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h4 className="font-semibold text-[var(--text-primary)]">{t('ruleAutomation.when')}</h4>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t('ruleAutomation.whenDescription')}</p>
              </div>
            </div>
            <SegmentedControl
              value={draft.matchMode}
              onChange={(matchMode) => setDraft({ ...draft, matchMode })}
              ariaLabel={t('ruleAutomation.matchMode')}
              role="radiogroup"
              itemRole="radio"
              options={[
                { id: 'all', label: t('ruleAutomation.all') },
                { id: 'any', label: t('ruleAutomation.any') }
              ]}
            />
          </div>

          <div className="rule-editor-condition-list mt-4 space-y-3">
            {draft.conditions.map((condition) => (
              <ConditionCard
                key={condition.id}
                condition={condition}
                groups={conditionGroups}
                canRemove={draft.conditions.length > 1}
                onChange={(patch) => updateCondition(condition.id, patch)}
                onRemove={() => setDraft({ ...draft, conditions: draft.conditions.filter((entry) => entry.id !== condition.id) })}
                t={t}
              />
            ))}
            <button
              type="button"
              disabled={draft.conditions.length >= 8}
              onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, newCondition()] })}
              className="rule-editor-add-condition flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-transparent px-3 py-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ruleAutomation.addCondition')}
            </button>
          </div>
        </section>

        <div className="rule-editor-timing grid gap-3 sm:grid-cols-2">
          <PresetField
            label={t('ruleAutomation.hold')}
            value={draft.holdSeconds}
            options={HOLD_PRESETS}
            min={0}
            max={300}
            unitLabel={t('ruleAutomation.secondsShort')}
            immediateLabel={t('ruleAutomation.immediate')}
            onChange={(holdSeconds) => setDraft({ ...draft, holdSeconds })}
          />
          <PresetField
            label={t('ruleAutomation.cooldown')}
            value={draft.cooldownMinutes}
            options={COOLDOWN_PRESETS}
            min={1}
            max={1440}
            unitLabel={t('ruleAutomation.minutesShort')}
            immediateLabel={t('ruleAutomation.immediate')}
            onChange={(cooldownMinutes) => setDraft({ ...draft, cooldownMinutes })}
          />
        </div>

        <section className="rule-editor-section rule-editor-action rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-3">
            <span className="rule-editor-section-icon inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h4 className="font-semibold text-[var(--text-primary)]">{t('ruleAutomation.then')}</h4>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t('ruleAutomation.thenDescription')}</p>
            </div>
          </div>
          <ChoiceCards
            value={draft.action.type}
            options={actionOptions}
            onChange={(type) => setDraft({
              ...draft,
              action: {
                ...draft.action,
                type,
                bypassConfirmation: type === 'runTweak'
                  ? draft.action.bypassConfirmation === true
                  : false
              }
            })}
            ariaLabel={t('ruleAutomation.action')}
            className="rule-editor-action-options mt-4"
          />

          {draft.action.type === 'notify' ? (
            <div className="rule-editor-action-detail mt-3">
              <Field label={t('ruleAutomation.notificationMessage')} hint={t('ruleAutomation.optional')}>
                <input
                  className={`${selectControlClass} w-full`}
                  value={draft.action.message || ''}
                  onChange={(event) => setDraft({ ...draft, action: { ...draft.action, message: event.target.value } })}
                  placeholder={t('ruleAutomation.notificationMessagePlaceholder')}
                />
              </Field>
            </div>
          ) : null}
          {draft.action.type === 'runOptimization' ? (
            <div className="rule-editor-action-detail mt-3">
              <Field label={t('ruleAutomation.optimization')}>
                <select
                  className={`${controlClass} w-full`}
                  value={draft.action.optimizationId}
                  onChange={(event) => setDraft({ ...draft, action: { ...draft.action, optimizationId: event.target.value } })}
                >
                  {['cpu', 'storage', 'network', 'cleanup'].map((id) => <option key={id} value={id}>{t(`tweaks.oneClick.${id}.title`)}</option>)}
                </select>
              </Field>
            </div>
          ) : null}
          {draft.action.type === 'runTweak' ? (
            <div className="rule-editor-action-detail mt-3">
              <Field label={t('ruleAutomation.tweak')}>
                <SearchCombobox
                  value={draft.action.tweakId}
                  groups={tweakGroups}
                  onChange={(tweakId) => {
                    const nextTweak = eligibleTweaks.find((item) => String(item.id) === String(tweakId));
                    setDraft({
                      ...draft,
                      action: {
                        ...draft.action,
                        tweakId,
                        tweakTargetValue: nextTweak ? getDefaultTweakTarget(nextTweak) : '',
                        bypassConfirmation: false
                      }
                    });
                  }}
                  ariaLabel={t('ruleAutomation.chooseTweak')}
                  searchPlaceholder={t('ruleAutomation.searchTweaks')}
                  emptyLabel={t('ruleAutomation.noTweaksFound')}
                  placeholderLabel={t('ruleAutomation.chooseTweak')}
                />
              </Field>
              {!eligibleTweaks.length ? (
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs leading-5 text-[var(--text-muted)]">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                  {t(`ruleAutomation.tweakCatalog.${tweakCatalogStatus || 'error'}`)}
                </p>
              ) : null}
              {selectedTweak ? (
                <>
                  {targetRequired ? (
                    <div className="rule-editor-tweak-target mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                      <div className="flex items-start gap-2">
                        <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                        <div>
                          <p className="text-xs font-semibold text-[var(--text-primary)]">{t('ruleAutomation.tweakTarget.title')}</p>
                          <p className="mt-0.5 text-[0.68rem] leading-4 text-[var(--text-muted)]">{t('ruleAutomation.tweakTarget.description')}</p>
                        </div>
                      </div>

                      {selectedTweakActionType === 'timer_resolution' ? (
                        <SegmentedControl
                          className="mt-3 w-full"
                          itemClassName="flex-1"
                          value={effectiveTweakTargetValue}
                          onChange={(tweakTargetValue) => setDraft({ ...draft, action: { ...draft.action, tweakTargetValue: String(tweakTargetValue) } })}
                          ariaLabel={t('ruleAutomation.tweakTarget.timerResolution')}
                          role="radiogroup"
                          itemRole="radio"
                          options={selectedTweakOptions.map((option) => ({
                            id: String(option.value),
                            label: selectionLabel(option, selectedTweakActionType)
                          }))}
                        />
                      ) : null}

                      {selectedTweakActionType === 'one_shot_selection' ? (
                        <select
                          className={`${selectControlClass} mt-3 w-full`}
                          value={effectiveTweakTargetValue}
                          onChange={(event) => setDraft({ ...draft, action: { ...draft.action, tweakTargetValue: event.target.value } })}
                          aria-label={t('ruleAutomation.tweakTarget.selection')}
                        >
                          {selectedTweakOptions.map((option) => (
                            <option key={String(option.value)} value={String(option.value)}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : null}

                      {selectedTweakActionType === 'range_selection' && selectedTweakRange ? (
                        <div className="mt-3">
                          <MetricSlider
                            value={Number(effectiveTweakTargetValue)}
                            min={selectedTweakRange.min}
                            max={selectedTweakRange.max}
                            step={selectedTweakRange.step}
                            unit={selectedTweakRange.unit}
                            recommended={selectedTweakRange.recommendedValue}
                            recommendedLabel={t('ruleAutomation.recommended')}
                            ariaLabel={t('ruleAutomation.tweakTarget.range')}
                            onChange={(value) => setDraft({ ...draft, action: { ...draft.action, tweakTargetValue: String(value) } })}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {tweakRequiresConfirmation ? (
                    <div className={`mt-3 flex items-center justify-between gap-4 rounded-xl border p-3 ${
                      bypassesTweakConfirmation
                        ? 'border-[color:color-mix(in_srgb,var(--warning)_42%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_8%,var(--surface))]'
                        : 'border-[var(--border)] bg-[var(--surface)]'
                    }`}>
                      <div className="flex min-w-0 items-start gap-2.5">
                        <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${
                          bypassesTweakConfirmation ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'
                        }`} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--text-primary)]">
                            {t('ruleAutomation.bypassConfirmation.title')}
                          </p>
                          <p className="mt-0.5 text-[0.68rem] leading-4 text-[var(--text-muted)]">
                            {t('ruleAutomation.bypassConfirmation.description')}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={bypassesTweakConfirmation}
                        onChange={(bypassConfirmation) => setDraft({
                          ...draft,
                          action: { ...draft.action, bypassConfirmation }
                        })}
                        ariaLabel={t('ruleAutomation.bypassConfirmation.title')}
                      />
                    </div>
                  ) : null}

                  <div className="rule-editor-tweak-meta mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--border)] pt-3 text-[0.68rem] text-[var(--text-muted)]">
                    <span>{selectedTweak.category || t('ruleAutomation.otherTweaks')}</span>
                    {selectedTweak.subcategory ? <span>· {selectedTweak.subcategory}</span> : null}
                    {selectedTweak.premium ? <span>· Premium</span> : null}
                    <span className="inline-flex items-center gap-1.5 sm:ml-auto">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {selectedTweakActionType === 'timer_resolution' || bypassesTweakConfirmation
                        ? t('ruleAutomation.automatic')
                        : t('ruleAutomation.safetyConfirmation')}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {draft.action.type === 'askClose' && !draft.conditions.some((condition) => condition.type.startsWith('process')) ? (
            <p className="relative mt-3 flex items-center gap-2 text-xs text-[var(--warning)]">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              {t('ruleAutomation.processConditionRequired')}
            </p>
          ) : null}
        </section>
      </div>
    </ModalShell>
  );
}

function RuleTemplateCard({ template, onSelect, t }) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex min-h-28 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border))] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--surface))] text-[var(--accent)]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="mt-2.5 text-sm font-semibold text-[var(--text-primary)]">{t(`ruleAutomation.templates.${template.id}.name`)}</span>
      <span className="mt-1 line-clamp-2 text-xs leading-4 text-[var(--text-muted)]">{t(`ruleAutomation.templates.${template.id}.description`)}</span>
      <span className="mt-auto pt-3 text-xs font-semibold text-[var(--accent)]">{t('ruleAutomation.useTemplate')} →</span>
    </button>
  );
}

function RuleMenu({ onEdit, onDuplicate, onDelete, t }) {
  const [open, setOpen] = useState(false);
  const portalContainer = useAppPortalContainer();
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('ruleAutomation.ruleActions')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition hover:border-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal container={portalContainer || undefined}>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          className="nova-dropdown-content z-[320] min-w-44 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.36)]"
        >
          {[
            { id: 'edit', icon: Settings2, label: t('common.edit'), action: onEdit },
            { id: 'duplicate', icon: Copy, label: t('ruleAutomation.duplicate'), action: onDuplicate },
            { id: 'delete', icon: Trash2, label: t('common.delete'), action: onDelete, danger: true }
          ].map((item) => (
            <DropdownMenuPrimitive.Item
              key={item.id}
              onSelect={item.action}
              className={`nova-dropdown-item flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition focus:bg-[var(--surface-hover)] ${
                item.danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
              }`}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function RuleCard({ rule, history, onSave, onEdit, onDelete, t }) {
  const actionDefinition = ACTION_DEFINITIONS[rule.action.type] || ACTION_DEFINITIONS.notify;
  const ActionIcon = actionDefinition.icon;
  const lastEntry = history.find((entry) => entry.ruleId === rule.id);

  return (
    <article className="group rounded-2xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)] p-4 transition hover:border-[color:color-mix(in_srgb,var(--accent)_24%,var(--border))] hover:bg-[var(--surface-hover)]">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--surface))] text-[var(--accent)]">
          <ActionIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[var(--text-primary)]">{rule.name}</h3>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-secondary)]">{t('ruleAutomation.when')} </span>
            {formatRuleSummary(rule, t)}
            <span className="mx-1.5 text-[var(--accent)]">→</span>
            <span className="font-semibold text-[var(--text-secondary)]">{t(`ruleAutomation.actions.${rule.action.type}`)}</span>
          </p>
        </div>
        <Switch
          checked={rule.enabled}
          onChange={(enabled) => onSave({ ...rule, enabled })}
          ariaLabel={`${rule.name}: ${t('ruleAutomation.enabled')}`}
        />
        <RuleMenu
          onEdit={onEdit}
          onDuplicate={() => onSave(duplicateRule(rule, t))}
          onDelete={onDelete}
          t={t}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-3 text-[0.68rem] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ruleAutomation.conditionCount', { count: rule.conditions.length })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {lastEntry ? `${t('ruleAutomation.lastRun')}: ${formatTimestamp(lastEntry.updatedAt || lastEntry.createdAt)}` : t('ruleAutomation.neverRun')}
        </span>
      </div>
    </article>
  );
}

function PendingActions({ entries, onExecute, onDismiss, t }) {
  if (!entries.length) return null;
  return (
    <div className="mt-4 space-y-2">
      {entries.map((execution) => {
        const definition = ACTION_DEFINITIONS[execution.action.type] || ACTION_DEFINITIONS.notify;
        const ActionIcon = definition.icon;
        return (
          <div key={execution.id} className="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_8%,var(--surface))] p-4">
            <div className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-[var(--warning)] opacity-[0.06] blur-2xl" aria-hidden="true" />
            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_12%,var(--surface))] text-[var(--warning)]">
                <ActionIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--warning)]">{t(execution.blockedReason === 'awaitingAdmin' ? 'ruleAutomation.awaitingAdmin' : 'ruleAutomation.pendingAction')}</p>
                <p className="mt-1 font-semibold text-[var(--text-primary)]">{execution.ruleName}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {t(`ruleAutomation.actions.${execution.action.type}`)}
                  {execution.processInfo ? ` · ${execution.processInfo.name}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => onExecute(execution)}>{t(execution.blockedReason === 'awaitingAdmin' ? 'ruleAutomation.approveAdmin' : 'ruleAutomation.execute')}</Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(execution.id)}>{t('ruleAutomation.dismiss')}</Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RuleHistory({ entries, t }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  if (!entries.length) return null;
  const visibleEntries = entries.slice(0, 10);

  return (
    <div className="mt-6 border-t border-[var(--border)] pt-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left focus-visible:outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-elevated)] text-[var(--text-muted)]">
          <History className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text-primary)]">{t('ruleAutomation.history')}</span>
          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{t('ruleAutomation.historyDescription', { count: entries.length })}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open ? (
        <div className="relative mt-3 ml-4 space-y-2 border-l border-[var(--border)] pl-5">
          {visibleEntries.map((entry) => {
            const expanded = expandedId === entry.id;
            const tone = entry.status === 'completed' ? "success" : entry.status === 'failed' ? 'danger' : entry.status === 'pending' ? 'warning' : 'neutral';
            return (
              <div key={entry.id} className="relative">
                <span className={`absolute -left-[1.62rem] top-4 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] ${
                  entry.status === 'completed' ? 'bg-[var(--success)]' : entry.status === 'failed' ? 'bg-[var(--danger)]' : entry.status === 'pending' ? 'bg-[var(--warning)]' : 'bg-[var(--text-muted)]'
                }`} aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? '' : entry.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{entry.ruleName}</span>
                    <span className="mt-0.5 block text-[0.68rem] text-[var(--text-muted)]">{formatTimestamp(entry.updatedAt || entry.createdAt)}</span>
                  </span>
                  <StatusPill tone={tone}>{t(`ruleAutomation.status.${entry.status}`, { defaultValue: entry.status })}</StatusPill>
                  <ChevronDown className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {expanded ? (
                  <div className="mx-2 rounded-b-xl border-x border-b border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
                    <p>{t('ruleAutomation.action')}: <span className="text-[var(--text-primary)]">{t(`ruleAutomation.actions.${entry.action?.type}`)}</span></p>
                    {entry.message ? <p className="mt-1">{entry.message}</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RuleAutomationSection({ state, tweaks, tweakCatalogStatus, onSave, onDelete, onExecute, onDismiss, open, onToggle }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(null);
  const rules = state?.rules || [];
  const history = state?.history || [];
  const pending = state?.pending || [];
  const summary = pending.length
    ? t('automationLayout.rulesPending', { count: pending.length })
    : t('automationLayout.rulesSummary', { count: rules.length });

  return (
    <>
      <AutomationAccordionSection
        id="automation-rules"
        icon={Workflow}
        title={t('ruleAutomation.title')}
        description={t('ruleAutomation.description')}
        summary={summary}
        open={open}
        onToggle={onToggle}
        actions={open ? <Button size="sm" variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing(newRule())}>{t('ruleAutomation.newRule')}</Button> : null}
      >

        <PendingActions entries={pending} onExecute={onExecute} onDismiss={onDismiss} t={t} />

        <div className="mt-4 grid gap-3">
          {rules.length ? rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              history={history}
              onSave={onSave}
              onEdit={() => setEditing(rule)}
              onDelete={() => onDelete(rule.id)}
              t={t}
            />
          )) : (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_76%,transparent)] p-5">
              <div className="text-center">
                <Workflow className="mx-auto h-7 w-7 text-[var(--accent)]" />
                <p className="mt-3 font-semibold text-[var(--text-primary)]">{t('ruleAutomation.emptyTitle')}</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{t('ruleAutomation.emptyBody')}</p>
              </div>
              <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {TEMPLATE_DEFINITIONS.map((template) => (
                  <RuleTemplateCard key={template.id} template={template} onSelect={() => setEditing(createTemplate(template.id, t))} t={t} />
                ))}
              </div>
            </div>
          )}
        </div>

        <RuleHistory entries={history} t={t} />
      </AutomationAccordionSection>

      {editing ? (
        <RuleEditor
          key={editing.id}
          rule={editing}
          open
          tweaks={tweaks}
          tweakCatalogStatus={tweakCatalogStatus}
          onClose={() => setEditing(null)}
          onSave={(rule) => {
            onSave(rule);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

export default RuleAutomationSection;
