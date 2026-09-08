const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

const { PROTOCOL_VERSION, createLineDecoder, createRequest, encodeMessage } = require('./adminBrokerProtocol');
const { createDefaultOperationHandler, normalizeUserSid, runAdminBrokerWorker, validateTweakParams } = require('./adminBrokerWorker');

test('worker executes allowed requests serially and returns structured results', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  const received = new Promise((resolve) => {
    output.on('data', createLineDecoder((message) => {
      messages.push(message);
      if (message.type === 'response') resolve(message);
    }, assert.fail));
  });
  const calls = [];
  await runAdminBrokerWorker({
    input,
    output,
    sessionId: 'session-test',
    exit: false,
    operationHandler: {
      handle: async (operation, payload) => {
        calls.push({ operation, payload });
        return { ok: true };
      },
      dispose() {}
    }
  });
  input.write(encodeMessage(createRequest({
    id: '1234567890abcdef',
    operation: 'process.terminate',
    payload: { processId: 10 }
  })));
  const response = await received;
  assert.equal(messages[0].type, 'hello');
  assert.equal(response.ok, true);
  assert.deepEqual(calls, [{ operation: 'process.terminate', payload: { processId: 10 } }]);
  input.write(encodeMessage({ type: 'shutdown', protocolVersion: PROTOCOL_VERSION }));
});

test('worker revalidates signed tweak parameter boundaries independently', () => {
  const artifact = {
    allowedParameters: [{ name: 'Value', type: 'number', minimum: 10, maximum: 20, required: true }]
  };
  assert.doesNotThrow(() => validateTweakParams({ State: 'On', Silent: true, Value: 15 }, artifact, 'On'));
  assert.throws(() => validateTweakParams({ State: 'On', Silent: true, Value: 99 }, artifact, 'On'), {
    code: 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE'
  });
  assert.throws(() => validateTweakParams({ State: 'On', Silent: true, Command: 'whoami' }, artifact, 'On'), {
    code: 'REMOTE_TWEAK_UNKNOWN_PARAMETER'
  });
});

test('accepts only normalized Windows SID syntax for the originating user', () => {
  assert.equal(normalizeUserSid('S-1-5-21-1-2-3-1001'), 'S-1-5-21-1-2-3-1001');
  assert.equal(normalizeUserSid('administrator'), '');
  assert.equal(normalizeUserSid('S-1-5-21-1;Stop-Process'), '');
});

test('default worker operation handler starts without interactive Electron dialogs', () => {
  const handler = createDefaultOperationHandler({
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '1.0.0'
    }
  });
  assert.equal(typeof handler.handle, 'function');
  handler.dispose();
});

test('worker starts only the integrity-checked LHM sidecar with a sanitized fixed contract', async () => {
  const calls = [];
  const child = new EventEmitter();
  child.pid = 4242;
  child.unref = () => {};
  const handler = createDefaultOperationHandler({
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '1.0.0'
    },
    spawnProcess: (filePath, args, options) => {
      calls.push({ filePath, args, options });
      process.nextTick(() => child.emit('spawn'));
      return child;
    }
  });
  const executablePath = path.join(
    process.cwd(),
    'resources',
    'monitoring',
    'LibreHardwareMonitor',
    'patched',
    'LibreHardwareMonitor.exe'
  );

  try {
    const result = await handler.handle('monitoring.startSidecar', { executablePath }, 15000);
    assert.deepEqual(result, { started: true, pid: 4242 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filePath, executablePath);
    assert.deepEqual(calls[0].args, ['--nova-headless']);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].options.env.LHM_HEADLESS, '1');
    assert.equal(calls[0].options.env.LHM_SKIP_PAWNIO_PROMPT, '1');
    assert.equal(calls[0].options.env.DOTNET_STARTUP_HOOKS, undefined);
    await assert.rejects(
      handler.handle('monitoring.startSidecar', { executablePath, arguments: ['--anything'] }, 15000),
      { code: 'ADMIN_BROKER_INVALID_PAYLOAD' }
    );
  } finally {
    handler.dispose();
  }
});

test('worker rejects app policies that are not in the optimization catalog', async () => {
  const handler = createDefaultOperationHandler({
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '1.0.0'
    }
  });
  try {
    await assert.rejects(
      handler.handle('apps.optimization.policy', {
        profileId: 'chrome',
        actionId: 'browser.untrustedPolicy',
        mode: 'apply'
      }, 30000),
      { code: 'ADMIN_BROKER_INVALID_PAYLOAD' }
    );
  } finally {
    handler.dispose();
  }
});

test('worker keeps an isolated tweak artifact until script execution completes', async () => {
  const content = 'param([string]$State, [switch]$Silent)';
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const signedPayload = {
    kind: 'nova-tweak-artifact',
    schemaVersion: 1,
    tweakId: 'broker_lifetime_test',
    artifactVersion: '1',
    scriptFileName: 'broker_lifetime_test.ps1',
    sha256,
    allowedActions: ['On'],
    allowedParameters: [],
    requiresAdmin: true,
    requiresReboot: false,
    minimumAppVersion: '',
    expiresAt: '',
    revoked: false
  };
  let executedPath = '';
  const handler = createDefaultOperationHandler({
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '1.0.0'
    },
    scriptRunnerFactory: ({ scriptsPath }) => ({
      runScript: async ({ scriptName }) => {
        executedPath = path.join(scriptsPath, scriptName);
        const requestRoot = path.dirname(scriptsPath);
        assert.equal(path.dirname(requestRoot), path.resolve(os.tmpdir()));
        assert.equal(fs.existsSync(executedPath), true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(fs.existsSync(executedPath), true);
        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
      }
    })
  });

  try {
    const result = await handler.handle('tweak.execute', {
      action: 'On',
      params: { State: 'On', Silent: true },
      allowUnsignedDevelopment: true,
      artifact: {
        ...signedPayload,
        signature: '',
        signedPayload,
        content
      }
    }, 30000);
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(executedPath), false);
  } finally {
    handler.dispose();
  }
});

test('packaged worker accepts a bundled tweak verified by the embedded local manifest', async () => {
  const tweakId = 'clear_clipboard_history';
  const scriptFileName = 'clear_clipboard_history.ps1';
  const content = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'resources', 'tweaks', 'scripts', tweakId, scriptFileName),
    'utf8'
  );
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const signedPayload = {
    kind: 'nova-tweak-artifact',
    schemaVersion: 1,
    tweakId,
    artifactVersion: 'bundled-1.0.0',
    scriptFileName,
    sha256,
    allowedActions: ['On'],
    allowedParameters: [],
    requiresAdmin: true,
    requiresReboot: false,
    minimumAppVersion: '',
    expiresAt: '',
    revoked: false
  };
  const handler = createDefaultOperationHandler({
    app: {
      isPackaged: true,
      getAppPath: () => process.cwd(),
      getVersion: () => '1.0.0'
    },
    scriptRunnerFactory: () => ({
      runScript: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' })
    })
  });

  try {
    const result = await handler.handle('tweak.execute', {
      action: 'On',
      params: { State: 'On', Silent: true },
      trustMode: 'bundled-integrity',
      artifact: {
        ...signedPayload,
        signature: '',
        signedPayload,
        content
      }
    }, 30000);
    assert.equal(result.ok, true);
  } finally {
    handler.dispose();
  }
});

test('game tuning refuses an unknown originating user before touching settings', async () => {
  const handler = createDefaultOperationHandler();
  try {
    await assert.rejects(handler.handle('game.configure', { executablePath: 'C:\\Games\\Example.exe' }), { code: 'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED' });
  } finally { handler.dispose(); }
});

test('game tuning refuses different administrator credentials', { skip: process.platform !== 'win32' }, async () => {
  const handler = createDefaultOperationHandler({ originUserSid: 'S-1-5-21-1-2-3-9999' });
  try {
    await assert.rejects(handler.handle('game.configure', { executablePath: 'C:\\Games\\Example.exe' }), { code: 'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED' });
  } finally { handler.dispose(); }
});
