import i18n from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Cpu,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Gamepad2,
  Gauge,
  Info,
  MemoryStick,
  MonitorCheck,
  Network,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Thermometer
} from 'lucide-react';
import { Button, IconBadge, ModalShell, PageHeader, PageShell, PremiumBadge, StatusPill, Switch } from './ui';

const POLL_INTERVAL_MS = 5000;
const STALE_GAME_KEEP_MS = 12000;
const GAME_MODE_PRESET_SELECTION_CLOUDFLARE = 'Cloudflare (1.1.1.1 / 1.0.0.1)';
const GAME_MODE_PRESET_TWEAKS = [
  {
    id: 'nova_ultimate_powerplan',
    label: 'Nova Tweaks Ultimate Powerplan'
  },
  {
    id: 'clear_standby_list',
    label: 'Clear Standby Memory'
  },
  {
    id: 'xbox_services',
    label: 'Disable Xbox Services'
  },
  {
    id: 'windows_game_mode',
    label: 'Enable Windows Game Mode'
  },
  {
    id: 'set_timer_resolution',
    label: 'Set Timerresolution',
    params: {
      Resolution: '0.5'
    },
    expectedResolution: '0.5'
  },
  {
    id: 'set_dns_provider',
    label: 'Set DNS Provider',
    params: {
      Selection: GAME_MODE_PRESET_SELECTION_CLOUDFLARE
    },
    expectedSelection: GAME_MODE_PRESET_SELECTION_CLOUDFLARE
  },
  {
    id: 'hardware_accelerated_gpu',
    label: 'Enable Hardware Accelerated GPU Scheduling'
  }
];
const LUCIDE_ICON_PROPS = {
  size: 18,
  strokeWidth: 1.8
};
const SESSION_INSIGHT_SEVERITY_ORDER = {
  critical: 0,
  warning: 1,
  good: 2,
  info: 3
};

function toIconSource(iconDataUrl) {
  const candidate = String(iconDataUrl || '').trim();
  return candidate.startsWith('data:image/') ? candidate : '';
}

function GameIcon({ iconSource, label, className = '' }) {
  const normalizedLabel = String(label || '').trim();

  return (
    <span className={`game-mode-game-icon ${className}`.trim()} aria-hidden="true">
      {iconSource ? (
        <img src={iconSource} alt="" />
      ) : (
        <Gamepad2 {...LUCIDE_ICON_PROPS} />
      )}
      <span className="sr-only">{normalizedLabel}</span>
    </span>
  );
}

function normalizePriorityClass(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const normalized = raw.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isHighPriorityClass(value) {
  return String(value || '').trim().toLowerCase() === 'high';
}

function isHighPriorityConfigured(game) {
  if (typeof game?.priorityConfigured === 'boolean') {
    return game.priorityConfigured;
  }

  return isHighPriorityClass(game?.priorityClass);
}

function getExecutableName(executablePath) {
  const normalizedPath = String(executablePath || '').trim();
  if (!normalizedPath) {
    return '';
  }

  return normalizedPath.split(/[\\/]/).filter(Boolean).pop() || '';
}

function getLogicalProcessorCount(game) {
  const count = Number(game?.logicalProcessorCount);
  return Number.isFinite(count) && count > 0 ? Math.min(64, Math.trunc(count)) : 0;
}

function createProcessorList(count) {
  const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Math.min(64, Math.trunc(Number(count)))) : 0;
  return Array.from({ length: normalizedCount }, (_entry, index) => index);
}

function normalizeProcessorList(value, count) {
  const maxCount = Number.isFinite(Number(count)) ? Math.max(0, Math.min(64, Math.trunc(Number(count)))) : 0;
  if (!maxCount) {
    return [];
  }

  const source = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      source
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry))
        .map((entry) => Math.trunc(entry))
        .filter((entry) => entry >= 0 && entry < maxCount)
    )
  ).sort((left, right) => left - right);
}

function areProcessorListsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

function uniqueTextValues(values) {
  return Array.from(
    new Set(
      values
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  );
}

function formatAffinitySummary(processors, logicalProcessorCount, t) {
  if (!logicalProcessorCount || !processors.length) {
    return t('gameMode.tuning.affinityUnknown');
  }

  if (processors.length === logicalProcessorCount) {
    return t('gameMode.tuning.affinityAll');
  }

  return t('gameMode.tuning.affinityCustom', {
    count: processors.length,
    total: logicalProcessorCount
  });
}

function normalizePresetId(value) {
  return String(value || '').trim();
}

function normalizeSelectionValue(value) {
  return String(value || '').trim();
}

function normalizeResolutionValue(value) {
  return String(value || '').trim().replace(',', '.');
}

function isPresetTweakActive(tweak, presetDefinition) {
  if (String(tweak?.currentState || '').trim().toLowerCase() !== 'enabled') {
    return false;
  }

  if (presetDefinition.expectedSelection) {
    return normalizeSelectionValue(tweak?.selectedOption) === normalizeSelectionValue(presetDefinition.expectedSelection);
  }

  if (presetDefinition.expectedResolution) {
    return normalizeResolutionValue(tweak?.selectedResolution || tweak?.currentResolution) === normalizeResolutionValue(presetDefinition.expectedResolution);
  }

  return true;
}

function valueOrUnavailable(value, formatter) {
  if (!hasFiniteValue(value)) return i18n.t('networkTest.mtu.status.unavailable');
  const numeric = Number(value);
  return formatter(numeric);
}

function formatNumber(value, digits = 0) {
  if (!hasFiniteValue(value)) return i18n.t('networkTest.mtu.status.unavailable');
  const numeric = Number(value);
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatPercent(value) {
  return valueOrUnavailable(value, (numeric) => `${formatNumber(numeric, 0)}%`);
}

function formatFps(value) {
  return valueOrUnavailable(value, (numeric) => `${formatNumber(numeric, 1)} FPS`);
}

function formatMs(value) {
  return valueOrUnavailable(value, (numeric) => `${formatNumber(numeric, numeric < 10 ? 2 : 1)} ms`);
}

function formatTemp(value) {
  return valueOrUnavailable(value, (numeric) => `${formatNumber(numeric, 0)} C`);
}

function formatMemoryMb(value) {
  if (!hasFiniteValue(value)) return i18n.t('networkTest.mtu.status.unavailable');
  const numeric = Number(value);
  if (numeric >= 1024) {
    return `${formatNumber(numeric / 1024, 1)} GB`;
  }
  return `${formatNumber(numeric, 0)} MB`;
}

function formatDuration(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.max(0, Math.round(numeric));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function hasFiniteValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function formatShortSessionTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return `${isToday ? i18n.t('interfaceText.today_24345') : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function getSessionInsightMetrics(session) {
  return session?.metrics && typeof session.metrics === 'object' ? session.metrics : {};
}

function normalizeCaptureStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status || status === 'idle') return 'Tracking not running';
  if (status === 'starting') return 'Starting';
  if (status === 'connected') return 'Connected';
  if (status === 'running') return 'Tracking';
  if (status === 'capturing') return 'Tracking';
  if (status === 'no_data') return 'No frame data';
  if (status === 'unavailable') return 'FPS monitoring unavailable';
  if (status === 'failed') return 'FPS monitoring unavailable';
  if (status === 'stopped') return 'Stopped';
  return status;
}

function getSessionMetric(session, key) {
  const value = session?.metrics?.[key];
  return hasFiniteValue(value) ? Number(value) : null;
}

function getLiveMetric(session, key) {
  const value = session?.live?.[key];
  return hasFiniteValue(value) ? Number(value) : null;
}

function getActiveProfileLabel({ presetActive, profileId }) {
  const normalizedProfileId = String(profileId || '').trim();
  if (normalizedProfileId) {
    return normalizedProfileId === 'nova-game-mode-preset' ? i18n.t('interfaceText.nova_game_mode_preset_73e0f') : normalizedProfileId;
  }
  return presetActive ? i18n.t('interfaceText.nova_game_mode_preset_73e0f') : i18n.t('interfaceText.no_active_profile_29a70');
}

function buildChartData(session) {
  const history = session?.history && typeof session.history === 'object' ? session.history : {};
  const rowsByTimestamp = new Map();
  const addSeries = (key, targetKey) => {
    const series = Array.isArray(history[key]) ? history[key] : [];
    for (const entry of series) {
      const timestamp = Number(entry?.timestamp);
      const value = Number(entry?.value);
      if (!hasFiniteValue(entry?.timestamp) || !hasFiniteValue(entry?.value)) {
        continue;
      }
      const row = rowsByTimestamp.get(timestamp) || {
        timestamp,
        time: new Date(timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
      };
      row[targetKey] = value;
      rowsByTimestamp.set(timestamp, row);
    }
  };

  addSeries('fps', 'fps');
  addSeries('frametime', 'frametime');
  addSeries('cpu', 'cpu');
  addSeries('gpu', 'gpu');

  return Array.from(rowsByTimestamp.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-120);
}

function GameModeSectionTitle({ title, subtitle, icon: Icon, actions = null }) {
  return (
    <div className="game-mode-section-title">
      <div className="game-mode-section-title__main">
        {Icon ? (
          <IconBadge tone="accent" className="game-mode-section-title__icon">
            <Icon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
          </IconBadge>
        ) : null}
        <div className="min-w-0">
          <h2 className="game-mode-card-title">{title}</h2>
          {subtitle ? <p className="game-mode-card-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="game-mode-section-title__actions">{actions}</div> : null}
    </div>
  );
}

function GameModeOrb({ active, pending, ariaLabel, brand, mode, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={ariaLabel}
      className={`game-mode-orb ${active ? 'is-active' : ''} ${className}`}
    >
      <span className="game-mode-orb__content">
        <Gamepad2 {...LUCIDE_ICON_PROPS} className="game-mode-orb__icon" aria-hidden="true" />
        <span className="game-mode-orb__brand">{brand}</span>
        <span className="game-mode-orb__mode">{mode}</span>
      </span>
    </button>
  );
}

function TuningRow({
  icon: Icon,
  title,
  statusLabel,
  statusTone,
  children
}) {
  return (
    <div className="game-mode-tuning-row">
      <IconBadge tone="accent" className="game-mode-tuning-row__icon">
        <Icon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
      </IconBadge>
      <p className="game-mode-tuning-row__title">{title}</p>
      <div className="game-mode-tuning-row__actions">
        <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
        {children}
      </div>
    </div>
  );
}

function RuntimeTuningCard({
  t,
  canUsePremium,
  hasDetectedGame,
  gameName,
  iconSource,
  hasPendingTuningChanges,
  fullscreenToggleChanged,
  disableFullscreenOptimizations,
  fullscreenToggleStateLabel,
  onFullscreenToggle,
  priorityToggleChanged,
  preferHighPriority,
  priorityToggleStateLabel,
  onPriorityToggle,
  affinityToggleChanged,
  logicalProcessorCount,
  affinityToggleStateLabel,
  onOpenAffinity,
  applyPending,
  onApply,
  onRequestPremium,
  applyMessage,
  applyTone,
  statusMessages
}) {
  const subtitle = hasPendingTuningChanges ? t('gameMode.tuning.pendingSummary') : t('gameMode.tuning.noPendingChanges');
  const actionHint = hasDetectedGame
    ? t('gameMode.tuning.readyForGame', { gameName })
    : t('gameMode.tuning.noGame');

  return (
    <section className="game-mode-card game-mode-runtime-card">
      <GameModeSectionTitle
        title={t('gameMode.tuning.title')}
        subtitle={subtitle}
        icon={SlidersHorizontal}
      />

      <div className="game-mode-tuning-list">
        <TuningRow
          icon={MonitorCheck}
          title={t('gameMode.tuning.fullscreenOptimization')}
          statusLabel={fullscreenToggleStateLabel}
          statusTone={fullscreenToggleChanged ? 'warning' : disableFullscreenOptimizations ? 'accent' : 'neutral'}
        >
          <Switch
            checked={disableFullscreenOptimizations}
            onChange={onFullscreenToggle}
            disabled={!canUsePremium || !hasDetectedGame || applyPending}
            ariaLabel={t('gameMode.tuning.fullscreenOptimization')}
          />
        </TuningRow>

        <TuningRow
          icon={Gauge}
          title={t('gameMode.tuning.highPriority')}
          statusLabel={priorityToggleStateLabel}
          statusTone={priorityToggleChanged ? 'warning' : preferHighPriority ? 'accent' : 'neutral'}
        >
          <Switch
            checked={preferHighPriority}
            onChange={onPriorityToggle}
            disabled={!canUsePremium || !hasDetectedGame || applyPending}
            ariaLabel={t('gameMode.tuning.highPriority')}
          />
        </TuningRow>

        <TuningRow
          icon={Cpu}
          title={t('gameMode.tuning.cpuAffinity')}
          statusLabel={affinityToggleStateLabel}
          statusTone={affinityToggleChanged ? 'warning' : logicalProcessorCount ? 'neutral' : 'neutral'}
        >
          <Button
            type="button"
            onClick={onOpenAffinity}
            variant="secondary"
            size="sm"
            disabled={!canUsePremium || !hasDetectedGame || !logicalProcessorCount || applyPending}
            className="game-mode-manage-button"
          >
            {t('gameMode.tuning.manageAffinity')}
          </Button>
        </TuningRow>
      </div>

      {statusMessages.length > 0 ? (
        <div className="game-mode-alert-stack">
          {statusMessages.map((message) => (
            <p key={message} className="game-mode-alert game-mode-alert--warning">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="game-mode-action-row">
        <Button
          type="button"
          onClick={onApply}
          variant={hasDetectedGame ? 'primary' : 'secondary'}
          size="md"
          loading={applyPending}
          disabled={!canUsePremium || !hasDetectedGame || !hasPendingTuningChanges}
          leftIcon={<Gauge {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
        >
          {t('gameMode.tuning.apply')}
        </Button>
        {!canUsePremium ? (
          <Button type="button" variant="secondary" size="md" onClick={onRequestPremium}>
            {t('gameMode.session.unlock', { defaultValue: 'Unlock' })}
          </Button>
        ) : null}
        <p className={`game-mode-action-row__hint ${hasDetectedGame ? 'is-ready' : ''}`}>
          {hasDetectedGame ? <GameIcon iconSource={iconSource} label={gameName} className="game-mode-game-icon--inline" /> : null}
          {actionHint}
        </p>
      </div>

      {applyMessage ? (
        <p className={`game-mode-message game-mode-message--${applyTone}`}>
          {applyMessage}
        </p>
      ) : null}
    </section>
  );
}

function PremiumInlineNotice({ label = 'Premium', compact = false }) {
  return (
    <PremiumBadge
      className={`game-mode-premium-inline ${compact ? 'is-compact' : ''}`}
      label={label}
    />
  );
}

function DetectedGameHeader({
  t,
  hasDetectedGame,
  hasSelectedGame,
  gameName,
  processName,
  executablePath,
  iconSource,
  session,
  activeProfileLabel,
  autoTracking,
  canUsePremium,
  showSessionControls = true,
  sessionPending,
  sessionMessage,
  sessionTone,
  onStartSession,
  onStopSession,
  onToggleAutoTracking,
  onChooseExecutable,
  onRefresh,
  refreshing,
  onRequestPremium
}) {
  const recording = session?.sessionStatus === 'recording';
  const captureStatusLabel = normalizeCaptureStatus(session?.captureStatus);

  return (
    <section className="game-mode-card game-mode-control-center">
      <div className="game-mode-control-center__identity">
        <GameIcon
          iconSource={hasSelectedGame ? iconSource : ''}
          label={gameName}
          className="game-mode-game-icon--hero"
        />
        <div className="min-w-0">
          <p className="game-mode-caption">{t('gameMode.controlCenter.caption', { defaultValue: 'Detected Game' })}</p>
          <h2 className="game-mode-control-center__title" title={gameName}>
            {hasSelectedGame ? gameName : t('gameMode.detection.noGameShort')}
          </h2>
          <div className="game-mode-control-center__meta">
            <span title={processName}>{processName || t('gameMode.detection.processLabel')}</span>
            <span>{activeProfileLabel}</span>
          </div>
          {executablePath ? (
            <p className="game-mode-control-center__path" title={executablePath}>
              {executablePath}
            </p>
          ) : null}
        </div>
      </div>

      <div className="game-mode-control-center__actions">
        {showSessionControls ? (
          <div className="game-mode-auto-tracking">
            <div className="min-w-0">
              <p>{t('gameMode.session.autoTracking', { defaultValue: 'Auto tracking' })}</p>
              <span>{canUsePremium ? captureStatusLabel : t('gameMode.session.premiumFeature', { defaultValue: 'Premium session feature' })}</span>
            </div>
            <Switch
              checked={autoTracking}
              onChange={onToggleAutoTracking}
              disabled={!canUsePremium}
              ariaLabel={t('gameMode.session.autoTracking', { defaultValue: 'Auto tracking' })}
            />
          </div>
        ) : null}

        <div className="game-mode-control-center__button-row">
          {showSessionControls ? (
            <Button
              type="button"
              onClick={recording ? onStopSession : onStartSession}
              variant={recording ? 'danger' : 'primary'}
              size="md"
              loading={sessionPending}
              disabled={sessionPending || !hasSelectedGame || !canUsePremium}
              leftIcon={recording ? <Square {...LUCIDE_ICON_PROPS} aria-hidden="true" /> : <Play {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
            >
              {recording
                ? t('gameMode.session.stop', { defaultValue: 'Stop Session' })
                : t('gameMode.session.start', { defaultValue: 'Start Session' })}
            </Button>
          ) : null}
          {showSessionControls && !canUsePremium ? (
            <Button type="button" variant="secondary" size="md" onClick={onRequestPremium}>
              {t('gameMode.session.unlock', { defaultValue: 'Unlock' })}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={onRefresh}
            variant="secondary"
            size="md"
            loading={refreshing}
            leftIcon={<RotateCcw {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
          >
            {t('gameMode.detection.refresh')}
          </Button>
          <Button
            type="button"
            onClick={onChooseExecutable}
            variant="ghost"
            size="md"
            leftIcon={<FolderOpen {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
          >
            {t('gameMode.session.selectExe', { defaultValue: 'Select EXE' })}
          </Button>
        </div>
        {showSessionControls && !canUsePremium ? <PremiumInlineNotice label={t('gameMode.premiumBadge')} /> : null}
        {sessionMessage ? (
          <p className={`game-mode-message game-mode-message--${sessionTone}`}>
            {sessionMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function LiveMetricCard({ icon: Icon, label, value, detail, premium = false, priority = false }) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  const unavailable =
    !normalizedValue ||
    normalizedValue === 'unavailable' ||
    normalizedValue === 'tracking not running' ||
    normalizedValue === 'waiting for session' ||
    normalizedValue === 'no frame data' ||
    normalizedValue.includes('unavailable');
  return (
    <div className={`game-mode-live-metric-card ${priority ? 'is-priority' : ''} ${unavailable ? 'is-empty' : ''}`}>
      <div className="game-mode-live-metric-card__top">
        <IconBadge tone="accent" className="game-mode-live-metric-card__icon">
          <Icon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
        </IconBadge>
        <p className="game-mode-live-metric-card__label">{label}</p>
        {premium ? <PremiumInlineNotice label={i18n.t('gameMode.premiumBadge')} compact /> : null}
      </div>
      <p className="game-mode-live-metric-card__value">{unavailable ? '--' : value}</p>
      <p className="game-mode-live-metric-card__detail">{unavailable ? i18n.t('interfaceText.no_live_data_3cbfe') : detail}</p>
    </div>
  );
}

function LiveMetricsGroup({ title, description, actions = null, children }) {
  return (
    <div className="game-mode-live-metrics-group">
      <div className="game-mode-live-metrics-group__header">
        <div className="min-w-0">
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="game-mode-live-metrics-grid">
        {children}
      </div>
    </div>
  );
}

function MetricTile({ icon: Icon, label, value, detail, premium = false }) {
  return (
    <div className="game-mode-metric-tile">
      <IconBadge tone="accent" className="game-mode-metric-tile__icon">
        <Icon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
      </IconBadge>
      <div className="game-mode-metric-tile__body">
        <div className="game-mode-metric-tile__top">
          <p className="game-mode-metric-tile__label">{label}</p>
          {premium ? <PremiumInlineNotice label={i18n.t('gameMode.premiumBadge')} compact /> : null}
        </div>
        <p className="game-mode-metric-tile__value">{value}</p>
        {detail ? <p className="game-mode-metric-tile__detail">{detail}</p> : null}
      </div>
    </div>
  );
}

function LiveGameMetrics({
  t,
  session,
  gameName,
  iconSource,
  capture,
  captureAvailability,
  canUsePremium,
  onRetryMonitoring,
  retryPending
}) {
  const captureStatus = String(capture?.status || session?.captureStatus || '').toLowerCase();
  const recording = session?.sessionStatus === 'recording';
  const waitingLabel = t('gameMode.metrics.waiting', { defaultValue: 'Waiting for session' });
  const fpsUnavailable = recording ? normalizeCaptureStatus(captureStatus) : waitingLabel;
  const chartData = useMemo(() => buildChartData(session), [session]);
  const frametimeSeries = chartData.filter((row) => Number.isFinite(row.frametime));
  const latestFrametime = frametimeSeries.length ? frametimeSeries[frametimeSeries.length - 1].frametime : null;
  const providerLabel = String(capture?.selectedProvider || capture?.provider || captureAvailability?.selectedProvider || '').trim();
  const statusDetail = String(capture?.message || captureAvailability?.message || '').trim();
  const retryable = recording && canUsePremium && ['failed', 'unavailable', 'no_data'].includes(captureStatus) && typeof onRetryMonitoring === 'function';
  const frameFallback = ['starting', 'connected', 'running'].includes(captureStatus)
    ? t('gameMode.metrics.noFrameData', { defaultValue: 'No frame data' })
    : fpsUnavailable;
  const sessionStatusLabel = recording ? i18n.t('interfaceText.recording_9b98e') : i18n.t('interfaceText.not_recording_ccde0');
  const statusLabel = recording ? normalizeCaptureStatus(captureStatus) : i18n.t('interfaceText.waiting_for_samples_c006f');
  const statusValue = statusDetail || statusLabel;

  function formatCapturedMetric(value, formatter) {
    if (!canUsePremium || !recording) {
      return fpsUnavailable;
    }

    return hasFiniteValue(value) ? formatter(value) : frameFallback;
  }

  const metrics = [
    {
      icon: Gauge,
      label: i18n.t('interfaceText.current_fps_b0462'),
      value: formatCapturedMetric(getSessionMetric(session, 'currentFps'), formatFps),
      detail: i18n.t('interfaceText.presentmon_service_b14d0')
    },
    {
      icon: Clock,
      label: i18n.t('interfaceText.frametime_1e32a'),
      value: formatCapturedMetric(latestFrametime, formatMs),
      detail: i18n.t('interfaceText.current_ms_cb7b0')
    },
    {
      icon: Activity,
      label: i18n.t('interfaceText.1_low_18710'),
      value: formatCapturedMetric(getSessionMetric(session, 'onePercentLow'), formatFps),
      detail: i18n.t('interfaceText.real_frame_samples_05d75')
    },
    {
      icon: Network,
      label: 'Latency',
      value: recording ? formatMs(getLiveMetric(session, 'latencyMs')) : waitingLabel,
      detail: i18n.t('interfaceText.network_probe_4d609')
    },
    {
      icon: Thermometer,
      label: i18n.t('interfaceText.gpu_temp_51769'),
      value: recording ? formatTemp(getLiveMetric(session, 'gpuTempC')) : waitingLabel,
      detail: i18n.t('interfaceText.sensor_value_aaca9')
    },
    {
      icon: Cpu,
      label: i18n.t('dashboard.metricsCards.cpu'),
      value: recording ? formatPercent(getLiveMetric(session, 'cpuUsagePercent')) : waitingLabel,
      detail: i18n.t('interfaceText.system_monitor_177a6')
    },
    {
      icon: MemoryStick,
      label: 'RAM / VRAM',
      value: recording
        ? `${formatMemoryMb(getLiveMetric(session, 'ramUsedMB'))} / ${formatMemoryMb(getLiveMetric(session, 'vramUsedMB'))}`
        : waitingLabel,
      detail: i18n.t('interfaceText.current_usage_e184f')
    },
    {
      icon: Network,
      label: i18n.t('interfaceText.packet_loss_bad56'),
      value: recording
        ? formatPercent(getLiveMetric(session, 'packetLossPercent'))
        : waitingLabel,
      detail: i18n.t('interfaceText.network_probe_4d609')
    }
  ];
  const primaryMetrics = metrics.slice(0, 4);
  const systemMetrics = metrics.slice(4);

  return (
    <section className="game-mode-card">
      <GameModeSectionTitle
        title={t('gameMode.metrics.title', { defaultValue: 'Live Game Metrics' })}
        subtitle={t('gameMode.metrics.subtitle', { defaultValue: 'Only real capture and monitoring samples are shown.' })}
        icon={Gauge}
        actions={retryable ? (
          <Button
            type="button"
            onClick={onRetryMonitoring}
            variant="secondary"
            size="sm"
            loading={retryPending}
            leftIcon={<RotateCcw {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
          >
            {i18n.t('interfaceText.retry_9f5cd')}
          </Button>
        ) : null}
      />
      <div className="game-mode-live-status-strip">
        {[
          { icon: Play, label: i18n.t('interfaceText.session_f7f19'), value: sessionStatusLabel },
          { icon: Gamepad2, label: i18n.t('interfaceText.game_e3e82'), value: recording ? session?.gameName || gameName : gameName, gameIcon: true },
          { icon: MonitorCheck, label: i18n.t('apps.startup.sourcePathLabel'), value: providerLabel || i18n.t('settingsPanel.legal.presentMonTitle') },
          { icon: Clock, label: i18n.t('tweaks.fix.result.durationLabel'), value: formatDuration(session?.durationSeconds) },
          { icon: Activity, label: i18n.t('common.status'), value: statusValue }
        ].map((item) => {
          const ItemIcon = item.icon;
          return (
            <div key={item.label} className="game-mode-live-status-item">
              {item.gameIcon && iconSource ? (
                <GameIcon iconSource={iconSource} label={item.value} className="game-mode-game-icon--status" />
              ) : (
                <IconBadge tone="accent" className="game-mode-live-status-item__icon">
                  <ItemIcon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                </IconBadge>
              )}
              <div className="min-w-0">
                <span>{item.label}</span>
                <strong>{item.value || i18n.t('networkTest.mtu.status.unavailable')}</strong>
              </div>
            </div>
          );
        })}
      </div>

      <LiveMetricsGroup
        title={i18n.t('interfaceText.primary_metrics_0ffef')}
        description={i18n.t('interfaceText.frame_and_input_sensitive_signals_af5b3')}
        actions={<span className="game-mode-live-priority-pill"><Gauge {...LUCIDE_ICON_PROPS} aria-hidden="true" /> {i18n.t('interfaceText.priority_view_770f8')}</span>}
      >
        {primaryMetrics.map((metric) => (
          <LiveMetricCard
            key={metric.label}
            {...metric}
            priority
            premium={!canUsePremium && ['Current FPS', '1% Low', 'Frametime'].includes(metric.label)}
          />
        ))}
      </LiveMetricsGroup>

      <LiveMetricsGroup title={i18n.t('dashboard.systemMetrics.title')} description={i18n.t('interfaceText.hardware_and_network_context_d8c55')}>
        {systemMetrics.map((metric) => (
          <LiveMetricCard key={metric.label} {...metric} />
        ))}
      </LiveMetricsGroup>

      <div className="game-mode-live-metrics-footer">
        <span><ShieldCheck {...LUCIDE_ICON_PROPS} aria-hidden="true" /> {i18n.t('interfaceText.metrics_will_appear_automatically_once_capture_begins_and_live_da_7ad23')}</span>
        {!recording ? (
          <strong><Activity {...LUCIDE_ICON_PROPS} aria-hidden="true" /> {i18n.t('interfaceText.start_recording_to_see_live_metrics_e1087')}</strong>
        ) : null}
      </div>
    </section>
  );
}

function LivePerformanceGraph({ t, session }) {
  const chartData = useMemo(() => buildChartData(session), [session]);
  const hasFrameSeries = chartData.some((row) => Number.isFinite(row.fps) || Number.isFinite(row.frametime));
  const hasCpuSeries = chartData.some((row) => Number.isFinite(row.cpu));
  const hasGpuSeries = chartData.some((row) => Number.isFinite(row.gpu));
  const emptyLabel = session?.sessionStatus === 'recording'
    ? t('gameMode.graph.collecting', { defaultValue: 'Collecting live history' })
    : t('gameMode.graph.empty', { defaultValue: 'Start a session to collect graph history' });
  const tooltipStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    boxShadow: 'var(--card-shadow-item)'
  };

  function renderSystemChart({ dataKey, label, className }) {
    const hasSeries = dataKey === 'cpu' ? hasCpuSeries : hasGpuSeries;

    return (
      <div className="game-mode-system-chart">
        <div className="game-mode-system-chart__header">
          <span>{label}</span>
          <i className={className} aria-hidden="true" />
        </div>
        {chartData.length > 1 && hasSeries ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 5" stroke="color-mix(in srgb, var(--chart-grid) 46%, transparent)" vertical={false} />
              <XAxis dataKey="time" stroke="color-mix(in srgb, var(--text-muted) 70%, transparent)" minTickGap={24} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" width={32} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <Tooltip
                cursor={false}
                formatter={(value) => [formatPercent(value), label]}
                contentStyle={tooltipStyle}
              />
              <Line type="monotone" dataKey={dataKey} stroke={`var(--gm-series-${dataKey})`} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="game-mode-chart-empty is-compact">{emptyLabel}</div>
        )}
      </div>
    );
  }

  return (
    <section className="game-mode-card">
      <GameModeSectionTitle
        title={t('gameMode.graph.title', { defaultValue: 'Live Performance Graph' })}
        subtitle={t('gameMode.graph.subtitle', { defaultValue: 'History is built only from live session samples.' })}
        icon={BarChart3}
      />
      <div className="game-mode-performance-chart">
        <div className="game-mode-chart-legend" aria-hidden="true">
          <span><i className="is-fps" />FPS</span>
          <span><i className="is-frametime" />{i18n.t('interfaceText.frametime_1e32a')}</span>
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 5" stroke="color-mix(in srgb, var(--chart-grid) 58%, transparent)" vertical={false} />
              <XAxis dataKey="time" stroke="color-mix(in srgb, var(--text-muted) 76%, transparent)" minTickGap={28} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis stroke="color-mix(in srgb, var(--text-muted) 72%, transparent)" width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={false}
                formatter={(value, name) => {
                  if (name === 'fps') return [formatFps(value), 'FPS'];
                  if (name === 'frametime') return [formatMs(value), 'Frametime'];
                  return [formatPercent(value), String(name).toUpperCase()];
                }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  boxShadow: 'var(--card-shadow-item)'
                }}
              />
              {hasFrameSeries ? <Line type="monotone" dataKey="fps" stroke="var(--gm-series-fps)" strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls /> : null}
              {hasFrameSeries ? <Line type="monotone" dataKey="frametime" stroke="var(--gm-series-frametime)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls /> : null}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="game-mode-chart-empty">
            {emptyLabel}
          </div>
        )}
      </div>
      <div className="game-mode-system-chart-grid">
        {renderSystemChart({ dataKey: 'cpu', label: i18n.t('dashboard.metricsCards.cpu'), className: 'is-cpu' })}
        {renderSystemChart({ dataKey: 'gpu', label: i18n.t('dashboard.metricsCards.gpu'), className: 'is-gpu' })}
      </div>
    </section>
  );
}

function ActiveGameProfileCard({
  t,
  activeProfileLabel,
  gameName,
  iconSource,
  presetActive,
  presetPending,
  presetMessage,
  presetTone,
  gameModeButtonAria,
  onRunPreset,
  onRequestPremium,
  session,
  canUsePremium
}) {
  return (
    <section className="game-mode-card">
      <GameModeSectionTitle
        title={t('gameMode.profile.title', { defaultValue: 'Active Game Profile' })}
        subtitle={canUsePremium
          ? t('gameMode.profile.subtitle', { defaultValue: 'Temporary optimization state for this game.' })
          : t('gameMode.profile.lockedSubtitle', { defaultValue: 'Per-game profiles are a Premium feature.' })}
        icon={SlidersHorizontal}
        actions={!canUsePremium ? <PremiumBadge label={t('gameMode.premiumBadge')} /> : null}
      />
      <div className="game-mode-profile-summary">
        <GameIcon iconSource={iconSource} label={gameName} className="game-mode-game-icon--profile" />
        <div>
          <p className="game-mode-profile-summary__label">{i18n.t('account.menu.profile')}</p>
          <p className="game-mode-profile-summary__value">{activeProfileLabel}</p>
        </div>
      </div>
      <div className="game-mode-profile-orb-wrap">
        <GameModeOrb
          active={presetActive}
          pending={presetPending}
          ariaLabel={gameModeButtonAria}
          brand="NOVA"
          mode="GAME MODE"
          onClick={canUsePremium ? onRunPreset : onRequestPremium}
          className="game-mode-profile-orb"
        />
      </div>
      <div className="game-mode-profile-restore">
        <ShieldCheck {...LUCIDE_ICON_PROPS} aria-hidden="true" />
        <span>{session?.restore?.message || i18n.t('interfaceText.auto_restore_after_gaming_is_prepared_for_temporary_profile_sessi_1a8d8')}</span>
      </div>
      {presetMessage ? (
        <p className={`game-mode-message game-mode-message--${presetTone}`}>
          {presetMessage}
        </p>
      ) : null}
    </section>
  );
}

function getInsightStyle(severity) {
  if (severity === 'critical') {
    return { icon: AlertTriangle, label: i18n.t('tweakDetails.risk.critical') };
  }
  if (severity === 'warning') {
    return { icon: AlertTriangle, label: i18n.t('interfaceText.warning_e9c45') };
  }
  if (severity === 'good') {
    return { icon: ShieldCheck, label: i18n.t('dashboard.widgets.systemHealth.good') };
  }
  return { icon: Info, label: i18n.t('emailVerification.badge.info') };
}

function createMetricInsights(session) {
  const insights = [];
  const avgFps = getSessionMetric(session, 'avgFps');
  const onePercentLow = getSessionMetric(session, 'onePercentLow');
  const gpuMaxTempC = getSessionMetric(session, 'gpuMaxTempC');
  const ramPeakMB = getSessionMetric(session, 'ramPeakMB');
  const vramPeakMB = getSessionMetric(session, 'vramPeakMB');
  const avgLatencyMs = getSessionMetric(session, 'avgLatencyMs');
  const packetLossPercent = getSessionMetric(session, 'packetLossPercent');

  if (hasFiniteValue(avgFps)) {
    const lowRatio = hasFiniteValue(onePercentLow) && avgFps > 0 ? onePercentLow / avgFps : null;
    const severity = lowRatio !== null && lowRatio < 0.55 ? 'warning' : 'info';
    insights.push({
      id: 'fps-stability',
      title: severity === 'warning' ? i18n.t('interfaceText.frame_pacing_dipped_during_the_session_2c1f1') : i18n.t('interfaceText.fps_samples_were_captured_6acab'),
      description: severity === 'warning'
        ? i18n.t('interfaceText.the_1_low_was_far_below_average_fps_which_can_feel_like_stutter_a725c')
        : i18n.t('interfaceText.frame_samples_are_available_for_the_recorded_session_013bd'),
      detail: hasFiniteValue(onePercentLow)
        ? `Average: ${formatNumber(avgFps, 1)} FPS / 1% Low: ${formatNumber(onePercentLow, 1)} FPS`
        : `Average: ${formatNumber(avgFps, 1)} FPS`,
      category: 'Performance',
      severity,
      icon: Gauge
    });
  }

  if (hasFiniteValue(gpuMaxTempC)) {
    const severity = gpuMaxTempC >= 88 ? 'critical' : gpuMaxTempC >= 80 ? 'warning' : 'good';
    insights.push({
      id: 'gpu-temperature',
      title: severity === 'good' ? i18n.t('interfaceText.gpu_temperature_stayed_stable_89970') : `GPU temperature peaked at ${formatNumber(gpuMaxTempC, 0)} C`,
      description: severity === 'good'
        ? `Peak temperature was ${formatNumber(gpuMaxTempC, 0)} C, well within safe limits.`
        : i18n.t('interfaceText.temperature_climbed_high_enough_to_review_cooling_fan_curves_or_s_75a66'),
      detail: `Peak: ${formatNumber(gpuMaxTempC, 0)} C`,
      category: 'Thermals',
      severity,
      icon: Thermometer
    });
  }

  if (hasFiniteValue(ramPeakMB)) {
    const ramPeakGb = ramPeakMB / 1024;
    const severity = ramPeakGb >= 14 ? 'warning' : 'info';
    insights.push({
      id: 'ram-peak',
      title: `RAM peak was ${formatNumber(ramPeakGb, 1)} GB`,
      description: severity === 'warning'
        ? i18n.t('interfaceText.high_memory_usage_detected_during_the_session_473cc')
        : i18n.t('interfaceText.memory_usage_stayed_within_normal_bounds_for_this_session_2df17'),
      detail: i18n.t('interfaceText.total_system_ram_unavailable_0043d'),
      category: 'Memory',
      severity,
      icon: MemoryStick
    });
  }

  if (hasFiniteValue(vramPeakMB)) {
    insights.push({
      id: 'vram-peak',
      title: `VRAM peak was ${formatNumber(vramPeakMB / 1024, 1)} GB`,
      description: i18n.t('interfaceText.normal_vram_usage_for_this_session_aeedd'),
      detail: i18n.t('interfaceText.total_vram_unavailable_cf6db'),
      category: 'GPU Memory',
      severity: 'info',
      icon: MonitorCheck
    });
  }

  if (hasFiniteValue(avgLatencyMs)) {
    const severity = packetLossPercent > 0 ? 'warning' : avgLatencyMs >= 100 ? 'warning' : 'info';
    insights.push({
      id: 'network-latency',
      title: severity === 'warning' ? i18n.t('interfaceText.network_quality_needs_attention_ba463') : i18n.t('interfaceText.network_latency_was_stable_55b32'),
      description: severity === 'warning'
        ? i18n.t('interfaceText.latency_or_packet_loss_was_detected_during_gameplay_6f7b3')
        : i18n.t('interfaceText.average_latency_stayed_consistent_during_gameplay_df305'),
      detail: `Average: ${formatNumber(avgLatencyMs, avgLatencyMs < 10 ? 1 : 0)} ms`,
      category: 'Network',
      severity,
      icon: Network
    });
  }

  return insights;
}

function createMessageInsight(message, index, fallbackSeverity = 'info') {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const critical = lower.includes('peaked') && (lower.includes('temperature') || lower.includes('latency'));
  const unavailable = lower.includes('unavailable') || lower.includes('no frame data') || lower.includes('packet loss');
  const stable = lower.includes('stable');
  const category = lower.includes('temperature') || lower.includes('thermal')
    ? i18n.t('interfaceText.thermals_fc36c')
    : lower.includes('vram')
      ? i18n.t('interfaceText.gpu_memory_f1567')
      : lower.includes('ram') || lower.includes('memory')
        ? 'Memory'
        : lower.includes('latency') || lower.includes('packet') || lower.includes('network')
          ? 'Network'
          : 'System';
  const icon = category === 'Thermals'
    ? Thermometer
    : category === 'Memory'
      ? MemoryStick
      : category === 'GPU Memory'
        ? MonitorCheck
        : category === 'Network'
          ? Network
          : Activity;
  const severity = critical ? 'critical' : unavailable ? 'warning' : stable ? 'good' : fallbackSeverity;

  return {
    id: `message-${index}-${text}`,
    title: text.replace(/\.$/, ''),
    description: severity === 'warning'
      ? i18n.t('interfaceText.this_signal_may_need_attention_if_it_persists_across_sessions_ffe21')
      : i18n.t('interfaceText.observed_from_the_recorded_session_samples_7648e'),
    detail: '',
    category,
    severity,
    icon
  };
}

function buildSessionInsights(session) {
  const metricsInsights = createMetricInsights(session);
  const metricIds = new Set(metricsInsights.map((entry) => entry.id));
  const warningInsights = (Array.isArray(session?.warnings) ? session.warnings : [])
    .map((message, index) => createMessageInsight(message, index, 'warning'));
  const messageInsights = (Array.isArray(session?.insights) ? session.insights : [])
    .filter((message) => String(message || '').trim().toLowerCase() !== 'collecting live session data.')
    .map((message, index) => createMessageInsight(message, index, 'info'))
    .filter((entry) => {
      if (entry.category === 'Thermals' && metricIds.has('gpu-temperature')) return false;
      if (entry.category === 'Memory' && metricIds.has('ram-peak')) return false;
      if (entry.category === 'GPU Memory' && metricIds.has('vram-peak')) return false;
      if (entry.category === 'Network' && metricIds.has('network-latency')) return false;
      return true;
    });

  return [...metricsInsights, ...warningInsights, ...messageInsights]
    .sort((left, right) => SESSION_INSIGHT_SEVERITY_ORDER[left.severity] - SESSION_INSIGHT_SEVERITY_ORDER[right.severity])
    .slice(0, 4);
}

function buildFullSessionInsights(session) {
  const metricsInsights = createMetricInsights(session);
  const metricIds = new Set(metricsInsights.map((entry) => entry.id));
  const warningInsights = (Array.isArray(session?.warnings) ? session.warnings : [])
    .map((message, index) => createMessageInsight(message, index, 'warning'));
  const messageInsights = (Array.isArray(session?.insights) ? session.insights : [])
    .filter((message) => String(message || '').trim().toLowerCase() !== 'collecting live session data.')
    .map((message, index) => createMessageInsight(message, index, 'info'))
    .filter((entry) => {
      if (entry.category === 'Thermals' && metricIds.has('gpu-temperature')) return false;
      if (entry.category === 'Memory' && metricIds.has('ram-peak')) return false;
      if (entry.category === 'GPU Memory' && metricIds.has('vram-peak')) return false;
      if (entry.category === 'Network' && metricIds.has('network-latency')) return false;
      return true;
    });

  return [...metricsInsights, ...warningInsights, ...messageInsights]
    .sort((left, right) => SESSION_INSIGHT_SEVERITY_ORDER[left.severity] - SESSION_INSIGHT_SEVERITY_ORDER[right.severity]);
}

function hasSessionAnalysisData(session) {
  if (!session) {
    return false;
  }

  const metrics = getSessionInsightMetrics(session);
  return [
    metrics.avgFps,
    metrics.currentFps,
    metrics.gpuMaxTempC,
    metrics.ramPeakMB,
    metrics.vramPeakMB,
    metrics.avgLatencyMs,
    metrics.packetLossPercent
  ].some(hasFiniteValue);
}

function SessionInsightsCard({ t, session, iconSource, onViewReport, onStartSession }) {
  const hasAnalysisData = hasSessionAnalysisData(session);
  const insights = hasAnalysisData ? buildSessionInsights(session) : [];
  const criticalCount = insights.filter((entry) => entry.severity === 'critical').length;
  const warningCount = insights.filter((entry) => entry.severity === 'warning').length;
  const infoCount = insights.filter((entry) => entry.severity === 'info').length;
  const health = criticalCount > 0 ? 'critical' : warningCount > 1 ? 'warning' : 'good';
  const healthLabel = health === 'critical' ? i18n.t('tweakDetails.risk.critical') : health === 'warning' ? i18n.t('dashboard.widgets.systemHealth.attention') : i18n.t('dashboard.widgets.systemHealth.good');
  const healthDescription = health === 'critical'
    ? i18n.t('interfaceText.critical_issue_detected_d714e')
    : health === 'warning'
      ? i18n.t('interfaceText.review_highlighted_signals_a744c')
      : i18n.t('interfaceText.stable_performance_ea25a');
  const sessionTime = formatShortSessionTime(session?.endedAt || session?.startedAt);
  const lastSessionName = String(session?.gameName || session?.processName || '').trim();

  return (
    <section className="game-mode-card game-mode-session-insights-card">
      <GameModeSectionTitle
        title={t('gameMode.insights.title', { defaultValue: 'Session Insights' })}
        subtitle={t('gameMode.insights.subtitle', { defaultValue: 'Smart summary from FPS, thermals, memory and network samples.' })}
        icon={AlertTriangle}
      />

      {!hasAnalysisData ? (
        <div className="game-mode-insight-empty">
          <IconBadge tone="accent" className="game-mode-insight-empty__icon">
            <BarChart3 {...LUCIDE_ICON_PROPS} aria-hidden="true" />
          </IconBadge>
          <div className="game-mode-insight-empty__copy">
            <strong>{i18n.t('interfaceText.no_session_insights_yet_bc046')}</strong>
            <span>{i18n.t('interfaceText.start_recording_a_game_session_to_analyze_fps_stability_thermals__b84de')}</span>
          </div>
          {typeof onStartSession === 'function' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onStartSession}
              leftIcon={<Play {...LUCIDE_ICON_PROPS} aria-hidden="true" />}
            >
              {i18n.t('interfaceText.start_recording_c4fb9')}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="game-mode-insight-health">
            <div className={`game-mode-insight-health__item is-health is-${health}`}>
              <span className="game-mode-insight-health__ring">
                <ShieldCheck {...LUCIDE_ICON_PROPS} aria-hidden="true" />
              </span>
              <div>
                <p>{i18n.t('interfaceText.session_health_f47cd')}</p>
                <strong>{healthLabel}</strong>
                <span>{healthDescription}</span>
              </div>
            </div>
            {[
              { label: i18n.t('tweakDetails.risk.critical'), value: criticalCount, severity: 'critical', icon: AlertTriangle },
              { label: i18n.t('tweaks.technical.warnings'), value: warningCount, severity: 'warning', icon: AlertTriangle },
              { label: i18n.t('emailVerification.badge.info'), value: infoCount, severity: 'info', icon: Info }
            ].map((entry) => {
              const EntryIcon = entry.icon;
              return (
                <div key={entry.label} className={`game-mode-insight-health__item is-${entry.severity}`}>
                  <p>{entry.label}</p>
                  <strong>{entry.value}</strong>
                  <EntryIcon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                </div>
              );
            })}
            <div className="game-mode-insight-health__item is-last-session">
              <p>{i18n.t('interfaceText.last_session_87024')}</p>
              <div className="game-mode-insight-session">
                <GameIcon iconSource={iconSource} label={lastSessionName || i18n.t('interfaceText.game_session_a524d')} className="game-mode-game-icon--session" />
                <div>
                  <strong>{lastSessionName || i18n.t('interfaceText.game_session_a524d')}</strong>
                  <em>{sessionTime || i18n.t('interfaceText.recently_409f7')}</em>
                </div>
              </div>
            </div>
          </div>

          <div className="game-mode-insight-list-header">
            <h3>{i18n.t('interfaceText.top_insights_8ab7e')}</h3>
            <span>{i18n.t('interfaceText.showing_163d8')} {insights.length} {"of"} {insights.length}</span>
          </div>

          <div className="game-mode-insight-list">
            {insights.map((insight) => {
              const InsightIcon = insight.icon;
              const severityStyle = getInsightStyle(insight.severity);
              const SeverityIcon = severityStyle.icon;
              return (
                <div key={insight.id} className={`game-mode-insight-row is-${insight.severity}`}>
                  <span className="game-mode-insight-row__accent" aria-hidden="true" />
                  <div className="game-mode-insight-row__icon">
                    <InsightIcon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                  </div>
                  <div className="game-mode-insight-row__copy">
                    <strong>{insight.title}</strong>
                    <span>{insight.description}</span>
                    {insight.detail ? <em>{insight.detail}</em> : null}
                  </div>
                  <div className="game-mode-insight-row__badges">
                    <span className="game-mode-insight-row__category">{insight.category}</span>
                    <span className={`game-mode-insight-row__severity is-${insight.severity}`}>
                      <SeverityIcon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                      {severityStyle.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="game-mode-insight-footer">
            <button type="button" onClick={onViewReport} disabled={typeof onViewReport !== 'function'}>
              <BarChart3 {...LUCIDE_ICON_PROPS} aria-hidden="true" />
              {i18n.t('interfaceText.view_full_session_report_3321b')}
            </button>
            <span><Clock {...LUCIDE_ICON_PROPS} aria-hidden="true" /> {i18n.t('interfaceText.auto_analyze_enabled_390d0')}</span>
          </div>
        </>
      )}
    </section>
  );
}

function LastSessionReportCard({ t, report, onViewReport, onExportReport, onOpenReport }) {
  const metrics = report?.metrics || {};
  return (
    <section className="game-mode-card">
      <GameModeSectionTitle
        title={t('gameMode.report.title', { defaultValue: 'Last Session Report' })}
        subtitle={report?.startedAt ? new Date(report.startedAt).toLocaleString() : t('gameMode.report.empty', { defaultValue: 'No saved game session report yet.' })}
        icon={FileText}
      />
      {report ? (
        <>
          <div className="game-mode-report-grid">
            <MetricTile icon={Clock} label={i18n.t('tweaks.fix.result.durationLabel')} value={formatDuration(report.durationSeconds)} detail={report.stopReason || i18n.t('apps.runtimeStatus.stopped')} />
            <MetricTile icon={Gauge} label={i18n.t('interfaceText.avg_fps_a5e9d')} value={formatFps(metrics.avgFps)} detail={i18n.t('settingsPanel.legal.presentMonTitle')} />
            <MetricTile icon={Activity} label="1% / 0.1% Low" value={`${formatFps(metrics.onePercentLow)} / ${formatFps(metrics.pointOnePercentLow)}`} detail={i18n.t('interfaceText.captured_frames_eb0f1')} />
            <MetricTile icon={Thermometer} label={i18n.t('interfaceText.max_gpu_temp_9b351')} value={formatTemp(metrics.gpuMaxTempC)} detail={i18n.t('interfaceText.sensor_peak_229b3')} />
            <MetricTile icon={MemoryStick} label={i18n.t('interfaceText.ram_vram_peak_00c7d')} value={`${formatMemoryMb(metrics.ramPeakMB)} / ${formatMemoryMb(metrics.vramPeakMB)}`} detail={i18n.t('interfaceText.session_peak_49f44')} />
            <MetricTile icon={Network} label={i18n.t('interfaceText.latency_loss_2d3a6')} value={`${formatMs(metrics.avgLatencyMs)} / ${formatPercent(metrics.packetLossPercent)}`} detail={i18n.t('interfaceText.network_probe_4d609')} />
          </div>
          <div className="game-mode-report-actions">
            <Button type="button" variant="secondary" size="sm" onClick={onViewReport} leftIcon={<Eye {...LUCIDE_ICON_PROPS} aria-hidden="true" />}>
              {t('gameMode.report.view', { defaultValue: 'View full report' })}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onExportReport} leftIcon={<Download {...LUCIDE_ICON_PROPS} aria-hidden="true" />}>
              {t('gameMode.report.export', { defaultValue: 'Export report' })}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onOpenReport} leftIcon={<FolderOpen {...LUCIDE_ICON_PROPS} aria-hidden="true" />}>
              {t('gameMode.report.open', { defaultValue: 'Open file' })}
            </Button>
          </div>
        </>
      ) : (
        <div className="game-mode-report-empty">
          <div className="game-mode-report-empty__summary">
            <IconBadge tone="neutral" className="game-mode-report-empty__icon">
              <FileText {...LUCIDE_ICON_PROPS} aria-hidden="true" />
            </IconBadge>
            <div className="min-w-0">
              <strong>{i18n.t('interfaceText.no_saved_game_session_report_yet_fe884')}</strong>
              <span>{i18n.t('interfaceText.once_you_record_a_session_a_detailed_report_will_appear_here_67c74')}</span>
            </div>
          </div>
          <div className="game-mode-report-empty__kpis" aria-hidden="true">
            <div><span>{i18n.t('interfaceText.avg_fps_a5e9d')}</span><strong>--</strong></div>
            <div><span>{i18n.t('interfaceText.1_low_18710')}</span><strong>--</strong></div>
            <div><span>{i18n.t('interfaceText.max_gpu_temp_9b351')}</span><strong>--</strong></div>
            <div><span>{i18n.t('interfaceText.session_duration_24a16')}</span><strong>--</strong></div>
          </div>
        </div>
      )}
    </section>
  );
}

function GameModeFootnote({ t }) {
  return (
    <div className="game-mode-footnote">
      <span className="game-mode-footnote__icon" aria-hidden="true">
        <Info {...LUCIDE_ICON_PROPS} />
      </span>
      <span>{t('gameMode.footnote.foreground', { defaultValue: 'Game detection works best when the game stays in the foreground.' })}</span>
    </div>
  );
}

function getSessionHealthSummary(report) {
  const insights = buildFullSessionInsights(report);
  const criticalCount = insights.filter((entry) => entry.severity === 'critical').length;
  const warningCount = insights.filter((entry) => entry.severity === 'warning').length;
  const health = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'good';

  if (health === 'critical') {
    return {
      health,
      label: i18n.t('tweakDetails.risk.critical'),
      title: i18n.t('interfaceText.critical_signals_detected_9bb33'),
      description: i18n.t('interfaceText.this_session_had_at_least_one_metric_that_should_be_reviewed_befo_e7712')
    };
  }

  if (health === 'warning') {
    return {
      health,
      label: i18n.t('dashboard.widgets.systemHealth.attention'),
      title: i18n.t('interfaceText.a_few_signals_need_attention_2de25'),
      description: i18n.t('interfaceText.nothing_catastrophic_but_the_highlighted_items_may_explain_stutte_c2514')
    };
  }

  return {
    health,
    label: i18n.t('dashboard.widgets.systemHealth.good'),
    title: i18n.t('interfaceText.session_looked_stable_b3941'),
    description: i18n.t('interfaceText.captured_metrics_stayed_in_a_healthy_range_for_this_run_4bda5')
  };
}

function formatDateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : i18n.t('networkTest.mtu.status.unavailable');
}

function formatStopReason(value) {
  const reason = String(value || '').trim();
  if (!reason) return i18n.t('apps.runtimeStatus.stopped');
  if (reason === 'manual') return i18n.t('interfaceText.stopped_manually_965ed');
  if (reason === 'game-exited') return i18n.t('interfaceText.game_exited_1405b');
  return reason
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ReportSection({ title, children, action = null }) {
  return (
    <section className="game-mode-report-section">
      <div className="game-mode-report-section__header">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ReportFact({ label, value }) {
  return (
    <div className="game-mode-report-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SessionReportModal({ t, report, open, onClose }) {
  if (!report) {
    return null;
  }

  const metrics = report.metrics || {};
  const insights = buildFullSessionInsights(report);
  const health = getSessionHealthSummary(report);
  const warnings = uniqueTextValues(Array.isArray(report.warnings) ? report.warnings : []);
  const overviewItems = [
    { icon: Clock, label: i18n.t('tweaks.fix.result.durationLabel'), value: formatDuration(report.durationSeconds), detail: formatStopReason(report.stopReason) },
    { icon: Gauge, label: i18n.t('interfaceText.average_fps_54f2d'), value: formatFps(metrics.avgFps), detail: i18n.t('interfaceText.overall_frame_rate_be203') },
    { icon: Activity, label: i18n.t('interfaceText.1_low_18710'), value: formatFps(metrics.onePercentLow), detail: i18n.t('interfaceText.stutter_indicator_2eaca') },
    { icon: Thermometer, label: i18n.t('interfaceText.max_gpu_temp_9b351'), value: formatTemp(metrics.gpuMaxTempC), detail: i18n.t('interfaceText.thermal_peak_04551') }
  ];
  const detailItems = [
    { icon: Activity, label: '0.1% Low', value: formatFps(metrics.pointOnePercentLow), detail: i18n.t('interfaceText.worst_frame_pacing_d38af') },
    { icon: Gauge, label: i18n.t('interfaceText.p95_frametime_3df66'), value: formatMs(metrics.p95FrametimeMs), detail: '95% of frames below this' },
    { icon: Gauge, label: i18n.t('interfaceText.worst_frametime_c9ff9'), value: formatMs(metrics.worstFrametimeMs), detail: i18n.t('interfaceText.highest_captured_frame_time_7b175') },
    { icon: Cpu, label: i18n.t('interfaceText.cpu_gpu_avg_5d6f7'), value: `${formatPercent(metrics.cpuAvgPercent)} / ${formatPercent(metrics.gpuAvgPercent)}`, detail: i18n.t('interfaceText.average_load_14881') },
    { icon: MemoryStick, label: i18n.t('interfaceText.ram_peak_70031'), value: formatMemoryMb(metrics.ramPeakMB), detail: i18n.t('interfaceText.highest_system_memory_use_b7678') },
    { icon: MonitorCheck, label: i18n.t('interfaceText.vram_peak_343a7'), value: formatMemoryMb(metrics.vramPeakMB), detail: i18n.t('interfaceText.highest_graphics_memory_use_dbd66') },
    { icon: Network, label: i18n.t('tweaks.subcategories.Network Latency'), value: formatMs(metrics.avgLatencyMs), detail: i18n.t('interfaceText.average_ping_6b690') },
    { icon: Network, label: i18n.t('interfaceText.packet_loss_bad56'), value: formatPercent(metrics.packetLossPercent), detail: i18n.t('interfaceText.average_loss_90c16') }
  ];
  const technicalFacts = [
    ['Game', report.gameName || report.processName || i18n.t('interfaceText.game_session_a524d')],
    ['Started', formatDateTime(report.startedAt)],
    ['Ended', formatDateTime(report.endedAt)],
    ['Profile', getActiveProfileLabel({ presetActive: false, profileId: report.profileId })],
    ['Capture Status', normalizeCaptureStatus(report.captureStatus)],
    ['Auto Restore', report.restore?.autoRestore ? i18n.t('backup.status.enabled') : i18n.t('interfaceText.not_configured_81193')]
  ];

  return (
    <ModalShell
      open={open}
      title={t('gameMode.report.fullTitle', { defaultValue: 'Game Session Report' })}
      description={`${report.gameName || i18n.t('interfaceText.game_e3e82')} - ${formatDuration(report.durationSeconds)} - ${formatDateTime(report.startedAt)}`}
      onClose={onClose}
      closeLabel={t('common.close')}
      size="lg"
      footer={(
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      )}
    >
      <div className="game-mode-report-view">
        <section className={`game-mode-report-hero is-${health.health}`}>
          <div className="game-mode-report-hero__icon">
            <ShieldCheck {...LUCIDE_ICON_PROPS} aria-hidden="true" />
          </div>
          <div className="game-mode-report-hero__copy">
            <span>{health.label}</span>
            <strong>{health.title}</strong>
            <p>{health.description}</p>
          </div>
          <div className="game-mode-report-hero__meta">
            <span>{formatStopReason(report.stopReason)}</span>
            <strong>{formatDuration(report.durationSeconds)}</strong>
          </div>
        </section>

        <ReportSection title={i18n.t('interfaceText.session_summary_cdcfa')}>
          <div className="game-mode-report-modal-grid">
            {overviewItems.map((item) => (
              <MetricTile key={item.label} {...item} />
            ))}
          </div>
        </ReportSection>

        <ReportSection title={i18n.t('interfaceText.what_this_means_29525')}>
          {insights.length ? (
            <div className="game-mode-report-insight-list">
              {insights.map((insight) => {
                const InsightIcon = insight.icon;
                const severityStyle = getInsightStyle(insight.severity);
                const SeverityIcon = severityStyle.icon;
                return (
                  <div key={insight.id} className={`game-mode-report-insight is-${insight.severity}`}>
                    <div className="game-mode-report-insight__icon">
                      <InsightIcon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                    </div>
                    <div className="game-mode-report-insight__copy">
                      <strong>{insight.title}</strong>
                      <span>{insight.description}</span>
                      {insight.detail ? <em>{insight.detail}</em> : null}
                    </div>
                    <span className={`game-mode-report-insight__severity is-${insight.severity}`}>
                      <SeverityIcon {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                      {severityStyle.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="game-mode-report-note">
              <Info {...LUCIDE_ICON_PROPS} aria-hidden="true" />
              <span>{i18n.t('interfaceText.no_special_findings_were_detected_in_this_report_53e18')}</span>
            </div>
          )}
        </ReportSection>

        {warnings.length ? (
          <ReportSection title={i18n.t('tweaks.technical.warnings')}>
            <div className="game-mode-report-warning-list">
              {warnings.map((warning) => (
                <div key={warning} className="game-mode-report-warning">
                  <AlertTriangle {...LUCIDE_ICON_PROPS} aria-hidden="true" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          </ReportSection>
        ) : null}

        <ReportSection title={i18n.t('interfaceText.detailed_metrics_4a6bc')}>
          <div className="game-mode-report-modal-grid is-compact">
            {detailItems.map((item) => (
              <MetricTile key={item.label} {...item} />
            ))}
          </div>
        </ReportSection>

        <ReportSection title={i18n.t('tweaks.technical.technicalDetails')}>
          <div className="game-mode-report-facts">
            {technicalFacts.map(([label, value]) => (
              <ReportFact key={label} label={label} value={value} />
            ))}
          </div>
        </ReportSection>
      </div>
    </ModalShell>
  );
}

function GameModePanel({ active = false, onRuntimeStatusChange, canUsePremium = true, onRequestPremium, view = 'game-mode' }) {
  const { t } = useTranslation();
  const [activeGame, setActiveGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [disableFullscreenOptimizations, setDisableFullscreenOptimizations] = useState(false);
  const [preferHighPriority, setPreferHighPriority] = useState(false);
  const [selectedAffinityProcessors, setSelectedAffinityProcessors] = useState([]);
  const [affinityModalOpen, setAffinityModalOpen] = useState(false);
  const [presetPending, setPresetPending] = useState(false);
  const [presetActive, setPresetActive] = useState(false);
  const [presetMessage, setPresetMessage] = useState('');
  const [presetTone, setPresetTone] = useState('info');
  const [applyPending, setApplyPending] = useState(false);
  const [applyMessage, setApplyMessage] = useState('');
  const [applyTone, setApplyTone] = useState('info');
  const [manualGame, setManualGame] = useState(null);
  const [gameSessionState, setGameSessionState] = useState({
    activeSession: null,
    lastReport: null,
    autoTracking: false,
    capture: null,
    captureAvailability: null
  });
  const [sessionPending, setSessionPending] = useState(false);
  const [presentMonRetryPending, setPresentMonRetryPending] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  const [sessionTone, setSessionTone] = useState('info');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const activeGameRef = useRef(null);
  const activeGameRequestInFlightRef = useRef(false);
  const syncedGameIdentityRef = useRef('');
  const lastDetectedAtRef = useRef(0);
  const affinityModalInitialProcessorsRef = useRef([]);
  const hasDetectedGame = Boolean(activeGame?.processId && activeGame?.executablePath);
  const displayGame = activeGame || manualGame;
  const hasSelectedGame = Boolean(displayGame?.executablePath);
  const currentFullscreenOptimizationsDisabled = Boolean(activeGame?.fullscreenOptimizationsDisabled);
  const currentPreferHighPriority = isHighPriorityConfigured(activeGame);
  const logicalProcessorCount = getLogicalProcessorCount(activeGame);
  const currentAffinityProcessors = normalizeProcessorList(activeGame?.cpuAffinityProcessors, logicalProcessorCount);
  const affinitySelection = normalizeProcessorList(selectedAffinityProcessors, logicalProcessorCount);
  const fullscreenToggleChanged = hasDetectedGame && disableFullscreenOptimizations !== currentFullscreenOptimizationsDisabled;
  const priorityToggleChanged = hasDetectedGame && preferHighPriority !== currentPreferHighPriority;
  const affinityToggleChanged =
    hasDetectedGame &&
    logicalProcessorCount > 0 &&
    !areProcessorListsEqual(affinitySelection, currentAffinityProcessors);
  const hasPendingTuningChanges = fullscreenToggleChanged || priorityToggleChanged || affinityToggleChanged;
  const fullscreenToggleStateLabel = fullscreenToggleChanged
    ? t('gameMode.tuning.state.pending')
    : disableFullscreenOptimizations
      ? t('gameMode.tuning.state.on')
      : t('gameMode.tuning.state.off');
  const priorityToggleStateLabel = priorityToggleChanged
    ? t('gameMode.tuning.state.pending')
    : preferHighPriority
      ? t('gameMode.tuning.state.configured')
      : t('gameMode.tuning.state.off');
  const affinityToggleStateLabel = affinityToggleChanged
    ? t('gameMode.tuning.state.pending')
    : formatAffinitySummary(currentAffinityProcessors, logicalProcessorCount, t);

  useEffect(() => {
    activeGameRef.current = activeGame;
  }, [activeGame]);

  async function executeRemoteTweak(payload) {
    if (window.desktopApi?.runTweak) {
      return window.desktopApi.runTweak(payload);
    }

    if (window.desktopApi?.apiExecuteTweak) {
      return window.desktopApi.apiExecuteTweak(payload);
    }

    if (window.desktopApi?.executeTweak) {
      return window.desktopApi.executeTweak(payload);
    }

    return {
      ok: false,
      code: 'API_NOT_AVAILABLE',
      message: t('errors.apiUnavailable')
    };
  }

  async function loadPresetCatalog() {
    if (!window.desktopApi?.listTweaks) {
      return {
        ok: false,
        code: 'API_NOT_AVAILABLE',
        tweaks: []
      };
    }

    const result = await window.desktopApi.listTweaks();

    if (!result?.ok) {
      return {
        ok: false,
        code: String(result?.code || 'LOAD_FAILED'),
        tweaks: []
      };
    }

    const catalogTweaks = Array.isArray(result?.tweaks) ? result.tweaks : [];
    const presetIds = new Set(GAME_MODE_PRESET_TWEAKS.map((entry) => normalizePresetId(entry.id)));
    const presetTweaks = catalogTweaks.filter((entry) => presetIds.has(normalizePresetId(entry?.id)));
    const tweaks = [];
    for (const tweak of presetTweaks) {
      tweaks.push(tweak);
    }
    return {
      ok: true,
      tweaks
    };
  }

  function resolvePresetTweaks(remoteTweaks) {
    return GAME_MODE_PRESET_TWEAKS.map((presetDefinition) => ({
      presetDefinition,
      tweak: remoteTweaks.find(
        (entry) => normalizePresetId(entry?.id) === normalizePresetId(presetDefinition.id)
      ) || null
    }));
  }

  async function refreshPresetState() {
    try {
      const result = await loadPresetCatalog();
      if (!result.ok) {
        setPresetActive(false);
        return;
      }

      const resolvedTweaks = resolvePresetTweaks(result.tweaks);
      const hasAllTweaks = resolvedTweaks.every((entry) => Boolean(entry.tweak));
      const allTweaksActive =
        hasAllTweaks &&
        resolvedTweaks.every(({ tweak, presetDefinition }) => isPresetTweakActive(tweak, presetDefinition));

      setPresetActive(allTweaksActive);
    } catch (_error) {
      setPresetActive(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    void refreshPresetState();
  }, [active]);

  async function loadActiveGame({ silent = false } = {}) {
    if (activeGameRequestInFlightRef.current) return;
    if (!window.desktopApi?.getActiveGame) {
      setErrorCode('API_NOT_AVAILABLE');
      setActiveGame(null);
      setSelectedAffinityProcessors([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    activeGameRequestInFlightRef.current = true;
    if (!silent) {
      setRefreshing(true);
    }

    try {
      const result = await window.desktopApi.getActiveGame();
      if (!result?.ok) {
        setErrorCode(String(result?.code || 'LOAD_FAILED'));
        const now = Date.now();
        const keepPreviousActiveGame =
          activeGameRef.current &&
          now - lastDetectedAtRef.current < STALE_GAME_KEEP_MS;
        if (!keepPreviousActiveGame) {
          setActiveGame(null);
          setDisableFullscreenOptimizations(false);
          setPreferHighPriority(false);
          setSelectedAffinityProcessors([]);
          syncedGameIdentityRef.current = '';
        }
        return;
      }

      setErrorCode('');
      const detectedGame = result?.game && typeof result.game === 'object' ? result.game : null;
      const now = Date.now();
      if (!detectedGame) {
        const keepPreviousActiveGame =
          activeGameRef.current &&
          now - lastDetectedAtRef.current < STALE_GAME_KEEP_MS;
        if (!keepPreviousActiveGame) {
          setActiveGame(null);
          setDisableFullscreenOptimizations(false);
          setPreferHighPriority(false);
          setSelectedAffinityProcessors([]);
          syncedGameIdentityRef.current = '';
        }
        return;
      }

      setActiveGame(detectedGame);
      setManualGame(null);
      lastDetectedAtRef.current = now;
      const nextIdentity = `${detectedGame.processId || 0}:${detectedGame.executablePath || ''}`;
      if (syncedGameIdentityRef.current !== nextIdentity) {
        setDisableFullscreenOptimizations(Boolean(detectedGame.fullscreenOptimizationsDisabled));
        setPreferHighPriority(isHighPriorityConfigured(detectedGame));
        setSelectedAffinityProcessors(
          normalizeProcessorList(detectedGame.cpuAffinityProcessors, getLogicalProcessorCount(detectedGame))
        );
        setAffinityModalOpen(false);
        syncedGameIdentityRef.current = nextIdentity;
        setApplyMessage('');
        setApplyTone('info');
      }
    } catch (_error) {
      setErrorCode('LOAD_FAILED');
      const now = Date.now();
      const keepPreviousActiveGame =
        activeGameRef.current &&
        now - lastDetectedAtRef.current < STALE_GAME_KEEP_MS;
      if (!keepPreviousActiveGame) {
        setActiveGame(null);
        setDisableFullscreenOptimizations(false);
        setPreferHighPriority(false);
        setSelectedAffinityProcessors([]);
        syncedGameIdentityRef.current = '';
      }
    } finally {
      activeGameRequestInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!active) return undefined;

    loadActiveGame();

    const intervalId = window.setInterval(() => {
      void loadActiveGame({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;

    let mounted = true;
    if (window.desktopApi?.getGameSessionState) {
      window.desktopApi.getGameSessionState()
        .then((result) => {
          if (mounted && result?.ok && result.state) {
            setGameSessionState(result.state);
          }
        })
        .catch(() => {});
    }

    if (!window.desktopApi?.onGameSessionUpdate) {
      return () => {
        mounted = false;
      };
    }

    const unsubscribe = window.desktopApi.onGameSessionUpdate((nextState) => {
      if (mounted && nextState) {
        setGameSessionState(nextState);
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [active]);

  async function runGameModePreset() {
    if (presetPending) {
      return;
    }

    if (!canUsePremium) {
      setPresetTone('warning');
      setPresetMessage(t('gameMode.preset.premiumRequired', { defaultValue: 'Nova Game Mode profiles require Premium.' }));
      onRequestPremium?.();
      return;
    }

    setPresetPending(true);
    setPresetMessage('');
    setPresetTone('info');

    try {
      const catalogResult = await loadPresetCatalog();
      if (!catalogResult.ok) {
        setPresetTone("error");
        setPresetMessage(t('gameMode.preset.loadFailed', { code: catalogResult.code }));
        setPresetActive(false);
        return;
      }

      const resolvedTweaks = resolvePresetTweaks(catalogResult.tweaks);
      const missingTweaks = resolvedTweaks.filter((entry) => !entry.tweak);
      if (missingTweaks.length > 0) {
        setPresetTone("error");
        setPresetMessage(t('gameMode.preset.missingTweaks', {
          names: missingTweaks.map((entry) => entry.presetDefinition.id).join(', ')
        }));
        setPresetActive(false);
        return;
      }

      const shouldDisablePreset = resolvedTweaks.every(({ tweak, presetDefinition }) => isPresetTweakActive(tweak, presetDefinition));
      const tweaksToApply = shouldDisablePreset
        ? resolvedTweaks
        : resolvedTweaks.filter(({ tweak, presetDefinition }) => !isPresetTweakActive(tweak, presetDefinition));
      if (tweaksToApply.length === 0) {
        setPresetTone("success");
        setPresetMessage(t('gameMode.preset.alreadyActive'));
        setPresetActive(true);
        return;
      }

      const failedTweaks = [];
      for (const { tweak, presetDefinition } of tweaksToApply) {
        const result = await executeRemoteTweak({
          id: tweak.id,
          targetState: shouldDisablePreset ? 'disabled' : 'enabled',
          params: shouldDisablePreset ? {} : presetDefinition.params || {},
          timeoutMs: 60000
        });

        if (!result?.ok) {
          failedTweaks.push(tweak.name || presetDefinition.label || presetDefinition.id);
        }
      }

      if (shouldDisablePreset && failedTweaks.length === 0) {
        setPresetActive(false);
      } else {
        await refreshPresetState();
      }

      if (failedTweaks.length > 0) {
        setPresetTone('warning');
        setPresetMessage(t(shouldDisablePreset ? 'gameMode.preset.disableFailedTweaks' : 'gameMode.preset.failedTweaks', { names: failedTweaks.join(', ') }));
        return;
      }

      setPresetTone("success");
      setPresetMessage(t(shouldDisablePreset ? 'gameMode.preset.disabledSimple' : 'gameMode.preset.appliedSimple'));
    } catch (_error) {
      setPresetTone("error");
      setPresetMessage(t(presetActive ? 'gameMode.preset.disableFailed' : 'gameMode.preset.failed'));
      setPresetActive(false);
    } finally {
      setPresetPending(false);
    }
  }

  async function startSession({ autoStarted = false } = {}) {
    if (sessionPending || gameSessionState.activeSession?.sessionStatus === 'recording') {
      return;
    }

    if (!canUsePremium) {
      setSessionTone('warning');
      setSessionMessage(t('gameMode.session.premiumRequired', { defaultValue: 'Session recording is available with Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    if (!hasSelectedGame) {
      setSessionTone('warning');
      setSessionMessage(t('gameMode.session.noGame', { defaultValue: 'Select or launch a game before starting a session.' }));
      return;
    }

    if (!window.desktopApi?.startGameSession) {
      setSessionTone("error");
      setSessionMessage(t('gameMode.tuning.apiUnavailable'));
      return;
    }

    setSessionPending(true);
    setSessionMessage('');
    setSessionTone('info');

    try {
      const result = await window.desktopApi.startGameSession({
        game: displayGame,
        profileId: presetActive ? 'nova-game-mode-preset' : '',
        autoRestore: false,
        autoStarted
      });

      if (!result?.ok) {
        setSessionTone("error");
        setSessionMessage(result?.code === 'GAME_PROCESS_NOT_RUNNING'
          ? t('gameMode.session.processNotRunning', { defaultValue: 'The selected game executable is not running.' })
          : `${t('gameMode.session.startFailed', { defaultValue: 'Session could not be started.' })} (${result?.code || 'START_FAILED'})`);
        return;
      }

      if (result.state) {
        setGameSessionState(result.state);
      }
      setSessionTone("success");
      setSessionMessage(t('gameMode.session.started', { defaultValue: 'Game session recording started.' }));
    } catch (_error) {
      setSessionTone("error");
      setSessionMessage(t('gameMode.session.startFailed', { defaultValue: 'Session could not be started.' }));
    } finally {
      setSessionPending(false);
    }
  }

  async function stopSession() {
    if (sessionPending || !gameSessionState.activeSession) {
      return;
    }

    if (!window.desktopApi?.stopGameSession) {
      setSessionTone("error");
      setSessionMessage(t('gameMode.tuning.apiUnavailable'));
      return;
    }

    setSessionPending(true);
    setSessionMessage('');
    setSessionTone('info');

    try {
      const result = await window.desktopApi.stopGameSession({ reason: 'manual' });
      if (!result?.ok) {
        setSessionTone("error");
        setSessionMessage(`${t('gameMode.session.stopFailed', { defaultValue: 'Session could not be stopped.' })} (${result?.code || 'STOP_FAILED'})`);
        return;
      }

      if (result.state) {
        setGameSessionState(result.state);
      }
      setSessionTone("success");
      setSessionMessage(t('gameMode.session.stopped', { defaultValue: 'Session report saved.' }));
    } catch (_error) {
      setSessionTone("error");
      setSessionMessage(t('gameMode.session.stopFailed', { defaultValue: 'Session could not be stopped.' }));
    } finally {
      setSessionPending(false);
    }
  }

  async function retryPresentMonMonitoring() {
    if (presentMonRetryPending || !window.desktopApi?.retryPresentMonMonitoring) {
      return;
    }

    setPresentMonRetryPending(true);
    try {
      const result = await window.desktopApi.retryPresentMonMonitoring();
      if (result?.state) {
        setGameSessionState(result.state);
      }
      if (!result?.ok) {
        setSessionTone("error");
        setSessionMessage(`${t('gameMode.session.captureRetryFailed', { defaultValue: 'FPS monitoring could not be restarted.' })} (${result?.code || 'RETRY_FAILED'})`);
      }
    } catch (_error) {
      setSessionTone("error");
      setSessionMessage(t('gameMode.session.captureRetryFailed', { defaultValue: 'FPS monitoring could not be restarted.' }));
    } finally {
      setPresentMonRetryPending(false);
    }
  }

  async function toggleAutoTracking(nextValue) {
    if (!canUsePremium) {
      setSessionTone('warning');
      setSessionMessage(t('gameMode.session.premiumRequired', { defaultValue: 'Session recording is available with Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    const enabled = Boolean(nextValue);
    setGameSessionState((previous) => ({ ...previous, autoTracking: enabled }));
    if (window.desktopApi?.setGameSessionAutoTracking) {
      try {
        const result = await window.desktopApi.setGameSessionAutoTracking({ enabled });
        if (result?.state) {
          setGameSessionState(result.state);
        }
      } catch (_error) {
        setGameSessionState((previous) => ({ ...previous, autoTracking: !enabled }));
      }
    }
  }

  async function chooseExecutable() {
    if (!window.desktopApi?.chooseGameExecutable) {
      setSessionTone("error");
      setSessionMessage(t('gameMode.tuning.apiUnavailable'));
      return;
    }

    const result = await window.desktopApi.chooseGameExecutable();
    if (result?.ok && result.game) {
      setManualGame(result.game);
      setSessionTone('info');
      setSessionMessage(t('gameMode.session.manualSelected', { defaultValue: 'Manual executable selected. Start the game before recording.' }));
    }
  }

  async function exportLastReport() {
    const report = gameSessionState.lastReport;
    if (!report || !window.desktopApi?.exportGameSessionReport) {
      return;
    }
    const result = await window.desktopApi.exportGameSessionReport({ sessionId: report.sessionId });
    if (result?.ok) {
      setSessionTone("success");
      setSessionMessage(t('gameMode.report.exported', { defaultValue: 'Session report exported.' }));
    }
  }

  async function openLastReport() {
    const report = gameSessionState.lastReport;
    if (!report || !window.desktopApi?.openGameSessionReport) {
      return;
    }
    await window.desktopApi.openGameSessionReport({ sessionId: report.sessionId });
  }

  useEffect(() => {
    if (
      !gameSessionState.autoTracking ||
      !canUsePremium ||
      !hasDetectedGame ||
      sessionPending ||
      gameSessionState.activeSession?.sessionStatus === 'recording'
    ) {
      return;
    }

    void startSession({ autoStarted: true });
  }, [
    activeGame?.processId,
    canUsePremium,
    gameSessionState.activeSession?.sessionStatus,
    gameSessionState.autoTracking,
    hasDetectedGame,
    sessionPending
  ]);

  function handleFullscreenToggle(nextValue) {
    if (!canUsePremium) {
      setApplyTone('warning');
      setApplyMessage(t('gameMode.tuning.premiumRequired', { defaultValue: 'Runtime tuning requires Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    const normalizedValue = Boolean(nextValue);
    setDisableFullscreenOptimizations(normalizedValue);
    if (!hasDetectedGame || applyPending) {
      return;
    }

    const nextFullscreenChanged = normalizedValue !== currentFullscreenOptimizationsDisabled;
    const nextHasPendingChanges = nextFullscreenChanged || priorityToggleChanged || affinityToggleChanged;
    if (!nextHasPendingChanges) {
      setApplyTone('info');
      setApplyMessage(t('gameMode.tuning.noChanges'));
      return;
    }

    setApplyTone('info');
    setApplyMessage(
      t('gameMode.tuning.pendingChange', {
        setting: t('gameMode.tuning.fullscreenOptimization'),
        state: normalizedValue ? t('gameMode.tuning.state.on') : t('gameMode.tuning.state.off')
      })
    );
  }

  function handlePriorityToggle(nextValue) {
    if (!canUsePremium) {
      setApplyTone('warning');
      setApplyMessage(t('gameMode.tuning.premiumRequired', { defaultValue: 'Runtime tuning requires Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    const normalizedValue = Boolean(nextValue);
    setPreferHighPriority(normalizedValue);
    if (!hasDetectedGame || applyPending) {
      return;
    }

    const nextPriorityChanged = normalizedValue !== currentPreferHighPriority;
    const nextHasPendingChanges = fullscreenToggleChanged || nextPriorityChanged || affinityToggleChanged;
    if (!nextHasPendingChanges) {
      setApplyTone('info');
      setApplyMessage(t('gameMode.tuning.noChanges'));
      return;
    }

    setApplyTone('info');
    setApplyMessage(
      t('gameMode.tuning.pendingChange', {
        setting: t('gameMode.tuning.highPriority'),
        state: normalizedValue ? t('gameMode.tuning.state.on') : t('gameMode.tuning.state.off')
      })
    );
  }

  function openAffinityModal() {
    if (!canUsePremium) {
      setApplyTone('warning');
      setApplyMessage(t('gameMode.tuning.premiumRequired', { defaultValue: 'Runtime tuning requires Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    if (!hasDetectedGame || !logicalProcessorCount || applyPending) {
      return;
    }

    const nextSelection =
      affinitySelection.length ? affinitySelection : currentAffinityProcessors.length ? currentAffinityProcessors : createProcessorList(logicalProcessorCount);
    affinityModalInitialProcessorsRef.current = nextSelection;
    setSelectedAffinityProcessors(nextSelection);
    setAffinityModalOpen(true);
  }

  function closeAffinityModal({ reset = true } = {}) {
    if (reset) {
      setSelectedAffinityProcessors(affinityModalInitialProcessorsRef.current);
    }
    setAffinityModalOpen(false);
  }

  function confirmAffinityModal() {
    if (!canUsePremium) {
      setApplyTone('warning');
      setApplyMessage(t('gameMode.tuning.premiumRequired', { defaultValue: 'Runtime tuning requires Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    if (!affinitySelection.length) {
      return;
    }

    setAffinityModalOpen(false);
    if (!hasDetectedGame || applyPending) {
      return;
    }

    const nextAffinityChanged = !areProcessorListsEqual(affinitySelection, currentAffinityProcessors);
    const nextHasPendingChanges = fullscreenToggleChanged || priorityToggleChanged || nextAffinityChanged;
    if (!nextHasPendingChanges) {
      setApplyTone('info');
      setApplyMessage(t('gameMode.tuning.noChanges'));
      return;
    }

    setApplyTone('info');
    setApplyMessage(
      t('gameMode.tuning.pendingChange', {
        setting: t('gameMode.tuning.cpuAffinity'),
        state: formatAffinitySummary(affinitySelection, logicalProcessorCount, t)
      })
    );
  }

  function toggleAllProcessors(nextValue) {
    setSelectedAffinityProcessors(nextValue ? createProcessorList(logicalProcessorCount) : []);
  }

  function toggleProcessor(processorIndex, nextValue) {
    setSelectedAffinityProcessors((previous) => {
      const normalizedPrevious = normalizeProcessorList(previous, logicalProcessorCount);
      if (nextValue) {
        return normalizeProcessorList([...normalizedPrevious, processorIndex], logicalProcessorCount);
      }

      return normalizedPrevious.filter((entry) => entry !== processorIndex);
    });
  }

  async function applySettings() {
    if (!canUsePremium) {
      setApplyTone('warning');
      setApplyMessage(t('gameMode.tuning.premiumRequired', { defaultValue: 'Runtime tuning requires Nova Tweaks Premium.' }));
      onRequestPremium?.();
      return;
    }

    if (!activeGame?.executablePath) {
      return;
    }

    if (!hasPendingTuningChanges) {
      setApplyTone('info');
      setApplyMessage(t('gameMode.tuning.noChanges'));
      return;
    }

    if (!window.desktopApi?.applyGameModeSettings) {
      setApplyTone("error");
      setApplyMessage(t('gameMode.tuning.apiUnavailable'));
      return;
    }

    setApplyPending(true);
    setApplyMessage('');
    const requestedFullscreenDisabled = disableFullscreenOptimizations;
    const requestedHighPriority = preferHighPriority;
    const requestedAffinityProcessors = affinitySelection;
    const requestedFullscreenChange = fullscreenToggleChanged;
    const requestedPriorityChange = priorityToggleChanged;
    const requestedAffinityChange = affinityToggleChanged;

    try {
      const result = await window.desktopApi.applyGameModeSettings({
        executablePath: activeGame.executablePath,
        processId: activeGame.targetProcessId || activeGame.processId,
        applyFullscreenOptimizations: requestedFullscreenChange,
        applyPriority: requestedPriorityChange,
        disableFullscreenOptimizations,
        preferHighPriority,
        applyCpuAffinity: requestedAffinityChange,
        cpuAffinityProcessors: requestedAffinityProcessors
      });

      if (!result?.ok) {
        setApplyTone("error");
        setApplyMessage(`${t('gameMode.tuning.applyFailed')} (${result?.code || 'APPLY_FAILED'})`);
        return;
      }

      const updated = result?.result && typeof result.result === 'object' ? result.result : {};
      const nextPriorityClass = String(updated.priorityClass || '').trim();
      const nextRuntimePriorityClass = String(updated.runtimePriorityClass || updated.priorityClass || '').trim();
      const nextPriorityConfigured = Boolean(updated.priorityConfigured);
      const nextFullscreenDisabled = Boolean(updated.fullscreenOptimizationsDisabled);
      const priorityApplyErrorCode = String(updated.priorityApplyErrorCode || '').trim();
      const priorityApplyErrors = Array.isArray(updated.priorityApplyErrors) ? updated.priorityApplyErrors : [];
      const nextLogicalProcessorCount = Number.isFinite(Number(updated.logicalProcessorCount))
        ? Math.trunc(Number(updated.logicalProcessorCount))
        : logicalProcessorCount;
      const nextAffinityProcessors = normalizeProcessorList(updated.cpuAffinityProcessors, nextLogicalProcessorCount);
      const cpuAffinityApplyErrorCode = String(updated.cpuAffinityApplyErrorCode || '').trim();
      const cpuAffinityApplyErrors = Array.isArray(updated.cpuAffinityApplyErrors) ? updated.cpuAffinityApplyErrors : [];
      const fullscreenAppliedCorrectly = nextFullscreenDisabled === requestedFullscreenDisabled;
      const priorityMatchesRequest = nextPriorityConfigured === requestedHighPriority;
      const affinityMatchesRequest =
        !requestedAffinityChange || areProcessorListsEqual(nextAffinityProcessors, requestedAffinityProcessors);
      const warnings = [];
      const addWarning = (message) => {
        const normalizedMessage = String(message || '').trim();
        if (normalizedMessage && !warnings.includes(normalizedMessage)) {
          warnings.push(normalizedMessage);
        }
      };

      if (requestedFullscreenChange && !fullscreenAppliedCorrectly) {
        addWarning(t('gameMode.tuning.fullscreenApplyWarning'));
      }
      if (requestedPriorityChange && priorityApplyErrors.length > 0) {
        addWarning(
          priorityApplyErrorCode === 'ACCESS_DENIED'
            ? t('gameMode.tuning.priorityAccessDeniedWarning')
            : t('gameMode.tuning.priorityApplyWarning')
        );
      } else if (requestedPriorityChange && (!priorityMatchesRequest || updated.priorityConfigurationState === 'partial' || !nextRuntimePriorityClass)) {
        addWarning(t('gameMode.tuning.priorityApplyWarning'));
      }
      if (
        requestedPriorityChange &&
        nextRuntimePriorityClass &&
        (requestedHighPriority ? !isHighPriorityClass(nextRuntimePriorityClass) : nextRuntimePriorityClass.toLowerCase() !== 'normal')
      ) {
        addWarning(
          t('gameMode.tuning.priorityRuntimeMismatch', {
            priority: normalizePriorityClass(nextRuntimePriorityClass)
          })
        );
      }
      if (requestedAffinityChange && cpuAffinityApplyErrors.length > 0) {
        addWarning(
          cpuAffinityApplyErrorCode === 'ACCESS_DENIED'
            ? t('gameMode.tuning.affinityAccessDeniedWarning')
            : cpuAffinityApplyErrorCode === 'TARGET_PROCESS_NOT_RUNNING'
              ? t('gameMode.tuning.affinityTargetNotRunningWarning')
              : t('gameMode.tuning.affinityApplyWarning')
        );
      } else if (requestedAffinityChange && !affinityMatchesRequest) {
        addWarning(t('gameMode.tuning.affinityApplyWarning'));
      }

      setActiveGame((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          processId: Number.isFinite(Number(updated.runtimeProcessId)) && Number(updated.runtimeProcessId) > 0
            ? Math.trunc(Number(updated.runtimeProcessId))
            : previous.processId,
          targetProcessId: Number.isFinite(Number(updated.runtimeProcessId)) && Number(updated.runtimeProcessId) > 0
            ? Math.trunc(Number(updated.runtimeProcessId))
            : previous.targetProcessId,
          runtimeExecutablePath: String(updated.runtimeExecutablePath || '').trim(),
          runtimeProcessMatchState: String(updated.runtimeProcessMatchState || '').trim(),
          fullscreenOptimizationsDisabled: nextFullscreenDisabled,
          priorityClass: nextPriorityClass,
          runtimePriorityClass: nextRuntimePriorityClass,
          priorityReadError: String(updated.priorityReadError || '').trim(),
          priorityConfigured: nextPriorityConfigured,
          priorityConfigurationState: String(updated.priorityConfigurationState || '').trim(),
          priorityConfiguredExecutablePaths: Array.isArray(updated.priorityConfiguredExecutablePaths)
            ? updated.priorityConfiguredExecutablePaths
            : [],
          priorityMissingExecutablePaths: Array.isArray(updated.priorityMissingExecutablePaths)
            ? updated.priorityMissingExecutablePaths
            : [],
          priorityRegistryPaths: Array.isArray(updated.priorityRegistryPaths) ? updated.priorityRegistryPaths : [],
          logicalProcessorCount: nextLogicalProcessorCount,
          cpuAffinityMask: String(updated.cpuAffinityMask || '').trim(),
          cpuAffinityProcessors: nextAffinityProcessors,
          cpuAffinityReadError: String(updated.cpuAffinityReadError || '').trim(),
          cpuAffinityApplyErrorCode,
          cpuAffinityApplyErrors
        };
      });

      setDisableFullscreenOptimizations(nextFullscreenDisabled);
      setPreferHighPriority(nextPriorityConfigured);
      setSelectedAffinityProcessors(nextAffinityProcessors);

      if (warnings.length > 0) {
        setApplyTone('warning');
        setApplyMessage([t('gameMode.tuning.appliedWithIssues'), ...warnings].join(' '));
      } else {
        setApplyTone("success");
        setApplyMessage(t('gameMode.tuning.applied'));
      }
    } catch (_error) {
      setApplyTone("error");
      setApplyMessage(`${t('gameMode.tuning.applyFailed')} (APPLY_FAILED)`);
    } finally {
      setApplyPending(false);
    }
  }

  const activeSession = gameSessionState.activeSession;
  const lastReport = gameSessionState.lastReport;
  const executableName = getExecutableName(displayGame?.executablePath);
  const priorityClassLabel = normalizePriorityClass(activeGame?.runtimePriorityClass || activeGame?.priorityClass);
  const priorityConfigured = isHighPriorityConfigured(activeGame);
  const priorityRuntimeMismatch =
    hasDetectedGame &&
    priorityConfigured &&
    priorityClassLabel &&
    !isHighPriorityClass(priorityClassLabel);
  const priorityConfigurationPartial = hasDetectedGame && activeGame?.priorityConfigurationState === 'partial';
  const priorityReadWarning = hasDetectedGame && !priorityClassLabel && Boolean(activeGame?.priorityReadError);
  const priorityStatusMessage = priorityRuntimeMismatch
    ? t('gameMode.tuning.priorityRuntimeMismatch', { priority: priorityClassLabel })
    : priorityConfigurationPartial
      ? t('gameMode.tuning.priorityPartialWarning')
      : priorityReadWarning
        ? t('gameMode.tuning.priorityReadWarning')
        : '';
  const affinityReadWarning = hasDetectedGame && Boolean(activeGame?.cpuAffinityReadError);
  const affinityApplyErrorCode = String(activeGame?.cpuAffinityApplyErrorCode || '').trim();
  const affinityStatusMessage = affinityApplyErrorCode
    ? affinityApplyErrorCode === 'ACCESS_DENIED'
      ? t('gameMode.tuning.affinityAccessDeniedWarning')
      : affinityApplyErrorCode === 'TARGET_PROCESS_NOT_RUNNING'
        ? t('gameMode.tuning.affinityTargetNotRunningWarning')
        : t('gameMode.tuning.affinityApplyWarning')
    : affinityReadWarning
      ? t('gameMode.tuning.affinityReadWarning')
      : '';
  const statusMessages = uniqueTextValues([priorityStatusMessage, affinityStatusMessage]);
  const allProcessors = createProcessorList(logicalProcessorCount);
  const allProcessorsSelected = logicalProcessorCount > 0 && affinitySelection.length === logicalProcessorCount;
  const gameModeButtonAria = presetActive ? `${t('gameMode.buttonAria')} (${t('gameMode.activeBadge')})` : t('gameMode.buttonAria');
  const gameName = displayGame?.displayName || displayGame?.processName || executableName || t('gameMode.detection.processLabel');
  const processName = displayGame?.processName || executableName || '';
  const executablePath = displayGame?.executablePath || '';
  const iconSource = toIconSource(displayGame?.iconDataUrl);
  const activeProfileLabel = getActiveProfileLabel({
    presetActive,
    profileId: activeSession?.profileId
  });
  const recording = activeSession?.sessionStatus === 'recording';
  const panelView = view === 'session-monitoring' ? 'session-monitoring' : 'game-mode';
  const isSessionMonitoringView = panelView === 'session-monitoring';
  const pageTitle = isSessionMonitoringView ? t('nav.sessionMonitoring') : t('nav.gameMode');
  const pageDescription = isSessionMonitoringView
    ? t('gameMode.header.monitoringDescription', {
      defaultValue: 'Track live game sessions, FPS capture, performance charts, and session reports.'
    })
    : t('gameMode.header.gameModeDescription', {
      defaultValue: 'Apply per-game profiles and runtime tuning for the detected game.'
    });

  useEffect(() => {
    if (typeof onRuntimeStatusChange !== 'function') {
      return;
    }

    if (presetPending) {
      onRuntimeStatusChange({
        id: 'game-mode:preset',
        label: t('nav.gameMode'),
        status: 'running'
      });
      return;
    }

    if (sessionPending) {
      onRuntimeStatusChange({
        id: 'game-mode:session',
        label: t('gameMode.session.recording', { defaultValue: 'Game Session' }),
        status: 'running'
      });
      return;
    }

    if (applyPending) {
      onRuntimeStatusChange({
        id: 'game-mode:tuning',
        label: t('gameMode.tuning.title'),
        status: 'running'
      });
      return;
    }

    onRuntimeStatusChange((previous) =>
      String(previous?.id || '').startsWith('game-mode:')
        ? { id: '', label: '', status: 'idle' }
        : previous
    );
  }, [applyPending, onRuntimeStatusChange, presetPending, sessionPending, t]);

  return (
    <PageShell className="game-mode-shell">
      <PageHeader
        title={pageTitle}
        description={pageDescription}
      />

      <div className="game-mode-control-layout">
        <DetectedGameHeader
          t={t}
          hasDetectedGame={hasDetectedGame}
          hasSelectedGame={hasSelectedGame}
          gameName={gameName}
          processName={processName}
          executablePath={executablePath}
          iconSource={iconSource}
          session={activeSession}
          activeProfileLabel={activeProfileLabel}
          autoTracking={Boolean(gameSessionState.autoTracking)}
          canUsePremium={canUsePremium}
          showSessionControls={isSessionMonitoringView}
          sessionPending={sessionPending}
          sessionMessage={sessionMessage}
          sessionTone={sessionTone}
          onStartSession={() => startSession()}
          onStopSession={stopSession}
          onToggleAutoTracking={toggleAutoTracking}
          onChooseExecutable={chooseExecutable}
          onRefresh={() => loadActiveGame()}
          refreshing={refreshing || loading}
          onRequestPremium={onRequestPremium}
        />

        {errorCode ? (
          <p className="game-mode-alert game-mode-alert--danger">
            {t('gameMode.detection.refreshFailed')} ({errorCode})
          </p>
        ) : null}

        {isSessionMonitoringView ? (
          <>
            <LiveGameMetrics
              t={t}
              session={activeSession}
              gameName={gameName}
              iconSource={iconSource}
              capture={gameSessionState.capture}
              captureAvailability={gameSessionState.captureAvailability}
              canUsePremium={canUsePremium}
              onRetryMonitoring={retryPresentMonMonitoring}
              retryPending={presentMonRetryPending}
            />

            <LivePerformanceGraph
              t={t}
              session={activeSession}
            />

            <SessionInsightsCard
              t={t}
              session={activeSession || lastReport}
              iconSource={iconSource}
              onViewReport={lastReport ? () => setReportModalOpen(true) : null}
              onStartSession={!recording && hasSelectedGame ? () => startSession() : null}
            />

            <LastSessionReportCard
              t={t}
              report={lastReport}
              onViewReport={() => setReportModalOpen(true)}
              onExportReport={exportLastReport}
              onOpenReport={openLastReport}
            />
          </>
        ) : (
          <div className="game-mode-two-column">
            <ActiveGameProfileCard
              t={t}
              activeProfileLabel={activeProfileLabel}
              gameName={gameName}
              iconSource={iconSource}
              presetActive={presetActive}
              presetPending={presetPending}
              presetMessage={presetMessage}
              presetTone={presetTone}
              gameModeButtonAria={gameModeButtonAria}
              onRunPreset={runGameModePreset}
              onRequestPremium={onRequestPremium}
              session={activeSession}
              canUsePremium={canUsePremium}
            />

            <RuntimeTuningCard
              t={t}
              canUsePremium={canUsePremium}
              hasDetectedGame={hasDetectedGame}
              gameName={gameName}
              iconSource={iconSource}
              hasPendingTuningChanges={hasPendingTuningChanges}
              fullscreenToggleChanged={fullscreenToggleChanged}
              disableFullscreenOptimizations={disableFullscreenOptimizations}
              fullscreenToggleStateLabel={fullscreenToggleStateLabel}
              onFullscreenToggle={handleFullscreenToggle}
              priorityToggleChanged={priorityToggleChanged}
              preferHighPriority={preferHighPriority}
              priorityToggleStateLabel={priorityToggleStateLabel}
              onPriorityToggle={handlePriorityToggle}
              affinityToggleChanged={affinityToggleChanged}
              logicalProcessorCount={logicalProcessorCount}
              affinityToggleStateLabel={affinityToggleStateLabel}
              onOpenAffinity={openAffinityModal}
              applyPending={applyPending}
              onApply={applySettings}
              onRequestPremium={onRequestPremium}
              applyMessage={applyMessage}
              applyTone={applyTone}
              statusMessages={statusMessages}
            />
          </div>
        )}

        <GameModeFootnote t={t} />
      </div>

      <ModalShell
        open={affinityModalOpen}
        title={t('gameMode.tuning.processorAffinityTitle')}
        description={t('gameMode.tuning.processorAffinityDescription', {
          exe: executableName || activeGame?.processName || t('gameMode.detection.processLabel')
        })}
        onClose={() => closeAffinityModal()}
        closeLabel={t('common.close')}
        showCloseButton={false}
        size="sm"
        footer={
          <>
            <Button type="button" variant="primary" size="sm" onClick={confirmAffinityModal} disabled={!affinitySelection.length}>
              {t('gameMode.tuning.affinityOk')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => closeAffinityModal()}>
              {t('common.cancel')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={allProcessorsSelected}
              onChange={(event) => toggleAllProcessors(event.target.checked)}
            />
            <span>{t('gameMode.tuning.allProcessors')}</span>
          </label>

          <div className="max-h-[17rem] space-y-2 overflow-y-auto pr-1">
            {allProcessors.map((processorIndex) => (
              <label
                key={processorIndex}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={affinitySelection.includes(processorIndex)}
                  onChange={(event) => toggleProcessor(processorIndex, event.target.checked)}
                />
                <span>{t('gameMode.tuning.cpuLabel', { index: processorIndex })}</span>
              </label>
            ))}
          </div>

          {!affinitySelection.length ? (
            <p className="rounded-lg border border-[var(--danger)]/45 bg-[color:var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
              {t('gameMode.tuning.affinityEmptyWarning')}
            </p>
          ) : null}
        </div>
      </ModalShell>
      <SessionReportModal
        t={t}
        report={lastReport}
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
      />
    </PageShell>
  );
}

export default GameModePanel;
