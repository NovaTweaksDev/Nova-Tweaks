const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

// Exercise the actual IPC consumers without mounting charts or starting monitoring.
test('dashboard history counts measurements once and preserves history across offline status', async () => {
  const { shouldAppendMonitoringSample } = await import('../utils/monitoringDisplay.mjs');
  const source = read('Dashboard.jsx');
  let now = 100000;
  let consume;
  let state;
  const context = {
    HISTORY_LIMIT: 60, dashboardRuntimeCache: {},
    shouldAppendMonitoringSample: (sample, previous) => shouldAppendMonitoringSample(sample, previous, now),
    window: { desktopApi: { onMetricsUpdate: (handler) => { consume = handler; } } },
    setMetricsState: (update) => { state = update(state); }
  };
  vm.runInNewContext([
    between(source, 'function clampPercent(', 'function formatTime('),
    between(source, 'function normalizeTemperature(', 'function formatTemperature('),
    between(source, 'function normalizeMetrics(', 'const dashboardRuntimeCache ='),
    'setMetricsState(() => createInitialMetricsState());',
    `(() => {${between(source, '    const unsubscribe = window.desktopApi?.onMetricsUpdate?.', '\n  }, []);')}})();`
  ].join('\n'), context);
  const first = { sampleKind: 'measurement', sampleId: 1, measuredAt: now, cpuLoad: 0 };
  consume(first);
  consume(first);
  consume({ ...first, sampleKind: 'heartbeat', emittedAt: now + 1000 });
  assert.equal(state.history.cpu.length, 1);
  assert.equal(state.current.cpu, 0);
  consume({ sampleKind: 'status', monitoring: 'offline' });
  assert.equal(state.current.cpu, null);
  assert.equal(state.history.cpu.length, 1);
  now += 20000;
  consume({ ...first, sampleId: 2 });
  assert.equal(state.history.cpu.length, 1);
  consume({ ...first, measuredAt: now, sampleId: 3, cpuLoad: 40 });
  assert.equal(state.history.cpu.length, 2);
  assert.equal(state.current.cpu, 40);
});

test('overview consumer ignores duplicate and heartbeat histories while accepting status', async () => {
  const { shouldAppendMonitoringSample } = await import('../utils/monitoringDisplay.mjs');
  const source = read('OverviewPanel.jsx');
  const cache = { snapshot: null, lastMeasurement: null };
  const snapshots = [];
  const consume = vm.runInNewContext(`${between(source, '    function acceptSnapshot(', '    async function initializeMonitoring(')}\nacceptSnapshot;`, {
    disposed: false, overviewRuntimeCache: cache,
    shouldAppendMonitoringSample: (sample, previous) => shouldAppendMonitoringSample(sample, previous, 100000),
    setSnapshot: (sample) => snapshots.push(sample), setLoading() {}, setIpcError() {}
  });
  const first = { sampleKind: 'measurement', measuredAt: 100000, sampleId: 1, cpu: { history: [{ value: 50 }] } };
  consume(first);
  consume(first);
  consume({ ...first, sampleKind: 'heartbeat' });
  consume({ ...first, sampleId: 2, measuredAt: 99999 });
  assert.equal(snapshots.length, 1);
  consume({ sampleKind: 'status', measuredAt: null });
  assert.equal(snapshots.length, 2);
  assert.equal(cache.lastMeasurement.sampleId, 1);
});
