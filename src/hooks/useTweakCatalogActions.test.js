const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const catalog = [{ id: 'fast', currentState: 'disabled' }, { id: 'slow', currentState: 'disabled' }];
  const finished = deferred();
  const started = deferred();
  const single = deferred();
  const listeners = new Set();
  let tweaks = [];
  let pending = [];
  let refreshing = false;
  let calls = 0;
  let singleCalls = 0;
  let stateRequestId;
  const context = { window: { desktopApi: {
    checkTweakState: async () => { singleCalls += 1; return single.promise; },
    listTweaks: async (options) => {
      calls += 1;
      if (!options.includeState) return { ok: true, tweaks: catalog };
      stateRequestId = options.stateRequestId;
      started.resolve();
      return finished.promise;
    },
    onTweakStateUpdated: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  } } };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'useTweakCatalogActions.js'), 'utf8');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../utils/tweakState.mjs'), 'utf8').replaceAll('export function', 'function'), context);
  vm.runInContext(source.replace(/^import .*\n/, '').replace('export function', 'function'), context);
  const ref = (current) => ({ current });
  const actions = context.useTweakCatalogActions({
    tweakReloadBlockedUntilRef: ref(0), activeTweaksLoadRequestRef: ref(0), stateRefreshCounterRef: ref(0),
    activeStateRefreshRunRef: ref(0), activeTweaksRefreshPromiseRef: ref(null), stateChecksRef: ref({ pending: new Map(), versions: new Map() }),
    hasLoadedTweaksRef: ref(false), hasLoadedTweakStatesRef: ref(false), didBootstrapRef: ref(false),
    setIsRefreshingTweakStates: (value) => { refreshing = value; }, setIsLoadingTweaks: () => {},
    setTweaksError: () => {}, setTweakReloadBlockedUntil: () => {}, pushToast: () => {}, t: (key) => key,
    getStoredRebootPendingIds: () => ['fast'], getTweakRateLimitDelay: () => 0,
    normalizeTweakForUi: (value) => value, mergeTweakRuntimeState: context.mergeTweakState,
    requiresRendererTweakStateCheck: () => true,
    setTweaks: (update) => { tweaks = typeof update === 'function' ? update(tweaks) : update; },
    setCheckingStateTweakIds: (update) => { pending = typeof update === 'function' ? update(pending) : update; }
  });
  return {
    actions, finished, started, single,
    get singleCalls() { return singleCalls; },
    get tweaks() { return tweaks; }, get pending() { return Array.from(pending); },
    get refreshing() { return refreshing; }, get calls() { return calls; }, get listeners() { return listeners.size; },
    update(id, requestId = stateRequestId) {
      for (const listener of listeners) listener({ requestId, tweak: { id, currentState: 'enabled', checked: true, stateCheckStatus: 'verified' } });
    },
    disableFast() { tweaks = tweaks.map((item) => item.id === 'fast' ? { ...item, currentState: 'disabled' } : item); },
    finish() { finished.resolve({ ok: true, tweaks: catalog.map((item) => ({ ...item, currentState: 'enabled', checked: true, stateCheckStatus: 'verified' })) }); }
  };
}

test('unlocks completed tweaks before a slow check finishes and preserves subsequent user actions', async () => {
  const f = fixture();
  const refresh = f.actions.refreshTweaksTwoPhase();
  await f.started.promise;
  assert.deepEqual(f.pending, ['fast', 'slow']);
  f.update('fast', 'old-request');
  assert.deepEqual(f.pending, ['fast', 'slow']);
  f.update('fast');
  assert.deepEqual(f.pending, ['slow']);
  assert.equal(f.refreshing, true);
  assert.equal(f.tweaks[0].currentState, 'enabled');
  assert.equal(f.tweaks[0].rebootPending, true);
  f.disableFast();
  f.update('fast'); // Duplicate events must not overwrite a user action either.
  const duplicateRefresh = f.actions.refreshTweaksTwoPhase();
  assert.equal(f.calls, 2);
  f.finish();
  await Promise.all([refresh, duplicateRefresh]);
  assert.equal(f.tweaks[0].currentState, 'disabled');
  assert.equal(f.tweaks[1].currentState, 'enabled');
  assert.deepEqual(f.pending, []);
  assert.equal(f.refreshing, false);
  assert.equal(f.listeners, 0);
});

test('card and details retries share one check and cannot be overwritten by the catalog response', async () => {
  const f = fixture();
  const refresh = f.actions.refreshTweaksTwoPhase();
  await f.started.promise;
  f.update('fast');
  f.disableFast();
  const first = f.actions.retryTweakState(f.tweaks[0]);
  const second = f.actions.retryTweakState(f.tweaks[0]);
  assert.equal(f.singleCalls, 1);
  assert.equal(f.tweaks[0].stateCheckStatus, 'pending');
  assert.equal(f.tweaks[0].currentState, null);
  assert.equal(f.tweaks[0].lastConfirmedState.currentState, 'disabled');
  f.finish();
  await refresh;
  assert.deepEqual(f.pending, ['fast']);
  f.single.resolve({ ok: true, tweak: { id: 'fast', checked: true, stateCheckStatus: 'verified', currentState: 'disabled' } });
  await Promise.all([first, second]);
  assert.equal(f.tweaks[0].currentState, 'disabled');
  assert.equal(f.tweaks[0].stateCheckStatus, 'verified');
  assert.deepEqual(f.pending, []);
  assert.equal(f.tweaks[0].rebootPending, true);
});

test('a repeated failed single check remains locked and keeps the last confirmed values', async () => {
  const f = fixture();
  const refresh = f.actions.refreshTweaksTwoPhase();
  await f.started.promise;
  f.update('fast');
  f.finish();
  await refresh;
  const retry = f.actions.retryTweakState(f.tweaks[0]);
  f.single.resolve({ ok: false, code: 'SCRIPT_TIMEOUT' });
  await retry;
  assert.equal(f.tweaks[0].stateCheckStatus, 'failed');
  assert.equal(f.tweaks[0].currentState, null);
  assert.equal(f.tweaks[0].lastConfirmedState.currentState, 'enabled');
  assert.equal(f.tweaks[0].stateCheckError.code, 'SCRIPT_TIMEOUT');
  assert.deepEqual(f.pending, []);
});

test('failed refresh removes its listener and releases the loading state', async () => {
  const f = fixture();
  const refresh = f.actions.refreshTweaksTwoPhase();
  await f.started.promise;
  f.update('fast');
  f.finished.resolve({ ok: false, code: 'LOAD_FAILED' });
  await refresh;
  assert.equal(f.tweaks[0].currentState, 'enabled');
  assert.deepEqual(f.pending, []);
  assert.equal(f.refreshing, false);
  assert.equal(f.listeners, 0);
});

test('superseded refresh results and events cannot replace newer states', async () => {
  const f = fixture();
  const first = f.actions.loadTweaks({ includeState: true, background: true });
  const second = f.actions.loadTweaks({ includeState: true, background: true });
  f.update('fast', 'tweak-states-1');
  assert.equal(f.tweaks.length, 0);
  f.finish();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
  assert.equal(f.listeners, 0);
  assert.equal(f.refreshing, false);
});

