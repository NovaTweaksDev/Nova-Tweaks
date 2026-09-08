import i18n from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Cpu,
  Fan,
  Gpu,
  HardDrive,
  MemoryStick,
  Microchip,
  Network,
  RadioTower,
  RotateCcw,
  Settings2,
  Thermometer,
  Timer,
  Wifi
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AdvancedSensorsPrompt from './AdvancedSensorsPrompt';
import { IconContainer, PageHeader, PageShell, Skeleton } from './ui';

const LUCIDE_ICON_PROPS = {
  size: 18,
  strokeWidth: 1.8
};

const SECTION_DEFAULTS = {
  cpu: true,
  gpu: true,
  memory: true,
  storage: true,
  network: true,
  cooling: true,
  processes: true
};

const TEMPERATURE_THRESHOLDS = {
  cpu: { warningC: 75, dangerC: 90 },
  gpu: { warningC: 70, dangerC: 85 }
};

const OVERVIEW_CARD_STORAGE_KEY = 'nova-tweaks:overview-cards:v1';
const SESSION_CLEANED_BYTES_STORAGE_KEY = 'nova-tweaks:session-cleaned-bytes:v1';
const SUMMARY_CARD_IDS = ['cpu', 'gpu', 'memory', 'vram', 'storage', 'network', 'uptime'];
const SUMMARY_CARD_GRID_COLUMNS = {
  cpu: 'minmax(6.25rem, 0.72fr)',
  gpu: 'minmax(6.25rem, 0.72fr)',
  memory: 'minmax(8.5rem, 1fr)',
  vram: 'minmax(8.5rem, 1fr)',
  storage: 'minmax(11.5rem, 1.42fr)',
  network: 'minmax(9rem, 1.08fr)',
  uptime: 'minmax(7.25rem, 0.82fr)'
};

const overviewRuntimeCache = {
  snapshot: null,
  capturedAt: 0
};

function readVisibleSummaryCards() {
  try {
    const stored = JSON.parse(localStorage.getItem(OVERVIEW_CARD_STORAGE_KEY) || '[]');
    const valid = Array.isArray(stored) ? stored.filter((id) => SUMMARY_CARD_IDS.includes(id)) : [];
    return valid.length ? valid : SUMMARY_CARD_IDS;
  } catch (_error) {
    return SUMMARY_CARD_IDS;
  }
}

function formatBytes(value) {
  const bytes = toFiniteNumber(value);
  if (bytes === null || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${formatNumber(bytes / (1024 ** unitIndex), unitIndex >= 3 ? 2 : 1)} ${units[unitIndex]}`;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, fractionDigits = 0, fallback = i18n.t('interfaceText.n_a_08d2e')) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return fallback;
  }

  return number.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits
  });
}

function formatPercent(value) {
  const number = toFiniteNumber(value);
  return number === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(number, 0)}%`;
}

function formatTemperature(value) {
  const number = toFiniteNumber(value);
  return number === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(number, 0)}\u00b0C`;
}

function temperatureTone(value, deviceType) {
  const number = toFiniteNumber(value);
  const thresholds = TEMPERATURE_THRESHOLDS[deviceType];
  if (number === null || !thresholds) {
    return 'neutral';
  }
  if (number >= thresholds.dangerC) {
    return 'danger';
  }
  if (number >= thresholds.warningC) {
    return 'warning';
  }
  return "success";
}

function TemperatureValue({ value, deviceType = '' }) {
  const available = toFiniteNumber(value) !== null;
  const tone = temperatureTone(value, deviceType);
  const formattedValue = formatTemperature(value);
  return (
    <span className={`overview-temperature-value${available ? '' : ' overview-temperature-value--unavailable'}${deviceType && available ? ` overview-temperature-value--${tone}` : ''}`}>
      <Thermometer size={12} strokeWidth={2} aria-hidden="true" />
      <span key={formattedValue} className="overview-live-value">{formattedValue}</span>
    </span>
  );
}

function AnimatedValue({ children }) {
  const valueKey = typeof children === 'string' || typeof children === 'number'
    ? String(children)
    : 'composed-value';
  return <span key={valueKey} className="overview-live-value">{children}</span>;
}

function formatGb(value, digits = 1) {
  const number = toFiniteNumber(value);
  return number === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(number, digits)} GB`;
}

function formatGbPair(used, total) {
  const usedNumber = toFiniteNumber(used);
  const totalNumber = toFiniteNumber(total);
  return usedNumber === null || totalNumber === null
    ? i18n.t('interfaceText.n_a_08d2e')
    : `${formatNumber(usedNumber, 1)} / ${formatNumber(totalNumber, 1)} GB`;
}

function formatMbps(value) {
  const number = toFiniteNumber(value);
  return number === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(number, number >= 100 ? 0 : 1)} Mbps`;
}

function formatClock(value) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return i18n.t('interfaceText.n_a_08d2e');
  }
  return number >= 1000 ? `${formatNumber(number / 1000, 2)} GHz` : `${formatNumber(number, 0)} MHz`;
}

function formatPower(value) {
  const number = toFiniteNumber(value);
  return number === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(number, 1)} W`;
}

function formatRpm(value) {
  const number = toFiniteNumber(value);
  return number === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(number, 0)} RPM`;
}

function formatUptime(seconds) {
  if (toFiniteNumber(seconds) === null) {
    return i18n.t('interfaceText.n_a_08d2e');
  }

  const totalMinutes = Math.max(0, Math.floor(Number(seconds) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatLastUpdated(timestamp) {
  const date = timestamp ? new Date(timestamp) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return i18n.t('interfaceText.waiting_for_data_bc95f');
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimings(timings) {
  return Array.isArray(timings) && timings.length === 4
    ? `${timings.map((value) => formatNumber(value, 1)).join('-')} ns`
    : i18n.t('interfaceText.n_a_08d2e');
}

function qualityUnavailableLabel(quality) {
  if (quality?.status === 'timeout') {
    return i18n.t('interfaceText.timeout_d4c45');
  }
  if (quality?.status === 'blocked') {
    return i18n.t('interfaceText.icmp_blocked_3c753');
  }
  return i18n.t('networkTest.mtu.status.unavailable');
}

function formatQualityLatency(quality) {
  const latency = toFiniteNumber(quality?.latencyMs);
  return latency === null ? qualityUnavailableLabel(quality) : `${formatNumber(latency, 1)} ms`;
}

function formatQualityPacketLoss(quality) {
  const loss = toFiniteNumber(quality?.packetLossPercent);
  return loss === null ? qualityUnavailableLabel(quality) : `${formatNumber(loss, 1)}%`;
}

function qualityStatusLabel(quality) {
  if (quality?.status === 'ok') {
    return 'Online';
  }
  if (quality?.status === 'degraded') {
    return 'Degraded';
  }
  if (quality?.status === 'blocked') {
    return 'ICMP blocked';
  }
  if (quality?.status === 'timeout') {
    return 'Timeout';
  }
  if (quality?.status === 'unavailable' || !quality?.status) {
    return 'Unavailable';
  }
  return quality.status;
}

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (['healthy', 'online', 'up', 'running', 'ok'].some((state) => value.includes(state))) {
    return 'success';
  }
  if (['warning', 'degraded', 'not responding', 'failed', 'error', 'blocked', 'timeout'].some((state) => value.includes(state))) {
    return 'warning';
  }
  return 'neutral';
}

function Sparkline({ history = [], secondaryHistory = [], tone = 'accent', secondaryTone = 'cyan', max = null, variant = 'standard' }) {
  const isNetwork = variant === 'network';
  const visibleHistory = isNetwork && Array.isArray(history) ? history.slice(-36) : history;
  const points = Array.isArray(visibleHistory)
    ? visibleHistory.map((entry) => toFiniteNumber(entry?.value)).filter((value) => value !== null)
    : [];
  const secondaryPoints = !isNetwork && Array.isArray(secondaryHistory)
    ? secondaryHistory.map((entry) => toFiniteNumber(entry?.value)).filter((value) => value !== null)
    : [];

  if (points.length < 2 && secondaryPoints.length < 2) {
    return <div className="overview-sparkline-empty">{i18n.t('interfaceText.collecting_live_history_0c594')}</div>;
  }

  const width = 246;
  const height = 43;
  const ceiling = max || Math.max(...points, ...secondaryPoints, 1);
  const createPath = (values) => {
    const step = width / Math.max(1, values.length - 1);
    return values.map((value, index) => {
      const x = index * step;
      const y = height - (Math.min(ceiling, Math.max(0, value)) / Math.max(1, ceiling)) * (height - 5) - 2;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  };
  const path = points.length >= 2 ? createPath(points) : '';
  const secondaryPath = secondaryPoints.length >= 2 ? createPath(secondaryPoints) : '';
  return (
    <svg className={`overview-sparkline overview-sparkline--${variant}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {!isNetwork ? <path className="overview-sparkline-grid" d="M0 11H246M0 22H246M0 33H246" /> : null}
      {path ? <path className={`overview-sparkline-line overview-sparkline-line--${tone}${isNetwork ? ' overview-sparkline-line--network' : ''}`} d={path} /> : null}
      {secondaryPath ? <path className={`overview-sparkline-line overview-sparkline-line--${secondaryTone} overview-sparkline-secondary`} d={secondaryPath} /> : null}
    </svg>
  );
}

function SummaryTile({ metricId, icon: Icon, label, value, detail, tone = 'accent', loading = false }) {
  const valueTitle = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  return (
    <article className={`overview-summary-tile overview-summary-tile--${metricId}`}>
      <IconContainer className={`overview-summary-icon overview-summary-icon--${tone}`}>
        <Icon {...LUCIDE_ICON_PROPS} />
      </IconContainer>
      <div className="overview-summary-copy">
        <p className="overview-summary-label">{label}</p>
        <p className="overview-summary-value" title={valueTitle}>
          {loading ? <Skeleton className="h-3.5 w-16" /> : <AnimatedValue>{value}</AnimatedValue>}
        </p>
        <p className="overview-summary-detail" title={detail}>
          {loading ? <Skeleton className="h-2.5 w-12" /> : detail || i18n.t('interfaceText.n_a_08d2e')}
        </p>
      </div>
    </article>
  );
}

function DetailStat({ label, value, tone = 'neutral', title = '', className = '' }) {
  return (
    <div className={`overview-detail-stat ${className}`} title={title || undefined}>
      <p>{label}</p>
      <strong className={`overview-value-${tone}`}><AnimatedValue>{value}</AnimatedValue></strong>
    </div>
  );
}

function StatusValue({ status }) {
  const tone = statusTone(status);
  return (
    <span className={`overview-state overview-state--${tone}`}>
      <span className="overview-status-dot" />
      {status || i18n.t('tweakDetails.unknown')}
    </span>
  );
}

function OverviewSection({ id, icon: Icon, title, subtitle, meta, tone = 'accent', open, onToggle, loading = false, children }) {
  return (
    <section className={`overview-section overview-section--${tone}`}>
      <div className="overview-section-layout">
        <header className="overview-section-intro">
          <IconContainer className={`overview-section-icon overview-summary-icon--${tone}`}>
            <Icon {...LUCIDE_ICON_PROPS} />
          </IconContainer>
          <div className="overview-section-copy">
            <h2>{title}</h2>
            {loading ? (
              <span className="mt-1 grid gap-1.5" aria-hidden="true">
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="h-2 w-20" />
              </span>
            ) : (
              <>
                <p title={subtitle}>{subtitle}</p>
                {meta ? <small title={meta}>{meta}</small> : null}
              </>
            )}
          </div>
        </header>
        {open ? <div className="overview-section-content">{loading ? <OverviewMetricSkeleton /> : children}</div> : <div className="overview-section-collapsed">{i18n.t('interfaceText.section_collapsed_be3c7')}</div>}
        <button
          type="button"
          className="overview-section-toggle"
          onClick={() => onToggle(id)}
          aria-expanded={open}
          aria-label={`${open ? i18n.t('interfaceText.collapse_9cf18') : i18n.t('interfaceText.expand_9869e')} ${title}`}
        >
          <ChevronDown className={open ? 'rotate-180' : ''} size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function MetricRow({ label = i18n.t('interfaceText.usage_0bb18'), value, history, secondaryHistory, tone = 'accent', graphVariant = 'standard', children }) {
  return (
    <div className="overview-metric-row">
      <div className="overview-primary-stat">
        <p>{label}</p>
        <strong><AnimatedValue>{value}</AnimatedValue></strong>
      </div>
      <Sparkline history={history} secondaryHistory={secondaryHistory} tone={tone} max={label === 'Usage' ? 100 : null} variant={graphVariant} />
      <div className="overview-device-stats">{children}</div>
    </div>
  );
}

function OverviewMetricSkeleton() {
  return (
    <div className="overview-metric-row" role="status" aria-label={i18n.t('interfaceText.loading_monitoring_data_c3618')} aria-busy="true">
      <span className="grid gap-2" aria-hidden="true">
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="h-4 w-16" />
      </span>
      <Skeleton className="h-10 w-full" />
      <div className="overview-device-stats" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <span className="grid gap-2 border-l border-[var(--border-subtle)] px-3 py-1" key={index}>
            <Skeleton className="h-2 w-12" />
            <Skeleton className="h-3 w-16" />
          </span>
        ))}
      </div>
    </div>
  );
}

function SensorGroup({ title, items, renderItem }) {
  return (
    <div className="overview-sensor-group">
      <p className="overview-group-title">{title}</p>
      <div className="overview-group-values">
        {items.length ? items.map(renderItem) : <span className="overview-unavailable">{i18n.t('networkTest.mtu.status.unavailable')}</span>}
      </div>
    </div>
  );
}

function OverviewPanel({ onNavigateSettings }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(() => overviewRuntimeCache.snapshot);
  const [loading, setLoading] = useState(() => !overviewRuntimeCache.snapshot);
  const [ipcError, setIpcError] = useState('');
  const [openSections, setOpenSections] = useState(SECTION_DEFAULTS);
  const [visibleSummaryCards, setVisibleSummaryCards] = useState(readVisibleSummaryCards);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sessionSummary, setSessionSummary] = useState(() => ({
    cpuPeakTempC: null,
    gpuPeakTempC: null,
    peakLoadPercent: null,
    cleanedBytes: Number(sessionStorage.getItem(SESSION_CLEANED_BYTES_STORAGE_KEY)) || 0
  }));

  useEffect(() => {
    let disposed = false;
    let unsubscribe = null;

    async function initializeMonitoring() {
      try {
        if (!window.desktopApi?.getMonitoringSnapshot) {
          setIpcError(i18n.t('interfaceText.desktop_monitoring_api_is_unavailable_ac87c'));
          setLoading(false);
          return;
        }

        await window.desktopApi.setMonitoringRefreshRate?.({ refreshRateMs: 3000 });
        const result = await window.desktopApi.getMonitoringSnapshot();
        if (!disposed && result?.snapshot) {
          overviewRuntimeCache.snapshot = result.snapshot;
          overviewRuntimeCache.capturedAt = Date.now();
          setSnapshot(result.snapshot);
          setLoading(false);
        }
        if (!disposed && result?.ok === false) {
          setIpcError(result.message || i18n.t('interfaceText.monitoring_is_unavailable_10ff2'));
          setLoading(false);
        }

        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (disposed) return;
        unsubscribe = window.desktopApi.onMonitoringUpdate?.((nextSnapshot) => {
          if (!disposed && nextSnapshot) {
            overviewRuntimeCache.snapshot = nextSnapshot;
            overviewRuntimeCache.capturedAt = Date.now();
            setSnapshot(nextSnapshot);
            setLoading(false);
            setIpcError('');
          }
        });
      } catch (error) {
        if (!disposed) {
          setIpcError(error?.message || i18n.t('interfaceText.monitoring_is_unavailable_10ff2'));
          setLoading(false);
        }
      }
    }

    void initializeMonitoring();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    function openCustomizer() {
      setCustomizeOpen(true);
    }
    function updateCleanedBytes(event) {
      const cleanedBytes = toFiniteNumber(event?.detail?.cleanedBytes);
      if (cleanedBytes !== null) {
        setSessionSummary((previous) => ({ ...previous, cleanedBytes }));
      }
    }
    function resetSessionSummary() {
      sessionStorage.removeItem(SESSION_CLEANED_BYTES_STORAGE_KEY);
      setSessionSummary({ cpuPeakTempC: null, gpuPeakTempC: null, peakLoadPercent: null, cleanedBytes: 0 });
    }
    window.addEventListener('nova:overview-customize', openCustomizer);
    window.addEventListener('nova:session-cleaned-bytes', updateCleanedBytes);
    window.addEventListener('nova:overview-reset-session', resetSessionSummary);
    return () => {
      window.removeEventListener('nova:overview-customize', openCustomizer);
      window.removeEventListener('nova:session-cleaned-bytes', updateCleanedBytes);
      window.removeEventListener('nova:overview-reset-session', resetSessionSummary);
    };
  }, []);

  const primaryGpu = snapshot?.gpus?.[0] || null;
  const initialMonitoringLoad = loading && !snapshot;
  const networkQuality = snapshot?.networkQuality || null;
  const networkRows = snapshot?.network?.length
    ? snapshot.network
    : networkQuality?.lastChecked
      ? [{
          name: networkQuality.adapterDescription || networkQuality.adapterName || i18n.t('interfaceText.network_quality_e3777'),
          status: qualityStatusLabel(networkQuality),
          linkSpeedMbps: null,
          downloadMbps: null,
          uploadMbps: null,
          history: [],
          uploadHistory: []
        }]
      : [];
  const primaryNetwork = networkRows[0] || null;
  const qualityTargetHint = networkQuality?.target
    ? `Measured against ${networkQuality.target}${networkQuality.method === 'tcp-fallback' ? ' using TCP latency fallback' : ' using ICMP probes'}`
    : '';
  const totalStorage = useMemo(() => {
    const drives = Array.isArray(snapshot?.storage) ? snapshot.storage : [];
    return drives.reduce((total, drive) => ({
      capacityGB: total.capacityGB + (toFiniteNumber(drive.capacityGB) || 0),
      usedGB: total.usedGB + (toFiniteNumber(drive.usedGB) || 0)
    }), { capacityGB: 0, usedGB: 0 });
  }, [snapshot?.storage]);
  const totalStoragePercent = totalStorage.capacityGB > 0 ? (totalStorage.usedGB / totalStorage.capacityGB) * 100 : null;
  const errors = Array.isArray(snapshot?.system?.errors) ? snapshot.system.errors : [];
  const cooling = snapshot?.cooling || {};

  useEffect(() => {
    if (!snapshot) return;
    const cpuTemp = toFiniteNumber(snapshot?.cpu?.temperatureC);
    const gpuTemp = toFiniteNumber(snapshot?.gpus?.[0]?.temperatureC);
    const cpuLoad = toFiniteNumber(snapshot?.cpu?.usagePercent);
    const gpuLoad = toFiniteNumber(snapshot?.gpus?.[0]?.usagePercent);
    const currentPeakLoad = Math.max(cpuLoad ?? -Infinity, gpuLoad ?? -Infinity);
    setSessionSummary((previous) => ({
      ...previous,
      cpuPeakTempC: cpuTemp === null ? previous.cpuPeakTempC : Math.max(previous.cpuPeakTempC ?? -Infinity, cpuTemp),
      gpuPeakTempC: gpuTemp === null ? previous.gpuPeakTempC : Math.max(previous.gpuPeakTempC ?? -Infinity, gpuTemp),
      peakLoadPercent: Number.isFinite(currentPeakLoad) ? Math.max(previous.peakLoadPercent ?? -Infinity, currentPeakLoad) : previous.peakLoadPercent
    }));
  }, [snapshot]);

  function toggleSummaryCard(id) {
    setVisibleSummaryCards((previous) => {
      const next = previous.includes(id) ? previous.filter((cardId) => cardId !== id) : [...previous, id];
      if (!next.length) return previous;
      localStorage.setItem(OVERVIEW_CARD_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function resetSessionSummary() {
    sessionStorage.removeItem(SESSION_CLEANED_BYTES_STORAGE_KEY);
    setSessionSummary({ cpuPeakTempC: null, gpuPeakTempC: null, peakLoadPercent: null, cleanedBytes: 0 });
  }

  const summaryCards = [
    { id: 'cpu', icon: Cpu, label: 'CPU', value: <TemperatureValue value={snapshot?.cpu?.temperatureC} deviceType="cpu" />, detail: `${formatPercent(snapshot?.cpu?.usagePercent)} usage` },
    { id: 'gpu', icon: Gpu, label: 'GPU', value: <TemperatureValue value={primaryGpu?.temperatureC} deviceType="gpu" />, detail: `${formatPercent(primaryGpu?.usagePercent)} usage`, tone: 'cyan' },
    { id: 'memory', icon: MemoryStick, label: 'RAM', value: formatGbPair(snapshot?.memory?.usedGB, snapshot?.memory?.totalGB), detail: `${formatPercent(snapshot?.memory?.usagePercent)} used`, tone: 'blue' },
    { id: 'vram', icon: Microchip, label: 'VRAM', value: formatGbPair(primaryGpu?.memoryUsedMB === null || primaryGpu?.memoryUsedMB === undefined ? null : primaryGpu.memoryUsedMB / 1024, primaryGpu?.memoryTotalMB === null || primaryGpu?.memoryTotalMB === undefined ? null : primaryGpu.memoryTotalMB / 1024), detail: primaryGpu?.memoryTotalMB ? `${formatPercent((primaryGpu.memoryUsedMB / primaryGpu.memoryTotalMB) * 100)} used` : i18n.t('interfaceText.n_a_08d2e') },
    { id: 'storage', icon: HardDrive, label: i18n.t('interfaceText.storage_9e092'), value: totalStorage.capacityGB ? formatGbPair(totalStorage.usedGB, totalStorage.capacityGB) : i18n.t('interfaceText.n_a_08d2e'), detail: `${formatPercent(totalStoragePercent)} used`, tone: 'blue' },
    { id: 'network', icon: Wifi, label: 'Network', value: formatMbps(primaryNetwork?.downloadMbps), detail: `Up ${formatMbps(primaryNetwork?.uploadMbps)}`, tone: 'cyan' },
    { id: 'uptime', icon: Timer, label: i18n.t('interfaceText.uptime_6aafa'), value: formatUptime(snapshot?.system?.uptimeSeconds), detail: snapshot?.system?.admin ? i18n.t('interfaceText.administrator_1eda2') : i18n.t('interfaceText.standard_user_a36db'), tone: 'pink' }
  ];
  const visibleSummaryCardItems = summaryCards.filter((card) => visibleSummaryCards.includes(card.id));
  const summaryGridColumns = visibleSummaryCardItems
    .map((card) => SUMMARY_CARD_GRID_COLUMNS[card.id])
    .join(' ');

  function toggleSection(id) {
    setOpenSections((previous) => ({ ...previous, [id]: !previous[id] }));
  }

  return (
    <PageShell className="overview-page">
      <PageHeader
        title={t('overview.title')}
        description={t('overview.subtitle')}
        status={
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCustomizeOpen((current) => !current)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--border))] hover:text-[var(--text-primary)]"
              aria-expanded={customizeOpen}
            >
              <Settings2 className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
              {t('overview.customize.action')}
            </button>
          </span>
        }
      />

      <AdvancedSensorsPrompt onOpenSettings={onNavigateSettings} />

      {errors.length || ipcError ? (
        <div className="overview-warning">
          <RadioTower size={15} aria-hidden="true" />
          <span>{ipcError || errors[0]}</span>
        </div>
      ) : null}

      {customizeOpen ? (
        <section className="motion-tab-panel rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_82%,var(--surface-strong)_18%)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('overview.customize.title')}</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t('overview.customize.description')}</p>
            </div>
            <button type="button" onClick={() => setVisibleSummaryCards(() => { localStorage.removeItem(OVERVIEW_CARD_STORAGE_KEY); return SUMMARY_CARD_IDS; })} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--accent)]">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('overview.customize.reset')}
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {summaryCards.map((card) => {
              const selected = visibleSummaryCards.includes(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => toggleSummaryCard(card.id)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${selected ? 'border-[color:color-mix(in_srgb,var(--accent)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface-elevated)_90%)] text-[var(--text-primary)]' : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] opacity-65'}`}
                  aria-pressed={selected}
                >
                  {card.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="overview-session-summary">
        <div className="overview-session-summary-copy">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('overview.sessionSummary.title')}</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{t('overview.sessionSummary.description')}</p>
        </div>
        <div className="overview-session-summary-grid">
          <DetailStat className="overview-session-stat" label={t('overview.sessionSummary.cpuPeak')} value={<TemperatureValue value={sessionSummary.cpuPeakTempC} deviceType="cpu" />} tone={temperatureTone(sessionSummary.cpuPeakTempC, 'cpu')} />
          <DetailStat className="overview-session-stat" label={t('overview.sessionSummary.gpuPeak')} value={<TemperatureValue value={sessionSummary.gpuPeakTempC} deviceType="gpu" />} tone={temperatureTone(sessionSummary.gpuPeakTempC, 'gpu')} />
          <DetailStat className="overview-session-stat" label={t('overview.sessionSummary.peakLoad')} value={formatPercent(sessionSummary.peakLoadPercent)} />
          <DetailStat className="overview-session-stat" label={t('overview.sessionSummary.cleaned')} value={formatBytes(sessionSummary.cleanedBytes)} tone="success" />
        </div>
        <button type="button" onClick={resetSessionSummary} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 text-xs font-semibold text-[var(--text-muted)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] hover:text-[var(--text-primary)]">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('overview.sessionSummary.reset')}
        </button>
      </section>

      <div className="overview-summary-strip" style={{ '--overview-summary-columns': summaryGridColumns }}>
        {visibleSummaryCardItems.map((card) => (
          <SummaryTile key={card.id} metricId={card.id} loading={initialMonitoringLoad} icon={card.icon} label={card.label} value={card.value} detail={card.detail} tone={card.tone} />
        ))}
      </div>

      <div className="overview-sections">
        <OverviewSection
          id="cpu"
          loading={initialMonitoringLoad}
          icon={Cpu}
          title={i18n.t('tweaks.subcategories.CPU')}
          subtitle={snapshot?.cpu?.name || i18n.t('interfaceText.processor_unavailable_d6ac8')}
          meta={snapshot?.cpu?.cores ? `${snapshot.cpu.cores} cores / ${snapshot.cpu.threads || i18n.t('interfaceText.n_a_08d2e')} threads` : snapshot?.cpu?.threads ? `${snapshot.cpu.threads} logical processors` : i18n.t('interfaceText.hardware_details_unavailable_c6280')}
          open={openSections.cpu}
          onToggle={toggleSection}
        >
          <MetricRow value={formatPercent(snapshot?.cpu?.usagePercent)} history={snapshot?.cpu?.history}>
            <DetailStat label={i18n.t('interfaceText.temperature_0a906')} value={<TemperatureValue value={snapshot?.cpu?.temperatureC} deviceType="cpu" />} tone={temperatureTone(snapshot?.cpu?.temperatureC, 'cpu')} />
            <DetailStat label={i18n.t('interfaceText.peak_clock_bd074')} value={formatClock(snapshot?.cpu?.clockMHz)} />
            <DetailStat label={i18n.t('interfaceText.package_power_af9a4')} value={formatPower(snapshot?.cpu?.powerW)} />
          </MetricRow>
        </OverviewSection>

        <OverviewSection
          id="gpu"
          loading={initialMonitoringLoad}
          icon={Gpu}
          title={i18n.t('tweaks.subcategories.GPU')}
          subtitle={primaryGpu?.name || i18n.t('interfaceText.graphics_adapter_unavailable_03936')}
          meta={snapshot?.gpus?.length > 1 ? `${snapshot.gpus.length} graphics adapters` : primaryGpu?.memoryTotalMB ? `${formatGb(primaryGpu.memoryTotalMB / 1024)} VRAM` : i18n.t('interfaceText.vram_sensor_unavailable_4df28')}
          tone="cyan"
          open={openSections.gpu}
          onToggle={toggleSection}
        >
          {snapshot?.gpus?.length ? snapshot.gpus.map((gpu, index) => (
            <div className="overview-stacked-metric" key={`${gpu.name}-${index}`}>
              {snapshot.gpus.length > 1 ? <p className="overview-device-label">{gpu.name}</p> : null}
              <MetricRow value={formatPercent(gpu.usagePercent)} history={gpu.history} tone="cyan">
                <DetailStat label={i18n.t('interfaceText.temperature_0a906')} value={<TemperatureValue value={gpu.temperatureC} deviceType="gpu" />} tone={temperatureTone(gpu.temperatureC, 'gpu')} />
                <DetailStat label={i18n.t('interfaceText.vram_usage_bd5bd')} value={formatGbPair(gpu.memoryUsedMB === null ? null : gpu.memoryUsedMB / 1024, gpu.memoryTotalMB === null ? null : gpu.memoryTotalMB / 1024)} />
                <DetailStat label={i18n.t('interfaceText.power_fan_fa150')} value={`${formatPower(gpu.powerW)} / ${formatRpm(gpu.fanRpm)}`} />
              </MetricRow>
            </div>
          )) : <span className="overview-unavailable">{i18n.t('interfaceText.graphics_sensors_unavailable_62dfb')}</span>}
        </OverviewSection>

        <OverviewSection
          id="memory"
          loading={initialMonitoringLoad}
          icon={MemoryStick}
          title={i18n.t('tweaks.subcategories.Memory')}
          subtitle={[formatGb(snapshot?.memory?.totalGB), snapshot?.memory?.type].filter((entry) => entry && entry !== 'N/A').join(' ') || i18n.t('interfaceText.physical_memory_4c7be')}
          meta={snapshot?.memory?.modules ? `${snapshot.memory.modules} module(s)` : i18n.t('interfaceText.module_data_unavailable_2fefa')}
          tone="blue"
          open={openSections.memory}
          onToggle={toggleSection}
        >
          <MetricRow value={formatGb(snapshot?.memory?.usedGB)} history={snapshot?.memory?.history} tone="blue">
            <DetailStat label={i18n.t('interfaceText.usage_0bb18')} value={formatPercent(snapshot?.memory?.usagePercent)} />
            <DetailStat label={i18n.t('interfaceText.speed_2d2cb')} value={toFiniteNumber(snapshot?.memory?.speedMTs) === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(snapshot.memory.speedMTs)} MT/s`} />
            <DetailStat label={i18n.t('interfaceText.spd_timings_ffe21')} value={formatTimings(snapshot?.memory?.timingsNs)} />
          </MetricRow>
        </OverviewSection>

        <OverviewSection
          id="storage"
          loading={initialMonitoringLoad}
          icon={HardDrive}
          title={i18n.t('interfaceText.storage_9e092')}
          subtitle={snapshot?.storage?.length ? `${snapshot.storage.length} drive(s)` : i18n.t('interfaceText.no_drives_detected_af318')}
          meta={totalStorage.capacityGB ? `${formatGb(totalStorage.capacityGB)} total capacity` : i18n.t('interfaceText.capacity_unavailable_efc25')}
          tone="blue"
          open={openSections.storage}
          onToggle={toggleSection}
        >
          <div className="overview-table-wrap">
            <table className="overview-table overview-storage-table">
              <thead>
                <tr>
                  <th>{i18n.t('interfaceText.drive_a02bb')}</th>
                  <th>{i18n.t('interfaceText.capacity_45bd9')}</th>
                  <th>{i18n.t('dashboard.performance.used')}</th>
                  <th>{i18n.t('interfaceText.temp_a2c04')}</th>
                  <th>{i18n.t('interfaceText.read_852b4')}</th>
                  <th>{i18n.t('interfaceText.write_4a489')}</th>
                  <th>{i18n.t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.storage?.length ? snapshot.storage.map((drive) => (
                  <tr key={drive.driveLetter || drive.name}>
                    <td className="overview-drive-name" title={[drive.driveLetter, drive.diskModel || drive.name].filter(Boolean).join(' ')}>
                      <strong>{drive.driveLetter || i18n.t('interfaceText.drive_a02bb')}</strong>
                      <span>{drive.diskModel || drive.name || drive.fileSystem || drive.type}</span>
                    </td>
                    <td>{formatGb(drive.capacityGB)}</td>
                    <td>
                      <div className="overview-used-cell">
                        <span className="overview-used-bar"><i style={{ width: `${Math.max(0, Math.min(100, toFiniteNumber(drive.usagePercent) || 0))}%` }} /></span>
                        {formatPercent(drive.usagePercent)}
                      </div>
                    </td>
                    <td><TemperatureValue value={drive.temperatureC} /></td>
                    <td>{toFiniteNumber(drive.readMBs) === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(drive.readMBs, 1)} MB/s`}</td>
                    <td>{toFiniteNumber(drive.writeMBs) === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(drive.writeMBs, 1)} MB/s`}</td>
                    <td><StatusValue status={drive.healthStatus} /></td>
                  </tr>
                )) : <tr><td colSpan={7} className="overview-empty-table">{i18n.t('interfaceText.storage_information_unavailable_ae3d4')}</td></tr>}
              </tbody>
            </table>
          </div>
        </OverviewSection>

        <OverviewSection
          id="network"
          loading={initialMonitoringLoad}
          icon={Network}
          title={i18n.t('tweaks.categories.Network')}
          subtitle={primaryNetwork?.name || i18n.t('interfaceText.active_adapter_unavailable_5abc6')}
          meta={primaryNetwork ? `${primaryNetwork.status || i18n.t('tweakDetails.unknown')}${primaryNetwork.linkSpeedMbps ? ` / ${formatMbps(primaryNetwork.linkSpeedMbps)} link` : ''}${toFiniteNumber(networkQuality?.gatewayLatencyMs) === null ? '' : ` / Gateway ${formatNumber(networkQuality.gatewayLatencyMs, 1)} ms`}` : i18n.t('interfaceText.live_counters_unavailable_23c10')}
          tone="cyan"
          open={openSections.network}
          onToggle={toggleSection}
        >
          {networkRows.length ? networkRows.map((adapter, index) => (
            <div className="overview-stacked-metric" key={`${adapter.name}-${index}`}>
              {networkRows.length > 1 ? <p className="overview-device-label">{adapter.name}</p> : null}
              <MetricRow label={i18n.t('dashboard.metricsCards.networkIn')} value={formatMbps(adapter.downloadMbps)} history={adapter.history} tone="cyan" graphVariant="network">
                <DetailStat label={i18n.t('dashboard.metricsCards.networkOut')} value={formatMbps(adapter.uploadMbps)} />
                <DetailStat label={i18n.t('tweaks.categories.Latency')} value={formatQualityLatency(index === 0 ? networkQuality : null)} title={index === 0 ? qualityTargetHint : ''} />
                <DetailStat label={i18n.t('interfaceText.packet_loss_bad56')} value={formatQualityPacketLoss(index === 0 ? networkQuality : null)} title={index === 0 && qualityTargetHint ? `${qualityTargetHint}. Packet loss is calculated from recent probe samples.` : ''} />
                <DetailStat label={i18n.t('interfaceText.quality_a60f2')} value={<StatusValue status={qualityStatusLabel(index === 0 ? networkQuality : null)} />} title={index === 0 ? qualityTargetHint : ''} />
              </MetricRow>
            </div>
          )) : <span className="overview-unavailable">{i18n.t('interfaceText.network_counters_unavailable_47966')}</span>}
        </OverviewSection>

        <OverviewSection
          id="cooling"
          loading={initialMonitoringLoad}
          icon={Fan}
          title={i18n.t('interfaceText.cooling_sensors_8ecec')}
          subtitle={cooling.fans?.length || cooling.temperatures?.length ? i18n.t('interfaceText.live_sensor_readings_82e10') : i18n.t('interfaceText.advanced_sensors_unavailable_255d1')}
          meta={`${cooling.fans?.length || 0} fans / ${cooling.temperatures?.length || 0} temperatures`}
          open={openSections.cooling}
          onToggle={toggleSection}
        >
          <div className="overview-sensor-groups">
            <SensorGroup
              title={i18n.t('interfaceText.fans_rpm_cbbf2')}
              items={(cooling.fans || []).slice(0, 4)}
              renderItem={(fan) => <DetailStat key={`${fan.hardwareName}-${fan.name}`} label={fan.name || fan.hardwareName || i18n.t('interfaceText.fan_ec384')} value={formatRpm(fan.rpm)} />}
            />
            <SensorGroup
              title={i18n.t('interfaceText.temperatures_89574')}
              items={(cooling.temperatures || []).slice(0, 5)}
              renderItem={(sensor) => <DetailStat key={`${sensor.hardwareName}-${sensor.name}`} label={sensor.name || sensor.hardwareName || i18n.t('interfaceText.sensor_9101f')} value={<TemperatureValue value={sensor.valueC} />} tone="success" />}
            />
            <SensorGroup
              title={i18n.t('interfaceText.voltages_91524')}
              items={(cooling.voltages || []).slice(0, 4)}
              renderItem={(sensor) => <DetailStat key={`${sensor.hardwareName}-${sensor.name}`} label={sensor.name || sensor.hardwareName || i18n.t('interfaceText.rail_0ed86')} value={toFiniteNumber(sensor.valueV) === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(sensor.valueV, 2)} V`} />}
            />
          </div>
        </OverviewSection>

        <OverviewSection
          id="processes"
          loading={initialMonitoringLoad}
          icon={Activity}
          title={i18n.t('interfaceText.processes_activity_c118c')}
          subtitle={i18n.t('interfaceText.top_resource_usage_96641')}
          meta={snapshot?.processes?.length ? `${snapshot.processes.length} active entries` : i18n.t('interfaceText.activity_unavailable_d1aaf')}
          open={openSections.processes}
          onToggle={toggleSection}
        >
          <div className="overview-table-wrap">
            <table className="overview-table overview-process-table">
              <thead>
                <tr>
                  <th>{i18n.t('gameMode.detection.processLabel')}</th>
                  <th>CPU</th>
                  <th>GPU</th>
                  <th>RAM</th>
                  <th>{i18n.t('interfaceText.disk_ef995')}</th>
                  <th>Network</th>
                  <th>{i18n.t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.processes?.length ? snapshot.processes.map((processInfo) => (
                  <tr key={`${processInfo.pid}-${processInfo.name}`}>
                    <td className="overview-process-name" title={processInfo.name}>
                      {processInfo.name}
                      <span>{processInfo.pid || ''}</span>
                    </td>
                    <td>{formatPercent(processInfo.cpuPercent)}</td>
                    <td>{formatPercent(processInfo.gpuPercent)}</td>
                    <td>{toFiniteNumber(processInfo.ramMB) === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(processInfo.ramMB, 0)} MB`}</td>
                    <td>{toFiniteNumber(processInfo.diskMBs) === null ? i18n.t('interfaceText.n_a_08d2e') : `${formatNumber(processInfo.diskMBs, 1)} MB/s`}</td>
                    <td>{formatMbps(processInfo.networkMbps)}</td>
                    <td><StatusValue status={processInfo.status} /></td>
                  </tr>
                )) : <tr><td colSpan={7} className="overview-empty-table">{i18n.t('interfaceText.process_counters_unavailable_245f9')}</td></tr>}
              </tbody>
            </table>
          </div>
        </OverviewSection>
      </div>

      <footer className="overview-footer">
        {initialMonitoringLoad ? (
          <>
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5 w-32" />
          </>
        ) : (
          <>
            <span>{i18n.t('interfaceText.refresh_17a8b')} {snapshot?.system?.refreshRateMs ? `${snapshot.system.refreshRateMs / 1000}s` : i18n.t('interfaceText.n_a_08d2e')}</span>
            <span>{i18n.t('interfaceText.last_updated_f5276')} {formatLastUpdated(snapshot?.system?.lastUpdated)}</span>
          </>
        )}
      </footer>
    </PageShell>
  );
}

export default OverviewPanel;
