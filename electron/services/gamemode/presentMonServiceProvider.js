const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { assertBundledSidecarIntegrity } = require('../security/bundledSidecarIntegrity');

const HELPER_EXE_NAME = 'NovaPresentMonHelper.exe';
const PRESENTMON_API_DLL_NAME = 'PresentMonAPI2Loader.dll';
const PRESENTMON_MIDDLEWARE_DLL_NAME = 'Intel-PresentMon.dll';
const DEFAULT_POLL_MS = 500;
const NO_FRAME_DATA_AFTER_MS = 5000;

function normalizeString(value) {
  return String(value || '').trim();
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeProcessId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function fileExistsWithContent(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch (_error) {
    return false;
  }
}

function directoryExists(directoryPath) {
  try {
    return Boolean(directoryPath) && fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function getAppPathFallback({ app, cwd = process.cwd() } = {}) {
  return typeof app?.getAppPath === 'function' ? app.getAppPath() : cwd;
}

function uniqueResolvedPaths(paths) {
  return [...new Set(paths.map((entry) => normalizeString(entry)).filter(Boolean).map((entry) => path.resolve(entry)))];
}

function getHelperCandidatePaths({ app, resourcesPath = process.resourcesPath, cwd = process.cwd(), env = process.env } = {}) {
  const appPath = getAppPathFallback({ app, cwd });
  return uniqueResolvedPaths([
    app?.isPackaged === true ? '' : env.NOVA_PRESENTMON_HELPER_PATH,
    resourcesPath ? path.join(resourcesPath, 'tools', 'nova-presentmon-helper', HELPER_EXE_NAME) : '',
    path.join(cwd, 'resources', 'tools', 'nova-presentmon-helper', HELPER_EXE_NAME),
    path.join(appPath, 'resources', 'tools', 'nova-presentmon-helper', HELPER_EXE_NAME)
  ]);
}

function getPresentMonToolsCandidateDirectories({ app, resourcesPath = process.resourcesPath, cwd = process.cwd(), env = process.env } = {}) {
  const appPath = getAppPathFallback({ app, cwd });
  return uniqueResolvedPaths([
    app?.isPackaged === true ? '' : env.NOVA_PRESENTMON_SERVICE_PATH,
    app?.isPackaged === true ? '' : env.NOVA_PRESENTMON_TOOLS_PATH,
    resourcesPath ? path.join(resourcesPath, 'tools', 'presentmon') : '',
    path.join(cwd, 'resources', 'tools', 'presentmon'),
    path.join(appPath, 'resources', 'tools', 'presentmon')
  ]);
}

function resolvePresentMonHelperPath(options = {}) {
  return getHelperCandidatePaths(options).find(fileExistsWithContent) || '';
}

function resolvePresentMonToolsPath(options = {}) {
  return getPresentMonToolsCandidateDirectories(options)
    .find((directoryPath) => {
      if (!directoryExists(directoryPath)) return false;
      return fileExistsWithContent(path.join(directoryPath, PRESENTMON_API_DLL_NAME)) &&
        fileExistsWithContent(path.join(directoryPath, PRESENTMON_MIDDLEWARE_DLL_NAME));
    }) || '';
}

function buildHelperArgs({
  processId,
  processName,
  pollMs = DEFAULT_POLL_MS,
  presentMonPath
} = {}) {
  const args = [];
  const normalizedProcessId = normalizeProcessId(processId);
  const normalizedProcessName = normalizeString(processName);

  if (normalizedProcessId) {
    args.push('--target-pid', String(normalizedProcessId));
  } else if (normalizedProcessName) {
    args.push('--target-process-name', normalizedProcessName);
  } else {
    throw new Error('A target process name or PID is required for PresentMon Service monitoring.');
  }

  args.push('--poll-ms', String(Math.max(100, Math.trunc(Number(pollMs) || DEFAULT_POLL_MS))));

  if (presentMonPath) {
    args.push('--presentmon-path', presentMonPath);
  }

  return args;
}

function createMetricsWindow(maxAgeMs = 5000) {
  const samples = [];

  function add(sample) {
    const timestamp = Number(sample?.timestamp) || Date.now();
    samples.push({ ...sample, timestamp });
    prune(timestamp);
  }

  function prune(now = Date.now()) {
    const minTimestamp = now - maxAgeMs;
    while (samples.length && samples[0].timestamp < minTimestamp) {
      samples.shift();
    }
  }

  function getMetrics() {
    const now = Date.now();
    prune(now);
    const fpsSamples = samples.map((sample) => toFiniteNumber(sample.fps)).filter((value) => value !== null && value > 0);
    const frametimeSamples = samples.map((sample) => toFiniteNumber(sample.frametimeMs)).filter((value) => value !== null && value > 0);
    const latest = samples[samples.length - 1] || null;

    return {
      latestFps: toFiniteNumber(latest?.fps),
      avgFps: fpsSamples.length ? fpsSamples.reduce((sum, value) => sum + value, 0) / fpsSamples.length : null,
      frametimeMs: toFiniteNumber(latest?.frametimeMs),
      avgFrametimeMs: frametimeSamples.length ? frametimeSamples.reduce((sum, value) => sum + value, 0) / frametimeSamples.length : null,
      sampleCount: samples.length,
      graph: samples.slice(-120).map((sample) => ({
        timestamp: sample.timestamp,
        fps: sample.fps,
        frametimeMs: sample.frametimeMs
      }))
    };
  }

  function clear() {
    samples.length = 0;
  }

  return { add, getMetrics, clear };
}

function normalizeHelperMetric(payload = {}, activeTarget = {}) {
  const fps = toFiniteNumber(payload.fps);
  const frametimeMs = toFiniteNumber(payload.frameTimeMs ?? payload.frametimeMs);

  if ((fps === null || fps <= 0) && (frametimeMs === null || frametimeMs <= 0)) {
    return null;
  }

  return {
    timestamp: Date.now(),
    processId: normalizeProcessId(payload.pid || payload.processId) || activeTarget.processId || null,
    application: normalizeString(payload.processName || payload.application || activeTarget.processName),
    fps: fps !== null && fps > 0 ? fps : frametimeMs !== null && frametimeMs > 0 ? 1000 / frametimeMs : null,
    frametimeMs: frametimeMs !== null && frametimeMs > 0 ? frametimeMs : fps !== null && fps > 0 ? 1000 / fps : null,
    avgFps: toFiniteNumber(payload.avgFps),
    onePercentLow: toFiniteNumber(payload.onePercentLow),
    source: 'presentmon-service'
  };
}

function createPresentMonServiceProvider(options = {}) {
  const logger = options.logger;
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawn || spawn;
  const emitEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  let helperPath = options.helperPath || resolvePresentMonHelperPath(options);
  let presentMonPath = options.presentMonPath || resolvePresentMonToolsPath(options);
  const enforceSidecarIntegrity = options.app?.isPackaged === true;
  if (enforceSidecarIntegrity) {
    try {
      assertBundledSidecarIntegrity(path.dirname(helperPath), 'presentmon-helper');
      assertBundledSidecarIntegrity(presentMonPath, 'presentmon-tools');
    } catch (_error) {
      helperPath = '';
      presentMonPath = '';
    }
  }
  const pollMs = Math.max(100, Math.trunc(Number(options.pollMs) || DEFAULT_POLL_MS));
  const metricsWindow = createMetricsWindow(options.metricsWindowMs || 5000);

  let child = null;
  let status = helperPath && presentMonPath ? 'idle' : 'unavailable';
  let statusMessage = helperPath
    ? presentMonPath
      ? ''
      : 'PresentMon Service/API files were not found.'
    : 'Nova PresentMon helper was not found.';
  let activeTarget = null;
  let activeCommandLine = '';
  let pendingStdoutLine = '';
  let stderrPreview = '';
  let startedAtMs = 0;
  let lastMetricTimestamp = 0;
  let noDataTimer = null;
  let stopping = false;
  const sampleQueue = [];

  function logInfo(message, data) {
    if (logger?.info) logger.info(message, data);
    else logger?.debug?.(message, data);
  }

  function logWarn(message, data) {
    logger?.warn?.(message, data);
  }

  function logDebug(message, data) {
    logger?.debug?.(message, data);
  }

  function emit(type, payload = {}) {
    emitEvent({
      type,
      provider: 'presentmon-service',
      timestamp: Date.now(),
      ...payload
    });
  }

  function getStatus() {
    return {
      provider: 'presentmon-service',
      status,
      message: statusMessage,
      helperPath,
      presentMonPath,
      presentMonApiPath: presentMonPath ? path.join(presentMonPath, PRESENTMON_API_DLL_NAME) : '',
      presentMonMiddlewarePath: presentMonPath ? path.join(presentMonPath, PRESENTMON_MIDDLEWARE_DLL_NAME) : '',
      commandLine: activeCommandLine,
      target: activeTarget,
      running: Boolean(child && !child.killed),
      pollingHintMs: pollMs,
      lastMetricTimestamp,
      outputCsvPath: ''
    };
  }

  function emitStatus(extra = {}) {
    emit('status', {
      ...getStatus(),
      ...extra
    });
  }

  function setStatus(nextStatus, message = statusMessage, extra = {}) {
    const changed = status !== nextStatus || statusMessage !== normalizeString(message);
    status = nextStatus;
    statusMessage = normalizeString(message);
    if (changed || extra.force) {
      emitStatus(extra);
    }
  }

  function getAvailability() {
    if (platform !== 'win32') {
      return {
        available: false,
        status: 'unavailable',
        provider: 'presentmon-service',
        message: 'PresentMon Service monitoring is only available on Windows.',
        helperPath: '',
        presentMonPath: ''
      };
    }

    if (!helperPath) {
      return {
        available: false,
        status: 'unavailable',
        provider: 'presentmon-service',
        message: 'Nova PresentMon helper was not found.',
        helperPath: '',
        presentMonPath,
        bundledSearchHint: 'Expected helper path: resources/tools/nova-presentmon-helper/NovaPresentMonHelper.exe in development or process.resourcesPath/tools/nova-presentmon-helper/NovaPresentMonHelper.exe in production.'
      };
    }

    if (!presentMonPath) {
      return {
        available: false,
        status: 'unavailable',
        provider: 'presentmon-service',
        message: 'PresentMon Service/API files were not found.',
        helperPath,
        presentMonPath: '',
        bundledSearchHint: 'Expected PresentMon Service/API path: resources/tools/presentmon/PresentMonAPI2Loader.dll and Intel-PresentMon.dll in development or process.resourcesPath/tools/presentmon in production.'
      };
    }

    return {
      available: true,
      status: 'available',
      provider: 'presentmon-service',
      message: '',
      helperPath,
      presentMonPath,
      presentMonApiPath: path.join(presentMonPath, PRESENTMON_API_DLL_NAME),
      presentMonMiddlewarePath: path.join(presentMonPath, PRESENTMON_MIDDLEWARE_DLL_NAME)
    };
  }

  function clearNoDataTimer() {
    if (noDataTimer) {
      clearInterval(noDataTimer);
      noDataTimer = null;
    }
  }

  function startNoDataTimer() {
    clearNoDataTimer();
    noDataTimer = setInterval(() => {
      if (!child || !['starting', 'connected', 'running'].includes(status)) return;
      const referenceTimestamp = lastMetricTimestamp || startedAtMs;
      if (referenceTimestamp && Date.now() - referenceTimestamp > NO_FRAME_DATA_AFTER_MS) {
        setStatus('no_data', 'No frame data has arrived from PresentMon Service for 5 seconds.');
      }
    }, Math.min(1000, pollMs));
  }

  function handleHelperStatus(payload = {}) {
    const helperStatus = normalizeString(payload.status).toLowerCase() || 'running';
    if (helperStatus === 'connected') {
      setStatus('connected', '');
      return;
    }
    if (helperStatus === 'starting') {
      setStatus('starting', '');
      return;
    }
    if (helperStatus === 'no_data') {
      setStatus('no_data', normalizeString(payload.message) || 'No frame data.');
      return;
    }
    setStatus(helperStatus, normalizeString(payload.message));
  }

  function handleHelperMetrics(payload = {}) {
    const sample = normalizeHelperMetric(payload, activeTarget || {});
    if (!sample) {
      return;
    }

    lastMetricTimestamp = sample.timestamp;
    status = 'running';
    statusMessage = '';
    sampleQueue.push(sample);
    metricsWindow.add(sample);

    emit('metrics', {
      ...sample,
      pid: sample.processId,
      processName: sample.application,
      frameTimeMs: sample.frametimeMs,
      lastMetricTimestamp
    });
  }

  function handleHelperError(payload = {}) {
    const message = normalizeString(payload.message) || 'PresentMon helper reported an error.';
    setStatus('failed', message, { force: true });
    emit('error', {
      message,
      helperPath,
      presentMonPath,
      target: activeTarget
    });
  }

  function handleStdoutLine(line) {
    const trimmed = normalizeString(line);
    if (!trimmed) return;

    logDebug('Nova PresentMon helper stdout.', {
      line: trimmed.slice(0, 2000)
    });

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (error) {
      logWarn('Nova PresentMon helper emitted invalid JSON.', {
        line: trimmed.slice(0, 1000),
        message: error.message
      });
      return;
    }

    const type = normalizeString(payload?.type).toLowerCase();
    if (type === 'status') {
      handleHelperStatus(payload);
    } else if (type === 'metrics') {
      handleHelperMetrics(payload);
    } else if (type === 'error') {
      handleHelperError(payload);
    } else {
      logDebug('Nova PresentMon helper emitted an unknown JSON line type.', {
        type,
        payload
      });
    }
  }

  async function stop() {
    clearNoDataTimer();
    const processToStop = child;
    child = null;
    stopping = true;

    if (!processToStop) {
      if (['starting', 'connected', 'running', 'no_data'].includes(status)) {
        setStatus('stopped', '');
      }
      stopping = false;
      return getStatus();
    }

    await new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      processToStop.once('exit', settle);
      try {
        processToStop.kill();
      } catch (_error) {
        settle();
      }
      setTimeout(settle, 1500);
    });

    stopping = false;
    setStatus('stopped', '');
    return getStatus();
  }

  async function start({ processId, processName, exeName } = {}) {
    const availability = getAvailability();
    const normalizedProcessId = normalizeProcessId(processId);
    const normalizedProcessName = normalizeString(processName || exeName);

    if (!normalizedProcessId && !normalizedProcessName) {
      setStatus('failed', 'A running game process id or process name is required for FPS monitoring.');
      return getStatus();
    }

    if (!availability.available) {
      setStatus('unavailable', availability.message, { force: true });
      logWarn('PresentMon Service provider is unavailable.', availability);
      return getStatus();
    }

    await stop();

    activeTarget = {
      processId: normalizedProcessId || null,
      processName: normalizedProcessName
    };
    sampleQueue.length = 0;
    metricsWindow.clear();
    pendingStdoutLine = '';
    stderrPreview = '';
    startedAtMs = Date.now();
    lastMetricTimestamp = 0;

    let args;
    try {
      args = buildHelperArgs({
        processId: normalizedProcessId,
        processName: normalizedProcessName,
        pollMs,
        presentMonPath
      });
    } catch (error) {
      setStatus('failed', error.message || 'Unable to build PresentMon helper arguments.');
      return getStatus();
    }

    activeCommandLine = `"${helperPath}" ${args.map((arg) => /\s/.test(String(arg)) ? `"${arg}"` : String(arg)).join(' ')}`;
    logInfo('Starting Nova PresentMon helper.', {
      selectedProvider: 'presentmon-service',
      helperPath,
      presentMonPath,
      presentMonApiPath: path.join(presentMonPath, PRESENTMON_API_DLL_NAME),
      presentMonMiddlewarePath: path.join(presentMonPath, PRESENTMON_MIDDLEWARE_DLL_NAME),
      activeTarget,
      pollMs,
      args
    });

    try {
      if (enforceSidecarIntegrity) {
        assertBundledSidecarIntegrity(path.dirname(helperPath), 'presentmon-helper');
        assertBundledSidecarIntegrity(presentMonPath, 'presentmon-tools');
      }
      child = spawnProcess(helperPath, args, {
        cwd: path.dirname(helperPath),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout?.on('data', (chunk) => {
        const text = `${pendingStdoutLine}${chunk.toString('utf8')}`;
        const lines = text.split(/\r?\n/);
        pendingStdoutLine = lines.pop() || '';
        for (const line of lines) {
          handleStdoutLine(line);
        }
      });

      child.stderr?.on('data', (chunk) => {
        const message = chunk.toString('utf8');
        stderrPreview = `${stderrPreview}${message}`.slice(-4000);
        logDebug('Nova PresentMon helper stderr.', {
          message: message.trim().slice(-1000)
        });
      });

      child.once('error', (error) => {
        child = null;
        clearNoDataTimer();
        const message = error.message || 'Nova PresentMon helper failed to start.';
        setStatus('failed', message, { force: true });
        logWarn('Nova PresentMon helper failed to start.', {
          message,
          activeCommandLine
        });
        emit('error', { message, helperPath, presentMonPath, target: activeTarget });
      });

      child.once('exit', (code, signal) => {
        if (child) child = null;
        clearNoDataTimer();

        if (pendingStdoutLine) {
          handleStdoutLine(pendingStdoutLine);
          pendingStdoutLine = '';
        }

        if (!stopping && ['starting', 'connected', 'running', 'no_data'].includes(status)) {
          const message = code === 0 || signal
            ? ''
            : stderrPreview.trim() || `Nova PresentMon helper exited with code ${code}.`;
          setStatus(code === 0 || signal ? 'stopped' : 'failed', message, { force: true });
        }

        logInfo('Nova PresentMon helper exited.', {
          code,
          signal,
          status,
          message: statusMessage,
          lastMetricTimestamp
        });
      });

      setStatus('starting', '', { force: true });
      startNoDataTimer();
      return getStatus();
    } catch (error) {
      child = null;
      clearNoDataTimer();
      const message = error.message || 'Nova PresentMon helper failed to start.';
      setStatus('failed', message, { force: true });
      logWarn('Nova PresentMon helper spawn failed.', {
        message,
        activeCommandLine
      });
      emit('error', { message, helperPath, presentMonPath, target: activeTarget });
      return getStatus();
    }
  }

  function readSamples() {
    if (child && ['starting', 'connected', 'running'].includes(status)) {
      const referenceTimestamp = lastMetricTimestamp || startedAtMs;
      if (referenceTimestamp && Date.now() - referenceTimestamp > NO_FRAME_DATA_AFTER_MS) {
        setStatus('no_data', 'No frame data has arrived from PresentMon Service for 5 seconds.');
      }
    }

    return sampleQueue.splice(0, sampleQueue.length);
  }

  function readMetrics() {
    readSamples();
    return {
      ...getStatus(),
      metrics: metricsWindow.getMetrics()
    };
  }

  return {
    providerId: 'presentmon-service',
    getAvailability,
    getStatus,
    start,
    stop,
    readSamples,
    readMetrics
  };
}

module.exports = {
  buildHelperArgs,
  createPresentMonServiceProvider,
  getHelperCandidatePaths,
  getPresentMonToolsCandidateDirectories,
  resolvePresentMonHelperPath,
  resolvePresentMonToolsPath
};
