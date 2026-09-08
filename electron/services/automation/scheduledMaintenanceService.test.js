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
