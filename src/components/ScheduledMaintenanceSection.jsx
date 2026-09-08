import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppWindow,
  BrushCleaning,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  HardDrive,
  Play,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { Button, LoadingIndicator, SegmentedControl, StatusPill, Switch } from './ui';
import AutomationAccordionSection from './AutomationAccordionSection';

const TASKS = [
  { id: 'cleanup', icon: BrushCleaning },
  { id: 'app-cache', icon: AppWindow },
  { id: 'drive', icon: HardDrive }
];

function formatDate(value, language) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function TaskCard({ task, index, last, selected, disabled, onToggle }) {
  const { t } = useTranslation();
  const Icon = task.icon;
  return (
    <article className="maintenance-task-route" data-selected={selected ? 'true' : 'false'}>
      <span className="maintenance-task-route__rail" aria-hidden="true">
        <span className="maintenance-task-route__node">
          {selected ? <Check className="h-3.5 w-3.5" /> : <span>{index + 1}</span>}
        </span>
        {!last ? <span className="maintenance-task-route__line" /> : null}
      </span>
      <div className="maintenance-task-route__body">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-[var(--active-layer)] text-[var(--accent)]' : 'bg-[var(--surface-elevated)] text-[var(--text-muted)]'}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text-primary)]">{t(`scheduledMaintenance.tasks.${task.id}.title`)}</span>
          <span className="mt-0.5 block text-xs leading-4 text-[var(--text-muted)]">{t(`scheduledMaintenance.tasks.${task.id}.description`)}</span>
        </span>
        <Switch checked={selected} disabled={disabled} onChange={() => onToggle(task.id)} ariaLabel={t(`scheduledMaintenance.tasks.${task.id}.title`)} />
      </div>
    </article>
  );
}

function ScheduledMaintenanceSection({ open, onToggle, onStatusChange }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.desktopApi?.getScheduledMaintenanceState?.()
      .then((result) => {
        if (mounted && result?.state) setState(result.state);
      })
      .catch(() => {});
    const unsubscribe = window.desktopApi?.onScheduledMaintenanceUpdate?.((nextState) => {
      if (mounted && nextState) setState(nextState);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const schedule = state?.schedule || {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 0,
    time: '03:00',
    tasks: ['cleanup', 'app-cache', 'drive']
  };
  const selectedTasks = useMemo(() => new Set(schedule.tasks || []), [schedule.tasks]);

  async function update(patch) {
    const previousState = state;
    const optimisticSchedule = { ...schedule, ...patch };
    setState((current) => ({
      ...(current || {}),
      schedule: optimisticSchedule
    }));
    setBusy(true);
    setError('');
    try {
      if (!window.desktopApi?.updateScheduledMaintenance) {
        throw new Error('MAINTENANCE_API_UNAVAILABLE');
      }
      const result = await window.desktopApi.updateScheduledMaintenance({
        schedule: optimisticSchedule
      });
      if (result?.state) setState(result.state);
      if (!result?.ok) {
        setState(previousState);
        setError(result?.message || t('scheduledMaintenance.updateFailed'));
      }
    } catch (_error) {
      setState(previousState);
      setError(t('scheduledMaintenance.updateFailed'));
    } finally {
      setBusy(false);
    }
  }

  function toggleTask(taskId) {
    const next = selectedTasks.has(taskId)
      ? schedule.tasks.filter((entry) => entry !== taskId)
      : [...schedule.tasks, taskId];
    void update({ tasks: next });
  }

  async function runNow() {
    setBusy(true);
    setError('');
    try {
      const result = await window.desktopApi?.runScheduledMaintenanceNow?.();
      if (result?.state) setState(result.state);
      if (!result?.ok) setError(
        result?.code === 'GAME_ACTIVE'
          ? t('scheduledMaintenance.gameActive')
          : result?.code === 'AUTH_REQUIRED'
            ? t('scheduledMaintenance.authRequired')
            : result?.message || t('scheduledMaintenance.runFailed')
      );
    } catch (_error) {
      setError(t('scheduledMaintenance.runFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    const result = await window.desktopApi?.clearScheduledMaintenanceHistory?.();
    if (result?.state) setState(result.state);
  }

  const running = Boolean(state?.running);
  const nextRun = formatDate(state?.nextRunAt, i18n.language);
  const history = Array.isArray(state?.history) ? state.history : [];
  const selectedTaskCount = schedule.tasks?.length || 0;

  useEffect(() => {
    onStatusChange?.({
      loaded: state !== null,
      running,
      enabled: schedule.enabled,
      nextRunAt: state?.nextRunAt || null,
      selectedTaskCount
    });
  }, [onStatusChange, running, schedule.enabled, selectedTaskCount, state, state?.nextRunAt]);

  const summary = running
    ? t('scheduledMaintenance.running.default')
    : schedule.enabled && nextRun
      ? t('automationLayout.maintenanceSummary', { count: selectedTaskCount, date: nextRun })
      : t('automationLayout.maintenancePaused', { count: selectedTaskCount });

  return (
    <AutomationAccordionSection
      id="automation-maintenance"
      icon={CalendarClock}
        title={t('scheduledMaintenance.title')}
        description={t('scheduledMaintenance.description')}
      summary={summary}
      open={open}
      onToggle={onToggle}
        actions={(
        <div className="flex items-center gap-2">
            <StatusPill tone={running ? 'warning' : schedule.enabled ? 'success' : 'neutral'}>{running ? t('automationLayout.running') : schedule.enabled ? t('scheduledMaintenance.active') : t('scheduledMaintenance.paused')}</StatusPill>
            <Switch checked={schedule.enabled} disabled={busy || running} onChange={(enabled) => void update({ enabled })} ariaLabel={t('scheduledMaintenance.title')} />
          </div>
        )}
    >

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t('scheduledMaintenance.tasksTitle')}</p>
          <div className="maintenance-task-route-list">
            {TASKS.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                last={index === TASKS.length - 1}
                selected={selectedTasks.has(task.id)}
                disabled={busy || running}
                onToggle={toggleTask}
              />
            ))}
          </div>
        </div>

        <div className="maintenance-schedule-console">
          <div className="maintenance-schedule-orb">
            <span className="maintenance-schedule-orb__ring" aria-hidden="true" />
            <CalendarClock className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div className="mt-3 text-center">
            <p className="text-sm font-semibold">{t('scheduledMaintenance.scheduleTitle')}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{nextRun ? t('scheduledMaintenance.nextRun', { date: nextRun }) : t('scheduledMaintenance.noNextRun')}</p>
          </div>
          <div className="mt-4">
            <SegmentedControl
              value={schedule.frequency}
              onChange={(frequency) => void update({ frequency })}
              ariaLabel={t('scheduledMaintenance.frequency')}
              options={[
                { id: 'daily', label: t('scheduledMaintenance.daily'), disabled: busy || running },
                { id: 'weekly', label: t('scheduledMaintenance.weekly'), disabled: busy || running }
              ]}
            />
          </div>
          {schedule.frequency === 'weekly' ? (
            <div className="mt-3 grid grid-cols-7 gap-1" aria-label={t('scheduledMaintenance.day')}>
              {Array.from({ length: 7 }, (_, day) => (
                <button
                  key={day}
                  type="button"
                  disabled={busy || running}
                  onClick={() => void update({ dayOfWeek: day })}
                  className={`maintenance-day-chip ${Number(schedule.dayOfWeek) === day ? 'is-active' : ''}`}
                  title={t(`scheduledMaintenance.days.${day}`)}
                >
                  {t(`scheduledMaintenance.days.${day}`).slice(0, 1)}
                </button>
              ))}
            </div>
          ) : null}
          <label className="mt-4 block text-center text-xs text-[var(--text-muted)]">
            {t('scheduledMaintenance.time')}
            <input className="maintenance-time-input" type="time" value={schedule.time} disabled={busy || running} onChange={(event) => void update({ time: event.target.value })} />
          </label>
          <Button className="mt-3 w-full" size="sm" variant="primary" disabled={busy || running || !schedule.tasks.length} leftIcon={<Play className="h-4 w-4" />} onClick={runNow}>
            {t('scheduledMaintenance.runNow')}
          </Button>
        </div>
      </div>

      {running ? (
        <div className="mt-4 rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[var(--active-layer)] p-3">
          <LoadingIndicator compact label={t(`scheduledMaintenance.running.${state.currentTask}`, { defaultValue: t('scheduledMaintenance.running.default') })} />
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-elevated)]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${state.progress || 0}%` }} /></div>
        </div>
      ) : null}
      {error ? <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="mt-5 border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2 text-left outline-none focus-visible:shadow-[var(--ui-focus-ring)]"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((current) => !current)}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-elevated)] text-[var(--text-muted)]"><Clock3 className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t('scheduledMaintenance.history')}</span>
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                {history.length ? formatDate(history[0].completedAt, i18n.language) : t('scheduledMaintenance.noHistory')}
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyOpen && history.length ? <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={clearHistory}>{t('scheduledMaintenance.clearHistory')}</Button> : null}
        </div>
        {historyOpen ? <div className="mt-2 grid gap-2">
        {history.length ? history.slice(0, 5).map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5">
            <ShieldCheck className={`h-4 w-4 shrink-0 ${entry.status === 'success' ? 'text-[var(--success)]' : entry.status === 'partial' ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t(`scheduledMaintenance.sources.${entry.source}`)}</p>
              <p className="text-xs text-[var(--text-muted)]">{formatDate(entry.completedAt, i18n.language)} · {t('scheduledMaintenance.result', { successful: entry.successful, failed: entry.failed })}</p>
            </div>
            <StatusPill tone={entry.status === 'success' ? 'success' : entry.status === 'partial' ? 'warning' : 'danger'}>{t(`scheduledMaintenance.status.${entry.status}`)}</StatusPill>
          </div>
        )) : <p className="py-3 text-sm text-[var(--text-muted)]">{t('scheduledMaintenance.noHistory')}</p>}
        </div> : null}
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">{t('scheduledMaintenance.backgroundNote')}</p>
    </AutomationAccordionSection>
  );
}

export default ScheduledMaintenanceSection;
