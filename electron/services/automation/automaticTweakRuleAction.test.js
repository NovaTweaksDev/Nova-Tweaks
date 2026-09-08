const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAutomaticTweakParams,
  executeAutomaticTweakRuleAction
} = require('./automaticTweakRuleAction');

function createFixture({ action, localConfig, remoteConfig = localConfig, backupResult = { ok: true } }) {
  const calls = [];
  const tweakRunner = {
    getConfig: async () => remoteConfig,
    runTweak: async (payload) => {
      calls.push(payload);
      return { ok: true };
    }
  };
  const execution = {
    id: 'execution-1',
    ruleId: 'rule-1',
    action
  };

  return {
    calls,
    execution,
    tweakRunner,
    tweakCatalog: { getConfigById: () => localConfig },
    createBackup: async () => backupResult
  };
}

test('administrator-ready rules run without another execution or UAC prompt', async () => {
  const fixture = createFixture({ action: { type: 'runTweak', tweakId: 'game-mode' }, localConfig: { container_type: 'normal_tweak' } });
  fixture.isAdminAccessReady = () => true;
  fixture.tweakRunner.getExecutionRequirements = async () => ({ requiresAdmin: true });
  const result = await executeAutomaticTweakRuleAction(fixture);
  assert.equal(result.ok, true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].executionContext.allowPrompt, false);
});

test('preserves a zero range recommendation and rejects missing values', () => {
  assert.deepEqual(buildAutomaticTweakParams({ container_type: 'range_selection', range: { recommendedValue: 0 } }, {}), { Value: 0 });
  assert.equal(buildAutomaticTweakParams({ container_type: 'range_selection', range: {} }, {}), null);
});

test('keeps confirmation-required tweaks pending unless the rule explicitly bypasses confirmation', async () => {
  const fixture = createFixture({
    action: { type: 'runTweak', tweakId: 'game-mode' },
    localConfig: { container_type: 'normal_tweak' }
  });

  const result = await executeAutomaticTweakRuleAction(fixture);

  assert.equal(result.handled, false);
  assert.equal(fixture.calls.length, 0);
});

test('executes a confirmation-bypassed selection with the exact stored target', async () => {
  const fixture = createFixture({
    action: {
      type: 'runTweak',
      tweakId: 'tcp-auto-tuning',
      tweakTargetValue: 'Restricted',
      bypassConfirmation: true
    },
    localConfig: {
      container_type: 'one_shot_selection',
      selections: ['Normal', 'Restricted', 'Disabled']
    }
  });

  const result = await executeAutomaticTweakRuleAction(fixture);

  assert.equal(result.handled, true);
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.calls[0].params, { Selection: 'Restricted' });
});

test('keeps timer resolution automatic without a bypass flag', async () => {
  const fixture = createFixture({
    action: {
      type: 'runTweak',
      tweakId: 'set-timer-resolution',
      tweakTargetValue: '0.5'
    },
    localConfig: { container_type: 'timer_resolution' }
  });
  fixture.tweakRunner.runTweak = async (payload) => {
    fixture.calls.push(payload);
    return {
      ok: true,
      currentState: 'enabled',
      selectedResolution: '0.5',
      currentResolution: '0.5'
    };
  };

  const result = await executeAutomaticTweakRuleAction(fixture);

  assert.equal(result.handled, true);
  assert.deepEqual(fixture.calls[0].params, { Resolution: '0.5' });
  assert.deepEqual(result.tweakState, {
    tweakId: 'set-timer-resolution',
    currentState: 'enabled',
    status: 'enabled',
    selectedResolution: '0.5',
    currentResolution: '0.5',
    selectedOption: '',
    currentValue: null
  });
});

test('does not execute when the configured safety backup fails', async () => {
  const fixture = createFixture({
    action: {
      type: 'runTweak',
      tweakId: 'game-mode',
      bypassConfirmation: true
    },
    localConfig: { container_type: 'normal_tweak' },
    backupResult: { ok: false, code: 'BACKUP_FAILED', message: 'Backup failed.' }
  });

  const result = await executeAutomaticTweakRuleAction(fixture);

  assert.equal(result.handled, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BACKUP_FAILED');
  assert.equal(fixture.calls.length, 0);
});

test('builds a numeric range parameter from the stored rule target', () => {
  assert.deepEqual(buildAutomaticTweakParams({
    container_type: 'range_selection',
    range: { parameter: 'Value', min: 0, max: 100, recommended_value: 62 }
  }, {
    tweakTargetValue: '75'
  }), {
    Value: 75
  });
});

test('keeps an automatic action pending when an explicit UAC prompt is cancelled', async () => {
  const fixture = createFixture({
    action: { type: 'runTweak', tweakId: 'admin-tweak', bypassConfirmation: true },
    localConfig: { container_type: 'normal_tweak' }
  });
  fixture.tweakRunner.runTweak = async () => {
    const error = new Error('cancelled');
    error.code = 'ADMIN_BROKER_CANCELLED';
    throw error;
  };
  const result = await executeAutomaticTweakRuleAction({ ...fixture, allowAdminPrompt: true });
  assert.equal(result.pendingAdmin, true);
  assert.equal(result.code, 'ADMIN_BROKER_CANCELLED');
});

test('reports the verified current timer value instead of preserving a requested fake success', async () => {
  const fixture = createFixture({
    action: {
      type: 'runTweak',
      tweakId: 'set_timer_resolution',
      tweakTargetValue: '0.5'
    },
    localConfig: { container_type: 'timer_resolution' }
  });
  fixture.tweakRunner.runTweak = async () => {
    const error = new Error('Windows did not keep the requested timer resolution active.');
    error.code = 'TIMER_RESOLUTION_NOT_EFFECTIVE';
    error.details = { requestedResolution: '0.5', currentResolution: '1' };
    throw error;
  };

  const result = await executeAutomaticTweakRuleAction(fixture);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'TIMER_RESOLUTION_NOT_EFFECTIVE');
  assert.deepEqual(result.tweakState, {
    tweakId: 'set_timer_resolution',
    currentState: 'disabled',
    status: 'disabled',
    selectedResolution: '',
    currentResolution: '1',
    selectedOption: '',
    currentValue: null
  });
});
