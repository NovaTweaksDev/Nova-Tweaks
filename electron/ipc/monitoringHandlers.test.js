const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { registerMonitoringHandlers } = require('./monitoringHandlers');

function createFixture(code) {
  const handlers = new Map();
  let settings = { monitoring: { advancedSensorsEnabled: false } };
  let shutdowns = 0;
  const runtime = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    advancedSensorMonitoringEnabled: false,
    metricsSubscriberIds: new Set(),
    monitoringManager: {
      start: async () => !code,
      getLatest: () => ({ code, message: 'Sensors unavailable' }),
      shutdown: async () => { shutdowns += 1; return { sidecarStopped: true }; }
    },
    settingsService: {
      updateSettings: (next) => { settings = next; return settings; },
      getSettings: () => settings
    },
    toIpcError: (error) => ({ code: error.code, message: error.message }),
    metricsLogger: { error() {} }
  };
  registerMonitoringHandlers(runtime);
  return { runtime, handlers, getShutdowns: () => shutdowns };
}

test('enabling sensors without admin approval preserves the preference and subscription', async () => {
  const fixture = createFixture('ADMIN_BROKER_APPROVAL_REQUIRED');
  const result = await fixture.handlers.get('monitoring:setAdvancedSensorsEnabled')(
    { sender: { id: 42 } }, { enabled: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.settings.monitoring.advancedSensorsEnabled, true);
  assert.equal(fixture.runtime.advancedSensorMonitoringEnabled, true);
  assert.equal(fixture.runtime.metricsSubscriberIds.has(42), true);
  assert.equal(fixture.getShutdowns(), 0);
});

test('real sensor startup failures still reject activation and clean up', async () => {
  const fixture = createFixture('MONITORING_ERROR');
  const result = await fixture.handlers.get('monitoring:setAdvancedSensorsEnabled')(
    { sender: { id: 42 } }, { enabled: true }
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ADVANCED_SENSOR_MONITORING_UNAVAILABLE');
  assert.equal(fixture.runtime.advancedSensorMonitoringEnabled, false);
  assert.equal(fixture.runtime.metricsSubscriberIds.has(42), false);
  assert.equal(fixture.getShutdowns(), 1);
});

test('disabling sensors persists the opt-out and stops the sidecar', async () => {
  const fixture = createFixture();
  fixture.runtime.advancedSensorMonitoringEnabled = true;
  const result = await fixture.handlers.get('monitoring:setAdvancedSensorsEnabled')(
    { sender: { id: 42 } }, { enabled: false }
  );
  assert.equal(result.ok, true);
  assert.equal(result.settings.monitoring.advancedSensorsEnabled, false);
  assert.equal(fixture.getShutdowns(), 1);
});

test('admin approval resumes subscribed monitoring once and respects disabled sensors', async () => {
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  const syncFunction = source.slice(source.indexOf('async function syncMonitoringSubscriptionState()'), source.indexOf('function broadcastMetricsUpdate('));
  const stateFunction = source.slice(source.indexOf('function handleAdminBrokerStateChange('), source.indexOf('function broadcastAppOptimizationUpdate('));
  let starts = 0;
  let stops = 0;
  const context = {
    pruneMetricsSubscribers() {}, pruneGameSessionSubscribers() {},
    broadcastAdminAccessState() {}, adminBrokerWasReady: false,
    advancedSensorMonitoringEnabled: true,
    monitoringManager: { start: async () => { starts += 1; }, stop: () => { stops += 1; } },
    metricsSubscriberIds: new Set([42]), settingsService: { getSettings: () => ({}) },
    gameSessionManager: null, ruleAutomationService: null, metricsLogger: { warn() {} }
  };
  vm.createContext(context);
  vm.runInContext(`${syncFunction}\n${stateFunction}`, context);
  context.handleAdminBrokerStateChange({ ready: false });
  assert.equal(starts, 0);
  context.handleAdminBrokerStateChange({ ready: true });
  await new Promise(setImmediate);
  assert.equal(starts, 1);
  context.handleAdminBrokerStateChange({ ready: true });
  assert.equal(starts, 1);
  context.handleAdminBrokerStateChange({ ready: false });
  context.advancedSensorMonitoringEnabled = false;
  context.handleAdminBrokerStateChange({ ready: true });
  await new Promise(setImmediate);
  assert.equal(starts, 1);
  assert.equal(stops, 1);
});
