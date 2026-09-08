import { BellRing, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function RuleNotificationOverlay({ notifications = [], onDismiss }) {
  const { t } = useTranslation();
  const visibleNotifications = notifications.slice(-3);

  if (!visibleNotifications.length) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[135] flex items-center justify-center p-4">
      <div className="flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-3">
        {visibleNotifications.map((notification) => (
          <section
            key={notification.id}
            className="pointer-events-auto animate-enter overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_48%,var(--border))] bg-[color:color-mix(in_srgb,var(--surface-strong)_94%,transparent)] shadow-[0_28px_80px_rgba(0,0,0,0.48),0_0_42px_color-mix(in_srgb,var(--accent)_16%,transparent)] backdrop-blur-xl"
            role="alert"
            aria-live="assertive"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 p-5">
              <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
                <span className="absolute inset-0 animate-ping rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] opacity-35" aria-hidden="true" />
                <BellRing className="relative h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                  {t('ruleAutomation.notificationTitle', { defaultValue: 'Rule triggered' })}
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]">
                  {notification.ruleName}
                </h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--text-secondary)]">
                  {notification.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss?.(notification.id)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--hover-layer)] hover:text-[var(--text-primary)] focus:outline-none focus:shadow-[var(--ui-focus-ring)]"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-1 bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)]">
              <div className="rule-notification-countdown h-full origin-left bg-[var(--accent)]" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default RuleNotificationOverlay;
