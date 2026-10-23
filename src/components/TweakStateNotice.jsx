import { useTranslation } from 'react-i18next';
import { Button } from './ui';
import { isTweakStateBlocked } from '../utils/tweakState.mjs';

export default function TweakStateNotice({ tweak, onRetry, compact = false }) {
  const { t } = useTranslation();
  if (!isTweakStateBlocked(tweak)) return null;
  const pending = tweak.stateCheckStatus === 'pending';
  const lastState = tweak.lastConfirmedState?.currentState;
  return (
    <div role="status" className={`${compact ? 'mt-1 text-xs' : 'my-3 rounded-lg border border-[var(--border)] p-3 text-sm'} text-[var(--text-muted)]`}>
      <p className={pending ? '' : 'text-[var(--warning)]'}>{t(`tweaks.stateCheck.${pending ? 'checking' : 'failed'}`)}</p>
      {lastState ? <p>{t('tweaks.stateCheck.lastConfirmed', { state: t(`tweaks.state.${lastState}`) })}</p> : null}
      {!compact && tweak.stateCheckError?.code ? <p className="mt-1 break-words text-xs">{tweak.stateCheckError.code}</p> : null}
      {!compact && onRetry ? <Button variant="secondary" size="sm" className="mt-2" disabled={pending} onClick={() => onRetry(tweak)}>{t(`tweaks.stateCheck.${pending ? 'checking' : 'retry'}`)}</Button> : null}
    </div>
  );
}
