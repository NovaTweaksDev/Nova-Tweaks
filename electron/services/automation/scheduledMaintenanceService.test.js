const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createScheduledMaintenanceService,
  getNextOccurrence,
  normalizeSchedule
} = require('./scheduledMaintenanceService');

function tempState(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-maintenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'state.json');
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createFixture(t, options = {}) {
  const service = createScheduledMaintenanceService({
    statePath: tempState(t), setIntervalProvider: () => ({ unref() {} }),
    clearIntervalProvider: () => {}, ...options
  });
  t.after(() => service.destroy());
  return service;
}

test('maintenance locks before asynchronous readiness checks and freezes the task selection', async (t) => {
  const readiness = deferred();
  const executed = [];
  const service = createFixture(t, {
    canRun: () => readiness.promise,
    executeTask: async (id) => { executed.push(id); return { ok: true }; }
  });
  service.updateSchedule({ tasks: ['cleanup', 'drive'] });
  const first = service.runNow();
  assert.equal((await service.runNow()).code, 'MAINTENANCE_RUNNING');
  service.updateSchedule({ tasks: ['app-cache'] });
  readiness.resolve({ ok: true });
  await first;
  assert.deepEqual(executed, ['cleanup', 'drive']);
  assert.equal(service.getState().history.length, 1);
});

test('maintenance releases its lock after readiness fails', async (t) => {
  let fail = true;
  const service = createFixture(t, {
    canRun: async () => { if (fail) throw new Error('Readiness unavailable'); return { ok: true }; },
    executeTask: async () => ({ ok: true })
  });
  await assert.rejects(service.runNow(), /Readiness unavailable/);
  fail = false;
  assert.equal((await service.runNow()).ok, true);
  assert.equal(service.getState().running, false);
});

test('a failed schedule save preserves the working file and cannot enable unsaved automation', async (t) => {
  const statePath = tempState(t);
  const service = createFixture(t, { statePath });
  service.updateSchedule({ enabled: false, tasks: ['cleanup'] });
  const before = fs.readFileSync(statePath, 'utf8');
  const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('File locked'); });
  assert.throws(() => service.updateSchedule({ enabled: true, tasks: ['drive'] }), /File locked/);
  assert.equal(service.getState().schedule.enabled, false);
  assert.deepEqual(service.getState().schedule.tasks, ['cleanup']);
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
  rename.mock.restore();
});

test('shutdown waits for pending readiness and prevents new maintenance work', async (t) => {
  const readiness = deferred();
  const service = createFixture(t, {
    canRun: () => readiness.promise,
    executeTask: async () => assert.fail('shutdown must prevent task execution')
  });
  const run = service.runNow();
  const stopped = service.destroy();
  readiness.resolve({ ok: true });
  assert.equal((await run).code, 'MAINTENANCE_STOPPED');
  await stopped;
  assert.equal((await service.runNow()).code, 'MAINTENANCE_STOPPED');
});

test('background readiness rejections are logged instead of escaping the timer', async (t) => {
  const statePath = tempState(t);
  const now = new Date(2026, 6, 27, 3, 5).getTime();
  fs.writeFileSync(statePath, JSON.stringify({ schedule: { enabled: true, frequency: 'daily', time: '03:00' } }));
  const warnings = [];
  const service = createFixture(t, {
    statePath, nowProvider: () => now,
    canRun: async () => { throw new Error('Readiness unavailable'); },
    logger: { warn: (...args) => warnings.push(args) }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getState().lastError, 'Readiness unavailable');
  assert.equal(warnings.length, 1);
});

test('normalizes maintenance schedules and removes unknown tasks', () => {
  assert.deepEqual(normalizeSchedule({
    enabled: true,
    frequency: 'daily',
    dayOfWeek: 99,
    time: '25:90',
    tasks: ['cleanup', 'unknown', 'cleanup', 'drive']
  }), {
    enabled: true,
    frequency: 'daily',
    dayOfWeek: 0,
    time: '03:00',
    tasks: ['cleanup', 'drive']
  });
});

test('calculates the next daily execution in local time', () => {
  const now = new Date(2026, 6, 27, 2, 0, 0).getTime();
  const next = getNextOccurrence({ enabled: true, frequency: 'daily', time: '03:00' }, now);
  assert.equal(next, new Date(2026, 6, 27, 3, 0, 0).getTime());
});

test('runs all selected tasks and stores a compact history entry', async (t) => {
  let currentTime = new Date(2026, 6, 27, 2, 0, 0).getTime();
  const executed = [];
  const service = createScheduledMaintenanceService({
    statePath: tempState(t),
    nowProvider: () => currentTime,
    setIntervalProvider: () => ({ unref() {} }),
    clearIntervalProvider: () => {},
    executeTask: async (taskId) => {
      executed.push(taskId);
      return { ok: true, summary: { taskId } };
    }
  });
  service.updateSchedule({ enabled: true, frequency: 'daily', time: '03:00', tasks: ['cleanup', 'app-cache'] });
  currentTime = new Date(2026, 6, 27, 3, 5, 0).getTime();
  await service.tick();
  const state = service.getState();
  assert.deepEqual(executed, ['cleanup', 'app-cache']);
  assert.equal(state.history[0].status, 'success');
  assert.equal(state.history[0].source, 'scheduled');
  assert.equal(state.history[0].successful, 2);
  service.destroy();
});

test('defers scheduled work while the system is busy', async (t) => {
  let currentTime = new Date(2026, 6, 27, 2, 0, 0).getTime();
  const service = createScheduledMaintenanceService({
    statePath: tempState(t),
    nowProvider: () => currentTime,
    setIntervalProvider: () => ({ unref() {} }),
    clearIntervalProvider: () => {},
    canRun: async () => ({ ok: false, code: 'GAME_ACTIVE' }),
    executeTask: async () => ({ ok: true })
  });
  service.updateSchedule({ enabled: true, frequency: 'daily', time: '03:00', tasks: ['cleanup'] });
  currentTime = new Date(2026, 6, 27, 3, 1, 0).getTime();
  await service.tick();
  const state = service.getState();
  assert.equal(state.history.length, 0);
  assert.equal(state.deferredUntil, currentTime + 15 * 60 * 1000);
  service.destroy();
});

test('marks admin-blocked maintenance as waiting and notifies only once', async (t) => {
  let currentTime = new Date(2026, 6, 27, 2, 0, 0).getTime();
  let notices = 0;
  const service = createScheduledMaintenanceService({
    statePath: tempState(t),
    nowProvider: () => currentTime,
    setIntervalProvider: () => ({ unref() {} }),
    clearIntervalProvider: () => {},
    canRun: async () => ({ ok: false, code: 'ADMIN_BROKER_APPROVAL_REQUIRED' }),
    onAdminRequired: () => { notices += 1; },
    executeTask: async () => assert.fail('blocked maintenance must not execute')
  });
  service.updateSchedule({ enabled: true, frequency: 'daily', time: '03:00', tasks: ['cleanup'] });
  currentTime = new Date(2026, 6, 27, 3, 1, 0).getTime();
  await service.tick();
  assert.equal(service.getState().blockedReason, 'awaitingAdmin');
  assert.equal(service.getState().history.length, 0);
  currentTime += 16 * 60 * 1000;
  await service.tick();
  assert.equal(notices, 1);
  service.destroy();
});
