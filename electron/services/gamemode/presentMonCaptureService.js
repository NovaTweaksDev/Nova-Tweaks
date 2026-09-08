const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { assertBundledSidecarIntegrity } = require('../security/bundledSidecarIntegrity');

const PRESENTMON_EXE_NAME = 'PresentMon.exe';
const PRESENTMON_LEGACY_EXE_NAME = 'PresentMonLegacy.exe';
const DEFAULT_PRESENTMON_SESSION_NAME = 'NovaTweaks-PresentMon';
const MAX_INCREMENTAL_READ_BYTES = 4 * 1024 * 1024;
const EMPTY_CAPTURE_FALLBACK_AFTER_MS = 10 * 1000;
const DEFAULT_POLLING_HINT_MS = 500;

function normalizePath(value) {
  return String(value || '').trim();
}

function fileExistsWithContent(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
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

function isTransientCaptureFileError(error) {
  return ['EBUSY', 'EPERM', 'EACCES'].includes(String(error?.code || '').toUpperCase());
}

function safeMkdirp(directoryPath) {
  if (!directoryPath) return;
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    fs.chmodSync(directoryPath, 0o700);
  }
}

function findPresentMonExecutableInDirectory(directoryPath) {
  const normalizedDirectory = normalizePath(directoryPath);
  if (!directoryExists(normalizedDirectory)) return '';

  const directPath = path.join(normalizedDirectory, PRESENTMON_EXE_NAME);
  if (fileExistsWithContent(directPath)) return directPath;

  try {
    const candidates = fs.readdirSync(normalizedDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((fileName) => /^PresentMon(?:[-_.].*)?\.exe$/i.test(fileName) && !/^PresentMonLegacy\.exe$/i.test(fileName))
      .sort((left, right) => {
        if (/x64/i.test(left) && !/x64/i.test(right)) return -1;
        if (!/x64/i.test(left) && /x64/i.test(right)) return 1;
        return left.localeCompare(right);
      })
      .map((fileName) => path.join(normalizedDirectory, fileName));

    return candidates.find(fileExistsWithContent) || '';
  } catch (_error) {
    return '';
  }
}

function findPresentMonLegacyExecutableInDirectory(directoryPath) {
  const normalizedDirectory = normalizePath(directoryPath);
  if (!directoryExists(normalizedDirectory)) return '';

  const directPath = path.join(normalizedDirectory, PRESENTMON_LEGACY_EXE_NAME);
  if (fileExistsWithContent(directPath)) return directPath;

  try {
    const candidates = fs.readdirSync(normalizedDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((fileName) => /^PresentMonLegacy(?:[-_.].*)?\.exe$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right))
      .map((fileName) => path.join(normalizedDirectory, fileName));

    return candidates.find(fileExistsWithContent) || '';
  } catch (_error) {
    return '';
  }
}

function getAppPathFallback({ app, cwd = process.cwd() } = {}) {
  return typeof app?.getAppPath === 'function' ? app.getAppPath() : cwd;
}

function getPresentMonCandidateDirectories({ app, resourcesPath = process.resourcesPath, cwd = process.cwd() } = {}) {
  const appPath = getAppPathFallback({ app, cwd });
  const dirs = [];

  if (resourcesPath) {
    dirs.push(path.join(resourcesPath, 'tools', 'presentmon'));
    dirs.push(path.join(resourcesPath, 'tools', 'PresentMon'));
  }

  dirs.push(path.join(cwd, 'resources', 'tools', 'presentmon'));
  dirs.push(path.join(cwd, 'resources', 'tools', 'PresentMon'));
  dirs.push(path.join(appPath, 'resources', 'tools', 'presentmon'));
  dirs.push(path.join(appPath, 'resources', 'tools', 'PresentMon'));

  if (resourcesPath) {
    dirs.push(path.join(resourcesPath, 'capture', 'PresentMon'));
    dirs.push(path.join(resourcesPath, 'resources', 'capture', 'PresentMon'));
    dirs.push(path.join(resourcesPath, 'helpers', 'PresentMon'));
    dirs.push(path.join(resourcesPath, 'resources', 'helpers', 'PresentMon'));
  }

  dirs.push(path.join(cwd, 'resources', 'capture', 'PresentMon'));
  dirs.push(path.join(cwd, 'resources', 'helpers', 'PresentMon'));
  dirs.push(path.join(cwd, 'tools', 'PresentMon'));
  dirs.push(path.join(appPath, 'resources', 'capture', 'PresentMon'));
  dirs.push(path.join(appPath, 'resources', 'helpers', 'PresentMon'));
  dirs.push(path.join(appPath, 'tools', 'PresentMon'));

  return [...new Set(dirs.map((dir) => path.resolve(dir)).filter(Boolean))];
}

function resolvePresentMonExecutablePath(options = {}) {
  const env = options.env || process.env;
  const explicitCandidates = options.app?.isPackaged === true ? [] : [
    env.NOVA_PRESENTMON_PATH,
    env.PRESENTMON_PATH
  ];

  const explicitMatch = explicitCandidates
    .map(normalizePath)
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .find(fileExistsWithContent);

  if (explicitMatch) return explicitMatch;

  return getPresentMonCandidateDirectories(options)
    .map(findPresentMonExecutableInDirectory)
    .find(Boolean) || '';
}

function resolvePresentMonLegacyExecutablePath(options = {}) {
  const env = options.env || process.env;
  const explicitCandidates = options.app?.isPackaged === true ? [] : [
    env.NOVA_PRESENTMON_LEGACY_PATH,
    env.PRESENTMON_LEGACY_PATH
  ];

  const explicitMatch = explicitCandidates
    .map(normalizePath)
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .find(fileExistsWithContent);

  if (explicitMatch) return explicitMatch;

  return getPresentMonCandidateDirectories(options)
    .map(findPresentMonLegacyExecutableInDirectory)
    .find(Boolean) || '';
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < String(line || '').length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function normalizeHeaderName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePresentMonSessionName(value) {
  const normalized = String(value || DEFAULT_PRESENTMON_SESSION_NAME)
    .replace(/[^a-z0-9_.-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);

  return normalized || DEFAULT_PRESENTMON_SESSION_NAME;
}

function normalizeProcessName(value) {
  return String(value || '').trim().replace(/^"|"$/g, '');
}

function isValidProcessId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map(normalizeHeaderName);

  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(normalizeHeaderName(candidate));
    if (index >= 0) return index;
  }

  return -1;
}

function detectColumns(headers) {
  const processIdIndex = findColumnIndex(headers, ['ProcessID', 'ProcessId', 'PID']);
  const applicationIndex = findColumnIndex(headers, ['Application', 'ProcessName', 'Process']);

  const timeIndex = findColumnIndex(headers, [
    'TimeInSeconds',
    'TimeInMs',
    'Timestamp',
    'CPUStartTime',
    'CPUStartQPC',
    'QPCTime',
    'SyncQPCTime'
  ]);

  const fpsIndex = findColumnIndex(headers, [
    'FPS',
    'DisplayedFPS',
    'PresentedFPS',
    'ApplicationFPS',
    'DisplayFPS'
  ]);

  const frametimeIndex = findColumnIndex(headers, [
    'FrameTime',
    'CPUFrameTime',
    'DisplayedTime',
    'MsBetweenPresents',
    'MsBetweenDisplayChange',
    'MsBetweenSimStarts',
    'MsBetweenSimulationStart',
    'MsBetweenAppStart',
    'FrameTimeMs',
    'FrametimeMs',
    'MsUntilDisplayed'
  ]);

  return {
    processIdIndex,
    applicationIndex,
    timeIndex,
    fpsIndex,
    frametimeIndex,
    detected: {
      processId: processIdIndex >= 0 ? headers[processIdIndex] : '',
      application: applicationIndex >= 0 ? headers[applicationIndex] : '',
      time: timeIndex >= 0 ? headers[timeIndex] : '',
      fps: fpsIndex >= 0 ? headers[fpsIndex] : '',
      frametime: frametimeIndex >= 0 ? headers[frametimeIndex] : ''
    }
  };
}

function parsePresentMonCsv(content, { afterLine = 0, now = Date.now(), logger } = {}) {
  const normalizedContent = String(content || '').replace(/^\uFEFF/, '');
  const lines = normalizedContent.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    return {
      samples: [],
      lineCount: lines.length,
      headers: lines.length ? parseCsvLine(lines[0]) : [],
      columns: null
    };
  }

  const headers = parseCsvLine(lines[0]);
  const columns = detectColumns(headers);

  if (columns.fpsIndex < 0 && columns.frametimeIndex < 0) {
    logger?.warn?.('PresentMon CSV has no supported FPS/frametime column.', {
      headers,
      detected: columns.detected
    });

    return {
      samples: [],
      lineCount: lines.length,
      headers,
      columns
    };
  }

  const startIndex = Math.max(1, Number(afterLine) || 1);
  const samples = [];

  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const fields = parseCsvLine(lines[lineIndex]);

    const rawFrametime = columns.frametimeIndex >= 0
      ? toFiniteNumber(fields[columns.frametimeIndex])
      : null;

    const rawFps = columns.fpsIndex >= 0
      ? toFiniteNumber(fields[columns.fpsIndex])
      : null;

    const fps = rawFps !== null && rawFps > 0
      ? rawFps
      : rawFrametime !== null && rawFrametime > 0
        ? 1000 / rawFrametime
        : null;

    if (fps === null && rawFrametime === null) continue;

    samples.push({
      timestamp: now,
      captureTimeSeconds: columns.timeIndex >= 0 ? toFiniteNumber(fields[columns.timeIndex]) : null,
      processId: columns.processIdIndex >= 0 ? toFiniteNumber(fields[columns.processIdIndex]) : null,
      application: columns.applicationIndex >= 0 ? String(fields[columns.applicationIndex] || '').trim() : '',
      fps,
      frametimeMs: rawFrametime,
      rawFps,
      sourceLine: lineIndex + 1
    });
  }

  return {
    samples,
    lineCount: lines.length,
    headers,
    columns
  };
}

function buildPresentMonArgs({
  processId,
  processName,
  outputCsvPath,
  sessionName,
  outputMode = 'file',
  flavor = 'modern',
  targetMode = 'processId',
  minimal = true
} = {}) {
  const legacy = flavor === 'legacy';
  const prefix = legacy ? '-' : '--';

  const normalizedSessionName = normalizePresentMonSessionName(sessionName);
  const normalizedProcessName = normalizeProcessName(processName);
  const validPid = isValidProcessId(processId);

  const outputArgs = outputMode === 'stdout'
    ? [`${prefix}output_stdout`]
    : [`${prefix}output_file`, outputCsvPath];

  let targetArgs = [];

  if (targetMode === 'processName' && normalizedProcessName) {
    targetArgs = [`${prefix}process_name`, normalizedProcessName];
  } else if (validPid) {
    targetArgs = [`${prefix}process_id`, String(Math.trunc(Number(processId)))];
  } else if (normalizedProcessName) {
    targetArgs = [`${prefix}process_name`, normalizedProcessName];
  }

  if (!targetArgs.length) {
    throw new Error('A valid process id or process name is required for PresentMon capture.');
  }

  if (legacy) {
    return [
      ...targetArgs,
      ...outputArgs,
      '-terminate_on_proc_exit',
      '-session_name',
      normalizedSessionName,
      '-stop_existing_session',
      '-no_top',
      '-no_track_display'
    ];
  }

  const args = [
    ...targetArgs,
    ...outputArgs,
    '--terminate_on_proc_exit',
    '--session_name',
    normalizedSessionName,
    '--stop_existing_session'
  ];

  if (!minimal) {
    args.push('--no_console_stats');
  }

  return args;
}

function createMetricsWindow(maxAgeMs = 5000) {
  const samples = [];

  function add(newSamples) {
    const now = Date.now();

    for (const sample of newSamples || []) {
      samples.push({
        ...sample,
        timestamp: sample.timestamp || now
      });
    }

    prune(now);
  }

  function prune(now = Date.now()) {
    const minTime = now - maxAgeMs;

    while (samples.length && samples[0].timestamp < minTime) {
      samples.shift();
    }
  }

  function getMetrics() {
    const now = Date.now();
    prune(now);

    const lastSecond = samples.filter((sample) => sample.timestamp >= now - 1000);
    const validFpsSamples = samples.filter((sample) => Number.isFinite(sample.fps) && sample.fps > 0);
    const validFrameTimes = samples.filter((sample) => Number.isFinite(sample.frametimeMs) && sample.frametimeMs > 0);
    const latest = samples[samples.length - 1] || null;

    const avgFps = validFpsSamples.length
      ? validFpsSamples.reduce((sum, sample) => sum + sample.fps, 0) / validFpsSamples.length
      : null;

    const avgFrametimeMs = validFrameTimes.length
      ? validFrameTimes.reduce((sum, sample) => sum + sample.frametimeMs, 0) / validFrameTimes.length
      : null;

    const latestFrametimeMs = latest && Number.isFinite(latest.frametimeMs)
      ? latest.frametimeMs
      : null;

    const spike = avgFrametimeMs !== null && latestFrametimeMs !== null
      ? latestFrametimeMs > Math.max(avgFrametimeMs * 1.75, avgFrametimeMs + 8)
      : false;

    return {
      liveFps: lastSecond.length || (latest?.fps ?? null),
      latestFps: latest?.fps ?? null,
      avgFps,
      frametimeMs: latestFrametimeMs,
      avgFrametimeMs,
      spike,
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

  return {
    add,
    getMetrics,
    clear
  };
}

function createPresentMonCaptureService(options = {}) {
  const logger = options.logger;
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawn || spawn;

  const executablePath = options.executablePath || resolvePresentMonExecutablePath(options);
  const legacyExecutablePath = options.legacyExecutablePath || resolvePresentMonLegacyExecutablePath(options);

  const outputMode = options.outputMode === 'stdout' ? 'stdout' : 'file';
  const minimalArgs = options.minimalArgs !== false;
  const flavor = options.flavor === 'legacy' ? 'legacy' : 'modern';
  const enforceSidecarIntegrity = options.app?.isPackaged === true;

  let actualExecutablePath = flavor === 'legacy' ? legacyExecutablePath : executablePath;
  if (enforceSidecarIntegrity && actualExecutablePath) {
    try {
      assertBundledSidecarIntegrity(
        path.dirname(actualExecutablePath),
        'presentmon-capture'
      );
    } catch (_error) {
      actualExecutablePath = '';
    }
  }
  const metricsWindow = createMetricsWindow(options.metricsWindowMs || 5000);

  let child = null;
  let status = actualExecutablePath ? 'idle' : 'unavailable';
  let statusMessage = actualExecutablePath ? '' : 'PresentMon executable was not found.';
  let outputCsvPath = '';
  let lastReadOffset = 0;
  let csvHeader = '';
  let pendingLine = '';
  let stderrPreview = '';
  let startedAtMs = 0;
  let lastSampleAtMs = 0;
  let selectedColumns = null;
  let activeCommandLine = '';
  let activeTarget = null;

  function logDebug(message, data) {
    logger?.debug?.(message, data);
  }

  function logInfo(message, data) {
    if (logger?.info) logger.info(message, data);
    else logger?.debug?.(message, data);
  }

  function logWarn(message, data) {
    logger?.warn?.(message, data);
  }

  function getAvailability() {
    if (platform !== 'win32') {
      return {
        available: false,
        status: 'unavailable',
        message: 'PresentMon capture is only available on Windows.',
        executablePath: ''
      };
    }

    return {
      available: Boolean(actualExecutablePath),
      status: actualExecutablePath ? 'available' : 'unavailable',
      message: actualExecutablePath ? '' : 'PresentMon executable was not found.',
      executablePath: actualExecutablePath,
      bundledSearchHint: 'Expected bundled path: resources/tools/presentmon/PresentMon.exe in development or process.resourcesPath/tools/presentmon/PresentMon.exe in production.'
    };
  }

  function getStatus() {
    return {
      status,
      message: statusMessage,
      executablePath: actualExecutablePath,
      outputCsvPath,
      commandLine: activeCommandLine,
      target: activeTarget,
      running: Boolean(child && !child.killed),
      selectedColumns,
      pollingHintMs: DEFAULT_POLLING_HINT_MS
    };
  }

  async function stop() {
    const processToStop = child;
    child = null;

    if (!processToStop) {
      if (['running', 'starting', 'capturing', 'no_data'].includes(status)) {
        status = 'stopped';
        statusMessage = '';
      }

      return getStatus();
    }

    status = 'stopped';
    statusMessage = '';

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

    return getStatus();
  }

  async function start({
    processId,
    processName,
    exeName,
    sessionId,
    outputDirectory,
    targetMode = 'processId'
  } = {}) {
    const normalizedProcessName = normalizeProcessName(processName || exeName);
    const normalizedProcessId = Number(processId);

    if (!isValidProcessId(normalizedProcessId) && !normalizedProcessName) {
      status = 'failed';
      statusMessage = 'A running game process id or process name is required for FPS capture.';
      return getStatus();
    }

    const availability = getAvailability();

    if (!availability.available) {
      status = 'unavailable';
      statusMessage = availability.message;
      logWarn('PresentMon executable is unavailable.', availability);
      return getStatus();
    }

    await stop();

    const safeSessionId = normalizePresentMonSessionName(
      sessionId || `${normalizedProcessName || normalizedProcessId}-${Date.now()}`
    );

    const captureDirectory = outputDirectory || path.join(process.cwd(), '.nova-presentmon-captures');
    safeMkdirp(captureDirectory);

    outputCsvPath = path.join(captureDirectory, `${safeSessionId}-presentmon.csv`);
    fs.writeFileSync(outputCsvPath, '', {
      encoding: 'utf8',
      mode: 0o600
    });

    lastReadOffset = 0;
    csvHeader = '';
    pendingLine = '';
    stderrPreview = '';
    startedAtMs = Date.now();
    lastSampleAtMs = 0;
    selectedColumns = null;
    metricsWindow.clear();

    activeTarget = {
      processId: isValidProcessId(normalizedProcessId) ? Math.trunc(normalizedProcessId) : null,
      processName: normalizedProcessName || '',
      targetMode
    };

    let args;

    try {
      args = buildPresentMonArgs({
        processId: normalizedProcessId,
        processName: normalizedProcessName,
        outputCsvPath,
        sessionName: `NovaTweaks-${safeSessionId}`,
        outputMode,
        flavor,
        targetMode,
        minimal: minimalArgs
      });
    } catch (error) {
      status = 'failed';
      statusMessage = error.message || 'Unable to build PresentMon arguments.';
      return getStatus();
    }

    activeCommandLine = `"${actualExecutablePath}" ${args
      .map((arg) => /\s/.test(String(arg)) ? `"${arg}"` : String(arg))
      .join(' ')}`;

    logInfo('Starting PresentMon capture.', {
      executablePath: actualExecutablePath,
      args,
      outputCsvPath,
      activeTarget
    });

    try {
      if (enforceSidecarIntegrity) {
        assertBundledSidecarIntegrity(
          path.dirname(actualExecutablePath),
          'presentmon-capture'
        );
      }
      child = spawnProcess(actualExecutablePath, args, {
        windowsHide: true,
        stdio: ['ignore', outputMode === 'stdout' ? 'pipe' : 'ignore', 'pipe']
      });

      if (outputMode === 'stdout') {
        child.stdout?.on('data', (chunk) => {
          try {
            fs.appendFileSync(outputCsvPath, chunk);
          } catch (error) {
            status = status === 'running' || status === 'capturing' ? 'failed' : status;
            statusMessage = error.message || 'Unable to write PresentMon capture output.';

            logWarn('Unable to write PresentMon capture output.', {
              outputCsvPath,
              message: statusMessage
            });
          }
        });
      }

      child.stderr?.on('data', (chunk) => {
        const message = chunk.toString('utf8');
        stderrPreview = `${stderrPreview}${message}`.slice(-4000);

        const preview = stderrPreview.trim();

        if (/ETW events were lost/i.test(preview)) {
          statusMessage = preview.split(/\r?\n/).slice(-2).join(' ').trim();
        }

        logDebug('PresentMon stderr output.', {
          message: message.trim().slice(-1000)
        });
      });

      child.once('error', (error) => {
        status = 'failed';
        statusMessage = error.message || 'PresentMon failed to start.';

        logWarn('PresentMon capture failed to start.', {
          message: statusMessage,
          commandLine: activeCommandLine
        });
      });

      child.once('exit', (code, signal) => {
        if (child) child = null;

        if (['running', 'capturing', 'starting', 'no_data'].includes(status)) {
          status = code === 0 || signal ? 'stopped' : 'failed';
          statusMessage = code === 0 || signal
            ? ''
            : stderrPreview.trim() || `PresentMon exited with code ${code}.`;
        }

        logInfo('PresentMon capture exited.', {
          code,
          signal,
          status,
          message: statusMessage
        });
      });

      status = 'running';
      statusMessage = '';
      return getStatus();
    } catch (error) {
      child = null;
      status = 'failed';
      statusMessage = error.message || 'PresentMon failed to start.';

      logWarn('PresentMon capture failed.', {
        message: statusMessage,
        commandLine: activeCommandLine
      });

      return getStatus();
    }
  }

  function readSamples() {
    if (!outputCsvPath || !fs.existsSync(outputCsvPath)) {
      if ((status === 'running' || status === 'starting') && startedAtMs && Date.now() - startedAtMs > EMPTY_CAPTURE_FALLBACK_AFTER_MS) {
        status = 'no_data';
        statusMessage = 'PresentMon is running, but no capture file was created yet. Keep the game in the foreground and check the selected process.';
      }

      return [];
    }

    try {
      const stats = fs.statSync(outputCsvPath);
      const now = Date.now();

      if ((status === 'running' || status === 'capturing') && stats.size === 0 && startedAtMs && now - startedAtMs > EMPTY_CAPTURE_FALLBACK_AFTER_MS) {
        status = 'no_data';
        statusMessage = 'PresentMon is running, but the capture file is still empty. Keep the game in the foreground, verify the real game process/PID and try running NovaTweaks as administrator.';
      }

      if (stats.size < lastReadOffset) {
        lastReadOffset = 0;
        csvHeader = '';
        pendingLine = '';
        selectedColumns = null;
      }

      if (stats.size === lastReadOffset) {
        if (pendingLine && csvHeader && !['running', 'capturing', 'no_data'].includes(status)) {
          const finalLine = pendingLine;
          pendingLine = '';
          const result = parsePresentMonCsv(`${csvHeader}\n${finalLine}`, {
            now,
            logger
          });

          if (result.samples.length) {
            lastSampleAtMs = now;
            metricsWindow.add(result.samples);
          }

          return result.samples;
        }

        if ((status === 'running' || status === 'capturing') && lastSampleAtMs && now - lastSampleAtMs > EMPTY_CAPTURE_FALLBACK_AFTER_MS) {
          status = 'no_data';
          statusMessage = 'PresentMon is running, but no new frame data arrived. The game may be minimized, blocked by permissions, or the wrong process may be selected.';
        }

        return [];
      }

      let startOffset = lastReadOffset;

      if (stats.size - startOffset > MAX_INCREMENTAL_READ_BYTES) {
        startOffset = Math.max(0, stats.size - MAX_INCREMENTAL_READ_BYTES);
        pendingLine = '';
      }

      const buffer = Buffer.alloc(stats.size - startOffset);
      const fd = fs.openSync(outputCsvPath, 'r');

      try {
        fs.readSync(fd, buffer, 0, buffer.length, startOffset);
      } finally {
        fs.closeSync(fd);
      }

      lastReadOffset = stats.size;

      let chunk = `${pendingLine}${buffer.toString('utf8')}`;
      const endsWithNewLine = /\r?\n$/.test(chunk);
      const lines = chunk.split(/\r?\n/);

      const keepPendingLine = !endsWithNewLine && ['running', 'capturing', 'no_data'].includes(status);
      pendingLine = keepPendingLine ? (lines.pop() || '') : '';

      const completeLines = lines.filter((line) => line.trim());

      if (!completeLines.length) return [];

      if (!csvHeader) {
        csvHeader = completeLines.shift() || '';
        const headers = parseCsvLine(csvHeader);
        selectedColumns = detectColumns(headers).detected;

        logInfo('PresentMon CSV header detected.', {
          outputCsvPath,
          headers,
          selectedColumns
        });
      } else if (startOffset > 0 && completeLines.length) {
        const firstLine = completeLines[0];
        const normalized = normalizeHeaderName(firstLine);

        if (normalized.includes('application') && (normalized.includes('processid') || normalized.includes('frametime'))) {
          csvHeader = completeLines.shift() || csvHeader;

          const headers = parseCsvLine(csvHeader);
          selectedColumns = detectColumns(headers).detected;

          logInfo('PresentMon CSV header refreshed.', {
            outputCsvPath,
            headers,
            selectedColumns
          });
        }
      }

      if (!csvHeader || !completeLines.length) return [];

      const result = parsePresentMonCsv(`${csvHeader}\n${completeLines.join('\n')}`, {
        now,
        logger
      });

      if (!selectedColumns && result.columns?.detected) {
        selectedColumns = result.columns.detected;
      }

      if (result.samples.length) {
        lastSampleAtMs = now;
        status = 'capturing';
        statusMessage = '';
        metricsWindow.add(result.samples);

        logDebug('PresentMon samples parsed.', {
          samples: result.samples.length,
          fileSize: stats.size,
          selectedColumns
        });
      } else if ((status === 'running' || status === 'capturing' || status === 'no_data') && startedAtMs && now - startedAtMs > EMPTY_CAPTURE_FALLBACK_AFTER_MS) {
        status = 'no_data';
        statusMessage = selectedColumns?.frametime || selectedColumns?.fps
          ? 'PresentMon is running, but no usable frame samples were parsed yet.'
          : 'PresentMon CSV was created, but NovaTweaks could not find a supported FPS or frametime column.';
      }

      return result.samples;
    } catch (error) {
      if (isTransientCaptureFileError(error)) {
        if ((status === 'running' || status === 'capturing') && startedAtMs && Date.now() - startedAtMs > EMPTY_CAPTURE_FALLBACK_AFTER_MS) {
          statusMessage = 'PresentMon is writing frame data, but Windows is temporarily locking the capture file. NovaTweaks will keep retrying.';
        }

        logDebug('PresentMon capture output is temporarily locked; retrying on the next poll.', {
          outputCsvPath,
          code: error.code
        });

        return [];
      }

      status = status === 'running' || status === 'capturing' || status === 'no_data'
        ? 'failed'
        : status;

      statusMessage = error.message || 'Unable to read PresentMon capture output.';

      logWarn('Unable to read PresentMon capture output.', {
        outputCsvPath,
        message: statusMessage
      });

      return [];
    }
  }

  function readMetrics() {
    readSamples();

    return {
      ...getStatus(),
      metrics: metricsWindow.getMetrics()
    };
  }

  return {
    getAvailability,
    getStatus,
    start,
    stop,
    readSamples,
    readMetrics
  };
}

module.exports = {
  buildPresentMonArgs,
  createPresentMonCaptureService,
  detectColumns,
  findPresentMonExecutableInDirectory,
  findPresentMonLegacyExecutableInDirectory,
  getPresentMonCandidateDirectories,
  isTransientCaptureFileError,
  parseCsvLine,
  parsePresentMonCsv,
  resolvePresentMonExecutablePath,
  resolvePresentMonLegacyExecutablePath
};
