const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { createLhmClient } = require('./lhmClient');
const { createMetricsService } = require('./metricsService');
const { createOverviewSnapshotService } = require('./overviewSnapshotService');
const { prepareMsixLhmRuntime } = require('./monitoringRuntime');
const {
  PAWNIO_INSTALLER,
  assertMonitoringRuntimeIntegrity,
  runtimeRootForExecutable
} = require('./monitoringIntegrity');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const LHM_PROCESS_NAME = 'LibreHardwareMonitor.exe';
const LHM_HEADLESS_ARGUMENT = '--nova-headless';
const PAWNIO_REGISTRY_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO';
const MIN_PAWNIO_MAJOR_VERSION = 2;
const DEFAULT_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 15000;
const STARTUP_RETRY_DELAY_MS = 500;
const RESTART_THRESHOLD = 3;
const LHM_AUTH_USERNAME = 'nova';

const REQUIRED_CONFIG_SETTINGS = {
  runWebServerMenuItem: 'true',
  listenerIp: '127.0.0.1',
  listenerPort: '8085',
  startMinMenuItem: 'true',
  minTrayMenuItem: 'false',
  gadgetMenuItem: 'false',
  cpuMenuItem: 'true',
  gpuMenuItem: 'true',
  ramMenuItem: 'true',
  hddMenuItem: 'true',
  nicMenuItem: 'true',
  mainboardMenuItem: 'true',
  fanControllerMenuItem: 'true',
  powerMonitorMenuItem: 'true',
  psuMenuItem: 'true',
  batteryMenuItem: 'false'
};

const ADD_SETTING_REGEX = /<add\s+key="([^"]+)"\s+value="([^"]*)"\s*\/>/gi;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function withTimeout(promise, timeoutMs, errorCode, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(message || 'Operation timed out.');
        error.code = errorCode || 'TIMEOUT';
        reject(error);
      }, timeoutMs);
    })
  ]);
}

function escapePsSingleQuotes(value) {
  return String(value).replace(/'/g, "''");
}

function uniquePaths(candidates) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') {
      continue;
    }

    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function resolveLhmExecutablePath(app, logger) {
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd();
  const resourcesPath = process.resourcesPath || '';
  const isPackaged = app?.isPackaged === true;
  const developmentOverrideEnabled =
    !isPackaged
    && String(process.env.NOVA_ALLOW_DEV_LHM_OVERRIDE || '').trim().toLowerCase() === 'true';
  const envPath = developmentOverrideEnabled ? process.env.LHM_EXE_PATH : null;
  let msixRuntimePath = null;

  if (process.windowsStore === true) {
    try {
      msixRuntimePath = prepareMsixLhmRuntime({ app, logger });
    } catch (error) {
      logger?.error?.('Writable LibreHardwareMonitor runtime could not be prepared for MSIX.', {
        error: error?.message || String(error)
      });
      return null;
    }
  }

  const candidates = uniquePaths([
    envPath,
    msixRuntimePath ? path.join(msixRuntimePath, 'patched', LHM_PROCESS_NAME) : null,
    process.windowsStore === true ? null :
    path.join(resourcesPath, 'resources', 'monitoring', 'LibreHardwareMonitor', 'patched', LHM_PROCESS_NAME),
    process.windowsStore === true ? null :
    path.join(resourcesPath, 'monitoring', 'LibreHardwareMonitor', 'patched', LHM_PROCESS_NAME),
    process.windowsStore === true ? null :
    path.join(process.cwd(), 'resources', 'monitoring', 'LibreHardwareMonitor', 'patched', LHM_PROCESS_NAME),
    process.windowsStore === true ? null :
    path.join(appPath, 'resources', 'monitoring', 'LibreHardwareMonitor', 'patched', LHM_PROCESS_NAME),
  ]);

  const executablePath = candidates.find((candidate) => (
    fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  ));

  if (!executablePath) {
    logger?.error?.('The trusted LibreHardwareMonitor executable was not found.');
    return null;
  }

  try {
    assertMonitoringRuntimeIntegrity(runtimeRootForExecutable(executablePath));
    return executablePath;
  } catch (error) {
    logger?.error?.('The LibreHardwareMonitor runtime failed its integrity check.', {
      code: error?.code || 'MONITORING_RUNTIME_INTEGRITY_INVALID'
    });
    return null;
  }
}

function resolvePawnIoInstallerPath(executablePath, logger) {
  try {
    const runtimeRoot = runtimeRootForExecutable(executablePath);
    assertMonitoringRuntimeIntegrity(runtimeRoot);
    const installerPath = path.join(runtimeRoot, PAWNIO_INSTALLER);
    if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
      throw new Error('PawnIO installer is missing.');
    }
    return installerPath;
  } catch (error) {
    logger?.error?.('The trusted PawnIO installer is unavailable.', {
      code: error?.code || 'MONITORING_RUNTIME_INTEGRITY_INVALID'
    });
    return null;
  }
}

function parseConfigEntries(content) {
  const map = new Map();

  if (!content || typeof content !== 'string') {
    return map;
  }

  let match = ADD_SETTING_REGEX.exec(content);
  while (match) {
    const key = match[1];
    const value = match[2];
    map.set(key, value);
    match = ADD_SETTING_REGEX.exec(content);
  }

  return map;
}

function buildConfigXml(entries) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<configuration>',
    '  <appSettings>'
  ];

  for (const [key, value] of entries) {
    lines.push(`    <add key="${key}" value="${value}" />`);
  }

  lines.push('  </appSettings>');
  lines.push('</configuration>');
  lines.push('');

  return lines.join('\n');
}

function ensureConfigFile(executablePath, logger, authentication = {}) {
  const configPath = path.join(path.dirname(executablePath), 'LibreHardwareMonitor.config');
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const entries = parseConfigEntries(existing);
  const requiredSettings = {
    ...REQUIRED_CONFIG_SETTINGS,
    authenticationEnabled: 'true',
    authenticationUserName: authentication.username || LHM_AUTH_USERNAME,
    authenticationPassword: authentication.password || ''
  };

  let changed = !fs.existsSync(configPath);

  for (const [key, requiredValue] of Object.entries(requiredSettings)) {
    if (entries.get(key) !== requiredValue) {
      entries.set(key, requiredValue);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(configPath, buildConfigXml(entries), 'utf8');
    logger?.info?.('Synchronized LibreHardwareMonitor.config.', { configPath });
  }

  return configPath;
}

function createLhmAuthentication(executablePath) {
  if (executablePath) {
    try {
      const configPath = path.join(path.dirname(executablePath), 'LibreHardwareMonitor.config');
      const entries = parseConfigEntries(fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '');
      const username = entries.get('authenticationUserName');
      const password = entries.get('authenticationPassword');

      if (
        entries.get('authenticationEnabled') === 'true'
        && username === LHM_AUTH_USERNAME
        && /^[A-Za-z0-9_-]{43}$/.test(password || '')
      ) {
        return { username, password };
      }
    } catch (_error) {
      // A new local credential is generated below when the previous config is unavailable.
    }
  }

  return {
    username: LHM_AUTH_USERNAME,
    password: crypto.randomBytes(32).toString('base64url')
  };
}

async function isLhmRunning() {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    const result = await execFileAsync(resolveWindowsSystemExecutable('tasklist'), ['/FI', `IMAGENAME eq ${LHM_PROCESS_NAME}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true
    });

    return String(result.stdout || '').toLowerCase().includes(LHM_PROCESS_NAME.toLowerCase());
  } catch (_error) {
    return false;
  }
}

async function killLhmProcesses(logger, options = {}) {
  if (process.platform !== 'win32') {
    return true;
  }

  try {
    await execFileAsync(resolveWindowsSystemExecutable('taskkill'), ['/F', '/IM', LHM_PROCESS_NAME], { windowsHide: true });
    logger?.warn?.('Terminated stale LibreHardwareMonitor process(es).');
    return true;
  } catch (error) {
    const stderr = String(error?.stderr || '').trim().toLowerCase();
    if (stderr.includes('not found') || stderr.includes('no running instance')) {
      return true;
    }

    logger?.warn?.('Failed to terminate existing LibreHardwareMonitor process(es).', {
      message: error?.error?.message || error?.message || 'Unknown taskkill error'
    });
    if (options.allowElevation === true && typeof options.privilegedExecutor === 'function' && await isLhmRunning()) {
      try {
        await options.privilegedExecutor('monitoring.stopSidecar', {}, { reason: 'monitoring-stop', timeoutMs: 15000 });
        return !(await isLhmRunning());
      } catch (brokerError) {
        logger?.warn?.('Privileged LibreHardwareMonitor termination was canceled or failed.', {
          message: brokerError?.message || 'Unknown broker error'
        });
      }
    }
    return !(await isLhmRunning());
  }
}

async function isPawnIoReady() {
  if (process.platform !== 'win32') {
    return true;
  }

  for (const registryView of ['/reg:64', '/reg:32']) {
    try {
      const result = await execFileAsync(
        resolveWindowsSystemExecutable('reg'),
        ['query', PAWNIO_REGISTRY_KEY, '/v', 'DisplayVersion', registryView],
        { windowsHide: true }
      );

      const match = String(result.stdout || '').match(/DisplayVersion\s+REG_SZ\s+(\S+)/i);
      if (match) {
        return Number.parseInt(match[1].split('.')[0], 10) >= MIN_PAWNIO_MAJOR_VERSION;
      }
    } catch (_error) {
      // Try the other registry view before reporting that sensor access is unavailable.
    }
  }

  return false;
}

async function runPawnIoInstaller(installerPath) {
  const runtimeRoot = path.resolve(path.dirname(installerPath), '..', '..');
  const expectedInstallerPath = path.resolve(runtimeRoot, PAWNIO_INSTALLER);
  if (path.resolve(installerPath) !== expectedInstallerPath) {
    throw new Error('The PawnIO installer path is not trusted.');
  }
  assertMonitoringRuntimeIntegrity(runtimeRoot);

  const result = await withTimeout(
    execFileAsync(installerPath, ['-install'], {
      cwd: path.dirname(installerPath),
      env: createSanitizedSidecarEnvironment(),
      windowsHide: true
    }),
    120000,
    'PAWNIO_INSTALL_TIMEOUT',
    'Timed out while installing the PawnIO sensor driver.'
  );
  return Number(result?.exitCode) || 0;
}

function createSanitizedSidecarEnvironment() {
  const env = { ...process.env };
  for (const key of [
    'COREHOST_TRACEFILE',
    'DOTNET_ADDITIONAL_DEPS',
    'DOTNET_HOST_PATH',
    'DOTNET_SHARED_STORE',
    'DOTNET_STARTUP_HOOKS'
  ]) {
    delete env[key];
  }
  return env;
}

async function startLhmProcess(executablePath, logger) {
  assertMonitoringRuntimeIntegrity(runtimeRootForExecutable(executablePath));
  const cwd = path.dirname(executablePath);
  const env = {
    ...createSanitizedSidecarEnvironment(),
    LHM_HEADLESS: '1',
    LHM_SKIP_PAWNIO_PROMPT: '1'
  };

  try {
    const pid = await new Promise((resolve, reject) => {
      const child = spawn(executablePath, [LHM_HEADLESS_ARGUMENT], {
        cwd,
        env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      let settled = false;

      const finish = (fn, value) => {
        if (settled) {
          return;
        }

        settled = true;
        child.removeListener('error', onError);
        child.removeListener('spawn', onSpawn);
        fn(value);
      };

      const onError = (error) => finish(reject, error);
      const onSpawn = () => finish(resolve, child.pid);

      child.once('error', onError);
      child.once('spawn', onSpawn);
      setTimeout(() => finish(resolve, child.pid), 500);

      child.unref();
    });

    logger?.info?.('Started LibreHardwareMonitor process.', {
      executablePath,
      pid: Number.isFinite(pid) ? pid : null,
      strategy: 'spawn'
    });

    return;
  } catch (error) {
    if (!['EACCES', 'EPERM', 'UNKNOWN'].includes(String(error?.code || '').toUpperCase())) {
      throw error;
    }

    logger?.warn?.('Direct LibreHardwareMonitor launch failed, using PowerShell fallback.', {
      executablePath,
      code: error?.code || 'UNKNOWN',
      message: error?.message || 'Unknown spawn error'
    });

    const escapedPath = escapePsSingleQuotes(executablePath);
    const escapedCwd = escapePsSingleQuotes(cwd);
    const command = [
      "$env:LHM_HEADLESS='1'",
      "$env:LHM_SKIP_PAWNIO_PROMPT='1'",
      `Start-Process -FilePath '${escapedPath}' -ArgumentList '${LHM_HEADLESS_ARGUMENT}' -WorkingDirectory '${escapedCwd}' -WindowStyle Hidden`
    ].join('; ');

    await withTimeout(
      execFileAsync(resolveWindowsSystemExecutable('powershell'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        env,
        windowsHide: true
      }),
      5000,
      'LHM_START_TIMEOUT',
      'Timed out while starting LibreHardwareMonitor via PowerShell.'
    );

    logger?.info?.('Started LibreHardwareMonitor process.', {
      executablePath,
      pid: null,
      strategy: 'powershell-start-process'
    });
  }
}

function createOfflinePayload(message = 'LibreHardwareMonitor endpoint is offline.') {
  return {
    monitoring: 'offline',
    message,
    cpuLoad: null,
    cpuTemp: null,
    gpuLoad: null,
    gpuTemp: null,
    memoryUsage: null,
    networkIn: null,
    networkOut: null,
    timestamp: Date.now()
  };
}

function createOnlinePayload(normalizedMetrics) {
  return {
    monitoring: 'online',
    ...normalizedMetrics,
    timestamp: Date.now()
  };
}

function createMonitoringManager(options = {}) {
  const logger = options.logger;
  const app = options.app;
  let intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : DEFAULT_INTERVAL_MS;
  const onMetrics = typeof options.onMetrics === 'function' ? options.onMetrics : null;
  const isAdminProvider =
    typeof options.isAdminProvider === 'function' ? options.isAdminProvider : () => false;
  const allowDriverProvisionProvider =
    typeof options.allowDriverProvisionProvider === 'function'
      ? options.allowDriverProvisionProvider
      : () => false;
  const privilegedExecutor = typeof options.privilegedExecutor === 'function' ? options.privilegedExecutor : null;
  let executablePath = resolveLhmExecutablePath(app, logger);
  const lhmAuthentication = createLhmAuthentication(executablePath);

  const lhmClient = createLhmClient({
    logger,
    timeoutMs: 3000,
    maxRetries: 5,
    retryDelayMs: 350,
    ...lhmAuthentication
  });
  const metricsService = createMetricsService({ logger });
  const overviewSnapshotService = createOverviewSnapshotService({
    logger,
    systemDetectionService: options.systemDetectionService,
    isAdminProvider,
    windowsTtlMs: Math.max(30000, intervalMs)
  });

  let latest = createOfflinePayload('Monitoring not initialized yet.');
  let timer = null;
  let startPromise = null;
  let pollInProgress = false;
  let consecutiveFailures = 0;
  let bootstrapPending = true;
  let pawnIoReady = null;
  let sensorDriverProvisionAttempted = false;
  let managedLhmRunning = false;

  async function requiresSensorDriver(forceRefresh = false) {
    if (forceRefresh || pawnIoReady === null) {
      pawnIoReady = await isPawnIoReady();
    }

    return !pawnIoReady;
  }

  async function ensureSensorDriverReady() {
    if (process.platform !== 'win32' || sensorDriverProvisionAttempted || !(await requiresSensorDriver())) {
      return;
    }
    if (!allowDriverProvisionProvider()) {
      return;
    }

    sensorDriverProvisionAttempted = true;
    const installerPath = resolvePawnIoInstallerPath(executablePath, logger);
    if (!installerPath) {
      logger?.warn?.('Bundled PawnIO sensor driver could not be provisioned because its installer is missing.');
      return;
    }

    try {
      logger?.info?.('Provisioning bundled PawnIO sensor driver.', { installerPath });
      const brokerResult = !isAdminProvider() && privilegedExecutor
        ? await privilegedExecutor('monitoring.installSensorDriver', {}, { reason: 'sensor-driver', timeoutMs: 120000 })
        : null;
      const exitCode = brokerResult ? Number(brokerResult.exitCode) || 0 : await runPawnIoInstaller(installerPath);
      if (exitCode !== 0 || await requiresSensorDriver(true)) {
        logger?.warn?.('Bundled PawnIO sensor driver setup did not complete.', { exitCode });
        return;
      }

      logger?.info?.('Bundled PawnIO sensor driver is ready.');
    } catch (error) {
      logger?.warn?.('Bundled PawnIO sensor driver setup failed.', {
        message: error.message || 'Unknown setup error'
      });
    }
  }

  async function startManagedLhmProcess() {
    assertMonitoringRuntimeIntegrity(runtimeRootForExecutable(executablePath));
    if (process.platform === 'win32' && !isAdminProvider()) {
      if (!privilegedExecutor) {
        throw new Error('Administrator broker is unavailable for LibreHardwareMonitor.');
      }
      const result = await privilegedExecutor(
        'monitoring.startSidecar',
        { executablePath },
        { reason: 'monitoring-start', timeoutMs: 15000 }
      );
      logger?.info?.('Started LibreHardwareMonitor through the administrator broker.', {
        executablePath,
        pid: Number.isFinite(result?.pid) ? result.pid : null
      });
      return;
    }

    await startLhmProcess(executablePath, logger);
  }

  async function probeEndpoint() {
    try {
      await lhmClient.fetchOnce({ timeoutMs: 1500 });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function waitForEndpoint(timeoutMs = STARTUP_TIMEOUT_MS) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (await probeEndpoint()) {
        return true;
      }

      await sleep(STARTUP_RETRY_DELAY_MS);
    }

    return false;
  }

  async function ensureLhmReady() {
    if (!executablePath) {
      executablePath = resolveLhmExecutablePath(app, logger);
    }

    if (!executablePath) {
      throw new Error('LibreHardwareMonitor executable path could not be resolved.');
    }

    ensureConfigFile(executablePath, logger, lhmAuthentication);
    await ensureSensorDriverReady();

    if (bootstrapPending) {
      bootstrapPending = false;
      if (await probeEndpoint()) {
        managedLhmRunning = true;
        return;
      }
      const stopped = await killLhmProcesses(logger, { allowElevation: true, privilegedExecutor });
      if (!stopped) {
        throw new Error('An existing LibreHardwareMonitor process could not be stopped.');
      }
      await startManagedLhmProcess();
      managedLhmRunning = true;
      const ready = await waitForEndpoint();
      if (!ready) {
        throw new Error('LHM endpoint did not become ready after cold start.');
      }
      return;
    }

    const running = await isLhmRunning();
    if (!running) {
      await startManagedLhmProcess();
      managedLhmRunning = true;
      const ready = await waitForEndpoint();
      if (!ready) {
        throw new Error('LHM started but endpoint did not become ready.');
      }
      return;
    }

    if (!(await probeEndpoint())) {
      logger?.warn?.('LHM process is running but endpoint is unreachable. Restarting LHM.');
      await killLhmProcesses(logger, { allowElevation: true, privilegedExecutor });
      managedLhmRunning = false;
      await startManagedLhmProcess();
      managedLhmRunning = true;

      const ready = await waitForEndpoint();
      if (!ready) {
        throw new Error('LHM endpoint is unreachable after restart.');
      }
    }
  }

  async function pollOnce() {
    if (pollInProgress) {
      const heartbeat = { ...latest, timestamp: Date.now() };
      latest = heartbeat;
      onMetrics?.(heartbeat);
      return latest;
    }

    const cycleStartedAt = Date.now();
    pollInProgress = true;

    try {
      await ensureLhmReady();

      const raw = await lhmClient.fetchWithRetry({
        timeoutMs: 3000,
        maxRetries: 2,
        retryDelayMs: 250
      });

      const normalized = metricsService.normalize(raw);
      const onlinePayload = createOnlinePayload(normalized);
      latest = {
        ...onlinePayload,
        overview: await overviewSnapshotService.buildSnapshot({
          rawLhmPayload: raw,
          metrics: onlinePayload,
          refreshRateMs: intervalMs
        })
      };
      consecutiveFailures = 0;
      onMetrics?.(latest);
      return latest;
    } catch (error) {
      consecutiveFailures += 1;

      logger?.error?.('LHM monitoring cycle failed.', {
        message: error.message,
        code: error.code || 'MONITORING_ERROR',
        consecutiveFailures
      });

      if (consecutiveFailures >= RESTART_THRESHOLD) {
        consecutiveFailures = 0;
        await killLhmProcesses(logger, { allowElevation: true, privilegedExecutor });
        managedLhmRunning = false;
      }

      const offlinePayload = createOfflinePayload(error.message || 'LibreHardwareMonitor endpoint is offline.');
      latest = {
        ...offlinePayload,
        overview: await overviewSnapshotService.buildSnapshot({
          rawLhmPayload: null,
          metrics: offlinePayload,
          refreshRateMs: intervalMs
        })
      };
      onMetrics?.(latest);
      return latest;
    } finally {
      const durationMs = Date.now() - cycleStartedAt;
      if (durationMs > 300) {
        logger?.warn?.('LHM monitoring cycle was slow.', {
          durationMs,
          monitoring: latest?.monitoring || 'unknown'
        });
      }
      pollInProgress = false;
    }
  }

  async function start() {
    if (timer) {
      return true;
    }
    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      logger?.info?.('Starting monitoring manager (LHM-only).', {
        intervalMs,
        endpoint: lhmClient.endpoint
      });

      const initialMetrics = await pollOnce();
      if (initialMetrics?.monitoring !== 'online') {
        logger?.warn?.('Monitoring manager was not scheduled because LHM is unavailable.');
        return false;
      }

      timer = setInterval(() => {
        void pollOnce();
      }, intervalMs);

      return true;
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
    logger?.info?.('Monitoring manager stopped.');
  }

  async function shutdown(options = {}) {
    stop();
    let sidecarStopped = true;
    if (managedLhmRunning) {
      sidecarStopped = await killLhmProcesses(logger, {
        allowElevation: options.ensureProcessStopped === true,
        privilegedExecutor
      });
      managedLhmRunning = !sidecarStopped;
    }
    if (sidecarStopped) {
      bootstrapPending = true;
    }
    latest = createOfflinePayload('Advanced sensor monitoring is disabled.');
    onMetrics?.(latest);
    return {
      sidecarStopped
    };
  }

  function getLatest() {
    return latest;
  }

  function setRefreshRate(nextIntervalMs) {
    const normalizedInterval = Number(nextIntervalMs);
    if (!Number.isFinite(normalizedInterval)) {
      return intervalMs;
    }

    intervalMs = Math.max(1000, Math.min(10000, Math.trunc(normalizedInterval)));
    if (timer) {
      clearInterval(timer);
      timer = setInterval(() => {
        void pollOnce();
      }, intervalMs);
    }

    return intervalMs;
  }

  return {
    start,
    stop,
    shutdown,
    pollOnce,
    getLatest,
    setRefreshRate
  };
}

module.exports = {
  createMonitoringManager
};
