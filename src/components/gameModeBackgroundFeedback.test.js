const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const translations = require('../../locales/en.json');

const source = fs.readFileSync(path.join(__dirname, 'GameModePanel.jsx'), 'utf8');
const formatter = source.slice(source.indexOf('function formatBackgroundIncomplete('), source.indexOf('const POLL_INTERVAL_MS'));
const feedback = source.slice(source.indexOf("      let backgroundWarning = '';"), source.indexOf('      if (shouldDisablePreset && failedTweaks.length === 0)'));

function t(key, values = {}) {
  const text = key.split('.').reduce((value, part) => value?.[part], translations) || values.defaultValue || key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
}

function summarize(backgroundResult, { restoring = false, failures = [] } = {}) {
  return vm.runInNewContext(`${formatter}\n${feedback}\n({ backgroundWarning, progressSteps, failedTweaks });`, {
    backgroundResult, shouldDisablePreset: restoring, failedTweaks: [...failures],
    progressSteps: [{ id: 'power_plan', label: 'Power plan', status: 'success' }], t
  });
}

test('a tray-only Discord instance is identified as a warning while successful tweaks and services stay successful', () => {
  const result = summarize({ ok: false, code: 'GAME_MODE_BACKGROUND_PARTIAL', state: {
    entries: [{ name: 'WSearch', phase: 'changed' }, { name: 'DiagTrack', phase: 'changed' },
      { name: 'Spooler', phase: 'skipped', code: 'ALREADY_DISABLED' }],
    apps: [{ pid: 1, name: 'Discord.exe', status: 'skipped', code: 'APP_CLOSE_UNSUPPORTED' }]
  } });
  assert.equal(result.failedTweaks.length, 0);
  assert.match(result.backgroundWarning, /^Game Mode applied\./);
  assert.match(result.backgroundWarning, /Discord\.exe: Normal exit unavailable/);
  assert.equal(result.progressSteps.filter(step => step.status === 'success').length, 4);
  assert.equal(result.progressSteps.at(-1).status, 'warning');
});

test('a rolled-back service change remains an error and real preset failures are preserved', () => {
  const result = summarize({ ok: false, code: 'GAME_MODE_BACKGROUND_PARTIAL', state: {
    entries: [{ name: 'WSearch', phase: 'restored', code: 'SERVICE_CHANGE_FAILED' }], apps: []
  } }, { failures: ['DNS'] });
  assert.equal(result.failedTweaks[0], 'DNS');
  assert.equal(result.progressSteps.at(-1).status, 'error');
  assert.match(result.backgroundWarning, /WSearch: Change failed/);
});

test('successful minimization has no warning; genuine restoration failure remains a failure', () => {
  assert.equal(summarize({ ok: true, state: { entries: [], apps: [] } }).backgroundWarning, '');
  const result = summarize({ ok: false, code: 'GAME_MODE_RESTORE_INCOMPLETE', state: {
    entries: [{ name: 'WSearch', phase: 'conflict', code: 'SERVICE_STATE_CONFLICT' }], apps: []
  } }, { restoring: true });
  assert.equal(result.backgroundWarning, '');
  assert.equal(result.failedTweaks.length, 1);
  assert.match(result.failedTweaks[0], /GAME_MODE_RESTORE_INCOMPLETE/);
  assert.equal(result.progressSteps.at(-1).status, 'error');
});

async function refreshPreset({ tweaksActive = true, timerActive = true, catalogOk = true, phase = 'partial', entries = [] } = {}) {
  const { isPresetTweakActive } = await import('./gameModePresetPolicy.mjs');
  const refreshStart = source.indexOf('  async function refreshPresetState()');
  const refreshSource = source.slice(refreshStart, source.indexOf('  useEffect(', refreshStart));
  let message;
  let active;
  let tone;
  let needsRestore;
  const refresh = vm.runInNewContext(`${formatter}\n${refreshSource}\nrefreshPresetState;`, {
    window: { desktopApi: {
      getGameModeState: async () => ({ state: { restoreSnapshot: [{ id: 'power_plan' }] } }),
      getGameModeBackgroundState: async () => ({ state: { pendingRestore: true, phase, entries,
        apps: [{ name: 'Discord.exe', status: 'skipped', code: 'APP_CLOSE_UNSUPPORTED' }] } })
    } },
    setPresetActive: value => { active = value; }, setPresetTone: value => { tone = value; },
    setPresetNeedsRestore: value => { needsRestore = value; },
    loadPresetCatalog: async () => ({ ok: catalogOk, tweaks: [] }),
    resolvePresetTweaks: () => [
      { presetDefinition: { id: 'power_plan' }, tweak: { currentState: tweaksActive ? 'enabled' : 'disabled' } },
      { presetDefinition: { id: 'set_timer_resolution', expectedResolution: '0.5' },
        tweak: { currentState: timerActive ? 'enabled' : 'disabled', selectedResolution: '0.5' } }
    ],
    presetStateRefreshRunRef: { current: 0 },
    isPresetTweakActive, setPresetMessage: value => { message = value; }, t
  });
  const result = await refresh();
  return { active, needsRestore, message, tone, result };
}

test('reopening Game Mode retains the concrete Discord warning with verified active tweaks', async () => {
  const state = await refreshPreset();
  assert.equal(state.active, true);
  assert.equal(state.needsRestore, true);
  assert.equal(state.tone, 'warning');
  assert.match(state.message, /Discord\.exe: Normal exit unavailable/);
  assert.doesNotMatch(state.message, /restoration is pending/);
});

test('after reboot a missing timer disables Game Mode despite persisted restore snapshots', async () => {
  const state = await refreshPreset({ timerActive: false });
  assert.equal(state.active, false);
  assert.equal(state.result, false);
  assert.equal(state.needsRestore, true);
});

test('a stale preset check cannot overwrite a newer disabled result', async () => {
  const { isPresetTweakActive } = await import('./gameModePresetPolicy.mjs');
  const start = source.indexOf('  async function refreshPresetState()');
  const body = source.slice(start, source.indexOf('  useEffect(', start));
  let finishOld;
  let entered;
  const pending = new Promise((resolve) => { finishOld = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  let requests = 0;
  let active;
  const refresh = vm.runInNewContext(`${body}\nrefreshPresetState;`, {
    presetStateRefreshRunRef: { current: 0 },
    window: { desktopApi: { getGameModeState: async () => ({}), getGameModeBackgroundState: async () => ({}) } },
    setPresetNeedsRestore() {}, setPresetTone() {}, setPresetMessage() {},
    setPresetActive: (value) => { active = value; },
    loadPresetCatalog: async () => { if (++requests === 1) { entered(); return pending; } return { ok: false }; },
    resolvePresetTweaks: () => [{ tweak: { currentState: 'enabled' }, presetDefinition: {} }],
    isPresetTweakActive
  });
  const old = refresh();
  await started;
  await refresh();
  finishOld({ ok: true, tweaks: [] });
  await old;
  assert.equal(active, false);
});

test('failed tweaks, unavailable detection and service recovery never count as enabled', async () => {
  for (const options of [
    { tweaksActive: false }, { catalogOk: false }, { phase: 'prepared' }, { phase: 'recovery_required' },
    { entries: [{ name: 'WSearch', phase: 'restored', code: 'SERVICE_CHANGE_FAILED' }] }
  ]) {
    const state = await refreshPreset(options);
    assert.equal(state.active, false);
    assert.equal(state.needsRestore, true);
  }
});
