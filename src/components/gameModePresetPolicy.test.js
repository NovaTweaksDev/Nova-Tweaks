const assert = require('node:assert/strict');
const test = require('node:test');

const PRESET_DEFINITIONS = [
  { id: 'power_plan' },
  { id: 'clear_memory', stateful: false },
  { id: 'services' },
  { id: 'windows_game_mode' },
  { id: 'timer', params: { Resolution: '0.5' } },
  { id: 'set_dns_provider', params: { Selection: 'Cloudflare' } },
  { id: 'gpu_scheduling' }
];

function resolveTweaks(states = {}) {
  return PRESET_DEFINITIONS.map((presetDefinition) => ({
    presetDefinition,
    tweak: {
      id: presetDefinition.id,
      currentState: states[presetDefinition.id] || 'disabled'
    }
  }));
}

test('activation always schedules all seven preset actions', async () => {
  const { createPresetExecutionPlan } = await import('./gameModePresetPolicy.mjs');
  const plan = createPresetExecutionPlan({
    resolvedTweaks: resolveTweaks({
      power_plan: 'enabled',
      services: 'enabled',
      windows_game_mode: 'enabled'
    }),
    disableRequested: false
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.entries.length, 7);
  assert.deepEqual(plan.entries.map((entry) => entry.targetState), Array(7).fill('enabled'));
});

test('a click on an active preset starts a disabling toast with reversible steps', async () => {
  const { createPresetOperation } = await import('./gameModePresetPolicy.mjs');
  const operation = createPresetOperation({
    presetActive: true,
    presetDefinitions: PRESET_DEFINITIONS
  });

  assert.equal(operation.disableRequested, true);
  assert.equal(operation.statusLabelKey, 'gameMode.preset.disabling');
  assert.equal(operation.initialPresetDefinitions.length, 6);
  assert.equal(operation.initialPresetDefinitions.some((entry) => entry.stateful === false), false);
});

test('deactivation restores every stateful action and excludes the one-shot action', async () => {
  const { createPresetExecutionPlan } = await import('./gameModePresetPolicy.mjs');
  const resolvedTweaks = resolveTweaks();
  const restoreSnapshot = resolvedTweaks
    .filter(({ presetDefinition }) => presetDefinition.stateful !== false)
    .map(({ presetDefinition }, index) => ({
      id: presetDefinition.id,
      currentState: index % 2 === 0 ? 'enabled' : 'disabled',
      selectedOption: presetDefinition.id === 'set_dns_provider' ? 'Automatic (DHCP)' : ''
    }));
  const plan = createPresetExecutionPlan({ resolvedTweaks, disableRequested: true, restoreSnapshot });

  assert.equal(plan.ok, true);
  assert.equal(plan.entries.length, 6);
  assert.equal(plan.entries.some((entry) => entry.presetDefinition.id === 'clear_memory'), false);
  assert.deepEqual(
    plan.entries.map((entry) => entry.targetState),
    restoreSnapshot.map((entry) => entry.currentState)
  );
  assert.deepEqual(
    plan.entries.find((entry) => entry.presetDefinition.id === 'set_dns_provider').executionParams,
    { Selection: 'Automatic (DHCP)' }
  );
});

test('deactivation fails closed when the restore snapshot is incomplete', async () => {
  const { createPresetExecutionPlan } = await import('./gameModePresetPolicy.mjs');
  const plan = createPresetExecutionPlan({
    resolvedTweaks: resolveTweaks(),
    disableRequested: true,
    restoreSnapshot: [{ id: 'power_plan', currentState: 'disabled' }]
  });

  assert.deepEqual(plan, {
    ok: false,
    code: 'INCOMPLETE_RESTORE_SNAPSHOT',
    entries: []
  });
});

test('preset detection validates option and resolution values', async () => {
  const { isPresetTweakActive } = await import('./gameModePresetPolicy.mjs');

  assert.equal(isPresetTweakActive(
    { currentState: 'enabled', selectedOption: 'Cloudflare' },
    { expectedSelection: 'Cloudflare' }
  ), true);
  assert.equal(isPresetTweakActive(
    { currentState: 'enabled', currentResolution: '0,5' },
    { expectedResolution: '0.5' }
  ), true);
  assert.equal(isPresetTweakActive(
    { currentState: 'enabled', selectedOption: 'Automatic' },
    { expectedSelection: 'Cloudflare' }
  ), false);
});
