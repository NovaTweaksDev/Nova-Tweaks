const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function createFixture({ buildSnapshot = async () => ({}) } = {}) {
  const filename = require.resolve('./monitoringManager');
  const localRequire = createRequire(filename);
  let adminReady = false;
  let writes = 0;
  let probes = 0;
  let timers = 0;
  const mocks = {
    fs: {
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      readFileSync: () => '',
      writeFileSync: () => { writes += 1; }
    },
    child_process: {
      execFile: (_file, _args, _options, callback) => callback(null, 'DisplayVersion REG_SZ 2.0', ''),
      spawn: () => assert.fail('Unexpected direct process launch')
    },
    './monitoringIntegrity': { assertMonitoringRuntimeIntegrity() {}, runtimeRootForExecutable: () => 'runtime' },
    './lhmClient': { createLhmClient: () => ({
      fetchOnce: async () => { probes += 1; }, fetchWithRetry: async () => ({})
    }) },
    './metricsService': { createMetricsService: () => ({ normalize: () => ({}) }) },
    './overviewSnapshotService': { createOverviewSnapshotService: () => ({ buildSnapshot }) }
  };
  const sandbox = {
    module: { exports: {} },
    require: (name) => mocks[name] || localRequire(name),
    process: { platform: 'win32', env: {}, cwd: () => 'C:/nova' },
    setTimeout, clearTimeout,
    setInterval: () => { timers += 1; return timers; }, clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const manager = sandbox.module.exports.createMonitoringManager({
    isAdminProvider: () => false,
    isAdminAccessReady: () => adminReady,
    privilegedExecutor: () => assert.fail('Unexpected privileged operation')
  });
  return { manager, approve: () => { adminReady = true; }, getCounts: () => ({ writes, probes, timers }) };
}

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
