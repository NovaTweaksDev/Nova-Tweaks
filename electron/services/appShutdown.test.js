const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createAppShutdownHandler } = require('./appShutdown');
const { createGameSessionManager } = require('./gamemode/gameSessionManager');

test('window close starts shutdown before destruction and preserves close-to-tray behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf("  mainWindow.on('close', (event) => {");
  const end = source.indexOf("  mainWindow.on('closed',", start);
  assert.ok(start >= 0 && end > start);
  const calls = []; let close; let closeToTray = false;
  const context = {
    isQuitting: false,
    getCurrentSettings: () => ({ startupWindow: { closeToTray } }),
    ensureTray: () => calls.push('tray'),
    mainWindow: { on: (_name, handler) => { close = handler; }, hide: () => calls.push('hide') },
    app: { quit: () => calls.push('quit') }
  };
  vm.runInNewContext(source.slice(start, end), context);
  close({ preventDefault: () => calls.push('prevent-close') });
  assert.deepEqual(calls, ['prevent-close', 'quit']);
  calls.length = 0; closeToTray = true;
  close({ preventDefault: () => calls.push('prevent-close') });
  assert.deepEqual(calls, ['prevent-close', 'tray', 'hide']);
  calls.length = 0; context.isQuitting = true;
  close({ preventDefault: () => calls.push('prevent-close') });
  assert.deepEqual(calls, [], 'The final close after cleanup must proceed.');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(setImmediate);
const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

function fixture(services = {}, options = {}) {
  const warnings = [];
  const calls = [];
  let handler;
  const app = { quit: () => {
    calls.push('quit');
    const resumed = event();
    handler(resumed);
    assert.equal(resumed.prevented, false);
  } };
  handler = createAppShutdownHandler({ app, logger: { warn: (message, meta) => warnings.push({ message, ...meta }) },
    onBegin: () => calls.push('begin'), getServices: () => services, ...options });
  return { handler, warnings, calls };
}

test('one quit flow awaits all cleanup and keeps the broker available until the end', async () => {
  const display = deferred();
  const recording = deferred();
  const monitoring = deferred();
  const steps = [];
  const f = fixture({
    processWatcherService: { stop: () => steps.push('watcher') },
    extendedNetworkTestService: { cancel: () => steps.push('network') },
    scheduledMaintenanceService: { destroy: () => steps.push('maintenance') },
    displayProfileService: { shutdown: () => { steps.push('display'); return display.promise; } },
    gameSessionManager: { stopSession: (options) => {
      assert.equal(options.reason, 'app-quit');
      steps.push('recording');
      return recording.promise;
    } },
    monitoringManager: { shutdown: (options) => {
      assert.equal(options.ensureProcessStopped, true);
      steps.push('monitoring');
      return monitoring.promise;
    } },
    adminBrokerManager: { shutdown: () => steps.push('broker') }
  });
  const firstEvent = event();
  const stopped = f.handler(firstEvent);
  assert.equal(firstEvent.prevented, true);
  assert.deepEqual(f.calls, ['begin']);
  assert.equal(f.handler(event()), stopped);
  await flush();
  assert.deepEqual(steps, ['watcher', 'network', 'maintenance', 'display', 'recording', 'monitoring']);
  display.resolve();
  recording.resolve();
  await flush();
  assert.equal(steps.includes('broker'), false);
  assert.deepEqual(f.calls, ['begin']);
  monitoring.resolve({ sidecarStopped: true });
  await stopped;
  assert.equal(steps.at(-1), 'broker');
  assert.deepEqual(f.calls, ['begin', 'quit']);
  assert.deepEqual(f.warnings, []);
});

test('synchronous and asynchronous failures cannot skip other services or the broker', async () => {
  let brokerStops = 0;
  const f = fixture({
    processWatcherService: { stop() { throw new Error('Watcher failed'); } },
    displayProfileService: { shutdown: async () => { throw new Error('Display restore failed'); } },
    gameSessionManager: { stopSession: async () => { throw new Error('Report write failed'); } },
    monitoringManager: { shutdown: async () => ({ sidecarStopped: false }) },
    adminBrokerManager: { shutdown: () => { brokerStops += 1; throw new Error('Broker failed'); } }
  });
  await f.handler(event());
  assert.equal(brokerStops, 1);
  assert.deepEqual(f.calls, ['begin', 'quit']);
  assert.deepEqual(f.warnings.map((warning) => warning.step).sort(), ['admin-broker', 'display-profiles', 'game-session', 'monitoring', 'process-watcher']);
});

test('a hanging service and broker obey one total time budget and late failures are observed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const recording = deferred();
  const broker = deferred();
  let brokerStops = 0;
  const f = fixture({
    gameSessionManager: { stopSession: () => recording.promise },
    adminBrokerManager: { shutdown: () => { brokerStops += 1; return broker.promise; } }
  }, { timeoutMs: 100, brokerTimeoutMs: 20 });
  const stopped = f.handler(event());
  await flush();
  t.mock.timers.tick(79);
  await flush();
  assert.equal(brokerStops, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(brokerStops, 1);
  assert.deepEqual(f.calls, ['begin']);
  t.mock.timers.tick(19);
  await flush();
  assert.deepEqual(f.calls, ['begin']);
  t.mock.timers.tick(1);
  await stopped;
  assert.deepEqual(f.calls, ['begin', 'quit']);
  assert.deepEqual(f.warnings.map((warning) => warning.pendingSteps), [['game-session'], ['admin-broker']]);
  recording.reject(new Error('Late recording failure'));
  broker.reject(new Error('Late broker failure'));
  await flush();
  assert.equal(f.warnings.filter((warning) => warning.step).length, 2);
  assert.equal(brokerStops, 1);
  assert.deepEqual(f.calls, ['begin', 'quit']);
});

test('partial initialization and reentrant quit requests finish once and clear timeout handles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let handler;
  let begins = 0;
  const f = fixture({}, { onBegin: () => {
    begins += 1;
    handler(event());
  } });
  handler = f.handler;
  await handler(event());
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(begins, 1);
  assert.deepEqual(f.calls, ['quit']);
  assert.deepEqual(f.warnings, []);
});

test('the actual session report is saved after asynchronous capture stop and before quit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-quit-report-'));
  const captureStopped = deferred();
  let stopped = false;
  const captureService = {
    getAvailability: () => ({ available: true }), getStatus: () => ({ status: stopped ? 'stopped' : 'running' }),
    start: async () => ({ status: 'running' }),
    stop: async () => { await captureStopped.promise; stopped = true; },
    readSamples: () => stopped ? [{ fps: 120, frametimeMs: 8 }] : []
  };
  const manager = createGameSessionManager({ userDataPath: root, captureService });
  t.after(async () => {
    captureStopped.resolve();
    await manager.stopSession();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await manager.startSession({ game: { processId: process.pid, processName: 'node.exe', executablePath: process.execPath } });
  const sessionId = manager.getState().activeSession.sessionId;
  const reportPath = path.join(root, 'game-mode', 'sessions', `${sessionId}.json`);
  let brokerStopped = false;
  const f = fixture({ gameSessionManager: manager, adminBrokerManager: { shutdown: () => {
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).metrics.currentFps, 120);
    brokerStopped = true;
  } } });
  const quit = f.handler(event());
  await flush();
  assert.equal(fs.existsSync(reportPath), false);
  assert.equal(brokerStopped, false);
  assert.deepEqual(f.calls, ['begin']);
  captureStopped.resolve();
  await quit;
  assert.equal(brokerStopped, true);
  assert.deepEqual(f.calls, ['begin', 'quit']);
  assert.deepEqual(f.warnings, []);
});

test('main wires the shared handler and blocks callbacks from restarting monitoring or rules during quit', async () => {
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  const handlers = new Map();
  const calls = [];
  const context = {
    app: { on: (name, handler) => handlers.set(name, handler), quit: () => calls.push('quit') },
    createAppShutdownHandler, logger: { warn() {} }, isQuitting: false,
    clearInterval: () => calls.push('backup-timer'), automaticBackupTimer: 1,
    displayProfileService: { shutdown: async () => calls.push('display') },
    gameSessionManager: { stopSession: async () => calls.push('recording') },
    monitoringManager: { shutdown: async () => calls.push('monitoring'), stop: () => calls.push('monitoring-stop') },
    adminBrokerManager: { shutdown: () => calls.push('broker') },
    backgroundMinimizationService: null,
    processWatcherService: null, extendedNetworkTestService: null, scheduledMaintenanceService: null,
    pruneMetricsSubscribers() {}, pruneGameSessionSubscribers() {},
    advancedSensorMonitoringEnabled: true,
    ruleAutomationService: { handleGameState: () => assert.fail('No quit-time automation') }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("app.on('before-quit',"), source.indexOf("app.on('window-all-closed',")), context);
  const handler = handlers.get('before-quit');
  const quit = handler(event());
  assert.equal(context.isQuitting, true);
  const sync = source.slice(source.indexOf('async function syncMonitoringSubscriptionState()'), source.indexOf('function broadcastMetricsUpdate('));
  const game = source.slice(source.indexOf('function broadcastGameSessionUpdate('), source.indexOf('function broadcastProcessAutomationUpdate('));
  vm.runInContext(`${sync}\n${game}`, context);
  await context.syncMonitoringSubscriptionState();
  context.broadcastGameSessionUpdate({});
  await quit;
  assert.equal(calls[0], 'backup-timer');
  assert.ok(calls.includes('monitoring-stop'));
  assert.deepEqual(calls.slice(-2), ['broker', 'quit']);
});

test('Game Mode background restore finishes before administrator broker shutdown', async () => {
  const restored = deferred();
  let brokerStopped = false;
  const f = fixture({
    backgroundMinimizationService: { shutdown: () => restored.promise },
    adminBrokerManager: { shutdown: () => { brokerStopped = true; } }
  });
  const quit = f.handler(event());
  await flush();
  assert.equal(brokerStopped, false);
  restored.resolve({ ok: true });
  await quit;
  assert.equal(brokerStopped, true);
});
