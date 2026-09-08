import i18n from '../i18n';
import {
  Activity,
  Ban,
  BellRing,
  CalendarClock,
  ChevronDown,
  Clock3,
  Cpu,
  HardDrive,
  History,
  MemoryStick,
  Settings2,
  ShieldCheck,
  Trash2,
  Workflow
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PageHeader, PageShell, StatusPill, Switch } from './ui';
import AutomationAccordionSection from './AutomationAccordionSection';
import RuleAutomationSection from './RuleAutomationSection';
import ScheduledMaintenanceSection from './ScheduledMaintenanceSection';

const METRIC_ICONS = { cpu: Cpu, memory: MemoryStick, disk: HardDrive, notResponding: Activity };

function AutomationRoute({ items, activeId, onSelect }) {
  return (
    <nav className="automation-route" aria-label={i18n.t('interfaceText.automation_areas_07bc6')}>
      {items.map((item, index) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            data-active={active ? 'true' : 'false'}
            className="automation-route__item"
            onClick={() => onSelect(item.id)}
          >
            <span className="automation-route__node">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 text-left">
              <span className="automation-route__label">{item.label}</span>
              <span className="automation-route__summary">{item.summary}</span>
            </span>
            {index < items.length - 1 ? <span className="automation-route__connector" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

function NumberField({ label, value, min, max, suffix, onChange, disabled = false }) {
  const [draft, setDraft] = useState(String(value ?? ''));

  useEffect(() => {
    setDraft(String(value ?? ''));
  }, [value]);

  function commit() {
    const numericValue = Number(draft);
    if (!draft.trim() || !Number.isFinite(numericValue)) {
      setDraft(String(value ?? ''));
      return;
    }
    onChange(Math.max(min, Math.min(max, numericValue)));
  }

  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="w-20 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-right text-sm outline-none focus:border-[var(--accent)] disabled:opacity-50"
        />
        <span className="w-10 text-xs text-[var(--text-muted)]">{suffix}</span>
      </span>
    </label>
  );
}

function DetectionRule({ icon: Icon, title, description, enabled, onEnabledChange, children }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_72%,transparent)] p-3.5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_13%,transparent)] p-2 text-[var(--accent)]"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-0.5 line-clamp-2 text-xs leading-4 text-[var(--text-muted)]">{description}</p></div>
            <Switch checked={enabled} onChange={onEnabledChange} ariaLabel={title} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

function CompactDisclosure({ icon: Icon, title, summary, open, onToggle, actions = null, children }) {
  return (
    <section className="border-t border-[var(--border)] pt-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2 text-left outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-elevated)] text-[var(--text-muted)]"><Icon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">{summary}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {actions}
      </div>
      {open ? <div className="motion-tab-panel mt-3">{children}</div> : null}
    </section>
  );
}

function metricLabel(alert, t) {
  if (alert.metric === 'cpu') return `${alert.value}% CPU`;
  if (alert.metric === 'memory') return `${alert.value} MB RAM`;
  if (alert.metric === 'disk') return `${alert.value} MB/s`;
  return t('automation.notResponding');
}

function AutomationPanel({ state, busy, rulesState, tweaks, tweakCatalogStatus, onSaveRule, onDeleteRule, onExecuteRule, onDismissRule, onUpdateSettings, onDismissAlert, onExcludeAlert, onRequestClose, onForceTerminate, onClearHistory }) {
  const { t } = useTranslation();
  const settings = state?.settings || {};
  const update = (patch) => onUpdateSettings({ ...settings, ...patch });
  const alerts = state?.currentAlerts || [];
  const exclusions = settings.excludedExecutables || [];
  const history = state?.history || [];
  const pendingRules = rulesState?.pending || [];
  const [openSection, setOpenSection] = useState(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState({ loaded: false, running: false });
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const userSelectedSection = useRef(false);

  useEffect(() => {
    if (openSection !== null || userSelectedSection.current) return;
    if (alerts.length) setOpenSection('processes');
    else setOpenSection('rules');
  }, [alerts.length, openSection, pendingRules.length]);

  const handleMaintenanceStatus = useCallback((nextStatus) => {
    setMaintenanceStatus(nextStatus);
    if (nextStatus.running && !userSelectedSection.current) {
      setOpenSection('maintenance');
    }
  }, []);

  function toggleSection(sectionId) {
    userSelectedSection.current = true;
    setOpenSection((current) => current === sectionId ? null : sectionId);
  }

  const activeDetectionRules = [
    settings.cpuEnabled,
    settings.memoryEnabled,
    settings.diskEnabled,
    settings.notRespondingEnabled
  ].filter(Boolean).length;

  const processSummary = alerts.length
    ? t('automationLayout.processAlerts', { count: alerts.length })
    : state?.enabled
      ? t('automationLayout.processSummary', { count: activeDetectionRules })
      : t('automation.inactive');

  const attention = maintenanceStatus.running && openSection !== 'maintenance'
    ? { section: 'maintenance', label: t('automationLayout.maintenanceRunningNotice') }
    : alerts.length && openSection !== 'processes'
      ? { section: 'processes', label: t('automationLayout.processAttention', { count: alerts.length }) }
      : pendingRules.length && openSection !== 'rules'
        ? { section: 'rules', label: t('automationLayout.ruleAttention', { count: pendingRules.length }) }
        : null;
  const routeItems = [
    {
      id: 'rules',
      icon: Workflow,
      label: t('ruleAutomation.title'),
      summary: pendingRules.length
        ? t('automationLayout.rulesPending', { count: pendingRules.length })
        : t('automationLayout.rulesSummary', { count: rulesState?.rules?.length || 0 })
    },
    {
      id: 'maintenance',
      icon: CalendarClock,
      label: t('scheduledMaintenance.title'),
      summary: maintenanceStatus.running
        ? t('automationLayout.running')
        : maintenanceStatus.enabled
          ? t('scheduledMaintenance.active')
          : t('scheduledMaintenance.paused')
    },
    {
      id: 'processes',
      icon: Activity,
      label: t('automation.liveDetection'),
      summary: processSummary
    }
  ];

  return (
    <PageShell className="automation-shell">
      <PageHeader
        title={t('automation.title')}
        description={t('automation.description')}
      />

      <AutomationRoute items={routeItems} activeId={openSection} onSelect={toggleSection} />

      {attention ? (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_30%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_8%,var(--surface))] px-4 py-3 text-left text-sm transition hover:bg-[color:color-mix(in_srgb,var(--warning)_12%,var(--surface))] focus-visible:outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
          onClick={() => toggleSection(attention.section)}
        >
          <BellRing className="h-4 w-4 shrink-0 text-[var(--warning)]" />
          <span className="min-w-0 flex-1 font-medium text-[var(--text-primary)]">{attention.label}</span>
          <span className="text-xs font-semibold text-[var(--accent)]">{t('automationLayout.open')}</span>
        </button>
      ) : null}

      <div className="grid gap-3">
        <RuleAutomationSection
          state={rulesState}
          tweaks={tweaks}
          tweakCatalogStatus={tweakCatalogStatus}
          onSave={onSaveRule}
          onDelete={onDeleteRule}
          onExecute={onExecuteRule}
          onDismiss={onDismissRule}
          open={openSection === 'rules'}
          onToggle={() => toggleSection('rules')}
        />

        <ScheduledMaintenanceSection
          open={openSection === 'maintenance'}
          onToggle={() => toggleSection('maintenance')}
          onStatusChange={handleMaintenanceStatus}
        />

        <AutomationAccordionSection
          id="automation-processes"
          icon={Activity}
          title={t('automation.liveDetection')}
          description={t('automationLayout.processDescription')}
          summary={processSummary}
          open={openSection === 'processes'}
          onToggle={() => toggleSection('processes')}
          actions={(
            <div className="flex items-center gap-2">
              <StatusPill tone={alerts.length ? 'warning' : state?.enabled ? "success" : 'neutral'}>
                {alerts.length ? t('automationLayout.needsAttention') : state?.enabled ? t('automation.active') : t('automation.inactive')}
              </StatusPill>
              <Switch checked={Boolean(state?.enabled)} disabled={busy} onChange={(enabled) => update({ enabled })} ariaLabel={t('automation.liveDetection')} />
            </div>
          )}
        >
          {!state?.enabled ? (
            <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--surface))] p-5">
              <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] blur-3xl" />
              <Workflow className="h-7 w-7 text-[var(--accent)]" />
              <h2 className="mt-3 text-lg font-semibold">{t('automation.onboardingTitle')}</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">{t('automation.onboardingBody')}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]"><ShieldCheck className="h-4 w-4 text-[var(--success)]" />{t('automation.localOnly')}</div>
              <Button className="mt-4" variant="primary" loading={busy} onClick={() => update({ enabled: true })}>{t('automation.enable')}</Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <div>
                <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                  <span>{state?.lastUpdated ? t('automation.lastScan', { time: new Date(state.lastUpdated).toLocaleTimeString() }) : t('automation.waitingForScan')}</span>
                  <span>{alerts.length ? t('automationLayout.processAlerts', { count: alerts.length }) : t('automation.noAlerts')}</span>
                </div>
                {state?.lastError ? <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{state.lastError}</p> : null}
                <div className="mt-3 grid gap-2">
                  {alerts.length === 0 ? (
                    <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]"><ShieldCheck className="h-5 w-5 text-[var(--success)]" />{t('automation.noAlerts')}</div>
                  ) : alerts.map((alert) => {
                    const Icon = METRIC_ICONS[alert.metric] || BellRing;
                    return (
                      <div key={alert.id} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:flex-row sm:items-center">
                        <Icon className="h-5 w-5 shrink-0 text-[var(--warning)]" />
                        <div className="min-w-0 flex-1"><p className="truncate font-medium">{alert.processName} <span className="text-xs text-[var(--text-muted)]">PID {alert.pid}</span></p><p className="text-xs text-[var(--text-muted)]">{metricLabel(alert, t)} · {alert.durationSeconds}s</p></div>
                        <div className="flex flex-wrap gap-2">
                          {alert.canClose && !alert.forceAvailable ? <Button size="sm" variant="primary" onClick={() => onRequestClose(alert)}>{t('automation.closeProcess')}</Button> : null}
                          {alert.forceAvailable ? <Button size="sm" variant="danger" onClick={() => onForceTerminate(alert)}>{t('automation.forceTerminate')}</Button> : null}
                          <Button size="sm" variant="ghost" onClick={() => onExcludeAlert(alert)}>{t('automation.alwaysIgnore')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => onDismissAlert(alert)}>{t('automation.ignoreOnce')}</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <CompactDisclosure
                icon={Settings2}
                title={t('automation.rules')}
                summary={t('automationLayout.thresholdSummary', { active: activeDetectionRules, total: 4 })}
                open={thresholdsOpen}
                onToggle={() => setThresholdsOpen((current) => !current)}
              >
                <p className="mb-3 text-xs text-[var(--text-muted)]">{t('automation.rulesDescription')}</p>
                <div className="grid gap-3 xl:grid-cols-2">
                  <DetectionRule icon={Cpu} title={t('automation.cpuRule')} description={t('automation.cpuRuleDescription')} enabled={settings.cpuEnabled} onEnabledChange={(cpuEnabled) => update({ cpuEnabled })}>
                    <NumberField label={t('automation.threshold')} value={settings.cpuThresholdPercent} min={10} max={90} suffix="%" disabled={!settings.cpuEnabled} onChange={(cpuThresholdPercent) => update({ cpuThresholdPercent })} />
                    <NumberField label={t('automation.duration')} value={settings.cpuDurationSeconds} min={10} max={120} suffix="sec" disabled={!settings.cpuEnabled} onChange={(cpuDurationSeconds) => update({ cpuDurationSeconds })} />
                  </DetectionRule>
                  <DetectionRule icon={MemoryStick} title={t('automation.memoryRule')} description={t('automation.memoryRuleDescription', { value: state?.calculatedMemoryThresholdMB || 2048 })} enabled={settings.memoryEnabled} onEnabledChange={(memoryEnabled) => update({ memoryEnabled })}>
                    <NumberField label={t('automation.threshold')} value={settings.memoryThresholdMB} min={0} max={32768} suffix="MB" disabled={!settings.memoryEnabled} onChange={(memoryThresholdMB) => update({ memoryThresholdMB })} />
                    <NumberField label={t('automation.duration')} value={settings.memoryDurationSeconds} min={10} max={120} suffix="sec" disabled={!settings.memoryEnabled} onChange={(memoryDurationSeconds) => update({ memoryDurationSeconds })} />
                  </DetectionRule>
                  <DetectionRule icon={HardDrive} title={t('automation.diskRule')} description={t('automation.diskRuleDescription')} enabled={settings.diskEnabled} onEnabledChange={(diskEnabled) => update({ diskEnabled })}>
                    <NumberField label={t('automation.threshold')} value={settings.diskThresholdMBs} min={10} max={1000} suffix="MB/s" disabled={!settings.diskEnabled} onChange={(diskThresholdMBs) => update({ diskThresholdMBs })} />
                    <NumberField label={t('automation.duration')} value={settings.diskDurationSeconds} min={10} max={120} suffix="sec" disabled={!settings.diskEnabled} onChange={(diskDurationSeconds) => update({ diskDurationSeconds })} />
                  </DetectionRule>
                  <DetectionRule icon={Activity} title={t('automation.hangRule')} description={t('automation.hangRuleDescription')} enabled={settings.notRespondingEnabled} onEnabledChange={(notRespondingEnabled) => update({ notRespondingEnabled })}>
                    <NumberField label={t('automation.duration')} value={settings.notRespondingDurationSeconds} min={5} max={120} suffix="sec" disabled={!settings.notRespondingEnabled} onChange={(notRespondingDurationSeconds) => update({ notRespondingDurationSeconds })} />
                    <NumberField label={t('automation.cooldown')} value={settings.cooldownMinutes} min={1} max={1440} suffix="min" onChange={(cooldownMinutes) => update({ cooldownMinutes })} />
                  </DetectionRule>
                </div>
              </CompactDisclosure>

              <CompactDisclosure
                icon={Ban}
                title={t('automation.exclusions')}
                summary={exclusions.length ? t('automationLayout.exclusionSummary', { count: exclusions.length }) : t('automation.noExclusions')}
                open={exclusionsOpen}
                onToggle={() => setExclusionsOpen((current) => !current)}
              >
                <p className="mb-3 text-xs text-[var(--text-muted)]">{t('automation.exclusionsDescription')}</p>
                <div className="flex flex-wrap gap-2">
                  {exclusions.length ? exclusions.map((entry) => (
                    <button key={entry} type="button" onClick={() => update({ excludedExecutables: exclusions.filter((item) => item !== entry) })} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)]">
                      {entry}<Ban className="h-3.5 w-3.5" />
                    </button>
                  )) : <p className="text-sm text-[var(--text-muted)]">{t('automation.noExclusions')}</p>}
                </div>
              </CompactDisclosure>

              <CompactDisclosure
                icon={History}
                title={t('automation.history')}
                summary={history.length ? t('automationLayout.historySummary', { count: history.length }) : t('automation.noHistory')}
                open={historyOpen}
                onToggle={() => setHistoryOpen((current) => !current)}
                actions={historyOpen && history.length ? <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} onClick={onClearHistory}>{t('automation.clearHistory')}</Button> : null}
              >
                <p className="mb-3 text-xs text-[var(--text-muted)]">{t('automation.historyDescription')}</p>
                <div className="grid gap-2">
                  {history.length ? history.slice(0, 20).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5">
                      <Clock3 className="h-4 w-4 text-[var(--text-muted)]" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.processName}</p><p className="text-xs text-[var(--text-muted)]">{new Date(entry.createdAt).toLocaleString()} · {metricLabel(entry, t)}</p></div>
                      <StatusPill tone={entry.status === 'active' ? 'warning' : entry.status === 'closed' || entry.status === 'force-closed' ? "success" : 'neutral'}>{t(`automation.status.${entry.status}`, { defaultValue: entry.status })}</StatusPill>
                    </div>
                  )) : <p className="py-3 text-sm text-[var(--text-muted)]">{t('automation.noHistory')}</p>}
                </div>
              </CompactDisclosure>
            </div>
          )}
        </AutomationAccordionSection>
      </div>
    </PageShell>
  );
}

export default AutomationPanel;
