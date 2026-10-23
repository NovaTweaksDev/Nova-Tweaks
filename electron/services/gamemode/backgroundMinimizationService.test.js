const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackgroundMinimizationService } = require('./backgroundMinimizationService');
const { createExecutionGate } = require('../tweaks/executionGate');
const { SERVICE_NAMES } = require('./backgroundServiceControl');

const state = (name, extra = {}) => ({ name, startType: 'Automatic', delayed: true, status: 'Running', dependents: [], ...extra });
function fixture(t, states = [state('WSearch')], extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-gamemode-background-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('nova-gamemode-background-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const journalPath = path.join(root, 'journal.json');
  const current = structuredClone(states);
  const calls = [];
  let appCalls = 0;
  const control = async (request) => {
    calls.push(request);
    if (request.action === 'read') return structuredClone(current);
    const item = current.find((entry) => entry.name === request.name);
    Object.assign(item, request.target);
    return { ok: true, state: structuredClone(item) };
  };
  const options = { journalPath, control, executionGate: createExecutionGate(), minimizeApps: async () => { appCalls++; return []; }, ...extra };
  const service = createBackgroundMinimizationService(options);
  return { service, current, calls, options, journalPath, get appCalls() { return appCalls; } };
}

test('saves every baseline before writes and restores exact startup, delayed flag and running state', async (t) => {
  const initial = [state('WSearch'), state('Spooler', { startType: 'Manual', delayed: false, status: 'Stopped' })];
  const f = fixture(t, initial);
  assert.equal((await f.service.prepare()).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journalPath)).entries.map((entry) => entry.original), initial);
  assert.equal(f.calls.filter((call) => call.action !== 'read').length, 0);
  assert.equal((await f.service.apply()).ok, true);
  assert.ok(f.current.every((item) => item.startType === 'Disabled' && item.status === 'Stopped'));
  assert.equal(f.appCalls, 1);
  assert.equal((await f.service.restore()).ok, true);
  assert.deepEqual(f.current, initial);
  assert.equal(f.service.getState().pendingRestore, false);
  const count = f.calls.length;
  await f.service.restore();
  assert.equal(f.calls.length, count);
});

test('missing and already disabled services are never written', async (t) => {
  const f = fixture(t, [state('Fax', { startType: 'Disabled', status: 'Stopped' })]);
  await f.service.prepare();
  assert.equal((await f.service.apply()).ok, true);
  assert.deepEqual(f.service.getState().entries, [{ name: 'Fax', phase: 'skipped', code: 'ALREADY_DISABLED' }]);
  await f.service.restore();
  assert.equal(f.calls.some((call) => call.action !== 'read'), false);
  const empty = fixture(t, []);
  await empty.service.prepare();
  assert.equal((await empty.service.apply()).ok, true);
});

test('the expanded service list round-trips exact original states and preserves older recovery journals', async (t) => {
  const initial = SERVICE_NAMES.map((name, index) => state(name, {
    startType: index % 3 === 0 ? 'Disabled' : index % 3 === 1 ? 'Manual' : 'Automatic',
    status: index % 3 === 0 ? 'Stopped' : 'Running', delayed: index % 2 === 0
  }));
  const f = fixture(t, initial);
  await f.service.prepare();
  assert.equal((await f.service.apply()).ok, true);
  assert.ok(f.current.every(item => item.startType === 'Disabled' && item.status === 'Stopped'));
  assert.equal((await f.service.restore()).ok, true);
  assert.deepEqual(f.current, initial);

  const older = fixture(t, [state('DiagTrack'), state('Fax'), state('XboxGipSvc')]);
  await older.service.prepare();
  await older.service.apply();
  const restarted = createBackgroundMinimizationService(older.options);
  assert.equal((await restarted.recover()).ok, true);
  assert.ok(older.current.every(item => item.startType === 'Automatic' && item.status === 'Running'));
});

test('running dependents cause partial completion and no app closures', async (t) => {
  const f = fixture(t, [state('Spooler', { dependents: ['OtherService'] })]);
  await f.service.prepare();
  const result = await f.service.apply();
  assert.equal(result.ok, false);
  assert.equal(result.state.entries[0].code, 'SERVICE_DEPENDENTS_RUNNING');
  assert.equal(f.appCalls, 0);
  assert.equal(f.calls.some((call) => call.action === 'disable'), false);
});

test('a failed change rolls back intermediate writes and still reports partial', async (t) => {
  const f = fixture(t);
  const control = f.options.control;
  f.options.control = async (request) => {
    if (request.action === 'disable') {
      f.current[0].status = 'Stopped';
      return { ok: false, code: 'SERVICE_CHANGE_FAILED', state: structuredClone(f.current[0]) };
    }
    return control(request);
  };
  const service = createBackgroundMinimizationService(f.options);
  await service.prepare();
  const result = await service.apply();
  assert.equal(result.ok, false);
  assert.equal(result.state.entries[0].phase, 'restored');
  assert.equal(f.current[0].status, 'Running');
  assert.equal(f.appCalls, 0);
});

test('external changes remain untouched, keep recovery pending and block activation', async (t) => {
  const f = fixture(t);
  await f.service.prepare(); await f.service.apply();
  f.current[0].startType = 'Manual';
  const result = await f.service.restore();
  assert.equal(result.ok, false);
  assert.equal(f.current[0].startType, 'Manual');
  assert.equal(result.state.entries[0].code, 'SERVICE_STATE_CONFLICT');
  assert.equal((await f.service.prepare()).code, 'GAME_MODE_RECOVERY_REQUIRED');
});

test('restart blocks new changes until crash recovery restores the durable baseline', async (t) => {
  const f = fixture(t);
  await f.service.prepare(); await f.service.apply();
  const restarted = createBackgroundMinimizationService(f.options);
  assert.equal((await restarted.prepare()).code, 'GAME_MODE_RECOVERY_REQUIRED');
  assert.equal((await restarted.recover()).ok, true);
  assert.equal(f.current[0].startType, 'Automatic');
  assert.equal(f.current[0].status, 'Running');
  assert.equal((await restarted.prepare()).ok, true);
});

test('recovers a process crash between stop and startup-type change', async (t) => {
  const f = fixture(t);
  await f.service.prepare();
  const journal = JSON.parse(fs.readFileSync(f.journalPath));
  journal.entries[0].phase = 'intent';
  journal.entries[0].expected = { startType: 'Disabled', delayed: true, status: 'Stopped' };
  fs.writeFileSync(f.journalPath, JSON.stringify(journal));
  f.current[0].status = 'Stopped';
  const restarted = createBackgroundMinimizationService(f.options);
  assert.equal((await restarted.recover()).ok, true);
  assert.equal(f.current[0].status, 'Running');
});

test('invalid recovery data and failed persistence prevent all system changes', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.journalPath, '{broken');
  const restarted = createBackgroundMinimizationService(f.options);
  assert.equal((await restarted.prepare()).code, 'GAME_MODE_JOURNAL_INVALID');
  assert.equal(f.calls.length, 0);
  const service = createBackgroundMinimizationService({ ...f.options, journalPath: path.join(f.journalPath, 'child') });
  assert.equal((await service.prepare()).ok, false);
  assert.equal(f.calls.some((call) => call.action !== 'read'), false);
});

test('duplicate operations are rejected and concurrency never exceeds three', async (t) => {
  const f = fixture(t, ['WSearch', 'DiagTrack', 'Spooler', 'Fax'].map((name) => state(name)));
  const control = f.options.control;
  let running = 0; let maximum = 0;
  const service = createBackgroundMinimizationService({ ...f.options, control: async (request) => {
    if (request.action === 'read') return control(request);
    running++; maximum = Math.max(maximum, running);
    await new Promise(setImmediate);
    const result = await control(request); running--; return result;
  } });
  await service.prepare();
  const applying = service.apply();
  assert.equal((await service.apply()).code, 'GAME_MODE_BACKGROUND_BUSY');
  await applying;
  assert.equal(maximum, 3);
});

test('apps that refuse to close produce a partial result and are not retried automatically', async (t) => {
  let calls = 0;
  const f = fixture(t, [], { minimizeApps: async () => { calls++; return [{ name: 'Chrome.exe', status: 'skipped', code: 'APP_STILL_RUNNING' }]; } });
  await f.service.prepare();
  assert.equal((await f.service.apply()).ok, false);
  assert.equal((await f.service.apply()).code, 'GAME_MODE_NOT_PREPARED');
  await f.service.restore();
  assert.equal(calls, 1);
});

test('an interrupted restore can complete after its startup type was already restored', async (t) => {
  const f = fixture(t);
  await f.service.prepare(); await f.service.apply();
  const data = JSON.parse(fs.readFileSync(f.journalPath));
  data.entries[0].phase = 'restoring';
  fs.writeFileSync(f.journalPath, JSON.stringify(data));
  f.current[0].startType = 'Automatic';
  const restarted = createBackgroundMinimizationService(f.options);
  assert.equal((await restarted.recover()).ok, true);
  assert.equal(f.current[0].status, 'Running');
});

test('shutdown waits for the running change, cancels app closures and restores services', async (t) => {
  const f = fixture(t);
  const control = f.options.control;
  let continueChange;
  const service = createBackgroundMinimizationService({ ...f.options, control: async (request) => {
    if (request.action === 'disable') await new Promise((resolve) => { continueChange = resolve; });
    return control(request);
  } });
  await service.prepare();
  const applying = service.apply();
  const shuttingDown = service.shutdown();
  assert.equal((await service.prepare()).code, 'GAME_MODE_SHUTTING_DOWN');
  continueChange();
  await applying;
  assert.equal((await shuttingDown).ok, true);
  assert.equal(f.appCalls, 0);
  assert.equal(f.current[0].status, 'Running');
  assert.equal(f.current[0].startType, 'Automatic');
});
