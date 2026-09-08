import { Gem } from 'lucide-react';
import { joinClasses } from './classNames';

function PremiumBadge({
  compact = false,
  locked = false,
  className = '',
  label = 'Premium'
}) {
  return (
    <span
      className={joinClasses(
        'premium-badge',
        compact && 'premium-badge--compact',
        locked && 'premium-badge--locked',
        className
      )}
      aria-label={compact ? label : undefined}
      title={label}
    >
      <Gem className="premium-badge-icon" aria-hidden="true" />
      <span className="premium-badge-text">{label}</span>
    </span>
  );
}

export default PremiumBadge;
