import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { LoadingSpinner } from './ui';

function toneClasses(tone) {
  if (tone === 'success') {
    return 'nova-toast--success';
  }
  if (tone === 'error') {
    return 'nova-toast--error';
  }
  if (tone === 'warning') {
    return 'nova-toast--warning';
  }
  if (tone === 'loading') {
    return 'nova-toast--loading';
  }
  return 'nova-toast--info';
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
    <div className={`pointer-events-none fixed right-4 ${stackTopClass} z-[130] flex ${stackMaxHeightClass} w-[min(calc(100vw-2rem),360px)] flex-col gap-2 overflow-y-auto overscroll-contain pr-1 transition-[top] duration-200`}>
      {toasts.map((toast) => {
        const Icon = toneIcon(toast.tone);
        return (
          <div
            key={toast.id}
            className={`nova-toast pointer-events-auto animate-enter w-full ${toneClasses(toast.tone)}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
              <span className="nova-toast__icon">
                {toast.tone === 'loading' ? <LoadingSpinner /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="whitespace-normal break-words text-[0.8rem] font-semibold leading-snug text-[var(--text-primary)]">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="nova-toast__dismiss"
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
