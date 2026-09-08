import { CheckCircle2 } from 'lucide-react';
import { Button, LoadingSpinner, Select, Switch } from '../ui';
import { joinClasses } from '../ui/classNames';

function SettingsSection({ icon: Icon, title, description, children, className = '' }) {
  return (
    <section className={joinClasses('settings-section rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_88%,var(--surface-elevated)_12%)] shadow-[var(--card-shadow-panel)]', className)}>
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] text-[var(--accent)]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-normal text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-5 text-[var(--text-muted)]">{description}</p> : null}
        </div>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </section>
  );
}

function RowStatus({ status }) {
  if (!status) return null;
  if (status === 'loading') {
    return <LoadingSpinner />;
  }
  if (status === 'success') {
    return <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />;
  }
  return null;
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  descriptionClassName = '',
  children,
  disabled = false,
  reason = '',
  status = '',
  className = ''
}) {
  return (
    <div className={joinClasses('grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center', disabled ? 'opacity-60' : '', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-muted)]">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
          {description ? <p className={joinClasses('mt-1 text-xs leading-5 text-[var(--text-muted)]', descriptionClassName)}>{description}</p> : null}
          {reason ? <p className="mt-1 text-xs leading-5 text-[var(--warning)]">{reason}</p> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
        <RowStatus status={status} />
        {children}
      </div>
    </div>
  );
}

function SettingsToggleRow({ value, onChange, disabled = false, ...props }) {
  return (
    <SettingsRow disabled={disabled} {...props}>
      <Switch checked={Boolean(value)} onChange={onChange} disabled={disabled} ariaLabel={props.title} />
    </SettingsRow>
  );
}

function SettingsSelectRow({ value, onChange, options = [], disabled = false, ...props }) {
  return (
    <SettingsRow disabled={disabled} {...props}>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        ariaLabel={props.title}
        className="sm:w-[170px]"
      />
    </SettingsRow>
  );
}

function SettingsActionRow({ label, onClick, variant = 'secondary', loading = false, disabled = false, leftIcon = null, ...props }) {
  return (
    <SettingsRow disabled={disabled} {...props}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        loading={loading}
        disabled={disabled}
        onClick={onClick}
        leftIcon={leftIcon}
        className="min-w-0 shrink"
      >
        {label}
      </Button>
    </SettingsRow>
  );
}

export { SettingsActionRow, SettingsRow, SettingsSection, SettingsSelectRow, SettingsToggleRow };
