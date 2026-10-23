const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual renderer action without mounting Electron or changing Windows settings.
const source = fs.readFileSync(path.join(__dirname, 'App.jsx'), 'utf8');
const actionSource = source.slice(
  source.indexOf('  async function toggleTweak('),
  source.indexOf('  async function applyTimerResolution(')
);

function fixture({ results, confirm = true, approval = { ok: true }, api = 'runTweak', stateCheckStatus, currentState = 'disabled' }) {
  const calls = [];
  const logs = [];
  const executionStates = [];
  const tweak = { id: 'set_timer_resolution', name: 'Timer Resolution', containerType: 'timer_resolution', stateCheckStatus, currentState };
  let execution = {};
  let tweaks = [tweak];
  const context = {
    tweaksRef: { get current() { return tweaks; } },
    stateChecksRef: { current: { pending: new Map(), versions: new Map() } },
    isTweakStateBlocked: (item) => ['pending', 'failed'].includes(item.stateCheckStatus),
    window: { desktopApi: { [api]: async (payload) => {
      calls.push({ type: 'execute', payload });
      return results.shift();
    } } },
    t: (key) => key,
    i18n: { t: (key) => key },
    appSettings: {},
    systemDetection: {},
    isStatelessExecutionTweak: () => false,
    normalizeRequiresAdmin: () => true,
    normalizeRebootRequired: () => false,
    normalizeTweakState: (value) => value,
    normalizeResolutionString: (value) => value || '',
    normalizeOptionalNumber: () => null,
    getTweakCompatibilityState: () => ({ status: 'compatible' }),
    setExecution: (update) => {
      execution = typeof update === 'function' ? update(execution) : update;
      executionStates.push(execution.status);
    },
    setGlobalOperation: () => {},
    setTweaks: (update) => { tweaks = update(tweaks); },
    recordTweakActionLog: (_tweak, entry) => logs.push(entry),
    recordDashboardActivity: () => {},
    pushToast: () => {},
    ADMIN_ACCESS_DENIED_FEEDBACK_DELAY_MS: 0,
    waitForRendererDelay: async () => {},
    requestSettingsConfirmation: async () => {
      calls.push({ type: 'confirm' });
      return confirm;
    },
    handleRequestAdminRelaunch: async () => {
      calls.push({ type: 'approve' });
      return approval;
    }
  };
  const toggleTweak = vm.runInNewContext(`${actionSource}\ntoggleTweak;`, context);
  return { calls, logs, executionStates, getTweaks: () => tweaks,
    run: (options = {}, nextEnabled = true) => toggleTweak(tweak, nextEnabled, { params: { Resolution: '0.5' }, ...options }) };
}

for (const nextEnabled of [true, false]) {
  for (const currentState of ['enabled', 'disabled', undefined]) {
    test(`requested ${nextEnabled ? 'enabled' : 'disabled'}: return and central state honor ${currentState || 'missing result state'}`, async () => {
      const scriptResult = { ok: true, ...(currentState ? { currentState } : {}) };
      const f = fixture({ results: [scriptResult], currentState: nextEnabled ? 'disabled' : 'enabled' });
      const result = await f.run({}, nextEnabled);
      const expected = currentState || (nextEnabled ? 'enabled' : 'disabled');
      assert.equal(result.currentState, expected);
      assert.equal(f.getTweaks()[0].currentState, expected);
      assert.equal(f.getTweaks()[0].status, expected);
    });
  }
}

for (const api of ['runTweak', 'apiExecuteTweak', 'executeTweak']) {
  test(`${api}: applies the selected resolution after approval without recording an initial failure`, async () => {
    const f = fixture({ api, results: [
      { ok: false, code: 'ADMIN_BROKER_APPROVAL_REQUIRED' },
      { ok: true, currentState: 'enabled', currentResolution: '0.5' }
    ] });
    assert.equal((await f.run()).ok, true);
    assert.deepEqual(f.calls.map((call) => call.type), ['execute', 'confirm', 'approve', 'execute']);
    assert.deepEqual(f.calls[0].payload, f.calls[3].payload);
    assert.equal(f.calls[3].payload.params.Resolution, '0.5');
    assert.deepEqual(f.logs.map((entry) => entry.result), ['success']);
    assert.equal(f.executionStates.includes('error'), false);
    assert.equal(f.getTweaks()[0].selectedResolution, '0.5');
  });
}

for (const stateCheckStatus of ['pending', 'failed']) {
  test(`shared execution path rejects ${stateCheckStatus} checks, including silent bulk actions`, async () => {
    const f = fixture({ stateCheckStatus, results: [{ ok: true }] });
    const result = await f.run({ suppressNotifications: true });
    assert.equal(result.code, 'TWEAK_STATE_UNAVAILABLE');
    assert.equal(result.skipped, true);
    assert.equal(f.calls.length, 0);
  });
}

test('does not retry or loop when the second attempt still requires admin', async () => {
  const f = fixture({ results: Array(2).fill({ ok: false, code: 'ADMIN_REQUIRED' }) });
  assert.equal((await f.run()).code, 'ADMIN_REQUIRED');
  assert.equal(f.calls.filter((call) => call.type === 'execute').length, 2);
  assert.equal(f.calls.filter((call) => call.type === 'confirm').length, 1);
  assert.deepEqual(f.logs.map((entry) => entry.result), ['failed']);
});

test('does not execute again when the dialog is declined', async () => {
  const f = fixture({ confirm: false, results: [{ ok: false, code: 'ADMIN_REQUIRED' }] });
  assert.equal((await f.run()).ok, false);
  assert.deepEqual(f.calls.map((call) => call.type), ['execute', 'confirm']);
});

test('returns a cancelled UAC approval without retrying the tweak', async () => {
  const f = fixture({ approval: { ok: false, code: 'ADMIN_BROKER_CANCELLED' },
    results: [{ ok: false, code: 'ADMIN_BROKER_APPROVAL_REQUIRED' }] });
  assert.equal((await f.run()).code, 'ADMIN_BROKER_CANCELLED');
  assert.deepEqual(f.calls.map((call) => call.type), ['execute', 'confirm', 'approve']);
});

test('does not prompt or retry unrelated execution failures', async () => {
  const f = fixture({ results: [{ ok: false, code: 'SCRIPT_FAILED' }] });
  assert.equal((await f.run()).code, 'SCRIPT_FAILED');
  assert.deepEqual(f.calls.map((call) => call.type), ['execute']);
});

test('does not prompt for a silent batch action', async () => {
  const f = fixture({ results: [{ ok: false, code: 'ADMIN_BROKER_APPROVAL_REQUIRED' }] });
  assert.equal((await f.run({ suppressNotifications: true })).ok, false);
  assert.deepEqual(f.calls.map((call) => call.type), ['execute']);
});
