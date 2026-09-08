import { useTranslation } from 'react-i18next';
import {
  BrushCleaning,
  Check,
  CheckCircle2,
  CircleX,
  Cpu,
  HardDrive,
  Loader2,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Wifi
} from 'lucide-react';
import { Button, ModalShell } from './ui';

const OPTIMIZATION_ICONS = {
  cleanup: BrushCleaning,
  network: Wifi,
  cpu: Cpu,
  storage: HardDrive
};

function ResultCounter({ icon: Icon, label, value, tone }) {
  const toneClass = tone === 'success'
    ? 'text-[var(--success)]'
    : tone === 'danger'
      ? 'text-[var(--danger)]'
      : 'text-[var(--text-muted)]';

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className="mt-1 font-tech text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function OneClickOptimizationModal({ state, onClose }) {
  const { t } = useTranslation();
  const open = Boolean(state?.open);
  const running = Boolean(state?.runningId);
  const optimizationId = state?.runningId || state?.completedId || state?.optimizationId || 'cleanup';
  const OptimizationIcon = OPTIMIZATION_ICONS[optimizationId] || BrushCleaning;
  const total = Math.max(0, Number(state?.total) || 0);
  const current = Math.max(0, Math.min(total, Number(state?.current) || 0));
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;
  const phase = state?.phase || 'preparing';
  const failed = Number(state?.failed) || 0;
  const successful = Number(state?.successful) || 0;
  const skipped = Number(state?.skipped) || 0;
  const finished = !running && ['success', 'partial', 'error'].includes(phase);
  const phaseIsError = phase === 'error';
  const phaseIsPartial = phase === 'partial';
  const PhaseIcon = running
    ? phase === 'backup' ? ShieldCheck : Loader2
    : phaseIsError
      ? CircleX
      : phaseIsPartial
        ? TriangleAlert
        : CheckCircle2;
  const phaseTone = phaseIsError
    ? 'var(--danger)'
    : phaseIsPartial
      ? 'var(--warning)'
      : finished
        ? 'var(--success)'
        : 'var(--accent)';
  const phaseLabel = running
    ? t(`tweaks.oneClick.modal.phases.${phase}`, { defaultValue: t('tweaks.oneClick.modal.phases.applying') })
    : phaseIsError
      ? t('tweaks.oneClick.modal.failedTitle')
      : phaseIsPartial
        ? t('tweaks.oneClick.modal.partialTitle')
        : t('tweaks.oneClick.modal.successTitle');
  const statusMessage = running
    ? phase === 'backup'
      ? t('tweaks.oneClick.modal.backupDescription')
      : state?.currentTweakName || t('tweaks.oneClick.modal.preparingDescription')
    : state?.message || t('tweaks.oneClick.summary', { successful, failed, skipped });

  return (
    <ModalShell
      open={open}
      title={(
        <span className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--surface-elevated))] text-[var(--accent)]">
            <OptimizationIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>{t(`tweaks.oneClick.${optimizationId}.title`)}</span>
        </span>
      )}
      description={t('tweaks.oneClick.modal.description')}
      onClose={onClose}
      closeDisabled={running}
      closeOnBackdrop={!running}
      closeOnEscape={!running}
      showCloseButton={!running}
      size="md"
      overlayClassName="z-[150]"
      contentClassName="overflow-hidden"
      footer={finished ? (
        <Button type="button" variant={phaseIsError ? 'danger' : 'primary'} size="md" onClick={onClose}>
          {t('tweaks.oneClick.modal.done')}
        </Button>
      ) : null}
    >
      <div className="relative overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border))] bg-[var(--surface-elevated)] p-5">
        <div
          className="pointer-events-none absolute left-1/2 top-8 h-48 w-48 -translate-x-1/2 rounded-full opacity-30 blur-3xl motion-safe:animate-pulse"
          style={{ background: phaseTone }}
          aria-hidden="true"
        />

        <div className="relative flex flex-col items-center text-center">
          <div
            className="relative flex h-36 w-36 items-center justify-center rounded-full p-[7px] shadow-[0_0_36px_color-mix(in_srgb,var(--one-click-tone)_24%,transparent)] transition-[background] duration-500"
            style={{
              '--one-click-tone': phaseTone,
              background: `conic-gradient(${phaseTone} ${running ? progress : finished ? 100 : 0}%, color-mix(in srgb, var(--surface-strong) 82%, transparent) 0)`
            }}
          >
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-strong)_94%,transparent)] shadow-inner">
              {running ? (
                <>
                  <span className="font-tech text-3xl font-semibold tabular-nums text-[var(--text-primary)]">{progress}%</span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {total ? t('tweaks.oneClick.modal.step', { current, total }) : t('tweaks.oneClick.modal.preparing')}
                  </span>
                </>
              ) : (
                <PhaseIcon className="h-12 w-12 animate-execution-icon" style={{ color: phaseTone }} aria-hidden="true" />
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 text-sm font-semibold" style={{ color: phaseTone }}>
            <PhaseIcon className={`h-4 w-4 ${running && phase !== 'backup' ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{phaseLabel}</span>
          </div>
          <p className="mt-2 min-h-10 max-w-md text-sm leading-5 text-[var(--text-secondary)]">{statusMessage}</p>

          <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-strong)]">
            <div
              className="h-full rounded-full transition-[width,background-color] duration-500"
              style={{ width: `${running ? progress : finished ? 100 : 0}%`, backgroundColor: phaseTone }}
            />
          </div>

          <div className="mt-4 grid w-full grid-cols-3 gap-2 text-left">
            <ResultCounter icon={Check} label={t('tweaks.oneClick.modal.applied')} value={successful} tone="success" />
            <ResultCounter icon={RotateCcw} label={t('tweaks.oneClick.modal.skipped')} value={skipped} />
            <ResultCounter icon={CircleX} label={t('tweaks.oneClick.modal.failed')} value={failed} tone={failed ? 'danger' : undefined} />
          </div>

          {finished && state?.requiresRestart ? (
            <div className="mt-4 flex w-full items-start gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_9%,var(--surface-elevated))] px-3.5 py-3 text-left">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">{t('tweaks.oneClick.modal.restartTitle')}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t('tweaks.oneClick.modal.restartDescription')}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}

export default OneClickOptimizationModal;
