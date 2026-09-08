import { joinClasses } from './classNames';

function ChoiceCards({
  value,
  options = [],
  onChange,
  ariaLabel = '',
  className = ''
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel || undefined}
      className={joinClasses('grid gap-2 sm:grid-cols-2', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(option.value)}
            className={`group flex min-h-[5.5rem] items-start gap-3 rounded-xl border p-3 text-left outline-none transition ${
              active
                ? 'border-[color:color-mix(in_srgb,var(--accent)_46%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] shadow-[0_10px_28px_-24px_var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)] hover:border-[color:color-mix(in_srgb,var(--accent)_26%,var(--border))] hover:bg-[var(--surface-hover)]'
            } focus-visible:shadow-[var(--ui-focus-ring)]`}
          >
            {Icon ? (
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                active
                  ? 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] group-hover:text-[var(--accent)]'
              }`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">{option.label}</span>
                {option.badge ? (
                  <span className={`rounded-full px-2 py-0.5 text-[0.62rem] font-semibold ${
                    option.tone === 'warning'
                      ? 'bg-[color:color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]'
                      : 'bg-[var(--surface-elevated)] text-[var(--text-muted)]'
                  }`}>{option.badge}</span>
                ) : null}
              </span>
              {option.description ? <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{option.description}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default ChoiceCards;
