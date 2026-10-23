const test = require('node:test');
const assert = require('node:assert/strict');
const { registerTweakHandlers } = require('./tweakHandlers');

test('tweak listing sends completed states to its caller while other checks are pending', async () => {
  const handlers = new Map();
  const events = [];
  const pending = new Map();
  registerTweakHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    backendTweakCatalog: { listTweaks: () => [{ id: 'fast' }, { id: 'slow' }, { id: 'action' }] },
    isBlockedSecurityTweakId: () => false,
    requiresTweakStateCheck: (tweak) => tweak.id !== 'action',
    mapWithConcurrency: (items, limit, iteratee) => {
      assert.equal(limit, 3);
      return Promise.all(items.map(iteratee));
    },
    tweakRunner: { getCurrentState: ({ tweakId }) => new Promise((resolve, reject) => pending.set(tweakId, { resolve, reject })) },
    mergeTweakDetails: (tweak, state) => ({ ...tweak, ...state })
  });
  const sender = { isDestroyed: () => false, send: (channel, payload) => events.push({ channel, ...payload }) };
  const list = handlers.get('tweaks:list');
  const listing = list({ sender }, { stateRequestId: 'request-1' });
  pending.get('fast').resolve({ currentState: 'enabled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ channel: 'tweaks:state-updated', requestId: 'request-1', tweak: { id: 'fast', currentState: 'enabled' } }]);
  pending.get('slow').reject(new Error('unavailable'));
  const result = await listing;
  assert.equal(result.ok, true);
  assert.equal(events.length, 2);
  assert.equal(events[1].tweak.id, 'slow');
  assert.equal(result.tweaks.length, 3);
  assert.deepEqual(await list({ sender }, { includeState: false }), { ok: true, tweaks: [{ id: 'fast' }, { id: 'slow' }, { id: 'action' }] });
  assert.equal(events.length, 2);
});

test('single checks validate catalog ids, deduplicate reads and return structured detection errors', async () => {
  const handlers = new Map();
  let calls = 0;
  let fail;
  registerTweakHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    backendTweakCatalog: { listTweaks: () => [{ id: 'known' }, { id: 'action' }] },
    isBlockedSecurityTweakId: (id) => id === 'blocked',
    requiresTweakStateCheck: (tweak) => tweak.id !== 'action',
    tweakRunner: { getCurrentState: () => { calls += 1; return new Promise((_resolve, reject) => { fail = reject; }); } },
    mergeTweakDetails: (tweak, state) => ({ ...tweak, ...state })
  });
  const check = handlers.get('tweaks:check-state');
  for (const id of ['', '../known', 'blocked', 1, 'missing']) assert.equal((await check({}, { id })).ok, false);
  assert.equal((await check({}, { id: 'action' })).code, 'TWEAK_STATE_UNSUPPORTED');
  assert.equal(calls, 0);
  const first = check({}, { id: 'known' });
  const second = check({}, { id: 'known' });
  assert.equal(calls, 1);
  fail(Object.assign(new Error('Missing script'), { code: 'SCRIPT_NOT_FOUND' }));
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.tweak.id, 'known');
    assert.equal(result.tweak.currentState, null);
    assert.equal(result.tweak.checked, false);
    assert.equal(result.tweak.stateCheckStatus, 'failed');
    assert.equal(result.tweak.stateCheckError.code, 'SCRIPT_NOT_FOUND');
  }
});

test('scoped listing checks only requested catalog entries and keeps security filtering', async () => {
  const handlers = new Map();
  const checks = [];
  registerTweakHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    backendTweakCatalog: { listTweaks: () => [{ id: 'preset' }, { id: 'unrelated' }, { id: 'blocked' }, { id: 'action' }] },
    isBlockedSecurityTweakId: (id) => id === 'blocked',
    requiresTweakStateCheck: (tweak) => tweak.id !== 'action',
    mapWithConcurrency: (items, limit, iteratee) => {
      assert.equal(limit, 3);
      return Promise.all(items.map(iteratee));
    },
    tweakRunner: { getCurrentState: async ({ tweakId }) => {
      checks.push(tweakId);
      return { currentState: 'disabled', checked: true };
    } },
    mergeTweakDetails: (tweak, state) => ({ ...tweak, ...state })
  });
  const list = handlers.get('tweaks:list');
  const result = await list({}, { ids: [' preset ', 'preset', 'blocked', 'missing', 'action', null, 1] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tweaks.map((tweak) => tweak.id), ['preset', 'action']);
  assert.deepEqual(checks, ['preset']);
  assert.equal(result.tweaks[0].checked, true);

  assert.deepEqual(await list({}, { ids: [] }), { ok: true, tweaks: [] });
  assert.deepEqual(await list({}, { ids: ['unrelated'], includeState: false }), {
    ok: true, tweaks: [{ id: 'unrelated' }]
  });
  assert.deepEqual(checks, ['preset']);
});
