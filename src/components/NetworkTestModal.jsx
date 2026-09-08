import i18n from '../i18n';
import { Activity, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, CircleAlert, Gauge, Globe2, Loader2, Network, RadioTower, RotateCcw, Router, Ruler, ShieldCheck, Wifi, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, ModalShell, StatusPill } from './ui';

const PHASES = ['preflight', 'mtu', 'stability', 'download', 'upload', 'analysis'];

function toFiniteNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function format(value, suffix, digits = 1) {
  const number = toFiniteNumber(value);
  return number === null ? '—' : `${number.toFixed(digits)} ${suffix}`;
}

function formatGatewayLatency(value) {
  const number = toFiniteNumber(value);
  if (number === null) return '—';
  return number >= 0 && number < 1 ? '<1 ms' : `${number.toFixed(1)} ms`;
}

function formatProbeReplies(t, received, expected) {
  const receivedCount = toFiniteNumber(received);
  const expectedCount = toFiniteNumber(expected);
  if (receivedCount === null || expectedCount === null || expectedCount <= 0) {
    return '';
  }
  return t('networkTest.probeReplies', {
    received: Math.max(0, Math.trunc(receivedCount)),
    expected: Math.max(0, Math.trunc(expectedCount))
  });
}

function PingChart({ samples = [], emptyLabel }) {
  const validSamples = samples
    .map(toFiniteNumber)
    .filter((value) => value !== null && value >= 0);
  if (validSamples.length < 2) {
    return (
      <div className="grid h-20 place-items-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-4 text-center">
        <p className="text-xs leading-5 text-[var(--text-muted)]">{emptyLabel}</p>
      </div>
    );
  }
  const max = Math.max(...validSamples, 1);
  const points = validSamples.map((value, index) => `${(index / (validSamples.length - 1)) * 100},${76 - (value / max) * 65}`).join(' ');
  return (
    <svg viewBox="0 0 100 80" preserveAspectRatio="none" className="h-20 w-full overflow-visible rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)] p-2">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'accent' }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Icon className="h-4 w-4" style={{ color: `var(--${tone})` }} />{label}</div>
      <p className="network-test-value mt-2 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-[11px] text-[var(--text-muted)]">{detail}</p> : null}
    </div>
  );
}

function MtuResultCard({ mtu, actionState, onApply, onReset }) {
  const { t } = useTranslation();
  const available = Boolean(mtu?.available);
  const optimal = available && Number(mtu.currentMtu) === Number(mtu.recommendedMtu);
  const reason = String(mtu?.reason || 'unavailable');
  const tone = available ? optimal ? "success" : 'warning' : 'neutral';

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,#06b6d4_28%,var(--border))] bg-[var(--surface)] p-4">
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--surface))] text-[var(--accent)]">
            <Ruler className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-[var(--text-primary)]">{t('networkTest.mtu.title')}</h4>
              <StatusPill tone={tone}>
                {available
                  ? t(`networkTest.mtu.status.${mtu.applied ? 'applied' : optimal ? 'optimal' : 'recommended'}`)
                  : t('networkTest.mtu.status.unavailable')}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              {available
                ? optimal
                  ? t('networkTest.mtu.optimalBody')
                  : t('networkTest.mtu.recommendationBody')
                : t(`networkTest.mtu.reasons.${reason}`, { defaultValue: t('networkTest.mtu.reasons.unavailable') })}
            </p>
            <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{mtu?.adapterDescription || mtu?.adapterName || ''}</p>
          </div>
        </div>

        {available ? (
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-3">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t('networkTest.mtu.current')}</p>
              <p className="network-test-value text-xl font-semibold tabular-nums">{mtu.currentMtu}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-[var(--accent)]" />
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t('networkTest.mtu.recommended')}</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--accent)]">{mtu.recommendedMtu}</p>
            </div>
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          {mtu?.canReset ? (
            <Button size="sm" variant="secondary" disabled={actionState?.busy} leftIcon={<RotateCcw className="h-4 w-4" />} onClick={onReset}>
              {t('networkTest.mtu.reset')}
            </Button>
          ) : null}
          {mtu?.canApply ? (
            <Button size="sm" variant="primary" disabled={actionState?.busy} leftIcon={actionState?.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ruler className="h-4 w-4" />} onClick={onApply}>
              {t('networkTest.mtu.apply')}
            </Button>
          ) : null}
        </div>
      </div>
      {actionState?.error ? (
        <p className="relative mt-3 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">{actionState.error}</p>
      ) : null}
      {available ? <p className="relative mt-3 text-[10px] text-[var(--text-muted)]">{t('networkTest.mtu.adminNote')}</p> : null}
    </section>
  );
}

function NetworkTestModal({ open, state, onStart, onCancel, onClose, onShowTweaks, onApplyMtu, onResetMtu, mtuActionState }) {
  const { t } = useTranslation();
  const running = state?.status === 'running';
  const result = state?.result;
  const complete = state?.status === 'complete' && result;
  const score = toFiniteNumber(result?.gaming?.score);
  const scoreTone = score === null ? 'neutral' : score >= 85 ? "success" : score >= 50 ? 'warning' : 'danger';
  const scoreRingColor = score === null ? 'var(--border)' : `var(--${scoreTone})`;
  const packetLoss = toFiniteNumber(result?.packetLossPercent);
  const internetProbeReceivedCount = toFiniteNumber(result?.internetProbeReceivedCount) ??
    (Array.isArray(result?.pingSamples) ? result.pingSamples.length : null);
  const internetProbeExpectedCount = toFiniteNumber(result?.internetProbeExpectedCount);
  const gatewayProbeReceivedCount = toFiniteNumber(result?.gatewayProbeReceivedCount) ??
    toFiniteNumber(result?.gateway?.receivedCount);
  const gatewayProbeExpectedCount = toFiniteNumber(result?.gatewayProbeExpectedCount) ??
    toFiniteNumber(result?.gateway?.expectedCount);
  const internetProbeDetail = formatProbeReplies(t, internetProbeReceivedCount, internetProbeExpectedCount);
  const gatewayProbeDetail = formatProbeReplies(t, gatewayProbeReceivedCount, gatewayProbeExpectedCount);
  const pingChartEmptyLabel = internetProbeReceivedCount > 0
    ? t('networkTest.pingInsufficient', {
        received: Math.trunc(internetProbeReceivedCount),
        expected: Math.trunc(internetProbeExpectedCount || internetProbeReceivedCount)
      })
    : t('networkTest.pingUnavailable');

  function close() {
    if (running) onCancel?.();
    onClose?.();
  }

  return (
    <ModalShell
      open={open}
      onClose={close}
      closeDisabled={running}
      closeOnBackdrop={!running}
      closeOnEscape={!running}
      size="xl"
      title={t('networkTest.title')}
      description={t('networkTest.description')}
      className="network-test-modal border-[color:color-mix(in_srgb,#06b6d4_35%,var(--border))] text-[var(--text-primary)]"
      contentClassName=""
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--text-muted)]">{t('networkTest.cloudflareNote')}</p>
          <div className="flex gap-2">
            {running ? <Button variant="danger" size="sm" onClick={onCancel}>{t('networkTest.cancel')}</Button> : null}
            {complete || state?.status === 'error' || state?.status === 'cancelled' ? <Button size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={onStart}>{t('networkTest.runAgain')}</Button> : null}
            {!running ? <Button size="sm" variant={complete ? 'primary' : 'secondary'} onClick={close}>{t('common.close')}</Button> : null}
          </div>
        </div>
      )}
    >
      {(!state || state.status === 'idle') ? (
        <div className="py-4">
          <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <RadioTower className="h-10 w-10 text-[var(--accent)]" />
            <h4 className="mt-5 text-xl font-semibold text-[var(--text-primary)]">{t('networkTest.readyTitle')}</h4>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">{t('networkTest.readyBody')}</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {[['20–30 s', t('networkTest.duration')], ['~50 MB', t('networkTest.dataUsage')], [t('networkTest.noAdmin'), t('networkTest.permissions')]].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3"><p className="font-semibold text-[var(--text-primary)]">{value}</p><p className="text-xs text-[var(--text-muted)]">{label}</p></div>
              ))}
            </div>
            <Button className="mt-6" variant="primary" leftIcon={<Activity className="h-4 w-4" />} onClick={onStart}>{t('networkTest.start')}</Button>
          </div>
        </div>
      ) : null}

      {running ? (
        <div className="py-3">
          <div className="flex flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:flex-row sm:items-center">
            <div className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--accent) ${state.progress || 0}%, var(--surface-elevated) 0)` }}>
              <div className="grid h-24 w-24 place-items-center rounded-full bg-[var(--surface)] text-center"><div><p className="network-test-value text-2xl font-bold tabular-nums">{state.progress || 0}%</p><p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t('networkTest.testing')}</p></div></div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-[var(--text-primary)]">{t(`networkTest.phases.${state.phase}`)}</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{t('networkTest.runningHint')}</p>
              <div className="mt-5 grid grid-cols-5 gap-2">
                {PHASES.map((phase, index) => {
                  const activeIndex = Math.max(0, PHASES.indexOf(state.phase));
                  return <div key={phase} className={`h-1.5 rounded-full ${index <= activeIndex ? 'bg-[var(--accent)]' : 'bg-[var(--surface-elevated)]'}`} />;
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {(state?.status === 'error' || state?.status === 'cancelled') ? (
        <div className="my-4 flex items-start gap-3 rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-5">
          {state.status === 'cancelled' ? <CircleAlert className="h-5 w-5 text-[var(--warning)]" /> : <XCircle className="h-5 w-5 text-[var(--danger)]" />}
          <div><p className="font-semibold">{t(`networkTest.${state.status}Title`)}</p><p className="mt-1 text-sm text-[var(--text-muted)]">{state.error || t(`networkTest.${state.status}Body`)}</p></div>
        </div>
      ) : null}

      {complete ? (
        <div className="space-y-4 py-3">
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
              <div className="grid h-28 w-28 place-items-center rounded-full border-[7px] border-[var(--border)]" style={{ borderColor: scoreRingColor }}>
                <span className="network-test-value text-3xl font-bold tabular-nums">{score ?? '—'}</span>
              </div>
              <p className="mt-3 font-semibold text-[var(--text-primary)]">{t('networkTest.gamingScore')}</p>
              <StatusPill className="mt-2" tone={scoreTone}>{t(`networkTest.quality.${result.gaming?.label}`)}</StatusPill>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard icon={Gauge} label={t('networkTest.latency')} value={format(result.latencyMs, 'ms')} detail={`${format(result.minLatencyMs, 'ms')} – ${format(result.maxLatencyMs, 'ms')}`} />
              <MetricCard icon={Activity} label={t('networkTest.jitter')} value={format(result.jitterMs, 'ms')} detail={internetProbeDetail} />
              <MetricCard icon={ShieldCheck} label={t('networkTest.packetLoss')} value={format(result.packetLossPercent, '%')} detail={internetProbeDetail} tone={packetLoss === null ? 'accent' : packetLoss > 1 ? 'danger' : "success"} />
              <MetricCard icon={Network} label={t('networkTest.bufferbloat')} value={format(result.loadedLatencyIncreaseMs, 'ms')} detail={result.loadedLatencySampleCount ? t('networkTest.validSamples', { count: result.loadedLatencySampleCount }) : ''} />
              <MetricCard icon={ArrowDown} label={t('networkTest.download')} value={format(result.downloadMbps, 'Mbps')} detail={result.downloadSampleCount ? t('networkTest.validSamples', { count: result.downloadSampleCount }) : ''} />
              <MetricCard icon={ArrowUp} label={t('networkTest.upload')} value={format(result.uploadMbps, 'Mbps')} detail={result.uploadSampleCount ? t('networkTest.validSamples', { count: result.uploadSampleCount }) : ''} />
              <MetricCard icon={Globe2} label={t('networkTest.dns')} value={format(result.dnsLatencyMs, 'ms')} detail={formatProbeReplies(t, result.dnsProbeReceivedCount, result.dnsProbeExpectedCount)} />
              <MetricCard icon={Router} label={t('networkTest.gateway')} value={formatGatewayLatency(result.gateway?.medianMs)} detail={gatewayProbeDetail} />
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between"><div><h4 className="font-semibold text-[var(--text-primary)]">{t('networkTest.pingStability')}</h4><p className="text-xs text-[var(--text-muted)]">{t('networkTest.pingStabilityHint')}</p></div><Wifi className="h-5 w-5 text-[var(--accent)]" /></div>
            <div className="mt-3"><PingChart samples={result.pingSamples} emptyLabel={pingChartEmptyLabel} /></div>
          </div>

          <MtuResultCard mtu={result.mtu} actionState={mtuActionState} onApply={onApplyMtu} onReset={onResetMtu} />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h4 className="font-semibold text-[var(--text-primary)]">{t('networkTest.connectionDetails')}</h4>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-[var(--text-muted)]">{t('networkTest.adapter')}</dt><dd className="truncate text-right font-medium text-[var(--text-primary)]">{result.adapterDescription || result.adapterName || '—'}</dd>
                <dt className="text-[var(--text-muted)]">{t('networkTest.connection')}</dt><dd className="text-right font-medium capitalize text-[var(--text-primary)]">{result.connectionType || '—'}</dd>
                <dt className="text-[var(--text-muted)]">{t('networkTest.linkSpeed')}</dt><dd className="text-right font-medium tabular-nums text-[var(--text-primary)]">{format(result.linkSpeedMbps, 'Mbps', 0)}</dd>
                <dt className="text-[var(--text-muted)]">{t('networkTest.dnsServers')}</dt><dd className="truncate text-right font-medium text-[var(--text-primary)]">{result.dnsServers?.join(', ') || '—'}</dd>
              </dl>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h4 className="font-semibold text-[var(--text-primary)]">{t('networkTest.findings')}</h4>
              <div className="mt-3 space-y-2">
                {result.recommendations?.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                    {item.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-[var(--success)]" /> : <CircleAlert className={`mt-0.5 h-4 w-4 ${item.tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`} />}
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--text-primary)]">{t(`networkTest.recommendations.${item.id}.title`)}</p><p className="mt-0.5 text-xs text-[var(--text-muted)]">{t(`networkTest.recommendations.${item.id}.body`)}</p></div>
                    {item.subcategory ? <Button size="sm" variant="ghost" onClick={() => onShowTweaks?.(item.subcategory)}>{t('networkTest.showTweaks')}</Button> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {result.speedError ? <p className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3 text-xs text-[var(--text-muted)]">{t('networkTest.speedUnavailable')}</p> : null}
        </div>
      ) : null}
    </ModalShell>
  );
}

export default NetworkTestModal;
