const crypto = require('crypto');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const desktopBuildConfig = require('../../generated/signing-config');

const {
  PROTOCOL_VERSION,
  AdminBrokerProtocolError,
  createLineDecoder,
  createRequest,
  encodeMessage,
  normalizeTimeout
} = require('./adminBrokerProtocol');

const CONNECT_TIMEOUT_MS = 45000;

class AdminBrokerError extends Error {
  constructor(message, code = 'ADMIN_BROKER_ERROR', details = {}) {
    super(message);
    this.name = 'AdminBrokerError';
    this.code = code;
    this.details = details;
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function quoteWindowsArgument(value) {
  const input = String(value ?? '');
  if (input.length > 0 && !/[\s"]/u.test(input)) return input;
  let result = '"';
  let backslashes = 0;
  for (const character of input) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += '\\'.repeat((backslashes * 2) + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + '\\'.repeat(backslashes * 2) + '"';
}

function createAdminBrokerManager(options = {}) {
  const app = options.app;
  const logger = options.logger;
  const isAdminProvider = typeof options.isAdminProvider === 'function' ? options.isAdminProvider : () => false;
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
  const platform = options.platform || process.platform;
  const createServer = options.createServer || net.createServer;
  const launchBroker = options.launchBroker || defaultLaunchBroker;
  const now = options.nowProvider || (() => Date.now());

  let status = platform === 'win32' ? 'idle' : 'unavailable';
  let socket = null;
  let server = null;
  let startPromise = null;
  let sessionId = '';
  let startedAt = 0;
  let pendingCount = 0;
  let shuttingDown = false;
  const pendingRequests = new Map();

  function getState() {
    const alreadyElevated = Boolean(isAdminProvider());
    return {
      status: alreadyElevated ? 'ready' : status,
      available: platform === 'win32',
      ready: alreadyElevated || status === 'ready',
      alreadyElevated,
      pendingCount,
      sessionId: alreadyElevated ? 'current-process' : sessionId,
      startedAt: alreadyElevated ? 0 : startedAt
    };
  }

  function emitState(nextStatus = status) {
    status = nextStatus;
    const state = getState();
    onStateChange(state);
    return state;
  }

  function rejectPending(code, message) {
    for (const entry of pendingRequests.values()) {
      clearTimeout(entry.timer);
      entry.reject(new AdminBrokerError(message, code, { requestId: entry.id }));
    }
    pendingRequests.clear();
    pendingCount = 0;
  }

  function closeTransport({ code = 'ADMIN_BROKER_DISCONNECTED', message = 'Administrator broker disconnected.', preserveStatus = false } = {}) {
    const activeSocket = socket;
    socket = null;
    if (activeSocket && !activeSocket.destroyed) activeSocket.destroy();
    if (server) {
      try { server.close(); } catch (_error) {}
      server = null;
    }
    rejectPending(code, message);
    sessionId = '';
    startedAt = 0;
    if (!preserveStatus && !shuttingDown && platform === 'win32') emitState('disconnected');
  }

  function handleMessage(message, resolveReady, rejectReady) {
    if (message?.type === 'startup-error') {
      if (message.protocolVersion !== PROTOCOL_VERSION || message.sessionId !== sessionId) {
        rejectReady(new AdminBrokerError('Administrator broker startup response was invalid.', 'ADMIN_BROKER_PROTOCOL_ERROR'));
        return;
      }
      rejectReady(new AdminBrokerError(
        message.error?.message || 'Administrator broker worker failed to start.',
        message.error?.code || 'ADMIN_BROKER_WORKER_FAILED',
        message.error?.details || {}
      ));
      return;
    }
    if (message?.type === 'hello') {
      if (message.protocolVersion !== PROTOCOL_VERSION || message.sessionId !== sessionId) {
        rejectReady(new AdminBrokerError('Administrator broker handshake failed.', 'ADMIN_BROKER_PROTOCOL_ERROR'));
        closeTransport({ code: 'ADMIN_BROKER_PROTOCOL_ERROR', message: 'Administrator broker handshake failed.' });
        return;
      }
      startedAt = now();
      if (server) {
        try { server.close(); } catch (_error) {}
        server = null;
      }
      emitState('ready');
      resolveReady(getState());
      return;
    }
    if (message?.type !== 'response' || typeof message.id !== 'string') return;
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    pendingCount = pendingRequests.size;
    clearTimeout(pending.timer);
    emitState(status);
    if (message.ok === true) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new AdminBrokerError(
      message.error?.message || 'Administrator operation failed.',
      message.error?.code || 'ADMIN_BROKER_OPERATION_FAILED',
      message.error?.details || {}
    ));
  }

  async function defaultLaunchBroker({ pipeName, brokerSessionId }) {
    const executablePath = process.execPath;
    const appPath = app?.getAppPath?.() || process.cwd();
    const workerArgs = app?.isPackaged
      ? ['--nova-admin-broker-worker', '--broker-pipe', pipeName, '--broker-session', brokerSessionId]
      : [appPath, '--nova-admin-broker-worker', '--broker-pipe', pipeName, '--broker-session', brokerSessionId];
    const nativeHostPath = app?.isPackaged
      ? path.join(process.resourcesPath, 'tools', 'nova-admin-broker', 'NovaAdminBrokerHost.exe')
      : path.join(appPath, 'tools', 'nova-admin-broker', 'bin', 'NovaAdminBrokerHost.exe');
    const useNativeHost = Boolean(app?.isPackaged && require('fs').existsSync(nativeHostPath));
    const launchPath = useNativeHost ? nativeHostPath : executablePath;
    const launchArgs = useNativeHost
      ? [
          '--pipe', pipeName,
          '--parent-pid', String(process.pid),
          '--worker', executablePath,
          '--session', brokerSessionId,
          ...(desktopBuildConfig.NOVA_LOCAL_TEST_BUILD === true ? ['--allow-unsigned-local-test'] : []),
          ...(app?.isPackaged ? [] : ['--app-path', appPath])
        ]
      : workerArgs;

    if (app?.isPackaged && !useNativeHost) {
      throw new AdminBrokerError('The signed administrator broker host is missing.', 'ADMIN_BROKER_UNAVAILABLE');
    }
    if (app?.isPackaged && process.windowsStore !== true && desktopBuildConfig.NOVA_LOCAL_TEST_BUILD !== true) {
      const signatureCommand = [
        '$signature = Get-AuthenticodeSignature -LiteralPath $env:NOVA_BROKER_HOST',
        'if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) { exit 17 }'
      ].join('; ');
      await new Promise((resolve, reject) => {
        execFile(options.powerShellPath || 'powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', signatureCommand], {
          env: { ...process.env, NOVA_BROKER_HOST: nativeHostPath },
          windowsHide: true,
          timeout: 15000
        }, (error) => error
          ? reject(new AdminBrokerError('The administrator broker signature is invalid.', 'ADMIN_BROKER_SIGNATURE_INVALID'))
          : resolve());
      });
    }

    const encodedLaunchArguments = Buffer.from(
      launchArgs.map(quoteWindowsArgument).join(' '),
      'utf8'
    ).toString('base64');
    const command = [
      `$arguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedLaunchArguments}'))`,
      `$process = Start-Process -FilePath '${escapePowerShellSingleQuoted(launchPath)}' -ArgumentList $arguments -WorkingDirectory '${escapePowerShellSingleQuoted(path.dirname(launchPath))}' -Verb RunAs -WindowStyle Hidden -PassThru`,
      'if ($process.WaitForExit(1500)) { Write-Error "Administrator broker host exited with code $($process.ExitCode)."; exit $process.ExitCode }',
      '$process.Id'
    ].join('; ');

    await new Promise((resolve, reject) => {
      execFile(
        options.powerShellPath || 'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { windowsHide: true, timeout: CONNECT_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            reject(new AdminBrokerError('Administrator approval was cancelled or failed.', 'ADMIN_BROKER_CANCELLED', {
              message: error.message
            }));
            return;
          }
          logger?.info?.('Administrator broker process launched.', { pid: Number.parseInt(String(stdout).trim(), 10) || 0, nativeHost: useNativeHost });
          resolve();
        }
      );
    });
  }

  function ensureReady({ reason = 'manual' } = {}) {
    if (isAdminProvider()) return Promise.resolve(getState());
    if (platform !== 'win32') {
      return Promise.reject(new AdminBrokerError('Administrator access is unavailable on this platform.', 'ADMIN_BROKER_UNAVAILABLE'));
    }
    if (status === 'ready' && socket && !socket.destroyed) return Promise.resolve(getState());
    if (startPromise) return startPromise;

    shuttingDown = false;
    sessionId = crypto.randomUUID();
    const pipeName = `\\\\.\\pipe\\nova-tweaks-admin-${process.pid}-${crypto.randomUUID()}`;
    emitState('starting');

    startPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        const wrapped = error instanceof AdminBrokerError
          ? error
          : new AdminBrokerError(error?.message || 'Administrator broker failed to start.', error?.code || 'ADMIN_BROKER_UNAVAILABLE');
        emitState(wrapped.code === 'ADMIN_BROKER_CANCELLED' ? 'cancelled' : 'disconnected');
        closeTransport({ code: wrapped.code, message: wrapped.message, preserveStatus: true });
        reject(wrapped);
      };
      let finishResolve = (state) => {
        if (settled) return;
        settled = true;
        resolve(state);
      };

      server = createServer((candidate) => {
        if (socket && !socket.destroyed) {
          candidate.destroy();
          return;
        }
        socket = candidate;
        candidate.setNoDelay?.(true);
        const decoder = createLineDecoder(
          (message) => handleMessage(message, finishResolve, finishReject),
          finishReject
        );
        candidate.on('data', decoder);
        candidate.on('error', (error) => {
          if (!settled) finishReject(error);
          else closeTransport();
        });
        candidate.on('close', () => {
          if (!settled) finishReject(new AdminBrokerError('Administrator broker disconnected during startup.', 'ADMIN_BROKER_DISCONNECTED'));
          else if (!shuttingDown) closeTransport();
        });
      });
      server.once('error', finishReject);
      server.listen(pipeName, () => {
        void launchBroker({ pipeName, brokerSessionId: sessionId, reason }).catch(finishReject);
      });

      const timer = setTimeout(() => {
        finishReject(new AdminBrokerError('Administrator broker startup timed out.', 'ADMIN_BROKER_TIMEOUT'));
      }, CONNECT_TIMEOUT_MS);
      timer.unref?.();
      const clearStartupTimer = () => clearTimeout(timer);
      const originalResolve = finishResolve;
      finishResolve = (state) => { clearStartupTimer(); originalResolve(state); };
    }).finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  async function execute(operation, payload = {}, options = {}) {
    if (isAdminProvider() && typeof options.executeElevated === 'function') {
      return options.executeElevated();
    }
    if (options.allowPrompt === false && getState().ready !== true) {
      throw new AdminBrokerError('Administrator approval is required.', 'ADMIN_BROKER_APPROVAL_REQUIRED');
    }
    await ensureReady({ reason: options.reason || operation });
    if (!socket || socket.destroyed || status !== 'ready') {
      throw new AdminBrokerError('Administrator broker is not connected.', 'ADMIN_BROKER_DISCONNECTED');
    }
    const id = crypto.randomUUID();
    const request = createRequest({ id, operation, payload, timeoutMs: options.timeoutMs });
    const timeoutMs = normalizeTimeout(options.timeoutMs) + 5000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        pendingCount = pendingRequests.size;
        emitState(status);
        reject(new AdminBrokerError('Administrator operation timed out.', 'ADMIN_BROKER_TIMEOUT', { requestId: id }));
      }, timeoutMs);
      timer.unref?.();
      pendingRequests.set(id, { id, resolve, reject, timer });
      pendingCount = pendingRequests.size;
      emitState(status);
      try {
        socket.write(encodeMessage(request));
      } catch (error) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        pendingCount = pendingRequests.size;
        reject(error instanceof AdminBrokerProtocolError ? error : new AdminBrokerError(error.message));
      }
    });
  }

  function shutdown() {
    shuttingDown = true;
    if (socket && !socket.destroyed) {
      try { socket.write(encodeMessage({ type: 'shutdown', protocolVersion: PROTOCOL_VERSION })); } catch (_error) {}
    }
    closeTransport({ code: 'ADMIN_BROKER_SHUTDOWN', message: 'Administrator broker was shut down.' });
    emitState(platform === 'win32' ? 'idle' : 'unavailable');
  }

  return { ensureReady, execute, getState, shutdown };
}

module.exports = { AdminBrokerError, createAdminBrokerManager, quoteWindowsArgument };
