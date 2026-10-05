const test = require('node:test');
const assert = require('node:assert/strict');
const { createRestoreService } = require('./restoreService');
const { createExecutionGate } = require('../tweaks/executionGate');
function fixture({ failAt, admin = false, checked = true, writeFailure, ensureAdmin } = {}) {
  const gate = createExecutionGate();
  const saved = new Map();
  const calls = [];
  const states = new Map();
  const configs = new Map(['a', 'b', 'c', 'd'].map((id) => [id, { id, containerType: 'normal_tweak', execution: { script: `${id}.ps1` } }]));
  const plan = { origin: 'nova', scope: ['tweakStates'], snapshot: {
    tweakStates: { captureStatus: 'complete', data: ['a', 'b', 'c', 'd'].map((id) => ({ id, currentState: 'enabled' })) }
  } };
  const journal = {
    async list() { return [...saved.values()].map((entry) => structuredClone(entry)); },
    async write(job) { if (writeFailure?.(job)) throw new Error('disk failure'); saved.set(job.id, structuredClone(job)); }
  };
  const dependencies = { executionGate: gate, journal,
    backupManager: { restoreBackup: async () => ({ restorePlan: structuredClone(plan) }) },
    tweakRunner: {
      getConfig: async (id) => configs.get(id),
      getExecutionRequirements: async () => ({ requiresAdmin: admin }),
      getCurrentState: async ({ tweakId }) => ({ checked, currentState: states.get(tweakId) || 'disabled' }),
      runTweak: async (request) => {
        const release = gate.enter(request.executionContext.restoreToken);
        try {
          calls.push(request.tweakId);
          if (request.tweakId === failAt) return { ok: false, code: 'SCRIPT_FAILED' };
          states.set(request.tweakId, request.targetState);
          return { ok: true };
        } finally { release(); }
      }
    }, settingsService: { updateSettings: (patch) => patch }, ensureAdmin
  };
  return { service: createRestoreService(dependencies), dependencies, calls, saved, states, plan, configs, gate };
}
async function finish(service, id) {
  for (let index = 0; index < 100; index += 1) {
    const job = await service.status(id);
    if (['completed', 'failed', 'interrupted'].includes(job.status)) return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Restore did not settle.');
}
test('stops after two successful changes and resumes by detecting completed target states', async () => {
  const f = fixture({ failAt: 'c' });
  const start = await f.service.start({ id: 'backup', scope: ['tweakStates'] });
  const failed = await finish(f.service, start.job.id);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(f.calls, ['a', 'b', 'c']);
  assert.deepEqual(failed.appliedScopes, []);
  assert.equal(failed.partial, true);
  assert.equal(f.saved.get(start.job.id).steps[0].status, 'completed');
  f.dependencies.tweakRunner.runTweak = async ({ tweakId, targetState }) => {
    f.calls.push(tweakId); f.states.set(tweakId, targetState); return { ok: true };
  };
  const restarted = createRestoreService(f.dependencies);
  await restarted.resume(start.job.id);
  const completed = await finish(restarted, start.job.id);
  assert.equal(completed.status, 'completed');
  assert.deepEqual(f.calls, ['a', 'b', 'c', 'c', 'd']);
  assert.deepEqual(completed.appliedScopes, ['tweakStates']);
});
test('UAC cancellation performs no changes and is recorded', async () => {
  const f = fixture({ admin: true, ensureAdmin: async () => ({ ok: false, code: 'ADMIN_BROKER_CANCELLED' }) });
  const { job } = await f.service.start({ id: 'backup' });
  const result = await finish(f.service, job.id);
  assert.equal(result.errors[0].code, 'ADMIN_BROKER_CANCELLED');
  assert.deepEqual(f.calls, []);
});
test('cannot execute a change if the started journal entry cannot be saved', async () => {
  const f = fixture({ writeFailure: (job) => job.steps.some((step) => step.status === 'started') });
  const { job } = await f.service.start({ id: 'backup' });
  assert.equal((await finish(f.service, job.id)).status, 'failed');
  assert.deepEqual(f.calls, []);
});
test('an unavailable detection fallback blocks restoration', async () => {
  const f = fixture({ checked: false });
  const { job } = await f.service.start({ id: 'backup' });
  assert.equal((await finish(f.service, job.id)).errors[0].code, 'RESTORE_STATE_UNAVAILABLE');
  assert.deepEqual(f.calls, []);
});
test('all entries are preflighted before settings or tweaks change', async () => {
  const f = fixture();
  f.dependencies.tweakRunner.getExecutionRequirements = async ({ tweakId }) => {
    if (tweakId === 'd') throw Object.assign(new Error('missing script'), { code: 'TWEAK_SCRIPT_MISSING' });
    return { requiresAdmin: false };
  };
  await assert.rejects(f.service.start({ id: 'backup' }), { code: 'TWEAK_SCRIPT_MISSING' });
  assert.deepEqual(f.calls, []);
});
test('rejects competing tweak and restore operations for the complete restore lifetime', async () => {
  const f = fixture({ admin: true, ensureAdmin: () => new Promise(() => {}) });
  await f.service.start({ id: 'backup' });
  assert.throws(() => f.gate.enter(), { code: 'SYSTEM_OPERATION_BUSY' });
  await assert.rejects(f.service.start({ id: 'other' }), { code: 'SYSTEM_OPERATION_BUSY' });
});
test('rejects a changed backup or execution configuration on resume', async () => {
  const f = fixture({ failAt: 'c' });
  const { job } = await f.service.start({ id: 'backup' });
  await finish(f.service, job.id);
  f.configs.get('a').execution.script = 'other.ps1';
  await assert.rejects(f.service.resume(job.id), { code: 'RESTORE_SOURCE_CHANGED' });
  assert.deepEqual(f.calls, ['a', 'b', 'c']);
});
test('marks a persisted in-flight step interrupted and checks its live state before replay', async () => {
  const f = fixture({ failAt: 'c' });
  const { job } = await f.service.start({ id: 'backup' });
  await finish(f.service, job.id);
  const persisted = f.saved.get(job.id);
  persisted.status = 'running'; persisted.steps[2].status = 'started';
  f.states.set('c', 'enabled');
  const restarted = createRestoreService(f.dependencies);
  assert.equal((await restarted.status(job.id)).status, 'interrupted');
  await restarted.resume(job.id);
  assert.equal((await finish(restarted, job.id)).status, 'completed');
  assert.deepEqual(f.calls, ['a', 'b', 'c', 'd']);
});
test('incomplete snapshots are rejected before any changes', async () => {
  const f = fixture(); f.plan.snapshot.tweakStates.captureStatus = 'failed';
  await assert.rejects(f.service.start({ id: 'backup' }), { code: 'INCOMPLETE_RESTORE_SNAPSHOT' });
  assert.deepEqual(f.calls, []);
});
test('restores language and theme through SettingsService', async () => {
  const f = fixture(); let patch;
  f.plan.scope = ['appSettings'];
  f.plan.snapshot.appSettings = { captureStatus: 'complete', data: { theme: 'light', language: 'de-DE', settings: { preferences: { theme: 'dark' } } } };
  f.dependencies.settingsService.updateSettings = (value) => { patch = value; return value; };
  const { job } = await f.service.start({ id: 'backup' });
  assert.equal((await finish(f.service, job.id)).status, 'completed');
  assert.deepEqual(patch.preferences, { theme: 'light', language: 'de' });
});

test('journal-supplied parameters are rebuilt from the verified backup on resume', async () => {
  const f = fixture({ failAt: 'c' });
  const { job } = await f.service.start({ id: 'backup' });
  await finish(f.service, job.id);
  f.saved.get(job.id).steps[2].params = { Value: 999 };
  const requests = [];
  f.dependencies.tweakRunner.runTweak = async (request) => { requests.push(request); f.states.set(request.tweakId, request.targetState); return { ok: true }; };
  const restarted = createRestoreService(f.dependencies);
  await restarted.resume(job.id);
  await finish(restarted, job.id);
  assert.deepEqual(requests[0].params, {});
});
test('restores a completed settings target again if the state changed after interruption', async () => {
  const f = fixture({ failAt: 'c' }); let preferences = { theme: 'dark' };
  f.plan.scope.unshift('appSettings');
  f.plan.snapshot.appSettings = { captureStatus: 'complete', data: { theme: 'light' } };
  f.dependencies.settingsService.getSettings = () => ({ preferences });
  f.dependencies.settingsService.updateSettings = (patch) => { preferences = patch.preferences; return patch; };
  const { job } = await f.service.start({ id: 'backup' });
  await finish(f.service, job.id);
  assert.equal(preferences.theme, 'light');
  preferences = { theme: 'dark' };
  await f.service.resume(job.id);
  await finish(f.service, job.id);
  assert.equal(preferences.theme, 'light');
});

test('a script success without the requested system state stops the restore', async () => {
  const f = fixture();
  f.dependencies.tweakRunner.runTweak = async ({ tweakId }) => { f.calls.push(tweakId); return { ok: true }; };
  const { job } = await f.service.start({ id: 'backup' });
  const result = await finish(f.service, job.id);
  assert.equal(result.errors[0].code, 'RESTORE_VERIFICATION_FAILED');
  assert.deepEqual(f.calls, ['a']);
});

test('real backup and settings managers preserve the backup format and persist restored preferences', async (t) => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { createBackupManager } = require('./backupManager');
  const { createSettingsService } = require('../settings/settingsService');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-restore-integration-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true }); });
  const app = { getPath: (name) => path.join(root, name) };
  const settings = createSettingsService({ app });
  const backups = createBackupManager({ app, dialog: { showOpenDialog() {}, showSaveDialog() {} }, getBackupRoot: () => path.join(root, 'backups'),
    windowsRestoreStateProvider: async () => ({ available: false, points: [] }) });
  const created = await backups.createBackup({ name: 'Preferences', scope: ['appSettings'],
    snapshot: { appSettings: { captureStatus: 'complete', data: { theme: 'light', language: 'de' } } } });
  const backup = created.backup;
  const service = createRestoreService({ backupManager: backups, settingsService: settings, tweakRunner: {},
    executionGate: createExecutionGate(), journalDirectory: path.join(root, 'restore-journal') });
  const { job } = await service.start({ id: backup.id, scope: ['appSettings'] });
  // Real fsync/rename may take longer than the in-memory fixture's event-loop turns.
  let result;
  for (let index = 0; index < 100; index += 1) {
    result = await service.status(job.id);
    if (['completed', 'failed'].includes(result.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(result.status, 'completed');
  const reloaded = createSettingsService({ app }).getSettings();
  assert.equal(reloaded.preferences.theme, 'light');
  assert.equal(reloaded.preferences.language, 'de');
  const storedPlan = (await backups.restoreBackup({ id: backup.id })).restorePlan;
  assert.match(storedPlan.backupHash, /^[a-f0-9]{64}$/);
});

test('partial scopes restore captured entries without claiming a complete scope', async () => {
  const f = fixture(); f.plan.snapshot.tweakStates.captureStatus = 'partial';
  const { job } = await f.service.start({ id: 'backup' });
  const result = await finish(f.service, job.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.deepEqual(result.appliedScopes, []);
  assert.equal(result.errors[0].code, 'RESTORE_SCOPE_INCOMPLETE');
  assert.deepEqual(f.calls, ['a', 'b', 'c', 'd']);
});
