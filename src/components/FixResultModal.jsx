import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ModalShell } from './ui';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value);
  return keys.length ? value : null;
}

function stripTrailingStatusJson(stdout) {
  const raw = String(stdout || '');
  if (!raw.trim()) {
    return '';
  }

  const lines = raw.split(/\r?\n/);
  let lastNonEmptyIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      lastNonEmptyIndex = index;
      break;
    }
  }

  if (lastNonEmptyIndex < 0) {
    return '';
  }

  const candidate = lines[lastNonEmptyIndex].trim();
  try {
    const parsed = JSON.parse(candidate);
    const status = String(parsed?.status || '').trim().toLowerCase();
    if (status === 'enabled' || status === 'disabled' || status === 'error') {
      lines.splice(lastNonEmptyIndex, 1);
    }
  } catch (_error) {
    // Keep original output when the final line is not the structured status JSON.
  }

  return lines.join('\n').trim();
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(2)} s`;
  }

  return `${seconds.toFixed(1)} s`;
}

function FixResultModal({ open, payload, onClose }) {
  const { t } = useTranslation();
  const tweakName = normalizeText(payload?.tweakName);
  const summary = normalizeText(payload?.message);
  const stdout = stripTrailingStatusJson(payload?.stdout);
  const stderr = normalizeText(payload?.stderr);
  const code = normalizeText(payload?.code);
  const details = normalizeObject(payload?.parsedDetails);
  const formattedDetails = useMemo(
    () => (details ? JSON.stringify(details, null, 2) : ''),
    [details]
  );
  const hasDiagnosticOutput = Boolean(stdout || stderr || formattedDetails);
  const isSuccess = Boolean(payload?.ok);
  const exitCode = Number.isFinite(payload?.exitCode) ? Number(payload.exitCode) : null;
  const durationText = formatDuration(Number(payload?.durationMs));
  const title = tweakName
    ? `${t('tweaks.fix.result.title')}: ${tweakName}`
    : t('tweaks.fix.result.title');

  return (
    <ModalShell
      open={open}
      title={title}
      description={t('tweaks.fix.result.description')}
      onClose={onClose}
      closeLabel={t('common.close')}
      size="lg"
      overlayClassName="z-[130]"
      footer={(
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
          <p className="ui-overline text-[10px] text-[var(--text-muted)]">{t('tweaks.fix.result.summaryLabel')}</p>
          <p className="mt-1 text-sm text-[var(--text-primary)]">
            {summary || t('tweaks.fix.result.noOutput')}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${
                isSuccess
                  ? 'border-[var(--success)]/40 bg-[var(--success)]/12 text-[var(--success)]'
                  : 'border-[var(--danger)]/40 bg-[var(--danger-soft)] text-[var(--danger)]'
              }`}
            >
              {t('tweaks.fix.result.stateLabel')}: {isSuccess ? t('tweaks.fix.result.stateSuccess') : t('tweaks.fix.result.stateFailed')}
            </span>

            {code ? (
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[var(--text-muted)]">
                {t('tweaks.fix.result.codeLabel')}: {code}
              </span>
            ) : null}

            {exitCode !== null ? (
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[var(--text-muted)]">
                {t('tweaks.fix.result.exitCodeLabel')}: {exitCode}
              </span>
            ) : null}

            {durationText ? (
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[var(--text-muted)]">
                {t('tweaks.fix.result.durationLabel')}: {durationText}
              </span>
            ) : null}
          </div>
        </div>

        {formattedDetails ? (
          <section className="space-y-1.5">
            <p className="ui-overline text-[10px] text-[var(--text-muted)]">{t('tweaks.fix.result.detailsLabel')}</p>
            <pre className="max-h-[220px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--text-primary)] whitespace-pre-wrap break-words">
              {formattedDetails}
            </pre>
          </section>
        ) : null}

        {stdout ? (
          <section className="space-y-1.5">
            <p className="ui-overline text-[10px] text-[var(--text-muted)]">{t('tweaks.fix.result.stdoutLabel')}</p>
            <pre className="max-h-[260px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--text-primary)] whitespace-pre-wrap break-words">
              {stdout}
            </pre>
          </section>
        ) : null}

        {stderr ? (
          <section className="space-y-1.5">
            <p className="ui-overline text-[10px] text-[var(--danger)]">{t('tweaks.fix.result.stderrLabel')}</p>
            <pre className="max-h-[220px] overflow-auto rounded-xl border border-[var(--danger)]/35 bg-[var(--danger-soft)] p-3 text-xs leading-5 text-[var(--danger)] whitespace-pre-wrap break-words">
              {stderr}
            </pre>
          </section>
        ) : null}

        {!hasDiagnosticOutput && !summary ? (
          <p className="text-sm text-[var(--text-muted)]">{t('tweaks.fix.result.noOutput')}</p>
        ) : null}
      </div>
    </ModalShell>
  );
}

export default FixResultModal;
