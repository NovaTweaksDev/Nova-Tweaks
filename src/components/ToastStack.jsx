import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { LoadingSpinner } from './ui';

function toneClasses(tone) {
  if (tone === 'success') {
    return 'border-[color:color-mix(in_srgb,var(--success)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--success)_12%,var(--surface)_88%)] text-[var(--success)]';
  }
  if (tone === 'error') {
    return 'border-[color:color-mix(in_srgb,var(--danger)_36%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_13%,var(--surface)_87%)] text-[var(--danger)]';
  }
  if (tone === 'warning') {
    return 'border-[color:color-mix(in_srgb,var(--warning)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_12%,var(--surface)_88%)] text-[var(--warning)]';
  }
  if (tone === 'loading') {
    return 'border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] text-[var(--accent)]';
  }
  return 'border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] text-[var(--accent)]';
}

function toneIcon(tone) {
  if (tone === 'success') {
    return CheckCircle2;
  }
  if (tone === 'error') {
    return AlertCircle;
  }
  if (tone === 'warning') {
    return AlertTriangle;
  }
  return Info;
}

function ToastStack({ toasts, onDismiss, offsetTop = false }) {
  const { t } = useTranslation();

  if (!toasts.length) {
    return null;
  }

  const stackTopClass = offsetTop ? 'top-[9.25rem]' : 'top-[3.25rem]';
  const stackMaxHeightClass = offsetTop ? 'max-h-[calc(100vh-10.25rem)]' : 'max-h-[calc(100vh-4.25rem)]';

  return (
    <div className={`pointer-events-none fixed right-4 ${stackTopClass} z-[130] flex ${stackMaxHeightClass} w-[min(calc(100vw-2rem),390px)] flex-col gap-3 overflow-y-auto overscroll-contain pr-1 transition-[top] duration-200`}>
      {toasts.map((toast) => {
        const Icon = toneIcon(toast.tone);
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto animate-enter w-full overflow-hidden rounded-xl border px-3.5 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.24)] backdrop-blur ${toneClasses(toast.tone)}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/30 bg-[color:color-mix(in_srgb,currentColor_10%,transparent)]">
                {toast.tone === 'loading' ? <LoadingSpinner /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="whitespace-normal break-words text-sm font-semibold leading-snug text-[var(--text-primary)]">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current opacity-70 transition hover:bg-current/10 hover:opacity-100 focus:outline-none focus:shadow-[var(--ui-focus-ring)]"
                aria-label={t('common.close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ToastStack;
