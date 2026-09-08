const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  calculateAdaptiveMemoryThresholdMB,
  createProcessWatcherService,
  isProtectedProcess
} = require('./processWatcherService');

function createSettings(overrides = {}) {
  return {
    automation: {
      processDetection: {
        enabled: true,
        cpuEnabled: true,
        cpuThresholdPercent: 35,
        cpuDurationSeconds: 20,
        memoryEnabled: true,
        memoryThresholdMB: 2048,
        memoryDurationSeconds: 30,
        diskEnabled: true,
        diskThresholdMBs: 75,
        diskDurationSeconds: 20,
        notRespondingEnabled: true,
        notRespondingDurationSeconds: 15,
        cooldownMinutes: 15,
        excludedExecutables: [],
        ...overrides
      }
    }
  };
}

function createProcess(overrides = {}) {
  return {
    name: 'sample-app',
    pid: 4242,
    startTime: new Date(1_000).toISOString(),
    executablePath: 'C:\\Apps\\sample-app.exe',
    cpuPercent: 60,
    ramMB: 500,
    diskMBs: 0,
    responding: true,
    mainWindowHandle: 10,
    ...overrides
  };
}

test('calculates a bounded adaptive memory threshold', () => {
  assert.equal(calculateAdaptiveMemoryThresholdMB(8 * 1024 ** 3), 2048);
  assert.equal(calculateAdaptiveMemoryThresholdMB(16 * 1024 ** 3), 3277);
  assert.equal(calculateAdaptiveMemoryThresholdMB(64 * 1024 ** 3), 4096);
});

test('protects critical Windows and Nova processes', () => {
  assert.equal(isProtectedProcess({ name: 'lsass', pid: 500 }), true);
  assert.equal(isProtectedProcess({ name: 'NovaTweaks', pid: 600 }), true);
  assert.equal(isProtectedProcess({ name: 'notepad', pid: 700 }, 999), false);
});

test('requires sustained CPU usage before creating one alert', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-process-watch-'));
  let now = 60_000;
  const service = createProcessWatcherService({
    historyPath: path.join(tempRoot, 'history.json'),
    getSettings: () => createSettings(),
    nowProvider: () => now,
    snapshotProvider: async () => [createProcess()]
  });

  await service.pollOnce();
  now += 19_000;
  await service.pollOnce();
  assert.equal(service.getState().currentAlerts.length, 0);

  now += 1_000;
  await service.pollOnce();
  assert.equal(service.getState().currentAlerts.length, 1);
  assert.equal(service.getState().currentAlerts[0].metric, 'cpu');

  now += 30_000;
  await service.pollOnce();
  assert.equal(service.getState().currentAlerts.length, 1);
});

test('suppresses CPU alerts for the active detected game', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-process-watch-'));
  let now = 60_000;
  const service = createProcessWatcherService({
    historyPath: path.join(tempRoot, 'history.json'),
    getSettings: () => createSettings(),
    getActiveGame: () => ({ processId: 4242 }),
    nowProvider: () => now,
    snapshotProvider: async () => [createProcess()]
  });

  await service.pollOnce();
  now += 30_000;
  await service.pollOnce();
  assert.equal(service.getState().currentAlerts.length, 0);
});

test('offers force termination only after graceful close leaves the process running', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-process-watch-'));
  let now = 60_000;
  const service = createProcessWatcherService({
    historyPath: path.join(tempRoot, 'history.json'),
    getSettings: () => createSettings({ cpuDurationSeconds: 10 }),
    nowProvider: () => now,
    snapshotProvider: async () => [createProcess()],
    actionProvider: async (_processInfo, force) => ({ ok: true, stillRunning: !force })
  });

  await service.pollOnce();
  now += 10_000;
  await service.pollOnce();
  const alert = service.getState().currentAlerts[0];
  const closeResult = await service.requestClose(alert.id);
  assert.equal(closeResult.ok, true);
  assert.equal(service.getState().currentAlerts[0].forceAvailable, true);

  const forceResult = await service.forceTerminate(alert.id);
  assert.equal(forceResult.ok, true);
  assert.equal(service.getState().currentAlerts.length, 0);
  assert.equal(service.getState().history[0].status, 'force-closed');
});
