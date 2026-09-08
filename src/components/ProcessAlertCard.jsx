import { AlertTriangle, Ban, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, StatusPill } from './ui';

function metricText(alert, t) {
  if (alert.metric === 'cpu') return t('automation.metricCpu', { value: alert.value });
  if (alert.metric === 'memory') return t('automation.metricMemory', { value: alert.value });
  if (alert.metric === 'disk') return t('automation.metricDisk', { value: alert.value });
  return t('automation.metricNotResponding');
}

function ProcessAlertCard({ alert, onClose, onDismiss, onForce, onOpen }) {
  const { t } = useTranslation();
  if (!alert) return null;

  return (
    <aside className="fixed right-5 top-20 z-[65] w-[min(25rem,calc(100vw-2rem))] animate-enter rounded-2xl border border-[color:color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-[color:color-mix(in_srgb,var(--surface-strong)_94%,transparent)] p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-[color:color-mix(in_srgb,var(--warning)_18%,transparent)] p-2 text-[var(--warning)]">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--text-primary)]">{t('automation.alertTitle')}</p>
              <p className="mt-0.5 truncate text-sm font-medium">{alert.processName} <span className="text-[var(--text-muted)]">· PID {alert.pid}</span></p>
            </div>
            <button type="button" onClick={() => onDismiss(alert)} className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" aria-label={t('common.close')}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {t('automation.alertBody', { metric: metricText(alert, t), seconds: alert.durationSeconds })}
          </p>
          {alert.protected ? (
            <StatusPill tone="neutral" className="mt-3"><ShieldCheck className="h-3.5 w-3.5" />{t('automation.protected')}</StatusPill>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {alert.canClose && !alert.forceAvailable ? (
              <Button size="sm" variant="primary" onClick={() => onClose(alert)}>{t('automation.closeProcess')}</Button>
            ) : null}
            {alert.forceAvailable ? (
              <Button size="sm" variant="danger" leftIcon={<Ban className="h-4 w-4" />} onClick={() => onForce(alert)}>{t('automation.forceTerminate')}</Button>
            ) : null}
            <Button size="sm" variant="ghost" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={onOpen}>{t('automation.openAutomation')}</Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default ProcessAlertCard;
