const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuleAutomationService, evaluateRule } = require('./ruleAutomationService');

test('missing or stale metrics and empty rules never trigger actions', () => {
  const rule = { conditions: [{ type: 'systemCpu', operator: 'lt', value: 20 }] };
  assert.equal(evaluateRule(rule, { metrics: { overview: { cpu: { usagePercent: null } } } }).matched, false);
  assert.equal(evaluateRule(rule, { metricsAt: 1, currentTime: 20000, metrics: { cpuLoad: 1 } }).matched, false);
  assert.equal(evaluateRule({ conditions: [] }, {}).matched, false);
});

test('named game-stop rules retain the stopped game identity', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-game-stop-rule-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const notifications = [];
  const service = createRuleAutomationService({ statePath: path.join(root, 'state.json'),
    getSettings: () => ({ automation: { rules: [{ id: 'stop', enabled: true, cooldownMinutes: 1,
      conditions: [{ type: 'gameStopped', text: 'My Game', operator: 'is' }], action: { type: 'notify' } }] } }),
    onNotify: (entry) => notifications.push(entry)
  });
  service.handleGameState({ activeGame: { gameName: 'My Game' } });
  service.handleGameState({ activeGame: null });
  assert.equal(notifications.length, 1);
});

test('in-flight rule actions cannot duplicate and failures notify with their reason', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-rule-inflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let finish;
  let calls = 0;
  const notices = [];
  const service = createRuleAutomationService({ statePath: path.join(root, 'state.json'),
    getSettings: () => ({ automation: { rules: [{ id: 'busy', enabled: true, cooldownMinutes: 0,
      conditions: [{ type: 'systemCpu', operator: 'gt', value: 50 }], action: { type: 'runTweak', tweakId: 'test' } }] } }),
    executeAutomaticAction: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
    onNotify: (entry) => notices.push(entry)
  });
  service.handleMetrics({ cpuLoad: 90 });
  service.handleMetrics({ cpuLoad: 90 });
  assert.equal(calls, 1);
  finish({ handled: true, ok: false, message: 'Access denied: test registry key.' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getState().pending.length, 0);
  assert.equal(notices[0].status, 'failed');
  assert.equal(notices[0].message, 'Access denied: test registry key.');
});

test('any-mode process edge rules still evaluate running-process alternatives', () => {
  const rule = { matchMode: 'any', conditions: [
    { type: 'processStarted', operator: 'is', text: 'game' },
    { type: 'processCpu', operator: 'gt', value: 80, text: 'game' }
  ] };
  assert.equal(evaluateRule(rule, { processEvents: [], processes: [{ name: 'game.exe', cpuPercent: 90 }] }).matched, true);
});

test('requires all process conditions to match the same process', () => {
  const rule = { matchMode: 'all', conditions: [
    { type: 'processRunning', operator: 'is', text: 'game' },
    { type: 'processCpu', operator: 'gte', value: 70, text: 'game' }
  ] };
  const match = evaluateRule(rule, { processes: [{ name: 'game.exe', cpuPercent: 80, responding: true }], metrics: null });
  assert.equal(match.matched, true);
});

test('supports any-mode across system conditions', () => {
  const rule = { matchMode: 'any', conditions: [
    { type: 'systemCpu', operator: 'gte', value: 90 },
    { type: 'packetLoss', operator: 'gt', value: 1 }
  ] };
  const match = evaluateRule(rule, { processes: [], metrics: { overview: { cpu: { usagePercent: 20 }, networkQuality: { packetLossPercent: 2 } } } });
  assert.equal(match.matched, true);
});

test('matches process filters with or without the exe extension', () => {
  const context = {
    processEvents: [{
      name: 'FortniteClient-Win64-Shipping',
      executablePath: '',
      event: 'started'
    }]
  };
  const withExtension = evaluateRule({
    matchMode: 'all',
    conditions: [{ type: 'processStarted', operator: 'is', text: 'FortniteClient-Win64-Shipping.exe' }]
  }, context);
  const withoutExtension = evaluateRule({
    matchMode: 'all',
    conditions: [{ type: 'processStarted', operator: 'is', text: 'FortniteClient-Win64-Shipping' }]
  }, {
    processEvents: [{
      name: 'FortniteClient-Win64-Shipping.exe',
      executablePath: 'C:\\Games\\FortniteClient-Win64-Shipping.exe',
      event: 'started'
    }]
  });

  assert.equal(withExtension.matched, true);
  assert.equal(withoutExtension.matched, true);
});

test('detects process start and stop as edge events after the baseline snapshot', () => {
  let settings = {
    automation: {
      rules: [{
        id: 'app-start',
        name: 'App start',
        enabled: true,
        matchMode: 'all',
        conditions: [{ id: 'started', type: 'processStarted', operator: 'is', value: 0, text: 'discord' }],
        holdSeconds: 30,
        cooldownMinutes: 1,
        action: { type: 'runTweak', tweakId: 'disable-overlay' }
      }]
    }
  };
  const updates = [];
  let timestamp = 1000;
  const service = createRuleAutomationService({
    getSettings: () => settings,
    nowProvider: () => timestamp,
    statePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-rule-edge-')), 'state.json'),
    onUpdate: (state) => updates.push(state)
  });

  service.handleProcessSnapshot([]);
  timestamp += 1000;
  service.handleProcessSnapshot([{ pid: 42, name: 'Discord.exe', startTime: 10, executablePath: 'C:\\Apps\\Discord.exe' }]);
  assert.equal(service.getState().pending.length, 1);
  assert.equal(service.getState().pending[0].processInfo.name, 'Discord.exe');

  settings = { automation: { rules: [{ ...settings.automation.rules[0], id: 'app-stop', conditions: [{ id: 'stopped', type: 'processStopped', operator: 'is', value: 0, text: 'discord' }] }] } };
  timestamp += 61_000;
  service.handleProcessSnapshot([]);
  assert.equal(service.getState().pending.some((entry) => entry.ruleId === 'app-stop'), true);
  assert.ok(updates.length >= 2);
});

test('completes a handled automatic action without renderer state', async () => {
  const settings = {
    automation: {
      rules: [{
        id: 'timer-start',
        name: 'Timer on game start',
        enabled: true,
        matchMode: 'all',
        conditions: [{ id: 'started', type: 'processStarted', operator: 'is', text: 'game' }],
        holdSeconds: 0,
        cooldownMinutes: 1,
        action: { type: 'runTweak', tweakId: 'set_timer_resolution', tweakTargetValue: '0.5' }
      }]
    }
  };
  let actionHandled;
  const handled = new Promise((resolve) => {
    actionHandled = resolve;
  });
  const service = createRuleAutomationService({
    getSettings: () => settings,
    statePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-rule-auto-')), 'state.json'),
    executeAutomaticAction: async (execution) => {
      actionHandled(execution);
      return {
        handled: true,
        ok: true,
        message: 'Applied.',
        tweakState: {
          tweakId: 'set_timer_resolution',
          currentState: 'enabled',
          selectedResolution: '0.5',
          currentResolution: '0.5'
        }
      };
    }
  });

  service.handleProcessSnapshot([]);
  service.handleProcessSnapshot([{ pid: 7, name: 'game', startTime: 1 }]);
  const execution = await handled;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(execution.action.tweakId, 'set_timer_resolution');
  assert.equal(service.getState().pending.length, 0);
  assert.equal(service.getState().history[0].status, 'completed');
  assert.equal(service.getState().history[0].automatic, true);
  assert.equal(service.getState().history[0].tweakState.selectedResolution, '0.5');
});

test('keeps an admin rule pending until an explicit approval and revalidates its trigger', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-rule-admin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const settings = { automation: { rules: [{
    id: 'admin-start', name: 'Admin start', enabled: true, matchMode: 'all',
    conditions: [{ type: 'processStarted', operator: 'is', text: 'game' }],
    holdSeconds: 0, cooldownMinutes: 1,
    action: { type: 'runTweak', tweakId: 'admin_tweak', bypassConfirmation: true }
  }] } };
  const notices = [];
  const prompts = [];
  const service = createRuleAutomationService({
    getSettings: () => settings,
    statePath: path.join(root, 'state.json'),
    onAdminRequired: (execution) => notices.push(execution.id),
    executeAutomaticAction: async (_execution, options) => {
      prompts.push(options.allowAdminPrompt);
      return options.allowAdminPrompt
        ? { handled: true, ok: true }
        : { handled: true, ok: false, pendingAdmin: true, code: 'ADMIN_BROKER_APPROVAL_REQUIRED' };
    }
  });
  service.handleProcessSnapshot([]);
  service.handleProcessSnapshot([{ pid: 7, name: 'game.exe', startTime: 1 }]);
  await new Promise((resolve) => setImmediate(resolve));
  const pending = service.getState().pending[0];
  assert.equal(pending.blockedReason, 'awaitingAdmin');
  assert.equal(notices.length, 1);
  const result = await service.execute(pending.id);
  assert.equal(result.ok, true);
  assert.deepEqual(prompts, [false, true]);
  assert.equal(service.getState().pending.length, 0);
});

test('never resumes an awaiting-admin action from an earlier app session', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-rule-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, 'state.json');
  const settings = { automation: { rules: [{
    id: 'admin-stop', name: 'Admin stop', enabled: true, matchMode: 'all',
    conditions: [{ type: 'processStopped', operator: 'is', text: 'game' }],
    holdSeconds: 0, cooldownMinutes: 1,
    action: { type: 'runTweak', tweakId: 'admin_tweak', bypassConfirmation: true }
  }] } };
  const first = createRuleAutomationService({
    getSettings: () => settings,
    statePath,
    executeAutomaticAction: async () => ({ handled: true, ok: false, pendingAdmin: true, code: 'ADMIN_BROKER_APPROVAL_REQUIRED' })
  });
  first.handleProcessSnapshot([{ pid: 9, name: 'game.exe', startTime: 1 }]);
  first.handleProcessSnapshot([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.getState().pending[0].blockedReason, 'awaitingAdmin');

  const second = createRuleAutomationService({ getSettings: () => settings, statePath });
  second.resumePendingAutomaticActions();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.getState().pending.length, 0);
  assert.equal(second.getState().history[0].status, 'expired');
});

test('groups multiple waiting admin rules into one approval notification', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-rule-admin-group-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseRule = {
    enabled: true,
    matchMode: 'all',
    conditions: [{ type: 'processStarted', operator: 'is', text: 'game' }],
    holdSeconds: 0,
    cooldownMinutes: 1,
    action: { type: 'runTweak', tweakId: 'admin_tweak', bypassConfirmation: true }
  };
  const settings = { automation: { rules: [
    { ...baseRule, id: 'admin-one', name: 'Admin one' },
    { ...baseRule, id: 'admin-two', name: 'Admin two' }
  ] } };
  const notices = [];
  const service = createRuleAutomationService({
    getSettings: () => settings,
    statePath: path.join(root, 'state.json'),
    onAdminRequired: (execution) => notices.push(execution),
    executeAutomaticAction: async () => ({
      handled: true,
      ok: false,
      pendingAdmin: true,
      code: 'ADMIN_BROKER_APPROVAL_REQUIRED'
    })
  });
  service.handleProcessSnapshot([]);
  service.handleProcessSnapshot([{ pid: 7, name: 'game.exe', startTime: 1 }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getState().pending.length, 2);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].pendingAdminCount, 2);
});
