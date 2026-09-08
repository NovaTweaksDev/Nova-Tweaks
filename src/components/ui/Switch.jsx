import { joinClasses } from './classNames';

function Switch({
  checked = false,
  onChange,
  disabled = false,
  className = '',
  ariaLabel = '',
  onLabel = '',
  offLabel = ''
}) {
  function toggle() {
    if (disabled) {
      return;
    }
    onChange?.(!checked);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || (checked ? onLabel : offLabel) || undefined}
      disabled={disabled}
      onClick={toggle}
      className={joinClasses('ui-switch', className)}
    >
      <span className="ui-switch-thumb">
        {checked ? (
          <svg viewBox="0 0 20 20" className="ui-switch-icon" aria-hidden="true">
            <path
              d="M5.25 10.25l2.7 2.7 6.8-6.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}

export default Switch;
