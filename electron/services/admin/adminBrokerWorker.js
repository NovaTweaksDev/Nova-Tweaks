const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const {
  PROTOCOL_VERSION,
  AdminBrokerProtocolError,
  assertAllowedOperation,
  createLineDecoder,
  encodeMessage,
  normalizeTimeout
} = require('./adminBrokerProtocol');
const { createScriptRunner } = require('../script-runner');
const { createRemoteTweakArtifactCache } = require('../tweaks/remoteTweakArtifactCache');
const { verifySignedPayloadWithKeyring } = require('../security/artifactVerifier');
const { createSigningManifestStore } = require('../security/signingManifest');
const { getArtifactPublicKeys, getTweakPublicKeys } = require('../security/signingConfig');
const { createAppsManager } = require('../apps/appsManager');
const { buildProfiles } = require('../apps/appOptimizationCatalog');
const { createBackupManager } = require('../backups/backupManager');
const {
  assertMonitoringRuntimeIntegrity,
  runtimeRootForExecutable
} = require('../monitoring/monitoringIntegrity');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');
const { assertBundledTweakContent } = require('../security/bundledTweakIntegrity');
const bundledTweakManifest = require('../../generated/bundled-tweaks-manifest');

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function toErrorPayload(error) {
  return {
    code: String(error?.code || 'ADMIN_BROKER_OPERATION_FAILED'),
    message: String(error?.message || 'Administrator operation failed.'),
    details: error?.details && typeof error.details === 'object' ? error.details : {}
  };
}

function execFileAsync(filePath, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(filePath, args, options, (error, stdout, stderr) => {
      if (error) {
        error.details = { ...(error.details || {}), stdout: String(stdout || ''), stderr: String(stderr || '') };
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), exitCode: 0 });
    });
  });
}

function assertInteger(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new AdminBrokerProtocolError(`${name} is invalid.`, 'ADMIN_BROKER_INVALID_PAYLOAD', { [name]: value });
  }
  return normalized;
}

function normalizeUserSid(value) {
  const sid = String(value || '').trim();
  return /^S-1-(?:\d+-){1,14}\d+$/i.test(sid) ? sid.toUpperCase() : '';
}

function validateTweakParams(params, artifact, action) {
  if (params.State !== action || params.Silent !== true) {
    throw new AdminBrokerProtocolError('The privileged tweak state contract is invalid.', 'ADMIN_BROKER_INVALID_PAYLOAD');
  }
  const definitions = new Map((Array.isArray(artifact.allowedParameters) ? artifact.allowedParameters : [])
    .map((definition) => [String(definition?.name || '').trim(), definition])
    .filter(([name]) => name));
  for (const key of Object.keys(params)) {
    if (key === 'State' || key === 'Silent') continue;
    const definition = definitions.get(key);
    if (!definition) {
      throw new AdminBrokerProtocolError('The privileged tweak contains an unknown parameter.', 'REMOTE_TWEAK_UNKNOWN_PARAMETER', { parameter: key });
    }
    const value = params[key];
    if (definition.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || (Number.isFinite(Number(definition.minimum)) && number < Number(definition.minimum)) || (Number.isFinite(Number(definition.maximum)) && number > Number(definition.maximum))) {
        throw new AdminBrokerProtocolError('The privileged tweak parameter is outside its signed range.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { parameter: key });
      }
    } else {
      const text = String(value ?? '');
      if (Number.isFinite(Number(definition.maxLength)) && text.length > Number(definition.maxLength)) {
        throw new AdminBrokerProtocolError('The privileged tweak parameter is too long.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { parameter: key });
      }
      if (Array.isArray(definition.allowedValues) && definition.allowedValues.length && !definition.allowedValues.map(String).includes(text)) {
        throw new AdminBrokerProtocolError('The privileged tweak parameter is not allowed.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { parameter: key });
      }
    }
  }
  for (const [name, definition] of definitions) {
    if (definition?.required === true && (params[name] === undefined || params[name] === null || params[name] === '')) {
      throw new AdminBrokerProtocolError('A required privileged tweak parameter is missing.', 'REMOTE_TWEAK_REQUIRED_PARAMETER_MISSING', { parameter: name });
    }
  }
}

function createDefaultOperationHandler(options = {}) {
  const logger = options.logger;
  const app = options.app;
  const scriptRunnerFactory = options.scriptRunnerFactory || createScriptRunner;
  const originUserSid = normalizeUserSid(options.originUserSid);
  const spawnProcess = options.spawnProcess || spawn;
  const workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'NovaTweaksAdminBroker-'));
  const appsManager = createAppsManager({
    logger,
    optimizationBackupRoot: path.join(workerRoot, 'app-optimization'),
    isAdminProvider: () => true,
    isPackaged: Boolean(app?.isPackaged)
  });
  const backupManager = createBackupManager({
    app: {
      getPath: () => path.join(workerRoot, 'user-data')
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: '' })
    },
    logger,
    getAppVersion: () => app?.getVersion?.() || '0.0.0',
    getBackupRoot: () => path.join(workerRoot, 'backups')
  });

  async function executeTweak(payload, timeoutMs) {
    const artifactInput = payload?.artifact;
    const action = String(payload?.action || '').trim();
    const params = payload?.params;
    if (!artifactInput || !['On', 'Off'].includes(action) || !params || typeof params !== 'object' || Array.isArray(params)) {
      throw new AdminBrokerProtocolError('The privileged tweak payload is invalid.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }

    if (originUserSid) {
      const identity = await execFileAsync(resolveWindowsSystemExecutable('powershell'), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
      ], { windowsHide: true, timeout: 15000 });
      const workerUserSid = normalizeUserSid(identity.stdout);
      if (!workerUserSid || workerUserSid !== originUserSid) {
        throw new AdminBrokerProtocolError(
          'This tweak cannot be safely mapped to the originating Windows user when different administrator credentials are used.',
          'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED'
        );
      }
    }

    const requestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'NovaTweaksAdminBrokerTweak-'));
    try {
      const isBundledIntegrityArtifact = payload.trustMode === 'bundled-integrity';
      if (isBundledIntegrityArtifact) {
        const signedPayload = artifactInput?.signedPayload || artifactInput;
        const tweakId = String(signedPayload?.tweakId || '').trim();
        const scriptFileName = path.basename(String(signedPayload?.scriptFileName || '').trim());
        assertBundledTweakContent(
          `scripts/${tweakId}/${scriptFileName}`,
          artifactInput.content,
          bundledTweakManifest
        );
      }

      const manifestPath = path.join(requestRoot, 'signing-manifest.json');
      const manifestStore = createSigningManifestStore({
        filePath: manifestPath,
        getPublicKeys: getArtifactPublicKeys
      });
      if (app?.isPackaged && !isBundledIntegrityArtifact && !payload.signingManifest) {
        throw new AdminBrokerProtocolError('The signed revocation manifest is missing.', 'SIGNING_MANIFEST_MISSING');
      }
      if (!isBundledIntegrityArtifact && payload.signingManifest) manifestStore.accept(payload.signingManifest);

      const allowUnsignedDevelopment = !app?.isPackaged && payload.allowUnsignedDevelopment === true;
      const cache = createRemoteTweakArtifactCache({
        cacheRoot: path.join(requestRoot, 'artifacts'),
        getAppVersion: () => app?.getVersion?.() || '0.0.0',
        verifySignature: ({ payload: signedPayload, signature }) => isBundledIntegrityArtifact || allowUnsignedDevelopment || verifySignedPayloadWithKeyring({
          payload: signedPayload,
          signature,
          publicKeys: getTweakPublicKeys(),
          keyId: signedPayload?.keyId
        }).verified
      });
      const artifact = await cache.storeArtifact(artifactInput);
      if (!isBundledIntegrityArtifact) {
        manifestStore.assertNotRevoked({
          keyId: artifact.keyId || artifact.signedPayload?.keyId,
          tweakId: artifact.tweakId,
          artifactVersion: artifact.artifactVersion
        });
      }
      const verified = cache.validateForExecution(artifact.tweakId, artifact.artifactVersion, action);
      validateTweakParams(params, verified, action);
      const runner = scriptRunnerFactory({
        scriptsPath: path.join(requestRoot, 'artifacts'),
        logger,
        env: {
          NOVA_TWEAKS_APP_PATH: app?.getAppPath?.() || '',
          NOVA_TWEAKS_BACKEND_ROOT: app?.isPackaged
            ? path.join(process.resourcesPath || app?.getAppPath?.() || process.cwd(), 'Nova-Api')
            : path.resolve(app?.getAppPath?.() || process.cwd(), '..', 'Nova-Api'),
          NOVA_TWEAKS_RESOURCES_PATH: process.resourcesPath || ''
        }
      });
      // Keep the isolated, revalidated artifact alive until PowerShell has
      // actually finished reading and executing it. Returning the promise
      // directly would enter `finally` immediately and delete requestRoot
      // while the child process is still starting.
      return await runner.runScript({
        scriptName: verified.scriptRelativePath,
        includeMode: false,
        params,
        timeoutMs: normalizeTimeout(timeoutMs),
        verifyBeforeRun: () => cache.validateForExecution(artifact.tweakId, artifact.artifactVersion, action)
      });
    } finally {
      fs.rmSync(requestRoot, { recursive: true, force: true });
    }
  }

  async function applyAppOptimizationPolicy(payload) {
    if (originUserSid) {
      const identity = await execFileAsync(resolveWindowsSystemExecutable('powershell'), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
      ], { windowsHide: true, timeout: 15000 });
      const workerUserSid = normalizeUserSid(identity.stdout);
      if (!workerUserSid || workerUserSid !== originUserSid) {
        throw new AdminBrokerProtocolError(
          'App settings cannot be mapped to the originating Windows user when different administrator credentials are used.',
          'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED'
        );
      }
    }

    const profileId = String(payload?.profileId || '').trim();
    const actionId = String(payload?.actionId || '').trim();
    const mode = String(payload?.mode || '').trim();
    const profile = buildProfiles(process.env).find((entry) => entry.id === profileId);
    const policy = profile?.policies?.find((entry) => entry.id === actionId);
    if (!policy || !['apply', 'restore'].includes(mode)) {
      throw new AdminBrokerProtocolError('The app policy request is not part of the optimization catalog.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }

    const registryPrefix = 'HKCU:\\';
    if (!String(policy.registryPath || '').startsWith(registryPrefix)) {
      throw new AdminBrokerProtocolError('Only current-user app policies are supported.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }

    const valueExists = mode === 'apply' || payload?.exists === true;
    let value = mode === 'apply' ? policy.recommendedValue : payload?.value;
    if (valueExists && policy.valueType === 'dword') {
      value = Number(value);
      if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
        throw new AdminBrokerProtocolError('The app policy value is invalid.', 'ADMIN_BROKER_INVALID_PAYLOAD');
      }
    } else if (valueExists) {
      value = String(value ?? '');
      if (value.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
        throw new AdminBrokerProtocolError('The app policy value is invalid.', 'ADMIN_BROKER_INVALID_PAYLOAD');
      }
    }

    const policyPayload = Buffer.from(JSON.stringify({
      subKey: policy.registryPath.slice(registryPrefix.length),
      valueName: policy.valueName,
      valueType: policy.valueType,
      value,
      exists: valueExists
    }), 'utf8').toString('base64');
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$item = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${policyPayload}')) | ConvertFrom-Json`,
      '$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey([string]$item.subKey, $true)',
      'if (-not $key) { throw "APP_POLICY_KEY_UNAVAILABLE" }',
      'try {',
      '  if ([bool]$item.exists) {',
      "    $kind = if ([string]$item.valueType -eq 'dword') { [Microsoft.Win32.RegistryValueKind]::DWord } else { [Microsoft.Win32.RegistryValueKind]::String }",
      "    $writeValue = if ([string]$item.valueType -eq 'dword') { [int]$item.value } else { [string]$item.value }",
      '    $key.SetValue([string]$item.valueName, $writeValue, $kind)',
      '  } else {',
      '    $key.DeleteValue([string]$item.valueName, $false)',
      '  }',
      '} finally { $key.Dispose() }',
      '[PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress'
    ].join('; ');
    const result = await execFileAsync(resolveWindowsSystemExecutable('powershell'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { windowsHide: true, timeout: 30000 });
    return { ...result, profileId, actionId, mode };
  }

  async function setMtu(payload) {
    const interfaceIndex = assertInteger(payload?.interfaceIndex, 'interfaceIndex', { max: 65535 });
    const mtu = assertInteger(payload?.mtu, 'mtu', { min: 576, max: 9000 });
    const result = await execFileAsync(
      resolveWindowsSystemExecutable('netsh'),
      ['interface', 'ipv4', 'set', 'subinterface', String(interfaceIndex), `mtu=${mtu}`, 'store=persistent'],
      { windowsHide: true, timeout: 30000 }
    );
    const verifyScript = [
      "$ErrorActionPreference = 'Stop'",
      `$entry = Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex ${interfaceIndex} -ErrorAction Stop | Select-Object -First 1`,
      '[PSCustomObject]@{ currentMtu = [int]$entry.NlMtu; interfaceIndex = [int]$entry.InterfaceIndex } | ConvertTo-Json -Compress'
    ].join('; ');
    const verified = await execFileAsync(resolveWindowsSystemExecutable('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', verifyScript], {
      windowsHide: true,
      timeout: 15000
    });
    const parsed = JSON.parse(verified.stdout.trim());
    return { ...result, interfaceIndex, mtu, currentMtu: Number(parsed.currentMtu) };
  }

  async function installSensorDriver() {
    const runtimeRoot = app?.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'monitoring', 'LibreHardwareMonitor')
      : path.join(app?.getAppPath?.() || process.cwd(), 'resources', 'monitoring', 'LibreHardwareMonitor');
    assertMonitoringRuntimeIntegrity(runtimeRoot);
    const installerPath = path.join(runtimeRoot, 'LibreHardwareMonitor', 'Resources', 'PawnIO_setup.exe');
    const result = await execFileAsync(installerPath, ['-install'], {
      cwd: path.dirname(installerPath),
      windowsHide: true,
      timeout: 120000
    });
    return { ...result, installed: true };
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
    env.LHM_HEADLESS = '1';
    env.LHM_SKIP_PAWNIO_PROMPT = '1';
    return env;
  }

  async function startSidecar(payload) {
    const payloadKeys = Object.keys(payload || {});
    const executablePath = String(payload?.executablePath || '').trim();
    if (payloadKeys.length !== 1 || payloadKeys[0] !== 'executablePath' || !executablePath || executablePath.length > 32767) {
      throw new AdminBrokerProtocolError('The monitoring sidecar payload is invalid.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }

    const runtimeRoot = runtimeRootForExecutable(executablePath);
    assertMonitoringRuntimeIntegrity(runtimeRoot);

    const child = spawnProcess(executablePath, ['--nova-headless'], {
      cwd: path.dirname(executablePath),
      detached: true,
      env: createSanitizedSidecarEnvironment(),
      shell: false,
      stdio: 'ignore',
      windowsHide: true
    });

    const pid = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('error', onError);
        child.removeListener('spawn', onSpawn);
        callback(value);
      };
      const onError = (error) => finish(reject, error);
      const onSpawn = () => finish(resolve, child.pid);
      const timer = setTimeout(() => finish(resolve, child.pid), 500);
      timer.unref?.();
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });
    child.unref();

    return { started: true, pid: Number.isFinite(pid) ? pid : null };
  }

  async function stopSidecar() {
    return execFileAsync(resolveWindowsSystemExecutable('taskkill'), ['/F', '/IM', 'LibreHardwareMonitor.exe'], {
      windowsHide: true,
      timeout: 15000
    });
  }

  async function terminateProcess(payload) {
    const processId = assertInteger(payload?.processId, 'processId', { max: 0x7fffffff });
    const expectedStartTime = String(payload?.startTime || '').trim();
    const expectedPath = String(payload?.executablePath || '').trim();
    if (!expectedStartTime && !expectedPath) {
      throw new AdminBrokerProtocolError('Process identity metadata is required.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }
    const identityPayload = Buffer.from(JSON.stringify({ processId, expectedStartTime, expectedPath }), 'utf8').toString('base64');
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${identityPayload}')) | ConvertFrom-Json`,
      '$process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$payload.processId) -ErrorAction Stop',
      "if (-not $process) { throw 'PROCESS_NOT_FOUND' }",
      '$actualPath = [string]$process.ExecutablePath',
      '$actualStart = ""',
      'try { $actualStart = (Get-Process -Id ([int]$payload.processId) -ErrorAction Stop).StartTime.ToUniversalTime().ToString("o") } catch {}',
      'if ($payload.expectedPath -and -not [string]::Equals($actualPath, [string]$payload.expectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw "PROCESS_IDENTITY_CHANGED" }',
      'if ($payload.expectedStartTime -and ((-not $actualStart) -or -not [string]::Equals($actualStart, [string]$payload.expectedStartTime, [StringComparison]::OrdinalIgnoreCase))) { throw "PROCESS_IDENTITY_CHANGED" }',
      'Stop-Process -Id ([int]$payload.processId) -Force -ErrorAction Stop'
    ].join('; ');
    await execFileAsync(resolveWindowsSystemExecutable('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 15000
    });
    return { processId, terminated: true };
  }

  function createRestorePoint(payload) {
    const name = payload?.name == null ? '' : String(payload.name).trim();
    if (name.length > 160 || /[\x00-\x1f]/.test(name)) {
      throw new AdminBrokerProtocolError('The restore point name is invalid.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }
    return backupManager.createWindowsRestorePoint(name);
  }

  function setMachineStartupState(payload) {
    if (payload?.expectedScope !== 'machine') {
      throw new AdminBrokerProtocolError('Only machine-wide startup entries are supported by the broker.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }
    return appsManager.setStartupEntryEnabled(payload);
  }

  function uninstallMachineApp(payload) {
    if (payload?.expectedScope !== 'machine') {
      throw new AdminBrokerProtocolError('Only machine-wide app uninstall operations are supported by the broker.', 'ADMIN_BROKER_INVALID_PAYLOAD');
    }
    return appsManager.uninstallApp(payload);
  }

  async function configureGame(payload) {
    if (!originUserSid) {
      throw new AdminBrokerProtocolError('The originating Windows user is required for game tuning.', 'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED');
    }
    const identity = await execFileAsync(resolveWindowsSystemExecutable('powershell'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
    ], { windowsHide: true, timeout: 15000 });
    if (normalizeUserSid(identity.stdout) !== originUserSid) {
      throw new AdminBrokerProtocolError('Game tuning requires administrator access for the originating Windows user.', 'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED');
    }
    return appsManager.configureActiveGame(payload);
  }

  async function handle(operation, payload, timeoutMs) {
    switch (operation) {
      case 'tweak.execute': return executeTweak(payload, timeoutMs);
      case 'startup.setEnabled': return setMachineStartupState(payload);
      case 'game.configure': return configureGame(payload);
      case 'apps.uninstall': return uninstallMachineApp(payload);
      case 'apps.optimization.policy': return applyAppOptimizationPolicy(payload);
      case 'systemRestore.create': return createRestorePoint(payload);
      case 'systemRestore.restore': return backupManager.restoreWindowsRestorePoint(assertInteger(payload?.sequenceNumber, 'sequenceNumber', { min: 0, max: 0x7fffffff }));
      case 'network.applyMtu': return setMtu(payload);
      case 'network.resetMtu': return setMtu(payload);
      case 'monitoring.installSensorDriver': return installSensorDriver();
      case 'monitoring.startSidecar': return startSidecar(payload);
      case 'monitoring.stopSidecar': return stopSidecar();
      case 'process.terminate': return terminateProcess(payload);
      default: throw new AdminBrokerProtocolError('Administrator operation is not implemented.', 'ADMIN_BROKER_OPERATION_NOT_ALLOWED');
    }
  }

  function dispose() {
    fs.rmSync(workerRoot, { recursive: true, force: true });
  }

  return { dispose, handle };
}

async function runAdminBrokerWorker(options = {}) {
  const argv = options.argv || process.argv;
  const sessionId = options.sessionId || argumentValue(argv, '--broker-session');
  const pipeName = options.pipeName || argumentValue(argv, '--broker-pipe');
  const originUserSid = options.originUserSid || argumentValue(argv, '--broker-origin-sid');
  const logger = options.logger;
  if (!sessionId || (!pipeName && options.input == null)) {
    throw new AdminBrokerProtocolError('Administrator broker startup arguments are missing.');
  }

  const input = options.input || net.connect(pipeName);
  const output = options.output || input;
  let closing = false;
  let queue = Promise.resolve();

  if (input.connecting) {
    await new Promise((resolve, reject) => {
      input.once('connect', resolve);
      input.once('error', reject);
    });
  }

  let operationHandler;
  try {
    operationHandler = options.operationHandler || createDefaultOperationHandler({ app: options.app, logger, originUserSid });
  } catch (error) {
    output.write(encodeMessage({
      type: 'startup-error',
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      error: toErrorPayload(error)
    }));
    if (input !== process.stdin) input.end?.();
    if (options.exit !== false) {
      setImmediate(() => options.exitProvider ? options.exitProvider(2) : process.exit(2));
    }
    return { shutdown() {} };
  }

  function send(message) {
    if (!closing) output.write(encodeMessage(message));
  }

  function shutdown(exitCode = 0) {
    if (closing) return;
    closing = true;
    operationHandler.dispose?.();
    if (input !== process.stdin) input.destroy?.();
    if (options.exit !== false) {
      setImmediate(() => options.exitProvider ? options.exitProvider(exitCode) : process.exit(exitCode));
    }
  }

  async function handleMessage(message) {
    if (message?.type === 'shutdown') {
      shutdown(0);
      return;
    }
    if (message?.type !== 'request' || message.protocolVersion !== PROTOCOL_VERSION || typeof message.id !== 'string') {
      throw new AdminBrokerProtocolError('Administrator broker received an invalid request.');
    }
    const operation = assertAllowedOperation(message.operation);
    try {
      const result = await operationHandler.handle(operation, message.payload || {}, normalizeTimeout(message.timeoutMs));
      send({ type: 'response', protocolVersion: PROTOCOL_VERSION, id: message.id, ok: true, result });
    } catch (error) {
      send({ type: 'response', protocolVersion: PROTOCOL_VERSION, id: message.id, ok: false, error: toErrorPayload(error) });
    }
  }

  const decoder = createLineDecoder(
    (message) => {
      queue = queue.then(() => handleMessage(message)).catch((error) => {
        logger?.error?.('Administrator broker request failed.', toErrorPayload(error));
      });
    },
    (error) => {
      logger?.error?.('Administrator broker protocol failed.', toErrorPayload(error));
      shutdown(2);
    }
  );
  input.on('data', decoder);
  input.on('error', (error) => {
    logger?.error?.('Administrator broker transport failed.', toErrorPayload(error));
    shutdown(3);
  });
  input.on('close', () => shutdown(0));

  send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, sessionId, pid: process.pid });
  return { shutdown };
}

module.exports = { createDefaultOperationHandler, normalizeUserSid, runAdminBrokerWorker, validateTweakParams };
