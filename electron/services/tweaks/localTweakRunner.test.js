const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createTweakRunner } = require('./tweakRunner');

function createLocalFixture({ requiresAdmin = false } = {}) {
  const scriptsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-local-tweak-'));
  const scriptRelativePath = 'local_test/local_test.ps1';
  const scriptPath = path.join(scriptsPath, ...scriptRelativePath.split('/'));
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, 'param([string]$State, [switch]$Silent)\n$State', 'utf8');

  const config = {
    id: 'local_test',
    name: 'Local test',
    container_type: 'normal_tweak',
    requires_admin: requiresAdmin,
    reboot_required: false,
    execution: {
      type: 'powershell',
      script: 'local_test.ps1',
      requires_admin: requiresAdmin,
      supports_status_detection: true,
      actions: {
        apply: { args: ['-State', 'On', '-Silent'], requires_admin: requiresAdmin },
        detect: { args: ['-State', 'Check', '-Silent'], requires_admin: false },
        restore: { args: ['-State', 'Off', '-Silent'], requires_admin: requiresAdmin }
      }
    }
  };
  const tweakCatalog = {
    getConfigById: () => config,
    resolveExecution: (_id, action) => ({
      tweakId: config.id,
      action,
      type: 'powershell',
      script: 'local_test.ps1',
      scriptPath,
      scriptRelativePath,
      timeoutMs: 30000,
      requiresAdmin: action === 'detect' ? false : requiresAdmin,
      params: { State: action === 'detect' ? 'Check' : action === 'apply' ? 'On' : 'Off', Silent: true }
    })
  };

  return {
    scriptsPath,
    tweakCatalog,
    dispose: () => fs.rmSync(scriptsPath, { recursive: true, force: true })
  };
}

test('local-only runner resolves bundled configs without a Nova API client', async () => {
  const fixture = createLocalFixture();
  const calls = [];
  try {
    const runner = createTweakRunner({
      novaApi: null,
      remoteScriptRunner: { runScript: async (payload) => (calls.push(payload), { ok: true, stdout: 'DISABLED', stderr: '', exitCode: 0 }) },
      remoteScriptsPath: fixture.scriptsPath,
      tweakCatalog: fixture.tweakCatalog,
      localOnly: true,
      isAdminProvider: () => false
    });

    const state = await runner.getCurrentState({ tweakId: 'local_test' });
    assert.equal(state.currentState, 'disabled');
    assert.equal(calls[0].scriptName, 'local_test/local_test.ps1');
    assert.deepEqual(calls[0].params, { State: 'Check', Silent: true });
  } finally {
    fixture.dispose();
  }
});

test('local-only runner executes a non-admin tweak without contacting the administrator broker', async () => {
  const fixture = createLocalFixture({ requiresAdmin: false });
  const calls = [];
  let brokerCalls = 0;
  try {
    const runner = createTweakRunner({
      novaApi: null,
      remoteScriptRunner: {
        runScript: async (payload) => {
          calls.push(payload);
          return { ok: true, stdout: 'ENABLED', stderr: '', exitCode: 0 };
        }
      },
      remoteScriptsPath: fixture.scriptsPath,
      tweakCatalog: fixture.tweakCatalog,
      localOnly: true,
      isAdminProvider: () => false,
      privilegedExecutor: async () => {
        brokerCalls += 1;
        throw new Error('Non-admin tweaks must not contact the administrator broker.');
      }
    });

    const result = await runner.runTweak({ tweakId: 'local_test', targetState: 'enabled' });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.State, 'On');
    assert.equal(brokerCalls, 0);
  } finally {
    fixture.dispose();
  }
});
test('local-only runner sends a self-contained development artifact to the administrator broker', async () => {
  const fixture = createLocalFixture({ requiresAdmin: true });
  let brokerCall = null;
  try {
    const runner = createTweakRunner({
      novaApi: null,
      remoteScriptRunner: { runScript: async () => ({ ok: true, stdout: 'ENABLED', stderr: '', exitCode: 0 }) },
      remoteScriptsPath: fixture.scriptsPath,
      tweakCatalog: fixture.tweakCatalog,
      localOnly: true,
      isAdminProvider: () => false,
      getAppVersion: () => '1.0.0',
      privilegedExecutor: async (operation, payload) => {
        brokerCall = { operation, payload };
        return { ok: true, stdout: 'ENABLED', stderr: '', exitCode: 0 };
      }
    });

    const result = await runner.runTweak({ tweakId: 'local_test', targetState: 'enabled' });
    assert.equal(result.ok, true);
    assert.equal(brokerCall.operation, 'tweak.execute');
    assert.equal(brokerCall.payload.artifact.signedPayload.kind, 'nova-tweak-artifact');
    assert.equal(brokerCall.payload.artifact.sha256.length, 64);
    assert.match(brokerCall.payload.artifact.content, /param/);
    assert.equal(brokerCall.payload.trustMode, 'bundled-integrity');
    assert.equal(brokerCall.payload.allowUnsignedDevelopment, true);
  } finally {
    fixture.dispose();
  }
});

test('normal execution honors config timeout, explicit overrides, and detection budget', async () => {
  const fixture = createLocalFixture();
  const config = fixture.tweakCatalog.getConfigById();
  config.execution.timeout_ms = 30000;
  const calls = [];
  const runner = createTweakRunner({ remoteScriptRunner: { runScript: async (request) => {
    calls.push(request); return { ok: true, stdout: 'ENABLED', exitCode: 0 };
  } }, tweakCatalog: fixture.tweakCatalog, remoteScriptsPath: fixture.scriptsPath, localOnly: true });
  try {
    await runner.runTweak({ tweakId: 'local_test' });
    await runner.runTweak({ tweakId: 'local_test', timeoutMs: 90000 });
    await runner.getCurrentState({ tweakId: 'local_test' });
    assert.deepEqual(calls.map((call) => call.timeoutMs), [30000, 90000, 30000]);
    await assert.rejects(runner.runTweak({ tweakId: 'local_test', timeoutMs: -1 }), { code: 'INVALID_TWEAK_TIMEOUT' });
    config.execution.timeout_ms = 300001;
    await assert.rejects(runner.runTweak({ tweakId: 'local_test' }), { code: 'INVALID_TWEAK_TIMEOUT' });
    assert.equal(calls.length, 3);
  } finally { fixture.dispose(); }
});

test('the central execution gate blocks UI and automatic callers and releases after errors', async () => {
  const { createExecutionGate } = require('./executionGate');
  const fixture = createLocalFixture(); const gate = createExecutionGate(); let calls = 0;
  const runner = createTweakRunner({ tweakCatalog: fixture.tweakCatalog, localOnly: true, executionGate: gate,
    remoteScriptsPath: fixture.scriptsPath, remoteScriptRunner: { runScript: async () => { calls += 1; throw new Error('script failed'); } } });
  try {
    const token = gate.beginRestore();
    await assert.rejects(runner.runTweak({ tweakId: 'local_test' }), { code: 'SYSTEM_OPERATION_BUSY' });
    await assert.rejects(runner.runTweak({ tweakId: 'local_test', executionContext: { source: 'automation' } }), { code: 'SYSTEM_OPERATION_BUSY' });
    assert.equal(calls, 0);
    gate.endRestore(token);
    await assert.rejects(runner.runTweak({ tweakId: 'local_test' }), { code: 'SCRIPT_EXECUTION_FAILED' });
    const next = gate.beginRestore(); gate.endRestore(next);
    assert.equal(calls, 1);
  } finally { fixture.dispose(); }
});

test('restore fingerprints reject script changes between preflight and execution', async () => {
  const fixture = createLocalFixture(); let calls = 0;
  const runner = createTweakRunner({ tweakCatalog: fixture.tweakCatalog, localOnly: true,
    remoteScriptsPath: fixture.scriptsPath, remoteScriptRunner: { runScript: async () => { calls += 1; return { ok: true }; } } });
  try {
    const requirements = await runner.getExecutionRequirements({ tweakId: 'local_test' });
    assert.match(requirements.executionFingerprint, /^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(fixture.scriptsPath, 'local_test/local_test.ps1'), 'Write-Output changed');
    await assert.rejects(runner.runTweak({ tweakId: 'local_test', executionContext: { expectedFingerprint: requirements.executionFingerprint } }), { code: 'RESTORE_SOURCE_CHANGED' });
    assert.equal(calls, 0);
  } finally { fixture.dispose(); }
});
test('privileged execution receives the same resolved timeout precedence', async () => {
  const fixture = createLocalFixture({ requiresAdmin: true }); const budgets = [];
  fixture.tweakCatalog.getConfigById().execution.timeout_ms = 30000;
  const runner = createTweakRunner({ tweakCatalog: fixture.tweakCatalog, localOnly: true,
    remoteScriptsPath: fixture.scriptsPath, isAdminProvider: () => false,
    privilegedExecutor: async (_operation, _payload, options) => { budgets.push(options.timeoutMs); return { ok: true, stdout: 'ENABLED' }; } });
  try {
    await runner.runTweak({ tweakId: 'local_test' });
    await runner.runTweak({ tweakId: 'local_test', timeoutMs: 90000 });
    assert.deepEqual(budgets, [30000, 90000]);
  } finally { fixture.dispose(); }
});
test('cannot begin restoration while an earlier tweak is in flight', async () => {
  const { createExecutionGate } = require('./executionGate'); const gate = createExecutionGate();
  const fixture = createLocalFixture(); let complete; let started;
  const pending = new Promise((resolve) => { complete = resolve; });
  const waiting = new Promise((resolve) => { started = resolve; });
  const runner = createTweakRunner({ tweakCatalog: fixture.tweakCatalog, localOnly: true, executionGate: gate,
    remoteScriptsPath: fixture.scriptsPath, remoteScriptRunner: { runScript: async () => { started(); return pending; } } });
  try {
    const execution = runner.runTweak({ tweakId: 'local_test' });
    await waiting;
    assert.throws(() => gate.beginRestore(), { code: 'SYSTEM_OPERATION_BUSY' });
    complete({ ok: true, stdout: 'ENABLED' });
    await execution;
    const token = gate.beginRestore(); gate.endRestore(token);
  } finally { fixture.dispose(); }
});

test('classic context menu detection passes real PowerShell output through the runner', { skip: process.platform !== 'win32' }, async () => {
  const { execFileSync } = require('node:child_process');
  const { createTweakCatalog } = require('../localTweaks/catalog');
  const scriptsPath = path.resolve(__dirname, '../../../resources/tweaks/scripts');
  const scriptPath = path.join(scriptsPath, 'enable_classic_context_menu/enable_classic_context_menu.ps1');
  for (const scenario of [
    { exists: false, hasDefault: false, value: '', expected: 'disabled' },
    { exists: true, hasDefault: false, value: '', expected: 'disabled' },
    { exists: true, hasDefault: true, value: 'other', expected: 'disabled' },
    { exists: true, hasDefault: true, value: '', expected: 'enabled' }
  ]) {
    const prelude = [
      'class DetectionRegistryKey {',
      '  [string[]] GetValueNames() { return ' + (scenario.hasDefault ? "@('')" : '@()') + ' }',
      "  [object] GetValue([string]$name) { return '" + scenario.value + "' }",
      '}',
      'function Test-Path { return $' + scenario.exists + ' }',
      'function Get-Item { return [DetectionRegistryKey]::new() }',
      "& '" + scriptPath.replace(/'/g, "''") + "' -State Check -Silent"
    ].join('\n');
    const runner = createTweakRunner({
      tweakCatalog: createTweakCatalog(), localOnly: true, remoteScriptsPath: scriptsPath,
      isAdminProvider: () => false,
      remoteScriptRunner: { runScript: async () => ({
        stdout: execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', prelude], { encoding: 'utf8', windowsHide: true }),
        stderr: '', exitCode: 0, ok: true
      }) }
    });
    const state = await runner.getCurrentState({ tweakId: 'enable_classic_context_menu' });
    assert.equal(state.currentState, scenario.expected, JSON.stringify(scenario));
    assert.equal(state.checked, true);
  }
});
