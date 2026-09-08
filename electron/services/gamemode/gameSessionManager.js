const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createMonitoringProviderManager } = require('./monitoringProviderManager');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const SESSION_SCHEMA_VERSION = 1;
const SESSION_HISTORY_LIMIT = 900;
const SESSION_REPORT_LIMIT = 25;
const SESSION_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROCESS_WATCH_INTERVAL_MS = 2500;
const CAPTURE_POLL_INTERVAL_MS = 500;

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

function average(values) {
  const numericValues = values.map(toFiniteNumber).filter((value) => value !== null);
  if (!numericValues.length) {
    return null;
  }
  return numericValues.reduce((total, value) => total + value, 0) / numericValues.length;
}

function percentile(values, percentileValue) {
  const numericValues = values.map(toFiniteNumber).filter((value) => value !== null).sort((left, right) => left - right);
  if (!numericValues.length) {
    return null;
  }
  const index = Math.min(
    numericValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * numericValues.length) - 1)
  );
  return numericValues[index];
}

function averageLowestPercent(values, percent) {
  const numericValues = values.map(toFiniteNumber).filter((value) => value !== null).sort((left, right) => left - right);
  if (!numericValues.length) {
    return null;
  }
  const count = Math.max(1, Math.ceil(numericValues.length * (percent / 100)));
  return average(numericValues.slice(0, count));
}

function maxValue(values) {
  const numericValues = values.map(toFiniteNumber).filter((value) => value !== null);
  return numericValues.length ? Math.max(...numericValues) : null;
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
  const captureService = options.captureService || createMonitoringProviderManager({
    app,
    logger,
    platform,
    onEvent: options.onPresentMonEvent
  });

  let activeSession = null;
  let lastReport = null;
  let autoTracking = false;
  let processWatchTimer = null;
  let capturePollTimer = null;
  let latestOverview = null;
  let latestMetrics = null;
  const samples = {
    fps: [],
    frametime: [],
    cpu: [],
    gpu: [],
    gpuTemp: [],
    ramMB: [],
    vramMB: [],
    latency: [],
    packetLoss: []
  };
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

  function resetAggregates() {
    for (const key of Object.keys(samples)) {
      samples[key] = [];
    }
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
    const captureStatus = captureService.getStatus();
    if (captureStatus.status === 'unavailable') {
      addUniqueMessage(warnings, 'FPS monitoring unavailable: PresentMon Service/API helper is not bundled with this build.');
    } else if (captureStatus.status === 'failed') {
      addUniqueMessage(warnings, `FPS monitoring unavailable${captureStatus.message ? `: ${captureStatus.message}` : '.'}`);
    } else if (captureStatus.status === 'no_data') {
      addUniqueMessage(warnings, captureStatus.message || 'No frame data has arrived from PresentMon Service.');
    } else if (['starting', 'connected', 'running'].includes(captureStatus.status) && !samples.fps.length) {
      addUniqueMessage(
        warnings,
        captureStatus.message
          ? `FPS monitoring is running, but no frame samples have been captured yet: ${captureStatus.message}`
          : 'FPS monitoring is running, but no frame samples have been captured yet.'
      );
    }

    if (!samples.gpuTemp.length) {
      addUniqueMessage(warnings, 'GPU temperature sensor unavailable.');
    }
    if (!samples.vramMB.length) {
      addUniqueMessage(warnings, 'VRAM usage sensor unavailable.');
    }
    if (!samples.latency.length) {
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

    const gpuMaxTempC = maxValue(samples.gpuTemp);
    if (gpuMaxTempC !== null) {
      addUniqueMessage(
        insights,
        gpuMaxTempC >= 85
          ? `GPU temperature peaked at ${roundOrNull(gpuMaxTempC, 0)} C during the session.`
          : 'GPU temperature stayed stable during the session.'
      );
    }

    const ramPeak = maxValue(samples.ramMB);
    if (ramPeak !== null) {
      addUniqueMessage(insights, `RAM peak was ${formatGbFromMb(ramPeak)} GB during the session.`);
    }

    const vramPeak = maxValue(samples.vramMB);
    if (vramPeak !== null) {
      addUniqueMessage(insights, `VRAM peak was ${formatGbFromMb(vramPeak)} GB during the session.`);
    }

    const latencyPeak = maxValue(samples.latency);
    if (latencyPeak !== null && latencyPeak >= 120) {
      addUniqueMessage(insights, `Network latency spiked to ${roundOrNull(latencyPeak, 0)} ms during the session.`);
    }

    const packetLossPeak = maxValue(samples.packetLoss);
    if (packetLossPeak !== null && packetLossPeak > 0) {
      addUniqueMessage(insights, 'Packet loss detected during the session.');
    }

    if (!insights.length && activeSession.sessionStatus === 'recording') {
      addUniqueMessage(insights, 'Collecting live session data.');
    }

    activeSession.insights = insights;
  }

  function updateMetrics() {
    if (!activeSession) {
      return;
    }

    const frametimeValues = samples.frametime.filter((value) => toFiniteNumber(value) !== null);
    const avgFrametime = average(frametimeValues);
    activeSession.metrics = {
      avgFps: roundOrNull(average(samples.fps), 1),
      currentFps: roundOrNull(samples.fps.length ? samples.fps[samples.fps.length - 1] : null, 1),
      onePercentLow: roundOrNull(averageLowestPercent(samples.fps, 1), 1),
      pointOnePercentLow: roundOrNull(averageLowestPercent(samples.fps, 0.1), 1),
      avgFrametimeMs: roundOrNull(avgFrametime, 2),
      p95FrametimeMs: roundOrNull(percentile(frametimeValues, 95), 2),
      p99FrametimeMs: roundOrNull(percentile(frametimeValues, 99), 2),
      worstFrametimeMs: roundOrNull(maxValue(frametimeValues), 2),
      stutterCount: frametimeValues.filter((value) => value >= Math.max(50, (avgFrametime || 0) * 2)).length,
      cpuAvgPercent: roundOrNull(average(samples.cpu), 1),
      gpuAvgPercent: roundOrNull(average(samples.gpu), 1),
      gpuMaxTempC: roundOrNull(maxValue(samples.gpuTemp), 0),
      ramPeakMB: roundOrNull(maxValue(samples.ramMB), 0),
      vramPeakMB: roundOrNull(maxValue(samples.vramMB), 0),
      avgLatencyMs: roundOrNull(average(samples.latency), 1),
      packetLossPercent: roundOrNull(average(samples.packetLoss), 2)
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
    latestMetrics = metrics || null;
    latestOverview = metrics?.overview || null;

    if (!activeSession || activeSession.sessionStatus !== 'recording') {
      return;
    }

    const timestamp = Number(metrics?.timestamp) || now();
    const overview = latestOverview;
    const primaryGpu = getPrimaryGpu(overview);
    const networkQuality = getNetworkQuality(overview);
    const cpuUsage = clampPercentOrNull(overview?.cpu?.usagePercent ?? metrics?.cpuLoad);
    const gpuUsage = clampPercentOrNull(primaryGpu?.usagePercent ?? metrics?.gpuLoad);
    const gpuTemp = nonNegativeOrNull(primaryGpu?.temperatureC ?? metrics?.gpuTemp);
    const ramMB = nonNegativeOrNull(overview?.memory?.usedGB) !== null ? overview.memory.usedGB * 1024 : null;
    const vramMB = nonNegativeOrNull(primaryGpu?.memoryUsedMB);
    const latencyMs = nonNegativeOrNull(networkQuality?.latencyMs);
    const packetLossPercent = nonNegativeOrNull(networkQuality?.packetLossPercent);

    if (cpuUsage !== null) {
      samples.cpu.push(cpuUsage);
      pushHistory(activeSession.history, 'cpu', cpuUsage, timestamp);
    }
    if (gpuUsage !== null) {
      samples.gpu.push(gpuUsage);
      pushHistory(activeSession.history, 'gpu', gpuUsage, timestamp);
    }
    if (gpuTemp !== null) {
      samples.gpuTemp.push(gpuTemp);
    }
    if (ramMB !== null) {
      samples.ramMB.push(ramMB);
    }
    if (vramMB !== null) {
      samples.vramMB.push(vramMB);
    }
    if (latencyMs !== null) {
      samples.latency.push(latencyMs);
      pushHistory(activeSession.history, 'latency', latencyMs, timestamp);
    }
    if (packetLossPercent !== null) {
      samples.packetLoss.push(packetLossPercent);
    }

    activeSession.live = {
      cpuUsagePercent: roundOrNull(cpuUsage, 1),
      gpuUsagePercent: roundOrNull(gpuUsage, 1),
      gpuTempC: roundOrNull(gpuTemp, 0),
      ramUsedMB: roundOrNull(ramMB, 0),
      vramUsedMB: roundOrNull(vramMB, 0),
      latencyMs: roundOrNull(latencyMs, 1),
      packetLossPercent: roundOrNull(packetLossPercent, 2)
    };

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
      if (fps !== null) {
        samples.fps.push(fps);
        pushHistory(activeSession.history, 'fps', fps, timestamp);
      }
      if (frametime !== null) {
        samples.frametime.push(frametime);
        pushHistory(activeSession.history, 'frametime', frametime, timestamp);
      }
    }

    if (captureSamples.length) {
      updateMetrics();
      emitUpdate();
    }
  }

  function startCapturePolling() {
    if (capturePollTimer) {
      return;
    }
    capturePollTimer = setInterval(() => {
      ingestCaptureSamples(captureService.readSamples());
      if (activeSession) {
        activeSession.captureStatus = captureService.getStatus().status;
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
    return {
      ...parsed,
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
        if (!entry.isFile()) continue;
        const capturePath = path.join(captureRoot, entry.name);
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

    activeSession = createSession({
      sessionId,
      game: resolvedGame,
      profileId,
      captureStatus: captureStart.status,
      rawCapturePath: captureStart.outputCsvPath
    });
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
      handleMetrics(latestMetrics);
    } else {
      updateMetrics();
    }
    emitUpdate();
    return activeSession;
  }

  async function stopSession({ reason = 'manual' } = {}) {
    if (!activeSession) {
      return null;
    }

    const sessionToStop = activeSession;
    if (sessionToStop.sessionStatus === 'recording') {
      ingestCaptureSamples(captureService.readSamples());
      await captureService.stop();
      ingestCaptureSamples(captureService.readSamples());
      sessionToStop.endedAt = new Date(now()).toISOString();
      sessionToStop.sessionStatus = 'stopped';
      sessionToStop.stopReason = normalizeString(reason) || 'manual';
      sessionToStop.captureStatus = captureService.getStatus().status;
      updateMetrics();
      saveReport(sessionToStop);
    }

    activeSession = null;
    stopCapturePolling();
    stopProcessWatcher();
    onRecordingStateChange?.(false);
    emitUpdate();
    return lastReport;
  }

  async function retryCapture() {
    if (!activeSession || activeSession.sessionStatus !== 'recording') {
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
