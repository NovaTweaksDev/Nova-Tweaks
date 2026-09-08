import { useTranslation } from 'react-i18next';
import {
  AppWindow,
  Check,
  CheckCircle2,
  CircleX,
  Gauge,
  Info,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Wrench,
  TriangleAlert,
  X
} from 'lucide-react';
import { Button, LoadingSpinner, ModalShell } from './ui';

const FINAL_STATUSES = new Set(['success', 'partial', 'error', 'cancelled']);

function formatBytes(bytes, language) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: value >= 1024 ** 2 ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1
  }).format(value >= 1024 ** 2 ? value / 1024 ** 2 : value / 1024);
}

function AppIdentity({ app, operation }) {
  const icon = app?.iconDataUrl || operation?.appIconDataUrl || '';
  const name = app?.name || operation?.appName || '';
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--accent)]">
        {icon ? <img src={icon} alt="" className="h-full w-full object-cover" /> : <AppWindow className="h-4.5 w-4.5" />}
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

function StatusCounter({ icon: Icon, label, value, tone = 'muted' }) {
  const toneClass = tone === 'success'
    ? 'text-[var(--success)]'
    : tone === 'danger'
      ? 'text-[var(--danger)]'
      : 'text-[var(--text-muted)]';
  return (
    <div className="min-w-0 px-3 py-1 first:pl-0 last:pr-0">
      <p className={`flex items-center gap-1.5 text-[11px] font-medium ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function ActionCard({ action, busy, onApply }) {
  const { t } = useTranslation();
  const changed = Boolean(action?.needsChange);
  const label = t(`apps.optimization.actions.${action?.id}`, { defaultValue: action?.label || action?.id });
  const description = t(`apps.optimization.actionDescriptions.${action?.id}`, {
    defaultValue: action?.description || (changed
      ? t('apps.optimization.changeAvailable', { defaultValue: 'A safe optimization is available.' })
      : t('apps.optimization.alreadyApplied', { defaultValue: 'Already configured.' }))
  });
  return (
    <article className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-1 py-3.5 last:border-b-0">
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
        changed
          ? 'bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
          : 'bg-[color:color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]'
      }`}>
        {changed ? <Gauge className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {changed ? description : t('apps.optimization.alreadyApplied', { defaultValue: 'Already configured.' })}
        </p>
        {changed && action?.reversible === false ? (
          <p className="mt-1 text-[11px] text-[var(--warning)]">{t('apps.optimization.notReversible', { defaultValue: 'Cannot be undone' })}</p>
        ) : null}
      </div>
      {changed ? (
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onApply?.(action.id)}>
          {busy ? <LoadingSpinner /> : t('apps.optimization.apply', { defaultValue: 'Apply' })}
        </Button>
      ) : null}
    </article>
  );
}

function DetailsView({ state, onApplyRecommended, onApplyAction, onReset }) {
  const { t } = useTranslation();
  const optimization = state?.analysis?.optimization || {};
  const sourceActions = Array.isArray(optimization.actions) ? optimization.actions : [];
  const cacheOnly = state?.scope === 'cache';
  const actions = sourceActions.filter((action) => cacheOnly
    ? action?.id === 'cache.cleanup'
    : action?.kind !== 'startup' && action?.id !== 'startup.disable');
  const recommendedActionIds = actions
    .filter((action) => action?.recommended && action?.needsChange && action?.reversible !== false)
    .map((action) => action.id);
  const recommendedCount = recommendedActionIds.length;
  const restoreAvailable = !cacheOnly && Boolean(optimization.restoreAvailable);
  const restoreCount = Number(optimization.restoreCount) || 0;
  const profileId = optimization.profileId || state?.app?.optimization?.profileId || '';
  const description = cacheOnly
    ? t('apps.optimization.cacheDescription', { defaultValue: 'Removes only known temporary cache data. App settings, sessions and personal files remain untouched.' })
    : t(`apps.optimization.profiles.${profileId}`, {
        defaultValue: optimization.description || state?.app?.optimization?.description || ''
      });

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--border)] pb-4">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text-primary)]">
            {recommendedCount
              ? t('apps.optimization.readyTitle', { count: recommendedCount, defaultValue: `${recommendedCount} changes available` })
              : t('apps.optimization.checkedTitle', { defaultValue: 'No changes pending' })}
          </p>
          <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{description}</p>
        </div>
        {optimization.managedSettings ? (
          <div className="mt-3 flex items-start gap-2 text-xs text-[var(--text-muted)]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span>{t('apps.optimization.managedNotice', { defaultValue: 'Browser settings use official Windows policies. Nova saves their previous values so they can be restored.' })}</span>
          </div>
        ) : null}
      </div>

      {actions.length ? (
        <div className="max-h-[19rem] overflow-y-auto pr-1">
          {actions.map((action) => <ActionCard key={action.id} action={action} busy={state.busy} onApply={onApplyAction} />)}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm leading-5 text-[var(--text-secondary)]">
            {t('apps.optimization.statusOnlyDescription', { defaultValue: 'Nova monitors the installation and runtime status. No stable automatic setting is changed for this app.' })}
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={state.busy || !restoreAvailable} onClick={onReset} leftIcon={<RotateCcw className="h-4 w-4" />}>
          {restoreAvailable
            ? t('apps.optimization.restoreCount', { count: restoreCount, defaultValue: `Restore ${restoreCount} saved settings` })
            : t('apps.optimization.noRestorePoint', { defaultValue: 'No saved settings' })}
        </Button>
        {recommendedCount > 0 ? (
          <Button type="button" variant="primary" size="md" disabled={state.busy} onClick={() => onApplyRecommended?.(recommendedActionIds)} leftIcon={state.busy ? <LoadingSpinner /> : <Wrench className="h-4 w-4" />}>
            {t('apps.optimization.applyRecommended', { count: recommendedCount, defaultValue: `Apply ${recommendedCount} changes` })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ProgressView({ state, onConfirmClose, onCancel }) {
  const { t, i18n } = useTranslation();
  const operation = state?.operation || {};
  const total = Math.max(0, Number(operation.total) || 0);
  const current = Math.max(0, Math.min(total, Number(operation.current) || 0));
  const progress = total ? Math.round((current / total) * 100) : operation.phase === 'success' ? 100 : 4;
  const final = FINAL_STATUSES.has(operation.status);
  const waiting = operation.phase === 'waiting-close';
  const error = operation.status === 'error';
  const partial = operation.status === 'partial';
  const cancelled = operation.status === 'cancelled';
  const tone = error ? 'var(--danger)' : partial || waiting ? 'var(--warning)' : final ? 'var(--success)' : 'var(--accent)';
  const PhaseIcon = error ? CircleX : partial || waiting ? TriangleAlert : final ? CheckCircle2 : Loader2;
  const phaseLabel = t(`apps.optimization.phases.${operation.phase}`, {
    defaultValue: operation.phase === 'waiting-close' ? 'App must be closed' : operation.currentStepName || 'Optimizing'
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-strong)]">
            <PhaseIcon className={`h-4.5 w-4.5 ${!final && !waiting ? 'animate-spin' : ''}`} style={{ color: tone }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold" style={{ color: tone }}>{phaseLabel}</p>
              <span className="text-xs tabular-nums text-[var(--text-muted)]">
                {total ? t('apps.optimization.step', { current, total, defaultValue: `Step ${current} of ${total}` }) : `${progress}%`}
              </span>
            </div>
            <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
              {operation.currentStepName || operation.message || t('apps.optimization.preparingDescription', { defaultValue: 'Checking the current app configuration…' })}
            </p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)]">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${progress}%`, background: tone }} />
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] pt-3">
            <StatusCounter icon={Check} label={t('apps.optimization.applied', { defaultValue: 'Applied' })} value={Number(operation.applied) || 0} tone="success" />
            <StatusCounter icon={RotateCcw} label={t('apps.optimization.skipped', { defaultValue: 'Skipped' })} value={Number(operation.skipped) || 0} />
            <StatusCounter icon={X} label={t('apps.optimization.failed', { defaultValue: 'Failed' })} value={Number(operation.failed) || 0} tone={operation.failed ? 'danger' : 'muted'} />
        </div>
      </div>

      {final && Array.isArray(operation.failures) && operation.failures.length > 0 ? (
        <div className="border-l-2 border-[var(--danger)] pl-3">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {t('apps.optimization.failedChangesTitle', { defaultValue: 'Some changes could not be applied' })}
          </p>
          <div className="mt-2 space-y-2">
            {operation.failures.map((failure) => (
              <div key={`${failure.actionId}:${failure.code}`}>
                <p className="text-xs font-medium text-[var(--text-secondary)]">{failure.actionName || failure.actionId}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{failure.message}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {waiting ? (
        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_9%,var(--surface-elevated))] p-4">
          <p className="font-semibold text-[var(--text-primary)]">{t('apps.optimization.closeTitle', { name: operation.appName, defaultValue: `Close ${operation.appName}?` })}</p>
          <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
            {operation.closeFailed
              ? t('apps.optimization.closeManual', { name: operation.appName, defaultValue: `Please close ${operation.appName} manually, then retry.` })
              : t('apps.optimization.closeDescription', { defaultValue: 'The cache can only be cleaned safely while the app is closed. Unsaved work may be lost.' })}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t('common.cancel')}</Button>
            <Button type="button" variant="primary" size="sm" onClick={onConfirmClose}>{t('apps.optimization.closeAndContinue', { defaultValue: 'Close app and continue' })}</Button>
          </div>
        </div>
      ) : null}

      {final && !cancelled && (operation.removedBytes > 0 || operation.requiresRestart || operation.managedSettings) ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {operation.removedBytes > 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-sm"><span className="text-[var(--text-muted)]">{t('apps.optimization.cacheFreed', { defaultValue: 'Cache freed' })}</span><strong className="ml-2 text-[var(--text-primary)]">{formatBytes(operation.removedBytes, i18n.language)}</strong></div> : null}
          {operation.requiresRestart ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-secondary)]">{t('apps.optimization.restartApp', { defaultValue: 'Restart the app to activate every change.' })}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function AppOptimizationModal({
  state,
  onClose,
  onApplyRecommended,
  onApplyAction,
  onConfirmClose,
  onCancel,
  onReset
}) {
  const { t } = useTranslation();
  const progressView = state?.view === 'progress';
  const operation = state?.operation || {};
  const final = progressView && FINAL_STATUSES.has(operation.status);
  const closeDisabled = progressView && !final && operation.phase !== 'waiting-close';
  const canCancel = progressView
    && Boolean(operation.operationId)
    && !final
    && operation.phase !== 'waiting-close'
    && operation.canCancel !== false;
  const footer = final
    ? <Button type="button" variant="primary" onClick={onClose}>{t('common.done', { defaultValue: 'Done' })}</Button>
    : canCancel
      ? <Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
      : null;

  return (
    <ModalShell
      open={Boolean(state?.open)}
      title={<AppIdentity app={state?.app || state?.analysis?.app} operation={operation} />}
      description={progressView
        ? t('apps.optimization.progressDescription', { defaultValue: 'Nova applies only the selected, stable optimizations.' })
        : t('apps.optimization.detailsDescription', { defaultValue: 'Review detected settings and safe actions.' })}
      onClose={onClose}
      closeDisabled={closeDisabled}
      closeOnBackdrop={!closeDisabled}
      closeOnEscape={!closeDisabled}
      showCloseButton={!closeDisabled}
      size="lg"
      overlayClassName="z-[155]"
      footer={footer}
    >
      {state?.error ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--danger)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_8%,var(--surface-elevated))] p-3 text-sm text-[var(--danger)]">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      {state?.busy && !progressView ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" /></div>
      ) : progressView ? (
        <ProgressView state={state} onConfirmClose={onConfirmClose} onCancel={onCancel} />
      ) : (
        <DetailsView state={state} onApplyRecommended={onApplyRecommended} onApplyAction={onApplyAction} onReset={onReset} />
      )}
    </ModalShell>
  );
}

export default AppOptimizationModal;
