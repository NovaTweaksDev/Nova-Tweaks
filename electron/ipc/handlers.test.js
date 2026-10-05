const test = require('node:test');
const assert = require('node:assert/strict');
const { registerMonitoringHandlers } = require('./monitoringHandlers');
const { registerSettingsHandlers } = require('./settingsHandlers');
const { registerRestoreHandlers } = require('./restoreHandlers');
test('monitoring handlers keep reading live service state', async () => {
  const handlers = new Map(); let manager = null;
  registerMonitoringHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    get monitoringManager() { return manager; } });
  assert.equal((await handlers.get('metrics:get-latest')()).code, 'METRICS_NOT_READY');
  manager = { getLatest: () => ({ cpu: null }) };
  assert.deepEqual((await handlers.get('metrics:get-latest')()).metrics, { cpu: null });
});
test('settings mutations still apply runtime effects and return the persisted settings', async () => {
  const handlers = new Map(); let applied;
  registerSettingsHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    settingsService: { updateSettings: (patch) => patch }, applySettingsRuntimeEffects: (settings) => { applied = settings; } });
  const result = await handlers.get('settings:update')(null, { preferences: { theme: 'light' } });
  assert.equal(result.ok, true); assert.equal(result.settings, applied);
});
test('restore IPC returns structured service errors and uses only the selected identity', async () => {
  const handlers = new Map();
  registerRestoreHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    restoreService: { resume: async (id) => { assert.equal(id, 'job'); throw Object.assign(new Error('changed'), { code: 'RESTORE_SOURCE_CHANGED' }); } } });
  const result = await handlers.get('backup:restore:resume')(null, { id: 'job', script: 'ignored' });
  assert.deepEqual(result, { ok: false, code: 'RESTORE_SOURCE_CHANGED', message: 'changed' });
});
