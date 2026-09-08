import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { joinClasses } from './classNames';

function SearchCombobox({
  value,
  groups = [],
  onChange,
  ariaLabel = '',
  searchPlaceholder = '',
  emptyLabel = '',
  placeholderLabel = '',
  className = ''
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = useMemo(() => groups.flatMap((group) => group.options || []), [groups]);
  const selected = options.find((option) => option.value === value) || null;
  const SelectedIcon = selected?.icon;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = useMemo(
    () => groups
      .map((group) => ({
        ...group,
        options: (group.options || []).filter((option) => {
          if (!normalizedQuery) return true;
          return `${option.label} ${option.keywords || ''}`.toLocaleLowerCase().includes(normalizedQuery);
        })
      }))
      .filter((group) => group.options.length),
    [groups, normalizedQuery]
  );

  function select(nextValue) {
    onChange?.(nextValue);
    setOpen(false);
    setQuery('');
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery('');
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={joinClasses(
            'nova-dropdown-trigger flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-left text-sm text-[var(--text-primary)] outline-none transition hover:border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] focus-visible:shadow-[var(--ui-focus-ring)]',
            className
          )}
        >
          {SelectedIcon ? <SelectedIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" /> : null}
          <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-[var(--text-muted)]'}`}>{selected?.label || placeholderLabel}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          aria-label={ariaLabel}
          className="nova-dropdown-content z-[320] w-[min(25rem,var(--radix-popover-trigger-width))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-2.5 pb-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div className="mt-1 max-h-72 overflow-y-auto pr-0.5">
            {visibleGroups.length ? visibleGroups.map((group) => (
              <div key={group.id} className="py-1">
                <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {group.icon ? <group.icon className="h-3 w-3" aria-hidden="true" /> : null}
                  {group.label}
                </p>
                {group.options.map((option) => {
                  const active = option.value === value;
                  const OptionIcon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => select(option.value)}
                      className={`nova-dropdown-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] ${
                        active ? 'is-active ' : ''
                      }${
                        active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {OptionIcon ? (
                        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                          active
                            ? 'border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--surface))]'
                            : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]'
                        }`}>
                          <OptionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {active ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            )) : <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">{emptyLabel}</p>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export default SearchCombobox;
