const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettingsService } = require('./settingsService');

test('persists Nova Violet as a supported accent color', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });

  const updated = service.updateSettings({
    preferences: {
      accentColor: '#9D4EDD'
    }
  });

  assert.equal(updated.preferences.accentColor, '#9D4EDD');
  assert.equal(service.loadSettings().preferences.accentColor, '#9D4EDD');
});

test('falls back to the default for removed accent colors', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });

  for (const accentColor of ['#22C55E', '#FF003C', '#14B8A6']) {
    const updated = service.updateSettings({
      preferences: {
        accentColor
      }
    });

    assert.equal(updated.preferences.accentColor, '#9D4EDD');
    assert.equal(service.loadSettings().preferences.accentColor, '#9D4EDD');
  }
});

test('migrates replaced accent colors to their new values', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });
  const replacements = new Map([
    ['#7C3AED', '#9D4EDD'],
    ['#A78BFA', '#9D4EDD'],
    ['#E586A8', '#E93D82'],
    ['#F08A7E', '#FF6F61'],
    ['#F59E0B', '#FFB000'],
    ['#E7AD55', '#FFB000'],
    ['#69C7A5', '#10B981'],
    ['#EC4899', '#E93D82'],
    ['#3B82F6', '#9D4EDD'],
    ['#6366F1', '#9D4EDD'],
    ['#FFB24B', '#FFB000'],
    ['#F43F5E', '#FF6F61'],
    ['#008CFF', '#9D4EDD'],
    ['#7C5CFF', '#9D4EDD'],
    ['#FF738B', '#FF6F61']
  ]);

  for (const [legacyColor, replacementColor] of replacements) {
    const updated = service.updateSettings({
      preferences: { accentColor: legacyColor }
    });
    assert.equal(updated.preferences.accentColor, replacementColor);
    assert.equal(service.loadSettings().preferences.accentColor, replacementColor);
  }
});

test('persists the mascot animation preference', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });

  const updated = service.updateSettings({
    preferences: {
      mascotAnimationEnabled: true
    }
  });

  assert.equal(updated.preferences.mascotAnimationEnabled, true);
  assert.equal(service.loadSettings().preferences.mascotAnimationEnabled, true);
});

test('migrates the legacy mascot animation test preference', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });

  const migrated = service.saveSettings({
    preferences: {
      mascotAnimationTestMode: true
    }
  });

  assert.equal(migrated.preferences.mascotAnimationEnabled, true);
  assert.equal('mascotAnimationTestMode' in migrated.preferences, false);
});

test('keeps advanced sensor monitoring opt-in and persists the explicit preference', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });

  assert.equal(service.getSettings().monitoring.advancedSensorsEnabled, false);

  const updated = service.updateSettings({
    monitoring: {
      advancedSensorsEnabled: true
    }
  });

  assert.equal(updated.monitoring.advancedSensorsEnabled, true);
  assert.equal(service.loadSettings().monitoring.advancedSensorsEnabled, true);
});

test('process detection is opt-in and sanitizes thresholds and exclusions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({
    app: {
      getPath: (name) => path.join(tempRoot, name)
    }
  });

  assert.equal(service.getSettings().automation.processDetection.enabled, false);

  const updated = service.updateSettings({
    automation: {
      processDetection: {
        enabled: true,
        cpuThresholdPercent: 999,
        memoryThresholdMB: -20,
        excludedExecutables: [' Game.exe ', '', 'GAME.EXE', 42]
      }
    },
    startupWindow: {
      lastTab: 'automation'
    }
  });

  assert.equal(updated.automation.processDetection.enabled, true);
  assert.equal(updated.automation.processDetection.cpuThresholdPercent, 90);
  assert.equal(updated.automation.processDetection.memoryThresholdMB, 0);
  assert.deepEqual(updated.automation.processDetection.excludedExecutables, ['game.exe']);
  assert.equal(updated.startupWindow.lastTab, 'automation');
});

test('sanitizes multi-condition automation rules and confirmed action metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({ app: { getPath: (name) => path.join(tempRoot, name) } });
  const updated = service.updateSettings({ automation: { rules: [{
    id: 'gaming-load',
    name: 'Gaming load',
    enabled: true,
    matchMode: 'all',
    conditions: [
      { id: 'game', type: 'gameRunning', operator: 'is', text: 'Fortnite' },
      { id: 'cpu', type: 'systemCpu', operator: 'gte', value: 85 }
    ],
    holdSeconds: 20,
    cooldownMinutes: 30,
    action: { type: 'runOptimization', optimizationId: 'cpu' }
  }] } });
  assert.equal(updated.automation.rules[0].conditions.length, 2);
  assert.equal(updated.automation.rules[0].action.type, 'runOptimization');
  assert.equal(updated.automation.rules[0].action.optimizationId, 'cpu');
});

test('preserves the explicit target value for non-toggle automation tweaks', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({ app: { getPath: (name) => path.join(tempRoot, name) } });
  const updated = service.updateSettings({ automation: { rules: [{
    id: 'fortnite-timer',
    name: 'Fortnite timer resolution',
    enabled: true,
    conditions: [
      { id: 'fortnite', type: 'processStarted', operator: 'is', value: true, text: 'Fortnite' }
    ],
    action: {
      type: 'runTweak',
      tweakId: 'set-timer-resolution',
      tweakTargetValue: '0.5',
      bypassConfirmation: true
    }
  }] } });

  assert.equal(updated.automation.rules[0].action.type, 'runTweak');
  assert.equal(updated.automation.rules[0].action.tweakId, 'set-timer-resolution');
  assert.equal(updated.automation.rules[0].action.tweakTargetValue, '0.5');
  assert.equal(updated.automation.rules[0].action.bypassConfirmation, true);
});

test('does not preserve confirmation bypass for non-tweak rule actions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-settings-'));
  const service = createSettingsService({ app: { getPath: (name) => path.join(tempRoot, name) } });
  const updated = service.updateSettings({ automation: { rules: [{
    id: 'notify-only',
    name: 'Notify only',
    enabled: true,
    conditions: [{ id: 'cpu', type: 'systemCpu', operator: 'gte', value: 80 }],
    action: {
      type: 'notify',
      message: 'High CPU',
      bypassConfirmation: true
    }
  }] } });

  assert.equal(updated.automation.rules[0].action.bypassConfirmation, false);
});
