const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { readMeasurement, isNewMeasurement, networkMeasurementTime } = require('../monitoring/samplePolicy');
const { createMonitoringProviderManager } = require('./monitoringProviderManager');
const { createSessionStatistics, averageLowestSorted, percentileSorted, LIVE_SAMPLE_LIMIT } = require('./sessionStatistics');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const SESSION_SCHEMA_VERSION = 1;
const SESSION_HISTORY_LIMIT = 900;
const SESSION_REPORT_LIMIT = 25;
const SESSION_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROCESS_WATCH_INTERVAL_MS = 2500;
const CAPTURE_POLL_INTERVAL_MS = 500;
const STATISTICS_WARNING = 'Exact frame statistics unavailable. Session averages and peaks were retained.';

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampPercentOrNull(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.max(0, Math.min(100, numeric));
}

function nonNegativeOrNull(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.max(0, numeric);
}

function roundOrNull(value, decimals = 1) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeProcessId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function normalizeHistoryEntry(value, timestamp = Date.now()) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  return {
    timestamp,
    value: roundOrNull(numeric, 3)
  };
}

function pushHistory(history, key, value, timestamp = Date.now()) {
  const entry = normalizeHistoryEntry(value, timestamp);
  if (!entry) {
    return;
  }
  history[key].push(entry);
  if (history[key].length > SESSION_HISTORY_LIMIT) {
    history[key].splice(0, history[key].length - SESSION_HISTORY_LIMIT);
  }
}

function createEmptyHistory() {
  return {
    fps: [],
    frametime: [],
    cpu: [],
    gpu: [],
    latency: []
  };
}

function percentile(values, percentileValue) {
  return percentileSorted(values.map(toFiniteNumber).filter((value) => value !== null).sort((left, right) => left - right), percentileValue);
}

function averageLowestPercent(values, percent) {
  return averageLowestSorted(values.map(toFiniteNumber).filter((value) => value !== null).sort((left, right) => left - right), percent);
}

function isProcessRunning(processId) {
  const normalizedProcessId = normalizeProcessId(processId);
  if (!normalizedProcessId) {
    return false;
  }

  try {
    process.kill(normalizedProcessId, 0);
    return true;
  } catch (error) {
    return String(error?.code || '') === 'EPERM';
  }
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function resolveRunningProcessByExecutablePath(executablePath, { timeoutMs = 5000, platform = process.platform } = {}) {
  const normalizedExecutablePath = normalizeString(executablePath);
  if (!normalizedExecutablePath || platform !== 'win32') {
    return Promise.resolve(null);
  }

  const payload = encodePayload({ executablePath: normalizedExecutablePath });
  const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$targetPath = [Environment]::ExpandEnvironmentVariables([string]$payload.executablePath).Trim()
try {
  $targetPath = [IO.Path]::GetFullPath($targetPath)
} catch {}
$targetBaseName = [IO.Path]::GetFileNameWithoutExtension($targetPath)
$match = $null
foreach ($process in @(Get-Process -Name $targetBaseName -ErrorAction SilentlyContinue)) {
  $candidatePath = ''
  try {
    $candidatePath = [string]$process.MainModule.FileName
  } catch {}
  if ([string]::IsNullOrWhiteSpace($candidatePath)) {
    try {
      $processId = [int]$process.Id
      $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
      $candidatePath = [string]$cimProcess.ExecutablePath
    } catch {}
  }
  try {
    if (-not [string]::IsNullOrWhiteSpace($candidatePath)) {
      $candidatePath = [IO.Path]::GetFullPath($candidatePath)
    }
  } catch {}
  if ([string]::Equals($candidatePath, $targetPath, [StringComparison]::OrdinalIgnoreCase)) {
    $match = [PSCustomObject]@{
      processId = [int]$process.Id
      processName = "$($process.ProcessName).exe"
      executablePath = [string]$candidatePath
    }
    break
  }
}
if ($null -eq $match) {
  '{}' | Write-Output
} else {
  $match | ConvertTo-Json -Compress
}
`;

  return new Promise((resolve) => {
    execFile(resolveWindowsSystemExecutable('powershell'), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 128 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(String(stdout || '{}').trim() || '{}');
        const processId = normalizeProcessId(parsed?.processId);
        resolve(processId ? {
          processId,
          processName: normalizeString(parsed?.processName),
          executablePath: normalizeString(parsed?.executablePath) || normalizedExecutablePath
        } : null);
      } catch (_parseError) {
        resolve(null);
      }
    });
  });
}

function normalizeGame(input = {}) {
  const executablePath = normalizeString(input.executablePath || input.runtimeExecutablePath);
  const processName = normalizeString(input.processName || input.canonicalExecutableName);
  const displayName = normalizeString(input.displayName || input.canonicalGameName || processName.replace(/\.exe$/i, ''));
  return {
    gameName: displayName || processName || (executablePath ? path.basename(executablePath, path.extname(executablePath)) : 'Game'),
    processName,
    processId: normalizeProcessId(input.processId || input.targetProcessId || input.runtimeProcessId),
    executablePath,
    iconDataUrl: normalizeString(input.iconDataUrl),
    normalizedGameId: normalizeString(input.normalizedGameId)
  };
}

function createDefaultMetrics() {
  return {
    avgFps: null,
    currentFps: null,
    onePercentLow: null,
    pointOnePercentLow: null,
    avgFrametimeMs: null,
    p95FrametimeMs: null,
    p99FrametimeMs: null,
    worstFrametimeMs: null,
    stutterCount: 0,
    cpuAvgPercent: null,
    gpuAvgPercent: null,
    gpuMaxTempC: null,
    ramPeakMB: null,
    vramPeakMB: null,
    avgLatencyMs: null,
    packetLossPercent: null
  };
}

function createSession({
  sessionId,
  game,
  profileId = '',
  captureStatus = 'idle',
  rawCapturePath = '',
  systemMemoryTotalMB = null,
  startedAt = new Date().toISOString()
}) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    gameName: game.gameName,
    processName: game.processName,
    processId: game.processId,
    executablePath: game.executablePath,
    startedAt,
    endedAt: '',
    durationSeconds: 0,
    profileId: normalizeString(profileId),
    systemMemoryTotalMB: roundOrNull(systemMemoryTotalMB, 0),
    captureStatus,
    sessionStatus: 'recording',
    live: {
      cpuUsagePercent: null,
      gpuUsagePercent: null,
      gpuTempC: null,
      ramUsedMB: null,
      vramUsedMB: null,
      latencyMs: null,
      packetLossPercent: null
    },
    metrics: createDefaultMetrics(),
    history: createEmptyHistory(),
    insights: [],
    warnings: [],
    rawCapturePath,
    restore: {
      autoRestore: false,
      status: 'not_configured',
      message: 'No temporary profile restore was requested for this session.'
    }
  };
}

function getPrimaryGpu(overview) {
  return Array.isArray(overview?.gpus) && overview.gpus.length > 0 ? overview.gpus[0] : null;
}

function getNetworkQuality(overview) {
  return overview?.networkQuality && typeof overview.networkQuality === 'object' ? overview.networkQuality : null;
}

function formatGbFromMb(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.round((numeric / 1024) * 10) / 10;
}

function addUniqueMessage(messages, message) {
  const normalizedMessage = normalizeString(message);
  if (normalizedMessage && !messages.includes(normalizedMessage)) {
    messages.push(normalizedMessage);
  }
}

function createGameSessionManager(options = {}) {
  const logger = options.logger;
  const platform = options.platform || process.platform;
  const now = options.nowProvider || (() => Date.now());
  const app = options.app;
  const userDataPath = options.userDataPath || (typeof app?.getPath === 'function' ? app.getPath('userData') : process.cwd());
  const sessionsRoot = options.sessionsRoot || path.join(userDataPath, 'game-mode', 'sessions');
  const captureRoot = options.captureRoot || path.join(userDataPath, 'game-mode', 'capture');
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
  const onRecordingStateChange = typeof options.onRecordingStateChange === 'function' ? options.onRecordingStateChange : null;
  const detectActiveGame = typeof options.detectActiveGame === 'function' ? options.detectActiveGame : null;
  const totalMemoryBytesProvider = typeof options.totalMemoryBytesProvider === 'function'
    ? options.totalMemoryBytesProvider
    : () => os.totalmem();
  const captureService = options.captureService || createMonitoringProviderManager({
    app,
    logger,
    platform,
    onEvent: options.onPresentMonEvent
  });

  function getTotalSystemMemoryMB() {
    try {
      const totalBytes = nonNegativeOrNull(totalMemoryBytesProvider());
      return totalBytes !== null && totalBytes > 0 ? totalBytes / (1024 ** 2) : null;
    } catch (_error) {
      return null;
    }
  }

  let activeSession = null;
  let lastReport = null;
  let autoTracking = false;
  let processWatchTimer = null;
  let capturePollTimer = null;
  let latestOverview = null;
  let latestMetrics = null;
  let lastReceivedMeasurement = null;
  let lastRecordedMeasurement = null;
  let lastNetworkMeasurementAt = null;
  let statistics = createSessionStatistics({ captureRoot, nowProvider: now });
  let stopPromise = null;
  const processPeaks = new Map();

  function getSessionsRoot() {
    fs.mkdirSync(sessionsRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      fs.chmodSync(sessionsRoot, 0o700);
    }
    return sessionsRoot;
  }

  function loadLastReport() {
    if (lastReport) {
      return lastReport;
    }

    try {
      const reports = listReports();
      lastReport = reports[0] || null;
    } catch (_error) {
      lastReport = null;
    }
    return lastReport;
  }

  function getState() {
    return {
      activeSession,
      lastReport: activeSession?.sessionStatus === 'recording' ? loadLastReport() : loadLastReport(),
      autoTracking,
      capture: captureService.getStatus(),
      captureAvailability: captureService.getAvailability()
    };
  }

  function emitUpdate() {
    onUpdate?.(getState());
  }

  function disposeStatistics() {
    try { statistics.dispose(); }
    catch (error) { logger?.warn?.('Unable to remove temporary session statistics.', { message: error.message }); }
  }

  function resetAggregates() {
    lastRecordedMeasurement = null;
    lastNetworkMeasurementAt = null;
    disposeStatistics();
    statistics = createSessionStatistics({ captureRoot, nowProvider: now });
    processPeaks.clear();
  }

  function updateDuration() {
    if (!activeSession) {
      return;
    }
    const endedAt = activeSession.endedAt ? Date.parse(activeSession.endedAt) : now();
    const startedAt = Date.parse(activeSession.startedAt);
    activeSession.durationSeconds = Number.isFinite(startedAt)
      ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
      : 0;
  }

  function updateWarnings() {
    if (!activeSession) {
      return;
    }

    const warnings = [];
    if (activeSession.statisticsWarning) addUniqueMessage(warnings, activeSession.statisticsWarning);
    const captureStatus = captureService.getStatus();
    if (captureStatus.status === 'unavailable') {
      addUniqueMessage(warnings, 'FPS monitoring unavailable: PresentMon Service/API helper is not bundled with this build.');
    } else if (captureStatus.status === 'failed') {
      addUniqueMessage(warnings, `FPS monitoring unavailable${captureStatus.message ? `: ${captureStatus.message}` : '.'}`);
    } else if (captureStatus.status === 'no_data') {
      addUniqueMessage(warnings, captureStatus.message || 'No frame data has arrived from PresentMon Service.');
    } else if (['starting', 'connected', 'running'].includes(captureStatus.status) && !statistics.aggregates.fps.count) {
      addUniqueMessage(
        warnings,
        captureStatus.message
          ? `FPS monitoring is running, but no frame samples have been captured yet: ${captureStatus.message}`
          : 'FPS monitoring is running, but no frame samples have been captured yet.'
      );
    }

    if (!statistics.aggregates.gpuTemp.count) {
      addUniqueMessage(warnings, 'GPU temperature sensor unavailable.');
    }
    if (!statistics.aggregates.vramMB.count) {
      addUniqueMessage(warnings, 'VRAM usage sensor unavailable.');
    }
    if (!statistics.aggregates.latency.count) {
      addUniqueMessage(warnings, 'Network latency probe unavailable.');
    }

    activeSession.warnings = warnings;
  }

  function updateInsights() {
    if (!activeSession) {
      return;
    }

    const insights = [];
    const highRamProcess = Array.from(processPeaks.values())
      .filter((entry) => entry.pid !== activeSession.processId && toFiniteNumber(entry.ramMB) !== null)
      .sort((left, right) => (right.ramMB || 0) - (left.ramMB || 0))[0];
    const highCpuProcess = Array.from(processPeaks.values())
      .filter((entry) => entry.pid !== activeSession.processId && toFiniteNumber(entry.cpuPercent) !== null)
      .sort((left, right) => (right.cpuPercent || 0) - (left.cpuPercent || 0))[0];

    if (highRamProcess?.ramMB >= 1024) {
      addUniqueMessage(insights, `${highRamProcess.name} used ${formatGbFromMb(highRamProcess.ramMB)} GB RAM during the session.`);
    }

    if (highCpuProcess?.cpuPercent >= 20) {
      addUniqueMessage(insights, `${highCpuProcess.name} reached ${roundOrNull(highCpuProcess.cpuPercent, 0)}% CPU usage during the session.`);
    }

    const gpuMaxTempC = statistics.aggregates.gpuTemp.max;
    if (gpuMaxTempC !== null) {
      addUniqueMessage(
        insights,
        gpuMaxTempC >= 85
          ? `GPU temperature peaked at ${roundOrNull(gpuMaxTempC, 0)} C during the session.`
          : 'GPU temperature stayed stable during the session.'
      );
    }

    const ramPeak = statistics.aggregates.ramMB.max;
    if (ramPeak !== null) {
      addUniqueMessage(insights, `RAM peak was ${formatGbFromMb(ramPeak)} GB during the session.`);
    }

    const vramPeak = statistics.aggregates.vramMB.max;
    if (vramPeak !== null) {
      addUniqueMessage(insights, `VRAM peak was ${formatGbFromMb(vramPeak)} GB during the session.`);
    }

    const latencyPeak = statistics.aggregates.latency.max;
    if (latencyPeak !== null && latencyPeak >= 120) {
      addUniqueMessage(insights, `Network latency spiked to ${roundOrNull(latencyPeak, 0)} ms during the session.`);
    }

    const packetLossPeak = statistics.aggregates.packetLoss.max;
    if (packetLossPeak !== null && packetLossPeak > 0) {
      addUniqueMessage(insights, 'Packet loss detected during the session.');
    }

    if (!insights.length && activeSession.sessionStatus === 'recording') {
      addUniqueMessage(insights, 'Collecting live session data.');
    }

    activeSession.insights = insights;
  }

  function updateMetrics(finalDistribution = null) {
    if (!activeSession) return;
    const distribution = finalDistribution || statistics.liveDistribution();
    if (statistics.getFailure()) activeSession.statisticsWarning = STATISTICS_WARNING;
    activeSession.metrics = {
      avgFps: roundOrNull(statistics.mean('fps'), 1),
      currentFps: roundOrNull(statistics.aggregates.fps.last, 1),
      onePercentLow: roundOrNull(distribution.onePercentLow, 1),
      pointOnePercentLow: roundOrNull(distribution.pointOnePercentLow, 1),
      avgFrametimeMs: roundOrNull(statistics.mean('frametime'), 2),
      p95FrametimeMs: roundOrNull(distribution.p95FrametimeMs, 2),
      p99FrametimeMs: roundOrNull(distribution.p99FrametimeMs, 2),
      worstFrametimeMs: roundOrNull(statistics.aggregates.frametime.max, 2),
      stutterCount: distribution.stutterCount,
      cpuAvgPercent: roundOrNull(statistics.mean('cpu'), 1),
      gpuAvgPercent: roundOrNull(statistics.mean('gpu'), 1),
      gpuMaxTempC: roundOrNull(statistics.aggregates.gpuTemp.max, 0),
      ramPeakMB: roundOrNull(statistics.aggregates.ramMB.max, 0),
      vramPeakMB: roundOrNull(statistics.aggregates.vramMB.max, 0),
      avgLatencyMs: roundOrNull(statistics.mean('latency'), 1),
      packetLossPercent: roundOrNull(statistics.mean('packetLoss'), 2)
    };
    activeSession.captureStatus = captureService.getStatus().status;
    updateDuration();
    updateWarnings();
    updateInsights();
  }

  function ingestProcessSnapshot(processes = []) {
    if (!Array.isArray(processes)) {
      return;
    }

    for (const processInfo of processes) {
      const pid = normalizeProcessId(processInfo?.pid || processInfo?.processId);
      const name = normalizeString(processInfo?.name || processInfo?.processName);
      if (!pid || !name) {
        continue;
      }

      const previous = processPeaks.get(pid) || {
        pid,
        name,
        cpuPercent: null,
        ramMB: null,
        diskMBs: null
      };
      const cpuPercent = clampPercentOrNull(processInfo?.cpuPercent);
      const ramMB = nonNegativeOrNull(processInfo?.ramMB);
      const diskMBs = nonNegativeOrNull(processInfo?.diskMBs);
      processPeaks.set(pid, {
        pid,
        name,
        cpuPercent: Math.max(previous.cpuPercent || 0, cpuPercent || 0) || null,
        ramMB: Math.max(previous.ramMB || 0, ramMB || 0) || null,
        diskMBs: Math.max(previous.diskMBs || 0, diskMBs || 0) || null
      });
    }
  }

  function handleMetrics(metrics) {
    if (metrics?.sampleKind === 'status' || metrics?.monitoring === 'offline') {
      latestMetrics = null;
      latestOverview = null;
      if (activeSession) {
        activeSession.live = Object.fromEntries(Object.keys(activeSession.live || {}).map((key) => [key, null]));
        emitUpdate();
      }
      return;
    }
    const measurement = readMeasurement(metrics, now());
    if (!isNewMeasurement(measurement, lastReceivedMeasurement)) return;
    lastReceivedMeasurement = measurement;
    latestMetrics = metrics;
    latestOverview = metrics.overview || null;
    recordMetrics(metrics);
  }

  function recordMetrics(metrics) {
    if (!activeSession || activeSession.sessionStatus !== 'recording') {
      return;
    }
    const measurement = readMeasurement(metrics, now());
    if (!isNewMeasurement(measurement, lastRecordedMeasurement)) return;
    lastRecordedMeasurement = measurement;
    const timestamp = measurement.measuredAt;
    const overview = latestOverview;
    const primaryGpu = getPrimaryGpu(overview);
    const networkQuality = getNetworkQuality(overview);
    const cpuUsage = clampPercentOrNull(overview?.cpu?.usagePercent ?? metrics?.cpuLoad);
    const gpuUsage = clampPercentOrNull(primaryGpu?.usagePercent ?? metrics?.gpuLoad);
    const gpuTemp = nonNegativeOrNull(primaryGpu?.temperatureC ?? metrics?.gpuTemp);
    const ramMB = nonNegativeOrNull(overview?.memory?.usedGB) !== null ? overview.memory.usedGB * 1024 : null;
    const totalRamMB = nonNegativeOrNull(overview?.memory?.totalGB) !== null ? overview.memory.totalGB * 1024 : null;
    const vramMB = nonNegativeOrNull(primaryGpu?.memoryUsedMB);
    const networkAt = networkMeasurementTime(networkQuality, now());
    const latencyMs = networkAt === null ? null : nonNegativeOrNull(networkQuality?.latencyMs);
    const packetLossPercent = networkAt === null ? null : nonNegativeOrNull(networkQuality?.packetLossPercent);
    const newNetworkMeasurement = networkAt !== null && (lastNetworkMeasurementAt === null || networkAt > lastNetworkMeasurementAt);

    if (cpuUsage !== null) {
      statistics.add('cpu', cpuUsage);
      pushHistory(activeSession.history, 'cpu', cpuUsage, timestamp);
    }
    if (gpuUsage !== null) {
      statistics.add('gpu', gpuUsage);
      pushHistory(activeSession.history, 'gpu', gpuUsage, timestamp);
    }
    if (gpuTemp !== null) {
      statistics.add('gpuTemp', gpuTemp);
    }
    if (ramMB !== null) {
      statistics.add('ramMB', ramMB);
    }
    if (vramMB !== null) {
      statistics.add('vramMB', vramMB);
    }
    if (newNetworkMeasurement && latencyMs !== null) {
      statistics.add('latency', latencyMs);
      pushHistory(activeSession.history, 'latency', latencyMs, networkAt);
    }
    if (newNetworkMeasurement && packetLossPercent !== null) {
      statistics.add('packetLoss', packetLossPercent);
    }
    if (newNetworkMeasurement) lastNetworkMeasurementAt = networkAt;

    activeSession.live = {
      cpuUsagePercent: roundOrNull(cpuUsage, 1),
      gpuUsagePercent: roundOrNull(gpuUsage, 1),
      gpuTempC: roundOrNull(gpuTemp, 0),
      ramUsedMB: roundOrNull(ramMB, 0),
      vramUsedMB: roundOrNull(vramMB, 0),
      latencyMs: roundOrNull(latencyMs, 1),
      packetLossPercent: roundOrNull(packetLossPercent, 2)
    };
    if (totalRamMB !== null) {
      activeSession.systemMemoryTotalMB = roundOrNull(totalRamMB, 0);
    }

    ingestProcessSnapshot(overview?.processes);
    updateMetrics();
    emitUpdate();
  }

  function ingestCaptureSamples(captureSamples = []) {
    if (!activeSession || activeSession.sessionStatus !== 'recording') {
      return;
    }

    for (const sample of captureSamples) {
      const timestamp = Number(sample?.timestamp) || now();
      const fps = nonNegativeOrNull(sample?.fps);
      const frametime = nonNegativeOrNull(sample?.frametimeMs);
      statistics.addFrame(fps, frametime);
      if (fps !== null) {
        pushHistory(activeSession.history, 'fps', fps, timestamp);
      }
      if (frametime !== null) {
        pushHistory(activeSession.history, 'frametime', frametime, timestamp);
      }
    }
  }

  function startCapturePolling() {
    if (capturePollTimer) {
      return;
    }
    capturePollTimer = setInterval(() => {
      ingestCaptureSamples(captureService.readSamples());
      if (activeSession?.sessionStatus === 'recording') {
        updateMetrics();
        emitUpdate();
      }
    }, CAPTURE_POLL_INTERVAL_MS);
  }

  function stopCapturePolling() {
    if (capturePollTimer) {
      clearInterval(capturePollTimer);
      capturePollTimer = null;
    }
  }

  function startProcessWatcher() {
    if (processWatchTimer) {
      return;
    }

    processWatchTimer = setInterval(() => {
      if (!activeSession || activeSession.sessionStatus !== 'recording') {
        return;
      }

      if (!isProcessRunning(activeSession.processId)) {
        void stopSession({ reason: 'game-exited' });
      }
    }, PROCESS_WATCH_INTERVAL_MS);
  }

  function stopProcessWatcher() {
    if (processWatchTimer) {
      clearInterval(processWatchTimer);
      processWatchTimer = null;
    }
  }

  function saveReport(session) {
    const root = getSessionsRoot();
    const reportPath = path.join(root, `${session.sessionId}.json`);
    const tempPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(session, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(tempPath, reportPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(reportPath, 0o600);
    }
    lastReport = {
      ...session,
      reportPath
    };
    return lastReport;
  }

  function readReportFile(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const storedTotalMemoryMB = nonNegativeOrNull(parsed?.systemMemoryTotalMB);
    return {
      ...parsed,
      systemMemoryTotalMB: storedTotalMemoryMB !== null && storedTotalMemoryMB > 0
        ? storedTotalMemoryMB
        : getTotalSystemMemoryMB(),
      reportPath: filePath
    };
  }

  function listReports() {
    const root = getSessionsRoot();
    const reports = fs.readdirSync(root)
      .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
      .map((fileName) => {
        const filePath = path.join(root, fileName);
        try {
          const report = readReportFile(filePath);
          const parsedTimestamp = Date.parse(report.endedAt || report.startedAt || '');
          const timestamp = Number.isFinite(parsedTimestamp)
            ? parsedTimestamp
            : fs.statSync(filePath).mtimeMs;
          return { report, filePath, timestamp };
        } catch (error) {
          logger?.warn?.('Unable to read game session report.', {
            fileName,
            message: error.message
          });
          try {
            fs.rmSync(filePath, { force: true });
          } catch (_removeError) {}
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.timestamp - left.timestamp);

    const cutoff = now() - SESSION_REPORT_RETENTION_MS;
    const captureRootResolved = path.resolve(captureRoot);
    const retained = [];
    for (const entry of reports) {
      const keep = entry.timestamp >= cutoff && retained.length < SESSION_REPORT_LIMIT;
      if (keep) {
        retained.push(entry.report);
        continue;
      }
      fs.rmSync(entry.filePath, { force: true });
      const rawCapturePath = path.resolve(String(entry.report.rawCapturePath || ''));
      if (
        rawCapturePath.startsWith(`${captureRootResolved}${path.sep}`) &&
        fs.existsSync(rawCapturePath)
      ) {
        fs.rmSync(rawCapturePath, { force: true });
      }
    }

    if (fs.existsSync(captureRoot)) {
      for (const entry of fs.readdirSync(captureRoot, { withFileTypes: true })) {
        const capturePath = path.resolve(captureRoot, entry.name);
        if (entry.isDirectory() && /^\.nova-session-stats-[a-z0-9]{6}$/i.test(entry.name)) {
          try {
            if (path.dirname(capturePath) === captureRootResolved && !statistics.ownsDirectory(capturePath) && fs.statSync(capturePath).mtimeMs < cutoff) {
              fs.rmSync(capturePath, { recursive: true, force: true });
            }
          } catch (_error) {}
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          if (fs.statSync(capturePath).mtimeMs < cutoff) {
            fs.rmSync(capturePath, { force: true });
          }
        } catch (_error) {}
      }
    }

    return retained;
  }

  function getReport(sessionId) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    return listReports().find((report) => report.sessionId === normalizedSessionId) || null;
  }

  async function resolveGame(inputGame) {
    const source = inputGame && typeof inputGame === 'object'
      ? inputGame
      : detectActiveGame
        ? await detectActiveGame()
        : null;
    const game = normalizeGame(source || {});

    if (game.processId && isProcessRunning(game.processId)) {
      return game;
    }

    const resolvedProcess = await resolveRunningProcessByExecutablePath(game.executablePath, { platform });
    if (resolvedProcess?.processId) {
      return {
        ...game,
        processId: resolvedProcess.processId,
        processName: game.processName || resolvedProcess.processName,
        executablePath: game.executablePath || resolvedProcess.executablePath
      };
    }

    return game;
  }

  async function startSession({
    game = null,
    profileId = '',
    autoRestore = false,
    autoStarted = false
  } = {}) {
    if (stopPromise) await stopPromise;
    if (activeSession?.sessionStatus === 'recording') {
      return activeSession;
    }

    const resolvedGame = await resolveGame(game);
    if (!resolvedGame.processId || !isProcessRunning(resolvedGame.processId)) {
      const error = new Error('A running detected game process is required to start a session.');
      error.code = 'GAME_PROCESS_NOT_RUNNING';
      throw error;
    }

    resetAggregates();

    const sessionId = `game-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    fs.mkdirSync(captureRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      fs.chmodSync(captureRoot, 0o700);
    }
    const captureStart = await captureService.start({
      processId: resolvedGame.processId,
      processName: resolvedGame.processName,
      sessionId,
      outputDirectory: captureRoot
    });
    const overviewTotalMemoryGB = nonNegativeOrNull(latestOverview?.memory?.totalGB);

    activeSession = createSession({
      sessionId,
      game: resolvedGame,
      profileId,
      captureStatus: captureStart.status,
      rawCapturePath: captureStart.outputCsvPath,
      systemMemoryTotalMB: overviewTotalMemoryGB !== null && overviewTotalMemoryGB > 0
        ? overviewTotalMemoryGB * 1024
        : getTotalSystemMemoryMB()
    });
    activeSession.frameStatisticsScope = 'recent';
    activeSession.frameStatisticsSampleLimit = LIVE_SAMPLE_LIMIT;
    activeSession.autoStarted = Boolean(autoStarted);
    activeSession.restore = {
      autoRestore: Boolean(autoRestore),
      status: autoRestore ? 'prepared' : 'not_configured',
      message: autoRestore
        ? 'Auto restore is prepared for temporary profile state, but no temporary profile snapshot was applied by the session manager.'
        : 'No temporary profile restore was requested for this session.'
    };

    if (captureStart.status === 'unavailable' || captureStart.status === 'failed') {
      updateWarnings();
    }

    startCapturePolling();
    startProcessWatcher();
    onRecordingStateChange?.(true);

    if (latestMetrics) {
      recordMetrics(latestMetrics);
    } else {
      updateMetrics();
    }
    emitUpdate();
    return activeSession;
  }

  async function stopSession({ reason = 'manual' } = {}) {
    if (stopPromise) return stopPromise;
    if (!activeSession) return null;
    const operation = finishSession(reason);
    stopPromise = operation;
    try { return await operation; }
    catch (error) { statistics.invalidate(error); throw error; }
    finally {
      disposeStatistics();
      if (stopPromise === operation) stopPromise = null;
    }
  }

  async function finishSession(reason) {
    const sessionToStop = activeSession;
    stopCapturePolling();
    stopProcessWatcher();
    if (sessionToStop.sessionStatus === 'recording') {
      ingestCaptureSamples(captureService.readSamples());
      await captureService.stop();
      ingestCaptureSamples(captureService.readSamples());
      sessionToStop.endedAt = new Date(now()).toISOString();
      sessionToStop.sessionStatus = 'stopped';
      sessionToStop.stopReason = normalizeString(reason) || 'manual';
      let distribution;
      try {
        distribution = await statistics.finalize();
        sessionToStop.frameStatisticsScope = 'session';
      } catch (error) {
        distribution = { onePercentLow: null, pointOnePercentLow: null, p95FrametimeMs: null, p99FrametimeMs: null, stutterCount: null };
        sessionToStop.frameStatisticsScope = 'unavailable';
        sessionToStop.statisticsWarning = STATISTICS_WARNING;
        logger?.warn?.('Unable to finalize session frame statistics.', { message: error.message });
      }
      updateMetrics(distribution);
      saveReport(sessionToStop);
    }
    activeSession = null;
    onRecordingStateChange?.(false);
    emitUpdate();
    return lastReport;
  }

  async function retryCapture() {
    if (stopPromise || !activeSession || activeSession.sessionStatus !== 'recording') {
      return getState();
    }

    const captureStart = await captureService.start({
      processId: activeSession.processId,
      processName: activeSession.processName,
      sessionId: `${activeSession.sessionId}-retry-${Date.now()}`,
      outputDirectory: captureRoot
    });

    activeSession.captureStatus = captureStart.status;
    activeSession.rawCapturePath = captureStart.outputCsvPath || activeSession.rawCapturePath || '';
    updateMetrics();
    emitUpdate();
    return getState();
  }

  function setAutoTracking(enabled) {
    autoTracking = Boolean(enabled);
    emitUpdate();
    return autoTracking;
  }

  function isRecording() {
    return Boolean(activeSession && activeSession.sessionStatus === 'recording');
  }

  async function clearLocalData() {
    if (stopPromise) await stopPromise;
    stopProcessWatcher();
    stopCapturePolling();
    try {
      await captureService.stop();
    } catch (_error) {}
    activeSession = null;
    lastReport = null;
    latestOverview = null;
    latestMetrics = null;
    resetAggregates();
    fs.rmSync(sessionsRoot, { recursive: true, force: true });
    fs.rmSync(captureRoot, { recursive: true, force: true });
    emitUpdate();
    return { ok: true };
  }

  return {
    getState,
    handleMetrics,
    startSession,
    stopSession,
    retryCapture,
    setAutoTracking,
    listReports,
    getReport,
    isRecording,
    isProcessRunning,
    clearLocalData
  };
}

module.exports = {
  createGameSessionManager,
  resolveRunningProcessByExecutablePath,
  isProcessRunning,
  averageLowestPercent,
  percentile
};
