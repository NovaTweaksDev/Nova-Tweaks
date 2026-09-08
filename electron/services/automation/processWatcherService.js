const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const DEFAULT_INTERVAL_MS = 5000;
const MAX_HISTORY_ENTRIES = 100;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PROCESS_AGE_MS = 30 * 1000;
const PROTECTED_PROCESS_NAMES = new Set([
  'system',
  'idle',
  'registry',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'svchost',
  'fontdrvhost',
  'dwm',
  'memory compression',
  'secure system'
]);

const WINDOWS_PROCESS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$items = @(Get-Process | ForEach-Object {',
  '  try {',
  '    [PSCustomObject]@{',
  '      name = $_.ProcessName',
  '      pid = [int]$_.Id',
  '      startTime = $_.StartTime.ToUniversalTime().ToString("o")',
  '      executablePath = $_.Path',
  '      cpuSeconds = $_.CPU',
  '      ramBytes = $_.WorkingSet64',
  '      ioReadBytes = $_.IOReadBytes',
  '      ioWriteBytes = $_.IOWriteBytes',
  '      responding = $_.Responding',
  '      mainWindowHandle = [int64]$_.MainWindowHandle',
  '    }',
  '  } catch {}',
  '})',
  '$items | ConvertTo-Json -Depth 4 -Compress'
].join('\n');

const WINDOWS_ACTION_SCRIPT = [
  'param([int]$ProcessId, [string]$ExpectedStartBase64, [string]$ExpectedPathBase64, [string]$Mode)',
  "$ErrorActionPreference = 'Stop'",
  '$expectedStart = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExpectedStartBase64))',
  '$expectedPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExpectedPathBase64))',
  'try { $target = Get-Process -Id $ProcessId -ErrorAction Stop } catch {',
  '  [PSCustomObject]@{ ok = $true; alreadyExited = $true; stillRunning = $false } | ConvertTo-Json -Compress',
  '  exit 0',
  '}',
  '$actualStart = $target.StartTime.ToUniversalTime().ToString("o")',
  '$actualPath = ""',
  'try { $actualPath = [string]$target.Path } catch {}',
  'if ($actualStart -ne $expectedStart -or ($expectedPath -and $actualPath -and $actualPath -ne $expectedPath)) {',
  '  [PSCustomObject]@{ ok = $false; code = "PROCESS_IDENTITY_CHANGED"; message = "The process identity changed before the action was executed." } | ConvertTo-Json -Compress',
  '  exit 0',
  '}',
  'if ($Mode -eq "force") {',
  '  Stop-Process -Id $ProcessId -Force -ErrorAction Stop',
  '  Start-Sleep -Milliseconds 250',
  '} else {',
  '  $requested = $target.CloseMainWindow()',
  '  if ($requested) { Start-Sleep -Seconds 5 }',
  '}',
  '$stillRunning = $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)',
  '[PSCustomObject]@{ ok = $true; requested = [bool]$requested; stillRunning = [bool]$stillRunning; forceAvailable = [bool]$stillRunning } | ConvertTo-Json -Compress'
].join('\n');

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateAdaptiveMemoryThresholdMB(totalMemoryBytes = os.totalmem()) {
  const totalMB = Math.max(0, Number(totalMemoryBytes) || 0) / (1024 ** 2);
  return Math.round(Math.max(2048, Math.min(4096, totalMB * 0.2)));
}

function normalizeExecutableIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function isProtectedProcess(processInfo, ownProcessId = process.pid) {
  const name = normalizeExecutableIdentity(processInfo?.name).replace(/\.exe$/i, '');
  const executablePath = normalizeExecutableIdentity(processInfo?.executablePath);
  if (!Number.isFinite(Number(processInfo?.pid)) || Number(processInfo.pid) <= 4 || Number(processInfo.pid) === ownProcessId) {
    return true;
  }
  if (PROTECTED_PROCESS_NAMES.has(name)) {
    return true;
  }
  return name.includes('novatweaks') ||
    name.includes('presentmon') ||
    name.includes('librehardwaremonitor') ||
    executablePath.includes('\\nova tweaks\\') ||
    executablePath.includes('\\novatweaks\\');
}

function runPowerShellJson(script, args = [], timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    execFile(
      resolveWindowsSystemExecutable('powershell'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        try {
          resolve(stdout ? JSON.parse(stdout) : null);
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

function defaultSnapshotProvider() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return runPowerShellJson(WINDOWS_PROCESS_SCRIPT);
}

function encodeArgument(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function defaultActionProvider(processInfo, force) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, code: 'UNSUPPORTED_PLATFORM', message: 'Process actions require Windows.' });
  }
  return runPowerShellJson(WINDOWS_ACTION_SCRIPT, [
    '-ProcessId', String(Math.trunc(Number(processInfo.pid))),
    '-ExpectedStartBase64', encodeArgument(processInfo.startTime),
    '-ExpectedPathBase64', encodeArgument(processInfo.executablePath),
    '-Mode', force ? 'force' : 'close'
  ], force ? 5000 : 8000);
}

function createProcessWatcherService(options = {}) {
  const app = options.app;
  const logger = options.logger;
  const snapshotProvider = options.snapshotProvider || defaultSnapshotProvider;
  const actionProvider = options.actionProvider || defaultActionProvider;
  const isAdminProvider = typeof options.isAdminProvider === 'function' ? options.isAdminProvider : () => false;
  const privilegedExecutor = typeof options.privilegedExecutor === 'function' ? options.privilegedExecutor : null;
  const getSettings = options.getSettings || (() => ({}));
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const onSnapshot = typeof options.onSnapshot === 'function' ? options.onSnapshot : () => {};
  const getActiveGame = typeof options.getActiveGame === 'function' ? options.getActiveGame : () => null;
  const nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => Date.now();
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : DEFAULT_INTERVAL_MS;
  const historyPath = options.historyPath || path.join(app?.getPath?.('userData') || process.cwd(), 'automation', 'process-alerts.json');

  let timer = null;
  let pollInProgress = false;
  let previousStats = new Map();
  let conditionSince = new Map();
  let cooldownUntil = new Map();
  let currentAlerts = [];
  let history = [];
  let lastUpdated = null;
  let lastError = '';

  function config() {
    return getSettings()?.automation?.processDetection || {};
  }
  function hasActiveRules() {
    return (getSettings()?.automation?.rules || []).some((rule) => rule?.enabled);
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      history = Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      history = [];
    }
    pruneHistory();
  }

  function writeHistory() {
    const directory = path.dirname(historyPath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${historyPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(history, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    try {
      fs.renameSync(temporaryPath, historyPath);
    } catch (_error) {
      fs.rmSync(historyPath, { force: true });
      fs.renameSync(temporaryPath, historyPath);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(historyPath, 0o600);
    }
  }

  function pruneHistory(now = nowProvider()) {
    history = history
      .filter((entry) => now - Number(entry.createdAt || 0) <= HISTORY_RETENTION_MS)
      .slice(0, MAX_HISTORY_ENTRIES);
  }

  function getState() {
    const settings = config();
    return {
      enabled: Boolean(settings.enabled),
      running: Boolean(timer),
      lastUpdated,
      lastError,
      calculatedMemoryThresholdMB: calculateAdaptiveMemoryThresholdMB(),
      settings,
      currentAlerts: currentAlerts.map((entry) => ({ ...entry })),
      history: history.map((entry) => ({ ...entry })),
      unreadCount: currentAlerts.length
    };
  }

  function emitUpdate() {
    onUpdate(getState());
  }

  function isExcluded(processInfo, settings) {
    const exclusions = Array.isArray(settings.excludedExecutables) ? settings.excludedExecutables : [];
    const name = normalizeExecutableIdentity(processInfo.name);
    const executablePath = normalizeExecutableIdentity(processInfo.executablePath);
    return exclusions.some((entry) => entry === name || (executablePath && entry === executablePath));
  }

  function normalizeProcesses(rawProcesses, now) {
    const logicalCores = Math.max(1, os.cpus()?.length || 1);
    const nextStats = new Map();
    const normalized = normalizeArray(rawProcesses).map((raw) => {
      const pid = Number(raw?.pid);
      const cpuSeconds = toFiniteNumber(raw?.cpuSeconds);
      const readBytes = toFiniteNumber(raw?.ioReadBytes);
      const writeBytes = toFiniteNumber(raw?.ioWriteBytes);
      const previous = previousStats.get(pid);
      let cpuPercent = toFiniteNumber(raw?.cpuPercent);
      let diskMBs = toFiniteNumber(raw?.diskMBs);
      if (previous) {
        const elapsedSeconds = Math.max(0.5, (now - previous.timestamp) / 1000);
        if (cpuPercent === null && cpuSeconds !== null && previous.cpuSeconds !== null && cpuSeconds >= previous.cpuSeconds) {
          cpuPercent = Math.max(0, Math.min(100, ((cpuSeconds - previous.cpuSeconds) / elapsedSeconds / logicalCores) * 100));
        }
        if (diskMBs === null && readBytes !== null && writeBytes !== null && previous.readBytes !== null && previous.writeBytes !== null) {
          diskMBs = Math.max(0, ((readBytes - previous.readBytes) + (writeBytes - previous.writeBytes)) / elapsedSeconds / (1024 ** 2));
        }
      }
      if (Number.isFinite(pid)) {
        nextStats.set(pid, { cpuSeconds, readBytes, writeBytes, timestamp: now });
      }
      return {
        name: String(raw?.name || 'Process'),
        pid,
        startTime: String(raw?.startTime || ''),
        executablePath: String(raw?.executablePath || ''),
        cpuPercent,
        ramMB: Math.max(0, Number(raw?.ramMB) || (Number(raw?.ramBytes) || 0) / (1024 ** 2)),
        diskMBs,
        responding: raw?.responding !== false,
        mainWindowHandle: Number(raw?.mainWindowHandle) || 0
      };
    }).filter((entry) => Number.isFinite(entry.pid) && entry.startTime);
    previousStats = nextStats;
    return normalized;
  }

  function createAlert(processInfo, metric, value, threshold, durationSeconds, now) {
    const protectedProcess = isProtectedProcess(processInfo);
    const alert = {
      id: randomUUID(),
      identity: `${processInfo.pid}:${processInfo.startTime}`,
      pid: processInfo.pid,
      processName: processInfo.name,
      executablePath: processInfo.executablePath,
      startTime: processInfo.startTime,
      metric,
      value: Math.round(Number(value) * 10) / 10,
      threshold: Math.round(Number(threshold) * 10) / 10,
      durationSeconds,
      protected: protectedProcess,
      canClose: !protectedProcess,
      forceAvailable: false,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };
    currentAlerts = [alert, ...currentAlerts].slice(0, 20);
    history = [alert, ...history].slice(0, MAX_HISTORY_ENTRIES);
    writeHistory();
  }

  function evaluateCondition(processInfo, metric, active, value, threshold, durationSeconds, now) {
    const key = `${processInfo.pid}:${processInfo.startTime}:${metric}`;
    if (!active) {
      conditionSince.delete(key);
      return;
    }
    const since = conditionSince.get(key) || now;
    conditionSince.set(key, since);
    if (now - since < durationSeconds * 1000 || Number(cooldownUntil.get(key) || 0) > now) return;
    if (currentAlerts.some((alert) => alert.identity === `${processInfo.pid}:${processInfo.startTime}` && alert.metric === metric)) return;
    createAlert(processInfo, metric, value, threshold, durationSeconds, now);
    cooldownUntil.set(key, now + Math.max(1, Number(config().cooldownMinutes) || 15) * 60 * 1000);
  }

  async function pollOnce() {
    if (pollInProgress || (!config().enabled && !hasActiveRules())) return getState();
    pollInProgress = true;
    const now = nowProvider();
    try {
      const rawProcesses = await snapshotProvider();
      const processes = normalizeProcesses(rawProcesses, now);
      onSnapshot(processes.map((entry) => ({ ...entry })), now);
      const settings = config();
      const detectionEnabled = Boolean(settings.enabled);
      const activeGame = await Promise.resolve(getActiveGame());
      const activeGamePid = Number(activeGame?.processId || activeGame?.activeGame?.processId) || 0;
      const memoryThreshold = Number(settings.memoryThresholdMB) > 0
        ? Number(settings.memoryThresholdMB)
        : calculateAdaptiveMemoryThresholdMB();

      for (const processInfo of processes) {
        const startedAt = Date.parse(processInfo.startTime);
        if (!Number.isFinite(startedAt) || now - startedAt < MIN_PROCESS_AGE_MS || isExcluded(processInfo, settings)) continue;
        const gameSuppressed = processInfo.pid === activeGamePid;
        evaluateCondition(processInfo, 'cpu', detectionEnabled && Boolean(settings.cpuEnabled) && !gameSuppressed && processInfo.cpuPercent !== null && processInfo.cpuPercent >= Number(settings.cpuThresholdPercent), processInfo.cpuPercent || 0, Number(settings.cpuThresholdPercent), Number(settings.cpuDurationSeconds), now);
        evaluateCondition(processInfo, 'memory', detectionEnabled && Boolean(settings.memoryEnabled) && processInfo.ramMB >= memoryThreshold, processInfo.ramMB, memoryThreshold, Number(settings.memoryDurationSeconds), now);
        evaluateCondition(processInfo, 'disk', detectionEnabled && Boolean(settings.diskEnabled) && !gameSuppressed && processInfo.diskMBs !== null && processInfo.diskMBs >= Number(settings.diskThresholdMBs), processInfo.diskMBs || 0, Number(settings.diskThresholdMBs), Number(settings.diskDurationSeconds), now);
        evaluateCondition(processInfo, 'notResponding', detectionEnabled && Boolean(settings.notRespondingEnabled) && !processInfo.responding, Number(settings.notRespondingDurationSeconds), Number(settings.notRespondingDurationSeconds), Number(settings.notRespondingDurationSeconds), now);
      }
      lastUpdated = now;
      lastError = '';
      pruneHistory(now);
      emitUpdate();
    } catch (error) {
      lastError = error?.message || 'Process detection failed.';
      logger?.warn?.('Process detection poll failed.', { message: lastError });
      emitUpdate();
    } finally {
      pollInProgress = false;
    }
    return getState();
  }

  function start() {
    if (timer || (!config().enabled && !hasActiveRules())) return;
    timer = setInterval(() => void pollOnce(), intervalMs);
    void pollOnce();
    emitUpdate();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    previousStats = new Map();
    conditionSince = new Map();
    emitUpdate();
  }

  function applySettings() {
    if (config().enabled || hasActiveRules()) start();
    else stop();
    emitUpdate();
  }

  function dismissAlert(alertId) {
    const alert = currentAlerts.find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, code: 'ALERT_NOT_FOUND', message: 'Process alert was not found.' };
    currentAlerts = currentAlerts.filter((entry) => entry.id !== alertId);
    history = history.map((entry) => entry.id === alertId ? { ...entry, status: 'ignored', updatedAt: nowProvider() } : entry);
    writeHistory();
    emitUpdate();
    return { ok: true, state: getState() };
  }

  function clearHistory() {
    history = [];
    writeHistory();
    emitUpdate();
    return { ok: true, state: getState() };
  }

  async function actOnAlert(alertId, force = false) {
    const alert = currentAlerts.find((entry) => entry.id === alertId);
    if (!alert) return { ok: false, code: 'ALERT_NOT_FOUND', message: 'Process alert was not found.' };
    if (alert.protected || !alert.canClose) return { ok: false, code: 'PROTECTED_PROCESS', message: 'Nova will not close this protected process.' };
    let result;
    try {
      if (force && !isAdminProvider() && privilegedExecutor) {
        await privilegedExecutor('process.terminate', {
          processId: alert.processId || alert.pid,
          startTime: alert.startTime,
          executablePath: alert.executablePath
        }, { reason: 'process-terminate', timeoutMs: 15000 });
        result = { ok: true, stillRunning: false };
      } else {
        result = await actionProvider(alert, force);
      }
    } catch (error) {
      logger?.warn?.('Process action failed.', {
        alertId,
        force,
        message: error?.message || String(error)
      });
      return {
        ok: false,
        code: 'PROCESS_ACTION_FAILED',
        message: error?.message || 'The process action failed.'
      };
    }
    const now = nowProvider();
    if (!result?.ok) return result;
    if (result.stillRunning) {
      currentAlerts = currentAlerts.map((entry) => entry.id === alertId ? { ...entry, forceAvailable: true, status: 'close-requested', updatedAt: now } : entry);
      history = history.map((entry) => entry.id === alertId ? { ...entry, forceAvailable: true, status: 'close-requested', updatedAt: now } : entry);
    } else {
      currentAlerts = currentAlerts.filter((entry) => entry.id !== alertId);
      history = history.map((entry) => entry.id === alertId ? { ...entry, status: force ? 'force-closed' : 'closed', updatedAt: now } : entry);
    }
    writeHistory();
    emitUpdate();
    return { ...result, state: getState() };
  }

  async function requestCloseProcess(processInfo) {
    if (!processInfo || isProtectedProcess(processInfo) || !Number.isFinite(Number(processInfo.pid))) {
      return { ok: false, code: 'PROTECTED_PROCESS', message: 'Nova will not close this protected process.' };
    }
    try {
      return await actionProvider(processInfo, false);
    } catch (error) {
      return { ok: false, code: 'PROCESS_ACTION_FAILED', message: error?.message || 'The process action failed.' };
    }
  }

  loadHistory();

  return {
    getState,
    start,
    stop,
    applySettings,
    pollOnce,
    dismissAlert,
    clearHistory,
    requestCloseProcess,
    requestClose: (alertId) => actOnAlert(alertId, false),
    forceTerminate: (alertId) => actOnAlert(alertId, true)
  };
}

module.exports = {
  calculateAdaptiveMemoryThresholdMB,
  createProcessWatcherService,
  isProtectedProcess
};
