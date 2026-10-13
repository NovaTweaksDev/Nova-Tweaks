const test = require('node:test');
const assert = require('node:assert/strict');
const { captureAutomaticTweakSnapshot } = require('./automaticBackupSnapshot');

test('captures restorable state and exact selected values', async () => {
  const section = await captureAutomaticTweakSnapshot([{ id: 'range', containerType: 'range_selection' }], {
    getCurrentState: async () => ({ checked: true, currentState: 'enabled', currentValue: 0, selectedOption: 'Option', selectedResolution: '0.5' })
  }, { strict: true });
  assert.equal(section.captureStatus, 'complete');
  assert.equal(section.data[0].currentState, 'enabled');
  assert.equal(section.data[0].currentValue, 0);
  assert.equal(section.data[0].selectedResolution, '0.5');
  assert.equal(section.data[0].selectedOption, 'Option');
});

test('never saves unverified detection fallbacks as disabled tweak states', async () => {
  const tweaks = [{ id: 'unavailable' }];
  const runner = { getCurrentState: async () => ({ checked: false, currentState: 'disabled' }) };
  await assert.rejects(captureAutomaticTweakSnapshot(tweaks, runner, { strict: true }), { code: 'BACKUP_STATE_UNAVAILABLE' });
  const section = await captureAutomaticTweakSnapshot(tweaks, runner);
  assert.equal(section.captureStatus, 'unavailable');
  assert.deepEqual(section.data, []);
});


test('omits missing slider values and preserves verified zero in partial automatic captures', async () => {
  const tweaks = [{ id: 'missing', containerType: 'range_selection' }, { id: 'zero', containerType: 'range_selection' }];
  const runner = { getCurrentState: async ({ tweakId }) => ({ checked: true, currentState: 'disabled', currentValue: tweakId === 'zero' ? 0 : null }) };
  const section = await captureAutomaticTweakSnapshot(tweaks, runner);
  assert.equal(section.captureStatus, 'partial');
  assert.deepEqual(section.data.map((entry) => entry.id), ['zero']);
  assert.equal(section.data[0].currentValue, 0);
  await assert.rejects(captureAutomaticTweakSnapshot(tweaks, runner, { strict: true }), { code: 'BACKUP_STATE_UNAVAILABLE' });
});
