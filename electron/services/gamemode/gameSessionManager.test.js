const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameSessionManager, averageLowestPercent, percentile } = require('./gameSessionManager');

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-session-'));
  try {
    const result = callback(directory);
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        fs.rmSync(directory, { recursive: true, force: true });
      });
    }
    fs.rmSync(directory, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test('calculates low FPS averages from the lowest real samples', () => {
  const fpsSamples = [144, 141, 138, 60, 120, 119, 118, 117, 116, 115];

  assert.equal(averageLowestPercent(fpsSamples, 10), 60);
  assert.equal(averageLowestPercent(fpsSamples, 20), 87.5);
});

test('calculates frametime percentiles deterministically', () => {
  const frametimes = [8, 9, 10, 11, 12, 20, 24, 30, 45, 60];

  assert.equal(percentile(frametimes, 95), 60);
  assert.equal(percentile(frametimes, 50), 12);
});

test('reads final PresentMon samples again after stopping capture', async () => withTempDirectory(async (directory) => {
  let stopped = false;
  let readCalls = 0;
  const captureService = {
    getAvailability: () => ({
      available: true,
      status: 'available',
      message: '',
      executablePath: 'PresentMon.exe'
    }),
    getStatus: () => ({
      status: stopped ? 'stopped' : 'running',
      message: '',
      executablePath: 'PresentMon.exe',
      outputCsvPath: path.join(directory, 'capture.csv'),
      running: !stopped
    }),
    start: async () => ({
      status: 'running',
      message: '',
      outputCsvPath: path.join(directory, 'capture.csv')
    }),
    stop: async () => {
      stopped = true;
      return captureService.getStatus();
    },
    readSamples: () => {
      readCalls += 1;
      return stopped
        ? [{ timestamp: Date.now(), fps: 120, frametimeMs: 8.3333 }]
        : [];
    }
  };
  const manager = createGameSessionManager({
    captureService,
    platform: 'win32',
    userDataPath: directory,
    totalMemoryBytesProvider: () => 32 * (1024 ** 3)
  });

  await manager.startSession({
    game: {
      gameName: 'Test Game',
      processName: 'node.exe',
      processId: process.pid,
      executablePath: process.execPath
    }
  });
  const report = await manager.stopSession();

  assert.equal(readCalls, 2);
  assert.equal(report.metrics.currentFps, 120);
  assert.equal(report.metrics.avgFrametimeMs, 8.33);
  assert.equal(report.systemMemoryTotalMB, 32768);
}));

test('hydrates total system memory for reports saved before the field existed', () => withTempDirectory((directory) => {
  const sessionsRoot = path.join(directory, 'game-mode', 'sessions');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  fs.writeFileSync(path.join(sessionsRoot, 'legacy-session.json'), JSON.stringify({
    schemaVersion: 1,
    sessionId: 'legacy-session',
    gameName: 'Legacy Game',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    sessionStatus: 'stopped',
    metrics: {}
  }));

  const manager = createGameSessionManager({
    userDataPath: directory,
    totalMemoryBytesProvider: () => 16 * (1024 ** 3)
  });
  const reports = manager.listReports();

  assert.equal(reports.length, 1);
  assert.equal(reports[0].systemMemoryTotalMB, 16384);
}));


test('session statistics admit each fresh measurement and network source only once', async () => withTempDirectory(async (directory) => {
  let now = 100000;
  const captureService = {
    getAvailability: () => ({ available: false }), getStatus: () => ({ status: 'unavailable' }),
    start: async () => ({ status: 'unavailable' }), stop: async () => ({}), readSamples: () => []
  };
  const manager = createGameSessionManager({ userDataPath: directory, captureService, nowProvider: () => now });
  const first = { sampleKind: 'measurement', sampleId: 1, measuredAt: now, timestamp: now, cpuLoad: 20,
    overview: { networkQuality: { latencyMs: 100, packetLossPercent: 10, lastChecked: new Date(now).toISOString() } } };
  manager.handleMetrics(first);
  await manager.startSession({ game: { gameName: 'Test Game', processName: 'node.exe', processId: process.pid, executablePath: process.execPath } });
  try {
    now += 1000;
    manager.handleMetrics(first);
    manager.handleMetrics({ ...first, sampleKind: 'heartbeat' });
    manager.handleMetrics({ ...first, sampleId: 2, measuredAt: 99999 });
    manager.handleMetrics({ cpuLoad: 90 });
    manager.handleMetrics({ ...first, sampleId: 2, measuredAt: now + 1 });
    manager.handleMetrics({ ...first, sampleId: 2, measuredAt: now, cpuLoad: 40 });
    let session = manager.getState().activeSession;
    assert.equal(session.history.cpu.length, 2);
    assert.equal(session.history.latency.length, 1);
    assert.equal(session.metrics.cpuAvgPercent, 30);
    now += 20000;
    manager.handleMetrics({ ...first, sampleId: 3 });
    manager.handleMetrics({ sampleKind: 'status', monitoring: 'offline' });
    assert.equal(session.history.cpu.length, 2);
    manager.handleMetrics({ ...first, sampleId: 4, measuredAt: now, cpuLoad: 60 });
    assert.equal(session.history.cpu.length, 3);
    assert.equal(session.history.latency.length, 1);
    now += 1000;
    manager.handleMetrics({ ...first, sampleId: 5, measuredAt: now, cpuLoad: 80,
      overview: { networkQuality: { latencyMs: 20, packetLossPercent: 0, lastChecked: new Date(now).toISOString() } } });
    session = manager.getState().activeSession;
    assert.equal(session.metrics.cpuAvgPercent, 50);
    assert.equal(session.metrics.avgLatencyMs, 60);
    assert.equal(session.metrics.packetLossPercent, 5);
    assert.equal(session.history.latency.length, 2);
  } finally {
    await manager.stopSession();
  }
}));

test('capture ticks update once, throttle live lows and finalize all frames exactly once', async (t) => withTempDirectory(async (directory) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100000 });
  let queue = [];
  let stopCalls = 0;
  let updates = 0;
  const captureService = {
    getAvailability: () => ({ available: true }), getStatus: () => ({ status: 'running' }),
    start: async () => ({ status: 'running' }),
    stop: async () => { stopCalls += 1; queue.push({ fps: 120, frametimeMs: 8 }); },
    readSamples: () => queue.splice(0)
  };
  const manager = createGameSessionManager({ userDataPath: directory, captureService, onUpdate: () => { updates += 1; } });
  const game = { processName: 'node.exe', processId: process.pid, executablePath: process.execPath };
  await manager.startSession({ game });
  try {
    queue.push({ fps: 60, frametimeMs: 16 });
    const before = updates;
    t.mock.timers.tick(500);
    assert.equal(updates, before + 1);
    assert.equal(manager.getState().activeSession.metrics.onePercentLow, 60);
    queue.push({ fps: 1, frametimeMs: 100 });
    t.mock.timers.tick(500);
    assert.equal(manager.getState().activeSession.metrics.currentFps, 1);
    assert.equal(manager.getState().activeSession.metrics.onePercentLow, 60);
    const stopped = manager.stopSession();
    const duplicate = manager.stopSession();
    const report = await stopped;
    assert.equal((await duplicate).sessionId, report.sessionId);
    assert.equal(stopCalls, 1);
    assert.equal(report.frameStatisticsScope, 'session');
    assert.equal(report.metrics.avgFps, 60.3);
    assert.equal(report.metrics.onePercentLow, 1);
    assert.equal(report.metrics.p99FrametimeMs, 100);
    assert.equal(report.metrics.stutterCount, 1);
    assert.deepEqual(fs.readdirSync(path.join(directory, 'game-mode', 'capture')), []);
    await manager.startSession({ game });
    queue.push({ fps: 240, frametimeMs: 4 });
    t.mock.timers.tick(500);
    assert.equal(manager.getState().activeSession.metrics.avgFps, 240);
    assert.equal(manager.getState().activeSession.metrics.onePercentLow, 240);
  } finally {
    await manager.stopSession();
  }
}));

test('failed temporary storage keeps the session stoppable and marks exact frame statistics unavailable', async () => withTempDirectory(async (directory) => {
  let frames = [{ fps: 100, frametimeMs: 10 }];
  const captureService = {
    getAvailability: () => ({ available: false }), getStatus: () => ({ status: 'unavailable' }),
    start: async () => ({ status: 'unavailable' }), stop: async () => ({}),
    readSamples: () => { const result = frames; frames = []; return result; }
  };
  const manager = createGameSessionManager({ userDataPath: directory, captureService });
  await manager.startSession({ game: { processId: process.pid, processName: 'node.exe', executablePath: process.execPath } });
  const captureRoot = path.join(directory, 'game-mode', 'capture');
  fs.rmdirSync(captureRoot);
  fs.writeFileSync(captureRoot, 'Simulated unavailable directory');
  const report = await manager.stopSession();
  assert.equal(report.frameStatisticsScope, 'unavailable');
  assert.equal(report.metrics.avgFps, 100);
  assert.equal(report.metrics.worstFrametimeMs, 10);
  assert.equal(report.metrics.onePercentLow, null);
  assert.equal(report.metrics.stutterCount, null);
  assert.ok(report.warnings.some((warning) => warning.includes('Exact frame statistics unavailable')));
  assert.equal(manager.isRecording(), false);
}));

test('failed capture shutdown releases statistics files and a retry preserves averages honestly', async () => withTempDirectory(async (directory) => {
  let frames = [{ fps: 100, frametimeMs: 10 }];
  let fail = true;
  const captureService = {
    getAvailability: () => ({ available: true }), getStatus: () => ({ status: 'running' }),
    start: async () => ({ status: 'running' }),
    stop: async () => { if (fail) throw new Error('Capture stop failed'); },
    readSamples: () => { const result = frames; frames = []; return result; }
  };
  const manager = createGameSessionManager({ userDataPath: directory, captureService });
  await manager.startSession({ game: { processId: process.pid, processName: 'node.exe', executablePath: process.execPath } });
  await assert.rejects(manager.stopSession(), /Capture stop failed/);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'game-mode', 'capture')), []);
  fail = false;
  const report = await manager.stopSession();
  assert.equal(report.frameStatisticsScope, 'unavailable');
  assert.equal(report.metrics.avgFps, 100);
  assert.equal(report.metrics.onePercentLow, null);
}));

test('existing retention removes expired statistics directories and preserves recent and unrelated data', () => withTempDirectory((directory) => {
  const captureRoot = path.join(directory, 'capture');
  fs.mkdirSync(captureRoot);
  const expired = path.join(captureRoot, '.nova-session-stats-abc123');
  const recent = path.join(captureRoot, '.nova-session-stats-def456');
  const unrelated = path.join(captureRoot, 'user-data');
  for (const entry of [expired, recent, unrelated]) fs.mkdirSync(entry);
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  fs.utimesSync(expired, old, old);
  fs.utimesSync(unrelated, old, old);
  const manager = createGameSessionManager({ userDataPath: directory, captureRoot,
    captureService: { getStatus: () => ({}), getAvailability: () => ({}) } });
  manager.listReports();
  assert.equal(fs.existsSync(expired), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(fs.existsSync(unrelated), true);
}));
