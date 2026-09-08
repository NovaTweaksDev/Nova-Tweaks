import i18n from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Command, Search, X } from 'lucide-react';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function CommandPalette({ open, commands = [], onClose, title = i18n.t('commandPalette.open'), placeholder = i18n.t('commandPalette.placeholder') }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const filteredCommands = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return commands;
    return commands.filter((command) => normalize([
      command.label,
      command.description,
      command.group,
      command.keywords
    ].join(' ')).includes(needle));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIndex(0);
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(current, Math.max(0, filteredCommands.length - 1))));
  }, [filteredCommands.length]);

  if (!open) return null;

  function runCommand(command) {
    if (!command || command.disabled) return;
    onClose?.();
    command.onSelect?.();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(filteredCommands.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(filteredCommands[activeIndex]);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <section
        className="motion-modal-panel w-full max-w-2xl overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border))] bg-[var(--surface-strong)] shadow-[0_30px_90px_rgba(0,0,0,0.52)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            aria-label={title}
          />
          <kbd className="hidden rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)] sm:inline">ESC</kbd>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[56vh] overflow-y-auto p-2" role="listbox">
          {filteredCommands.length ? filteredCommands.map((command, index) => {
            const active = index === activeIndex;
            const Icon = command.icon || Command;
            return (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={active}
                disabled={command.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${active ? 'border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface-elevated)_90%)]' : 'border-transparent hover:bg-[var(--surface-hover)]'} disabled:cursor-not-allowed disabled:opacity-45`}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--accent)]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{command.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">{command.description}</span>
                </span>
                <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] sm:block">{command.group}</span>
                <ArrowRight className={`h-4 w-4 shrink-0 transition ${active ? 'translate-x-0 text-[var(--accent)] opacity-100' : '-translate-x-1 opacity-0'}`} aria-hidden="true" />
              </button>
            );
          }) : (
            <div className="px-4 py-10 text-center">
              <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">{t('commandPalette.noResults')}</p>
            </div>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-[10px] font-medium text-[var(--text-muted)]">
          <span>↑ ↓ {t('commandPalette.navigate')} · Enter {t('commandPalette.select')}</span>
          <span>Ctrl K</span>
        </footer>
      </section>
    </div>
  );
}

export default CommandPalette;
