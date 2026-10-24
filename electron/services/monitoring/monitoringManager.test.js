const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function createFixture({ buildSnapshot = async () => ({}), fetchWithRetry = async () => ({}),
  fetchOnce = async () => {}, now = () => Date.now(), onMetrics = () => {},
  privilegedExecutor = () => assert.fail('Unexpected privileged operation'),
  execFile = (_file, args, _options, callback) => callback(null, args.includes('/FI') ? 'LibreHardwareMonitor.exe' : 'DisplayVersion REG_SZ 2.0', '')
} = {}) {
  const filename = require.resolve('./monitoringManager');
  const localRequire = createRequire(filename);
  let adminReady = false;
  let writes = 0;
  let probes = 0;
  let timers = 0;
  const activeTimers = new Map();
  const timerCallbacks = [];
  const mocks = {
    fs: {
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      readFileSync: () => '',
      writeFileSync: () => { writes += 1; }
    },
    child_process: {
      execFile,
      spawn: () => assert.fail('Unexpected direct process launch')
    },
    './monitoringIntegrity': { assertMonitoringRuntimeIntegrity() {}, runtimeRootForExecutable: () => 'runtime' },
    './lhmClient': { createLhmClient: () => ({
      fetchOnce: async () => { probes += 1; return fetchOnce(); }, fetchWithRetry
    }) },
    './metricsService': { createMetricsService: () => ({ normalize: () => ({}) }) },
    './overviewSnapshotService': { createOverviewSnapshotService: () => ({ buildSnapshot }) }
  };
  const sandbox = {
    Date: class extends Date { static now() { return now(); } },
    module: { exports: {} },
    require: (name) => mocks[name] || localRequire(name),
    process: { platform: 'win32', env: {}, cwd: () => 'C:/nova' },
    setTimeout, clearTimeout,
    setInterval: (callback) => {
      timers += 1;
      activeTimers.set(timers, callback);
      timerCallbacks.push(callback);
      return timers;
    }, clearInterval: (timer) => activeTimers.delete(timer)
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const manager = sandbox.module.exports.createMonitoringManager({
    onMetrics,
    isAdminProvider: () => false,
    isAdminAccessReady: () => adminReady,
    privilegedExecutor
  });
  return { manager, approve: () => { adminReady = true; }, getCounts: () => ({ writes, probes, timers }),
    activeTimerCount: () => activeTimers.size, timerCallbacks };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('refresh changes replace one polling timer, persist across stop/start and skip unchanged rates', async () => {
  const f = createFixture(); f.approve();
  await f.manager.start();
  const initial = f.getCounts().timers;
  assert.equal(f.manager.setRefreshRate(1000), 1000);
  assert.equal(f.activeTimerCount(), 1);
  assert.equal(f.getCounts().timers, initial + 1);
  f.manager.setRefreshRate(1000);
  assert.equal(f.getCounts().timers, initial + 1, 'Unrelated settings saves must not restart polling.');
  await f.manager.stop();
  assert.equal(f.activeTimerCount(), 0);
  await f.manager.start();
  assert.equal(f.activeTimerCount(), 1);
  const restarted = f.getCounts().timers;
  f.manager.setRefreshRate(1000);
  assert.equal(f.getCounts().timers, restarted, 'Restart retains the selected interval.');
  await f.manager.stop();
});

test('waiting for admin approval performs no sensor writes, probes or background polling', async () => {
  const fixture = createFixture();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(await fixture.manager.start(), false);
    assert.equal(fixture.manager.getLatest().code, 'ADMIN_BROKER_APPROVAL_REQUIRED');
  }
  assert.deepEqual(fixture.getCounts(), { writes: 0, probes: 0, timers: 0 });
  fixture.approve();
  assert.equal(await fixture.manager.start(), true);
  assert.equal(fixture.manager.getLatest().monitoring, 'online');
  assert.equal(fixture.getCounts().timers, 1);
});

test('approval during a failed initial snapshot retries after the pending start settles', async () => {
  let releaseSnapshot;
  let snapshotStarted;
  const pendingSnapshot = new Promise((resolve) => { releaseSnapshot = resolve; });
  const enteredSnapshot = new Promise((resolve) => { snapshotStarted = resolve; });
  let builds = 0;
  const fixture = createFixture({ buildSnapshot: async () => {
    builds += 1;
    if (builds === 1) { snapshotStarted(); await pendingSnapshot; }
    return {};
  } });
  const initialStart = fixture.manager.start();
  await enteredSnapshot;
  fixture.approve();
  const resumedStart = fixture.manager.start();
  releaseSnapshot();
  assert.equal(await initialStart, false);
  assert.equal(await resumedStart, true);
  assert.equal(fixture.getCounts().timers, 1);
  assert.equal(fixture.manager.getLatest().monitoring, 'online');
});


test('overlapping polls retain the last completed sample and slow enrichment preserves sensor time', async () => {
  let now = 100000;
  let releaseFetch;
  let releaseOverview;
  let fetchEntered;
  let overviewEntered;
  let delay = false;
  const fetched = new Promise((resolve) => { fetchEntered = resolve; });
  const enriched = new Promise((resolve) => { overviewEntered = resolve; });
  const events = [];
  const fixture = createFixture({ now: () => now, onMetrics: (sample) => events.push(sample),
    fetchWithRetry: async () => {
      if (delay) { fetchEntered(); await new Promise((resolve) => { releaseFetch = resolve; }); }
      return {};
    },
    buildSnapshot: async () => {
      if (delay) { overviewEntered(); await new Promise((resolve) => { releaseOverview = resolve; }); }
      return {};
    }
  });
  fixture.approve();
  await fixture.manager.start();
  const completed = fixture.manager.getLatest();
  assert.equal(completed.sampleId, 1);
  delay = true;
  const pending = fixture.manager.pollOnce();
  await fetched;
  now += 2000;
  const heartbeat = await fixture.manager.pollOnce();
  assert.equal(heartbeat.sampleKind, 'heartbeat');
  assert.equal(heartbeat.sampleId, completed.sampleId);
  assert.equal(heartbeat.timestamp, completed.timestamp);
  assert.equal(heartbeat.measuredAt, completed.measuredAt);
  assert.equal(heartbeat.emittedAt, now);
  assert.equal(fixture.manager.getLatest(), completed);
  releaseFetch();
  await enriched;
  const sensorTime = now;
  now += 20000;
  await fixture.manager.pollOnce();
  assert.equal(fixture.manager.getLatest(), completed);
  releaseOverview();
  const next = await pending;
  assert.equal(next.sampleId, 2);
  assert.equal(next.measuredAt, sensorTime);
  assert.equal(next.timestamp, sensorTime);
  assert.equal(next.overview.measuredAt, sensorTime);
  assert.equal(next.emittedAt, now);
  assert.equal(events.filter((sample) => sample.sampleKind === 'measurement').length, 2);
});

test('admin waiting publishes status rather than sensor evidence', async () => {
  const fixture = createFixture();
  await fixture.manager.start();
  assert.equal(fixture.manager.getLatest().sampleKind, 'status');
  assert.equal(fixture.manager.getLatest().measuredAt, null);
});

test('stop during initial fetch invalidates both successful and failed responses', async () => {
  for (const fail of [false, true]) {
    const entered = deferred();
    const response = deferred();
    const events = [];
    let fetches = 0;
    const fixture = createFixture({ onMetrics: (sample) => events.push(sample), fetchWithRetry: () => {
      fetches += 1;
      entered.resolve();
      return response.promise;
    } });
    fixture.approve();
    const initial = fixture.manager.getLatest();
    const started = fixture.manager.start();
    await entered.promise;
    fixture.manager.stop();
    fixture.manager.setRefreshRate(1000);
    if (fail) response.reject(new Error('Delayed sensor error'));
    else response.resolve({});
    assert.equal(await started, false);
    assert.equal(fixture.activeTimerCount(), 0);
    assert.equal(fixture.getCounts().timers, 0);
    assert.equal(fixture.manager.getLatest(), initial);
    assert.equal(events.length, 0);
    await fixture.manager.pollOnce();
    assert.equal(fetches, 1);
  }
});

test('stop during snapshot enrichment suppresses measurements and admin retry continuations', async () => {
  for (const adminReady of [false, true]) {
    const entered = deferred();
    const response = deferred();
    const events = [];
    const fixture = createFixture({ onMetrics: (sample) => events.push(sample), buildSnapshot: async () => {
      entered.resolve();
      return response.promise;
    } });
    if (adminReady) fixture.approve();
    const started = fixture.manager.start();
    await entered.promise;
    fixture.approve();
    const joinedStart = fixture.manager.start();
    fixture.manager.stop();
    response.resolve({});
    assert.equal(await started, false);
    assert.equal(await joinedStart, false);
    assert.equal(events.length, 0);
    assert.equal(fixture.activeTimerCount(), 0);
    assert.equal(fixture.getCounts().timers, 0);
  }
});

test('a fresh start waits for the cancelled initial query and publishes only its own result', async () => {
  const entered = deferred();
  const response = deferred();
  const events = [];
  let fetches = 0;
  const fixture = createFixture({ onMetrics: (sample) => events.push(sample), fetchWithRetry: () => {
    fetches += 1;
    if (fetches === 1) { entered.resolve(); return response.promise; }
    return {};
  } });
  fixture.approve();
  const oldStart = fixture.manager.start();
  await entered.promise;
  fixture.manager.stop();
  const newStart = fixture.manager.start();
  const joinedStart = fixture.manager.start();
  assert.equal(fixture.activeTimerCount(), 0);
  response.resolve({});
  assert.equal(await oldStart, false);
  assert.equal(await newStart, true);
  assert.equal(await joinedStart, true);
  assert.equal(fetches, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].sampleKind, 'measurement');
  assert.equal(fixture.activeTimerCount(), 1);
  assert.equal(fixture.getCounts().timers, 1);
});

test('stopped periodic work and queued interval callbacks cannot publish or affect a restart', async () => {
  const entered = deferred();
  const response = deferred();
  const events = [];
  let fetches = 0;
  const fixture = createFixture({ onMetrics: (sample) => events.push(sample), fetchWithRetry: () => {
    fetches += 1;
    if (fetches === 2) { entered.resolve(); return response.promise; }
    return {};
  } });
  fixture.approve();
  await fixture.manager.start();
  const initial = fixture.manager.getLatest();
  const oldCallback = fixture.timerCallbacks[0];
  const poll = fixture.manager.pollOnce();
  await entered.promise;
  fixture.manager.stop();
  oldCallback();
  assert.equal(events.length, 1);
  response.resolve({});
  await poll;
  assert.equal(fixture.manager.getLatest(), initial);
  assert.equal(fixture.activeTimerCount(), 0);
  await fixture.manager.start();
  const latest = fixture.manager.getLatest();
  oldCallback();
  assert.equal(fixture.manager.getLatest(), latest);
  assert.equal(fetches, 3);
  assert.equal(events.length, 2);
  assert.equal(fixture.activeTimerCount(), 1);
});

test('shutdown drains a periodic query, coalesces cleanup and releases a subsequent start', async () => {
  const entered = deferred();
  const response = deferred();
  const events = [];
  let fetches = 0;
  let kills = 0;
  const fixture = createFixture({ onMetrics: (sample) => events.push(sample), fetchWithRetry: () => {
    fetches += 1;
    if (fetches === 2) { entered.resolve(); return response.promise; }
    return {};
  }, execFile: (_file, args, _options, callback) => {
    if (args.includes('/F')) kills += 1;
    callback(null, args.includes('/FI') ? 'LibreHardwareMonitor.exe' : 'DisplayVersion REG_SZ 2.0', '');
  } });
  fixture.approve();
  await fixture.manager.start();
  const pendingPoll = fixture.manager.pollOnce();
  await entered.promise;
  let settled = false;
  const shutdown = fixture.manager.shutdown().then((result) => { settled = true; return result; });
  const joinedShutdown = fixture.manager.shutdown();
  const restarted = fixture.manager.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(kills, 0);
  assert.equal(fixture.activeTimerCount(), 0);
  assert.equal(fetches, 2);
  response.resolve({});
  await pendingPoll;
  assert.equal((await shutdown).sidecarStopped, true);
  assert.equal((await joinedShutdown).sidecarStopped, true);
  assert.equal(await restarted, true);
  assert.equal(kills, 1);
  assert.equal(fetches, 3);
  assert.deepEqual(events.map((sample) => sample.sampleKind), ['measurement', 'status', 'measurement']);
  assert.equal(fixture.activeTimerCount(), 1);
});

test('shutdown cleans up an in-flight sidecar launch even if its response fails', async () => {
  for (const fail of [false, true]) {
    const launchEntered = deferred();
    const launched = deferred();
    const events = [];
    let probes = 0;
    let fetches = 0;
    let kills = 0;
    const fixture = createFixture({
      onMetrics: (sample) => events.push(sample),
      fetchOnce: async () => { probes += 1; throw new Error('Not running'); },
      fetchWithRetry: async () => { fetches += 1; return {}; },
      privilegedExecutor: async (operation) => {
        assert.equal(operation, 'monitoring.startSidecar');
        launchEntered.resolve();
        return launched.promise;
      },
      execFile: (_file, args, _options, callback) => {
        if (args.includes('/F')) kills += 1;
        callback(null, 'DisplayVersion REG_SZ 2.0', '');
      }
    });
    fixture.approve();
    const started = fixture.manager.start();
    await launchEntered.promise;
    const shutdown = fixture.manager.shutdown({ ensureProcessStopped: true });
    assert.equal(kills, 1); // Cold-start cleanup precedes the launch.
    if (fail) launched.reject(new Error('Broker response lost'));
    else launched.resolve({ pid: 42 });
    assert.equal(await started, false);
    assert.equal((await shutdown).sidecarStopped, true);
    assert.equal(kills, 2);
    assert.equal(probes, 1);
    assert.equal(fetches, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].monitoring, 'offline');
    assert.equal(fixture.manager.getLatest(), events[0]);
    assert.equal(fixture.activeTimerCount(), 0);
  }
});

test('stop during endpoint probing prevents subsequent sidecar cleanup and launch', async () => {
  const entered = deferred();
  const response = deferred();
  const fixture = createFixture({
    fetchOnce: () => { entered.resolve(); return response.promise; },
    execFile: (_file, args, _options, callback) => {
      assert.equal(args.includes('/F'), false);
      callback(null, 'DisplayVersion REG_SZ 2.0', '');
    }
  });
  fixture.approve();
  const started = fixture.manager.start();
  await entered.promise;
  fixture.manager.stop();
  response.reject(new Error('Endpoint unavailable'));
  assert.equal(await started, false);
  assert.equal(fixture.activeTimerCount(), 0);
});

test('restart while a periodic query is pending waits and obtains a fresh measurement', async () => {
  const entered = deferred();
  const response = deferred();
  let fetches = 0;
  const events = [];
  const fixture = createFixture({ onMetrics: (sample) => events.push(sample), fetchWithRetry: () => {
    fetches += 1;
    if (fetches === 2) { entered.resolve(); return response.promise; }
    return {};
  } });
  fixture.approve();
  await fixture.manager.start();
  const pending = fixture.manager.pollOnce();
  await entered.promise;
  fixture.manager.stop();
  const restarted = fixture.manager.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 2);
  response.resolve({});
  await pending;
  assert.equal(await restarted, true);
  assert.equal(fetches, 3);
  assert.equal(events.length, 2);
  assert.equal(fixture.activeTimerCount(), 1);
});

test('a stop also cancels a start that is waiting for shutdown cleanup', async () => {
  const entered = deferred();
  let releaseKill;
  const fixture = createFixture({ execFile: (_file, args, _options, callback) => {
    if (args.includes('/F')) { entered.resolve(); releaseKill = callback; return; }
    callback(null, args.includes('/FI') ? 'LibreHardwareMonitor.exe' : 'DisplayVersion REG_SZ 2.0', '');
  } });
  fixture.approve();
  await fixture.manager.start();
  const shutdown = fixture.manager.shutdown();
  await entered.promise;
  const restarted = fixture.manager.start();
  fixture.manager.stop();
  releaseKill(null, '', '');
  await shutdown;
  assert.equal(await restarted, false);
  assert.equal(fixture.activeTimerCount(), 0);
  assert.equal(fixture.getCounts().timers, 1);
  assert.equal(fixture.manager.getLatest().monitoring, 'offline');
});

test('a concurrent explicit shutdown preserves its stronger process cleanup request', async () => {
  const entered = deferred();
  let releaseKill;
  let running = true;
  let kills = 0;
  let brokerStops = 0;
  const fixture = createFixture({
    execFile: (_file, args, _options, callback) => {
      if (args.includes('/F')) {
        kills += 1;
        if (kills === 1) { entered.resolve(); releaseKill = callback; return; }
        callback(new Error('Access denied'), '', 'Access denied');
        return;
      }
      callback(null, args.includes('/FI') ? (running ? 'LibreHardwareMonitor.exe' : '') : 'DisplayVersion REG_SZ 2.0', '');
    },
    privilegedExecutor: async (operation) => {
      assert.equal(operation, 'monitoring.stopSidecar');
      brokerStops += 1;
      running = false;
      return {};
    }
  });
  fixture.approve();
  await fixture.manager.start();
  const shutdown = fixture.manager.shutdown();
  await entered.promise;
  const explicitShutdown = fixture.manager.shutdown({ ensureProcessStopped: true });
  releaseKill(new Error('Access denied'), '', 'Access denied');
  assert.equal((await shutdown).sidecarStopped, true);
  assert.equal((await explicitShutdown).sidecarStopped, true);
  assert.equal(brokerStops, 1);
  assert.equal(fixture.activeTimerCount(), 0);
});
