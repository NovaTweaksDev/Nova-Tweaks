import { ChevronDown } from 'lucide-react';

function AutomationAccordionSection({
  id,
  icon: Icon,
  title,
  description,
  summary,
  open,
  onToggle,
  actions = null,
  children
}) {
  const contentId = `${id}-content`;

  return (
    <section className={`overflow-hidden rounded-2xl border bg-[color:color-mix(in_srgb,var(--surface)_84%,var(--surface-strong)_16%)] transition ${
      open
        ? 'border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] shadow-[0_18px_44px_-38px_var(--accent)]'
        : 'border-[var(--border)] hover:border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border))]'
    }`}>
      <div className="flex min-h-[4.75rem] items-stretch">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left outline-none transition hover:bg-[var(--surface-hover)] focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_48%,transparent)] sm:px-5"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
            open
              ? 'border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[var(--active-layer)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]'
          }`}>
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--text-primary)] sm:text-base">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">{description}</span>
          </span>
          {summary ? <span className="hidden max-w-[42%] truncate text-xs font-medium text-[var(--text-secondary)] md:block">{summary}</span> : null}
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {actions ? <div className="flex shrink-0 items-center border-l border-[var(--border)] px-3 sm:px-4">{actions}</div> : null}
      </div>
      {open ? (
        <div id={contentId} className="motion-tab-panel border-t border-[var(--border)] p-4 sm:p-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export default AutomationAccordionSection;
