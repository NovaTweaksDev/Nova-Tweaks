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

test('reopening Game Mode retains the concrete Discord warning and the active restore snapshot', async () => {
  const refreshStart = source.indexOf('  async function refreshPresetState()');
  const refreshSource = source.slice(refreshStart, source.indexOf('  useEffect(', refreshStart));
  let message;
  let active;
  let tone;
  const refresh = vm.runInNewContext(`${formatter}\n${refreshSource}\nrefreshPresetState;`, {
    window: { desktopApi: {
      getGameModeState: async () => ({ state: { restoreSnapshot: [{ id: 'power_plan' }] } }),
      getGameModeBackgroundState: async () => ({ state: { pendingRestore: true, phase: 'partial', entries: [],
        apps: [{ name: 'Discord.exe', status: 'skipped', code: 'APP_CLOSE_UNSUPPORTED' }] } })
    } },
    setPresetActive: value => { active = value; }, setPresetTone: value => { tone = value; },
    setPresetMessage: value => { message = value; }, t
  });
  await refresh();
  assert.equal(active, true);
  assert.equal(tone, 'warning');
  assert.match(message, /Discord\.exe: Normal exit unavailable/);
  assert.doesNotMatch(message, /restoration is pending/);
});
