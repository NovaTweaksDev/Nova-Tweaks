const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { createLineDecoder, encodeMessage, PROTOCOL_VERSION } = require('./adminBrokerProtocol');
const { AdminBrokerError, createAdminBrokerManager, quoteWindowsArgument } = require('./adminBrokerManager');

test('quotes Windows process arguments without splitting installed paths', () => {
  assert.equal(quoteWindowsArgument('plain'), 'plain');
  assert.equal(quoteWindowsArgument('C:\\Program Files\\Nova Tweaks\\NovaTweaks.exe'), '"C:\\Program Files\\Nova Tweaks\\NovaTweaks.exe"');
  assert.equal(quoteWindowsArgument(''), '""');
  assert.equal(quoteWindowsArgument('ends with space\\'), '"ends with space\\\\"');
});

function createFixture() {
  let launches = 0;
  let workerSocket = null;
  const states = [];
  const manager = createAdminBrokerManager({
    app: { isPackaged: false, getAppPath: () => process.cwd() },
    platform: 'win32',
    isAdminProvider: () => false,
    onStateChange: (state) => states.push(state),
    launchBroker: async ({ pipeName, brokerSessionId }) => {
      launches += 1;
      workerSocket = net.connect(pipeName);
      await new Promise((resolve, reject) => {
        workerSocket.once('connect', resolve);
        workerSocket.once('error', reject);
      });
      workerSocket.write(encodeMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION, sessionId: brokerSessionId }));
    }
  });
  return { manager, states, getLaunches: () => launches, getSocket: () => workerSocket };
}

test('shares one broker launch across simultaneous first requests', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.manager.shutdown());
  const [left, right] = await Promise.all([
    fixture.manager.ensureReady({ reason: 'first' }),
    fixture.manager.ensureReady({ reason: 'second' })
  ]);
  assert.equal(fixture.getLaunches(), 1);
  assert.equal(left.ready, true);
  assert.equal(right.sessionId, left.sessionId);
  assert.equal(fixture.manager.getState().status, 'ready');
});

test('does not prompt for a background request', async () => {
  const fixture = createFixture();
  await assert.rejects(
    fixture.manager.execute('tweak.execute', {}, { allowPrompt: false }),
    { code: 'ADMIN_BROKER_APPROVAL_REQUIRED' }
  );
  assert.equal(fixture.getLaunches(), 0);
});

test('correlates broker responses and returns their result', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.manager.shutdown());
  await fixture.manager.ensureReady();
  const workerSocket = fixture.getSocket();
  workerSocket.on('data', createLineDecoder((message) => {
    if (message.type === 'request') {
      workerSocket.write(encodeMessage({
        type: 'response',
        protocolVersion: PROTOCOL_VERSION,
        id: message.id,
        ok: true,
        result: { applied: true }
      }));
    }
  }, () => {}));
  const result = await fixture.manager.execute('network.applyMtu', { interfaceIndex: 4, mtu: 1500 });
  assert.deepEqual(result, { applied: true });
  assert.equal(fixture.manager.getState().pendingCount, 0);
});

test('reports unavailable outside Windows without launching', async () => {
  const manager = createAdminBrokerManager({ platform: 'linux' });
  assert.equal(manager.getState().status, 'unavailable');
  await assert.rejects(manager.ensureReady(), { code: 'ADMIN_BROKER_UNAVAILABLE' });
});

test('keeps the cancelled state and allows a later explicit retry', async () => {
  let launches = 0;
  const manager = createAdminBrokerManager({
    app: { isPackaged: false, getAppPath: () => process.cwd() },
    platform: 'win32',
    launchBroker: async () => {
      launches += 1;
      throw new AdminBrokerError('cancelled', 'ADMIN_BROKER_CANCELLED');
    }
  });
  await assert.rejects(manager.ensureReady(), { code: 'ADMIN_BROKER_CANCELLED' });
  assert.equal(manager.getState().status, 'cancelled');
  await assert.rejects(manager.ensureReady(), { code: 'ADMIN_BROKER_CANCELLED' });
  assert.equal(launches, 2);
  manager.shutdown();
});

test('delivers simultaneous operations to the worker in FIFO order', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.manager.shutdown());
  await fixture.manager.ensureReady();
  const received = [];
  fixture.getSocket().on('data', createLineDecoder((message) => {
    if (message.type !== 'request') return;
    received.push(message.operation);
    fixture.getSocket().write(encodeMessage({
      type: 'response',
      protocolVersion: PROTOCOL_VERSION,
      id: message.id,
      ok: true,
      result: { operation: message.operation }
    }));
  }, assert.fail));
  await Promise.all([
    fixture.manager.execute('network.applyMtu', { interfaceIndex: 1, mtu: 1500 }),
    fixture.manager.execute('network.resetMtu', { interfaceIndex: 1, mtu: 1400 }),
    fixture.manager.execute('monitoring.startSidecar', { executablePath: 'C:\\trusted\\LibreHardwareMonitor.exe' }),
    fixture.manager.execute('monitoring.stopSidecar', {})
  ]);
  assert.deepEqual(received, [
    'network.applyMtu',
    'network.resetMtu',
    'monitoring.startSidecar',
    'monitoring.stopSidecar'
  ]);
});

test('rejects an in-flight non-idempotent request after disconnect', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.manager.shutdown());
  await fixture.manager.ensureReady();
  const pending = fixture.manager.execute('apps.uninstall', { appId: 'machine-app', expectedScope: 'machine' });
  fixture.getSocket().destroy();
  await assert.rejects(pending, { code: 'ADMIN_BROKER_DISCONNECTED' });
  assert.equal(fixture.manager.getState().status, 'disconnected');
});

test('reports a worker startup error immediately instead of waiting for the session timeout', async () => {
  const manager = createAdminBrokerManager({
    app: { isPackaged: false, getAppPath: () => process.cwd() },
    platform: 'win32',
    launchBroker: async ({ pipeName, brokerSessionId }) => {
      const worker = net.connect(pipeName);
      await new Promise((resolve, reject) => {
        worker.once('connect', resolve);
        worker.once('error', reject);
      });
      worker.write(encodeMessage({
        type: 'startup-error',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: brokerSessionId,
        error: { code: 'ADMIN_BROKER_WORKER_FAILED', message: 'worker setup failed', details: {} }
      }));
    }
  });
  await assert.rejects(manager.ensureReady(), {
    code: 'ADMIN_BROKER_WORKER_FAILED',
    message: 'worker setup failed'
  });
  manager.shutdown();
});
