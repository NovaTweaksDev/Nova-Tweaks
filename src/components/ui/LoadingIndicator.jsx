import { Loader2 } from 'lucide-react';
import { joinClasses } from './classNames';

function LoadingSpinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={joinClasses('shrink-0 animate-spin text-[var(--accent)]', className)} aria-hidden="true" />;
}

function Skeleton({ className = '' }) {
  return <span className={joinClasses('ui-skeleton', className)} aria-hidden="true" />;
}

function LoadingIndicator({ label = 'Loading', className = '', compact = false }) {
  return (
    <span
      className={joinClasses(
        'inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] font-medium text-[var(--text-muted)]',
        compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-2 text-sm',
        className
      )}
    >
      <LoadingSpinner className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      <span>{label}</span>
    </span>
  );
}

function LoadingRow({ label = 'Loading', className = '' }) {
  return (
    <div className={joinClasses('flex min-h-[74px] items-center px-5', className)}>
      <LoadingIndicator label={label} />
    </div>
  );
}

function ListSkeleton({ rows = 4, label = 'Loading', className = '' }) {
  const rowCount = Math.max(1, Math.min(8, Math.trunc(Number(rows) || 4)));
  return (
    <div className={joinClasses('ui-list-skeleton', className)} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rowCount }).map((_, index) => (
        <div className="ui-list-skeleton-row" key={index}>
          <Skeleton className="ui-list-skeleton-icon" />
          <span className="ui-list-skeleton-copy" aria-hidden="true">
            <Skeleton className="ui-list-skeleton-title" />
            <Skeleton className="ui-list-skeleton-subtitle" />
          </span>
          <Skeleton className="ui-list-skeleton-meta" />
          <Skeleton className="ui-list-skeleton-status" />
          <Skeleton className="ui-list-skeleton-action" />
          <Skeleton className="ui-list-skeleton-chevron" />
        </div>
      ))}
    </div>
  );
}

export { ListSkeleton, LoadingIndicator, LoadingRow, LoadingSpinner, Skeleton };
