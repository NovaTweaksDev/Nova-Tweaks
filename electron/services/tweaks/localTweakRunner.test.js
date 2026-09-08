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
