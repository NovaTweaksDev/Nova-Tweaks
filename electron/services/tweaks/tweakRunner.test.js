const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createTweakRunner } = require('./tweakRunner');
const { buildSignedPayload, sha256Hex } = require('./remoteTweakArtifactCache');
const generatedSigningConfig = require('../../generated/signing-config');

function createConfig(overrides = {}) {
  const apply = { args: ['-State', 'On', '-Silent'], success_exit_codes: [0], requires_admin: true };
  const detect = { args: ['-State', 'Check', '-Silent'], success_exit_codes: [0], requires_admin: false };
  const restore = { args: ['-State', 'Off', '-Silent'], success_exit_codes: [0], requires_admin: true };
  return {
    id: 'windows_game_mode',
    name: 'Windows Game Mode',
    script: 'windows_game_mode.ps1',
    requires_admin: true,
    reboot_required: false,
    execution: {
      type: 'powershell',
      script: 'windows_game_mode.ps1',
      requires_admin: true,
      timeout_ms: 30000,
      supports_status_detection: true,
      actions: { apply, detect, restore }
    },
    ...overrides
  };
}

function createArtifactPayload(overrides = {}) {
  const content = overrides.content || 'Write-Output "ok"';
  const artifact = {
    tweakId: 'windows_game_mode',
    artifactVersion: '2026.07.10.1',
    script: 'windows_game_mode.ps1',
    hash: sha256Hex(content),
    allowedActions: ['Check', 'Off', 'On'],
    allowedParameters: [],
    requiresAdmin: true,
    requiresReboot: false,
    minimumAppVersion: '',
    expiresAt: '',
    revoked: false,
    content,
    signature: '',
    ...overrides
  };
  artifact.signedPayload = buildSignedPayload({
    tweakId: artifact.tweakId,
    artifactVersion: artifact.artifactVersion,
    scriptFileName: artifact.script,
    sha256: artifact.hash,
    allowedActions: artifact.allowedActions,
    allowedParameters: artifact.allowedParameters,
    requiresAdmin: artifact.requiresAdmin,
    requiresReboot: artifact.requiresReboot,
    minimumAppVersion: artifact.minimumAppVersion,
    expiresAt: artifact.expiresAt
  });
  return artifact;
}

function createRemoteRunner({
  config = createConfig(),
  localConfig = config,
  getTweakScript,
  allowUnsignedDevelopmentArtifacts = true,
  scriptStdout = '{"status":"enabled"}',
  isAdminProvider,
  privilegedExecutor,
  timerVerificationDelayMs = 0
} = {}) {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tweak-runner-'));
  const calls = [];
  const runner = createTweakRunner({
    novaApi: {
      getTweakConfig: async () => config,
      getTweakScript
    },
    remoteScriptRunner: {
      runScript: async (options) => {
        await options.verifyBeforeRun();
        calls.push(options);
        const stdout = typeof scriptStdout === 'function'
          ? scriptStdout(options, calls.length - 1)
          : scriptStdout;
        return { ok: true, stdout, stderr: '', exitCode: 0 };
      }
    },
    remoteScriptsPath: cacheRoot,
    getAppVersion: () => '1.0.0',
    allowUnsignedDevelopmentArtifacts,
    isAdminProvider,
    privilegedExecutor,
    timerVerificationDelayMs,
    tweakCatalog: {
      getConfigById: () => localConfig
    }
  });
  return { calls, runner };
}

test('rejects timer resolution success when the delayed system check reports a coarser value', async () => {
  const config = createConfig({
    id: 'set_timer_resolution',
    name: 'Timer Resolution',
    script: 'set_timer_resolution.ps1',
    container_type: 'timer_resolution'
  });
  config.execution.script = 'set_timer_resolution.ps1';
  config.execution.actions.apply.allowed_params = ['Resolution'];
  config.execution.actions.restore.allowed_params = ['Resolution'];
  const payload = createArtifactPayload({
    tweakId: 'set_timer_resolution',
    script: 'set_timer_resolution.ps1',
    allowedParameters: [{
      name: 'Resolution',
      type: 'string',
      required: false,
      allowedValues: ['0.5', '1.0']
    }]
  });
  const fixture = createRemoteRunner({
    config,
    getTweakScript: async () => payload,
    scriptStdout: (_options, callIndex) => JSON.stringify(callIndex === 0
      ? {
          status: 'Enabled',
          details: { selectedResolution: '0.5', currentResolution: '0.5' }
        }
      : {
          status: 'Enabled',
          details: { selectedResolution: '0.5', currentResolution: '1' }
        })
  });

  await assert.rejects(
    () => fixture.runner.runTweak({
      tweakId: 'set_timer_resolution',
      params: { Resolution: '0.5' }
    }),
    (error) => (
      error?.code === 'TIMER_RESOLUTION_NOT_EFFECTIVE'
      && error?.details?.currentResolution === '1'
    )
  );
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1].params.State, 'Check');
});

test('administrator detection uses the active broker without prompting', async () => {
  const config = createConfig();
  config.execution.actions.detect.requires_admin = true;
  const calls = [];
  const fixture = createRemoteRunner({ config, isAdminProvider: () => false,
    getTweakScript: async () => createArtifactPayload(),
    privilegedExecutor: async (...args) => { calls.push(args); return { ok: true, stdout: '{"status":"enabled"}' }; }
  });
  const state = await fixture.runner.getCurrentState({ tweakId: 'windows_game_mode' });
  assert.equal(state.checked, true);
  assert.equal(state.currentState, 'enabled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].allowPrompt, false);
  assert.equal(fixture.calls.length, 0);
});

test('empty detection output is not marked as a verified disabled state', async () => {
  const fixture = createRemoteRunner({ getTweakScript: async () => createArtifactPayload(), scriptStdout: '' });
  const state = await fixture.runner.getCurrentState({ tweakId: 'windows_game_mode' });
  assert.equal(state.checked, false);
});

test('returns the detected option for status-capable one-shot selections', async () => {
  const config = createConfig({
    container_type: 'one_shot_selection',
    selections: ['Windows Default', 'Balanced Gaming', 'Aggressive Gaming']
  });
  const payload = createArtifactPayload();
  const fixture = createRemoteRunner({
    config,
    getTweakScript: async () => payload,
    scriptStdout: JSON.stringify({
      status: 'Enabled',
      details: { selectedOption: 'Balanced Gaming' }
    })
  });

  const state = await fixture.runner.getCurrentState({ tweakId: 'windows_game_mode' });

  assert.equal(state.checked, true);
  assert.equal(state.currentState, 'enabled');
  assert.equal(state.selectedOption, 'Balanced Gaming');
  assert.equal(fixture.calls[0].params.State, 'Check');
});

test('executes one-shot actions without returning an enabled or disabled state', async () => {
  const config = createConfig({
    id: 'clear_temporary_files',
    name: 'Clear Temporary Files',
    container_type: 'one_shot_action'
  });
  const payload = createArtifactPayload({ tweakId: 'clear_temporary_files' });
  const fixture = createRemoteRunner({
    config,
    localConfig: config,
    getTweakScript: async () => payload,
    scriptStdout: JSON.stringify({ status: 'Enabled', message: 'Cleanup completed.' })
  });

  const result = await fixture.runner.runTweak({ tweakId: 'clear_temporary_files' });

  assert.equal(result.ok, true);
  assert.equal(result.message, 'Cleanup completed.');
  assert.equal(Object.hasOwn(result, 'currentState'), false);
  assert.equal(Object.hasOwn(result, 'status'), false);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].params.State, 'On');
});

test('rejects removed security tweak IDs before remote config lookup', async () => {
  let remoteConfigRequested = false;
  const runner = createTweakRunner({
    novaApi: {
      getTweakConfig: async () => {
        remoteConfigRequested = true;
        return {};
      }
    },
    tweakCatalog: {}
  });

  await assert.rejects(
    () => runner.runTweak({ tweakId: 'enable_windows_firewall' }),
    (error) => error?.code === 'TWEAK_BLOCKED_BY_SECURITY_POLICY'
  );
  assert.equal(remoteConfigRequested, false);
});

test('uses a previously verified cache artifact when the script endpoint is unavailable', async () => {
  const payload = createArtifactPayload();
  let unavailable = false;
  const fixture = createRemoteRunner({
    getTweakScript: async () => {
      if (unavailable) throw Object.assign(new Error('offline'), { code: 'NETWORK_UNAVAILABLE' });
      return payload;
    }
  });

  await fixture.runner.runTweak({ tweakId: 'windows_game_mode' });
  unavailable = true;
  await fixture.runner.runTweak({ tweakId: 'windows_game_mode' });
  assert.equal(fixture.calls.length, 2);
});

test('sends a self-contained verified artifact to the privileged executor', async () => {
  const payload = createArtifactPayload();
  const brokerCalls = [];
  const fixture = createRemoteRunner({
    getTweakScript: async () => payload,
    isAdminProvider: () => false,
    privilegedExecutor: async (...args) => {
      brokerCalls.push(args);
      return { ok: true, stdout: '{"status":"enabled"}', stderr: '', exitCode: 0 };
    }
  });
  const result = await fixture.runner.runTweak({
    tweakId: 'windows_game_mode',
    executionContext: { allowPrompt: false, source: 'rule' }
  });
  assert.equal(result.ok, true);
  assert.equal(brokerCalls[0][0], 'tweak.execute');
  assert.equal(brokerCalls[0][1].artifact.content, payload.content);
  assert.equal(brokerCalls[0][1].action, 'On');
  assert.equal(brokerCalls[0][2].allowPrompt, false);
  assert.equal(fixture.calls.length, 0);
});

test('rejects renderer parameters that are not in the signed and locally supported contract', async () => {
  const config = createConfig();
  config.execution.actions.apply.allowed_params = ['Selection'];
  config.execution.actions.restore.allowed_params = ['Selection'];
  const payload = createArtifactPayload({
    allowedParameters: [{ name: 'Selection', type: 'string', required: false, allowedValues: ['Cloudflare'], maxLength: 32 }]
  });
  payload.signedPayload = buildSignedPayload({
    tweakId: payload.tweakId,
    artifactVersion: payload.artifactVersion,
    scriptFileName: payload.script,
    sha256: payload.hash,
    allowedActions: payload.allowedActions,
    allowedParameters: payload.allowedParameters,
    requiresAdmin: payload.requiresAdmin,
    requiresReboot: payload.requiresReboot,
    minimumAppVersion: payload.minimumAppVersion,
    expiresAt: payload.expiresAt
  });
  const fixture = createRemoteRunner({ config, getTweakScript: async () => payload });

  await assert.rejects(
    () => fixture.runner.runTweak({ tweakId: 'windows_game_mode', params: { Unsafe: 'x' } }),
    (error) => error?.code === 'REMOTE_TWEAK_UNKNOWN_PARAMETER'
  );
  await assert.rejects(
    () => fixture.runner.runTweak({ tweakId: 'windows_game_mode', params: { Selection: 'Other' } }),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE'
  );
});

test('accepts only bounded numeric values for range selection tweaks', async () => {
  const config = createConfig({
    container_type: 'range_selection',
    range: {
      parameter: 'Value',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      recommended_value: 62
    }
  });
  config.execution.actions.apply.allowed_params = ['Value'];
  const payload = createArtifactPayload({
    allowedParameters: [{
      name: 'Value',
      type: 'number',
      required: false,
      minimum: 0,
      maximum: 100
    }]
  });
  payload.signedPayload = buildSignedPayload({
    tweakId: payload.tweakId,
    artifactVersion: payload.artifactVersion,
    scriptFileName: payload.script,
    sha256: payload.hash,
    allowedActions: payload.allowedActions,
    allowedParameters: payload.allowedParameters,
    requiresAdmin: payload.requiresAdmin,
    requiresReboot: payload.requiresReboot,
    minimumAppVersion: payload.minimumAppVersion,
    expiresAt: payload.expiresAt
  });
  const fixture = createRemoteRunner({ config, getTweakScript: async () => payload });

  const result = await fixture.runner.runTweak({
    tweakId: 'windows_game_mode',
    params: { Value: 62 }
  });

  assert.equal(result.currentValue, 62);
  assert.equal(fixture.calls[0].params.Value, 62);
  await assert.rejects(
    () => fixture.runner.runTweak({ tweakId: 'windows_game_mode', params: { Value: 101 } }),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE'
  );
  await assert.rejects(
    () => fixture.runner.runTweak({ tweakId: 'windows_game_mode', params: { Value: 62.5 } }),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE'
  );
  await assert.rejects(
    () => fixture.runner.runTweak({ tweakId: 'windows_game_mode', params: { Value: '62' } }),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE'
  );
  await assert.rejects(
    () => fixture.runner.runTweak({ tweakId: 'windows_game_mode' }),
    (error) => error?.code === 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE'
  );
});

test('uses the locally pinned range contract when the remote catalog omits it', async () => {
  const localConfig = createConfig({
    container_type: 'range_selection',
    range: {
      parameter: 'Value',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      recommended_value: 62
    }
  });
  localConfig.execution.actions.apply.allowed_params = ['Value'];
  const remoteConfig = structuredClone(localConfig);
  delete remoteConfig.range;
  const payload = createArtifactPayload({
    allowedParameters: [{
      name: 'Value',
      type: 'number',
      required: false,
      minimum: 0,
      maximum: 100
    }]
  });
  payload.signedPayload = buildSignedPayload({
    tweakId: payload.tweakId,
    artifactVersion: payload.artifactVersion,
    scriptFileName: payload.script,
    sha256: payload.hash,
    allowedActions: payload.allowedActions,
    allowedParameters: payload.allowedParameters,
    requiresAdmin: payload.requiresAdmin,
    requiresReboot: payload.requiresReboot,
    minimumAppVersion: payload.minimumAppVersion,
    expiresAt: payload.expiresAt
  });
  const fixture = createRemoteRunner({
    config: remoteConfig,
    localConfig,
    getTweakScript: async () => payload
  });

  const result = await fixture.runner.runTweak({
    tweakId: 'windows_game_mode',
    params: { Value: 62 }
  });

  assert.equal(result.currentValue, 62);
  assert.equal(fixture.calls[0].params.Value, 62);
});

test('rejects a remote range contract that differs from the locally pinned contract', async () => {
  const localConfig = createConfig({
    container_type: 'range_selection',
    range: {
      parameter: 'Value',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      recommended_value: 62
    }
  });
  localConfig.execution.actions.apply.allowed_params = ['Value'];
  const remoteConfig = structuredClone(localConfig);
  remoteConfig.range.max = 200;
  const fixture = createRemoteRunner({
    config: remoteConfig,
    localConfig,
    getTweakScript: async () => createArtifactPayload()
  });

  await assert.rejects(
    () => fixture.runner.runTweak({
      tweakId: 'windows_game_mode',
      params: { Value: 62 }
    }),
    (error) => error?.code === 'REMOTE_TWEAK_SECURITY_BOUNDARY_VIOLATION'
  );
});

test('rejects a remote execution config that weakens a local administrator requirement', async () => {
  const localConfig = createConfig();
  const remoteConfig = createConfig({ requires_admin: false });
  remoteConfig.execution.requires_admin = false;
  remoteConfig.execution.actions.apply.requires_admin = false;
  remoteConfig.execution.actions.restore.requires_admin = false;
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tweak-runner-boundary-'));
  const runner = createTweakRunner({
    novaApi: { getTweakConfig: async () => remoteConfig, getTweakScript: async () => createArtifactPayload() },
    remoteScriptRunner: { runScript: async () => ({}) },
    remoteScriptsPath: cacheRoot,
    allowUnsignedDevelopmentArtifacts: true,
    tweakCatalog: { getConfigById: () => localConfig }
  });

  await assert.rejects(
    () => runner.runTweak({ tweakId: 'windows_game_mode' }),
    (error) => error?.code === 'REMOTE_TWEAK_SECURITY_BOUNDARY_VIOLATION'
  );
});

test('fails closed when no tweak public key is configured', async () => {
  const previousTweakKey = process.env.NOVA_TWEAK_PUBLIC_KEY;
  const previousArtifactKey = process.env.NOVA_ARTIFACT_PUBLIC_KEY;
  const previousGeneratedConfig = { ...generatedSigningConfig };
  delete process.env.NOVA_TWEAK_PUBLIC_KEY;
  delete process.env.NOVA_ARTIFACT_PUBLIC_KEY;
  Object.assign(generatedSigningConfig, {
    NOVA_ARTIFACT_PUBLIC_KEY: '',
    NOVA_ARTIFACT_PUBLIC_KEYS: [],
    NOVA_TWEAK_PUBLIC_KEY: '',
    NOVA_TWEAK_PUBLIC_KEYS: [],
    NOVA_UPDATE_PUBLIC_KEY: ''
  });
  try {
    const fixture = createRemoteRunner({ getTweakScript: async () => createArtifactPayload(), allowUnsignedDevelopmentArtifacts: false });
    await assert.rejects(
      () => fixture.runner.runTweak({ tweakId: 'windows_game_mode' }),
      (error) => error?.code === 'REMOTE_TWEAK_SIGNATURE_KEY_MISSING'
    );
  } finally {
    if (previousTweakKey === undefined) delete process.env.NOVA_TWEAK_PUBLIC_KEY;
    else process.env.NOVA_TWEAK_PUBLIC_KEY = previousTweakKey;
    if (previousArtifactKey === undefined) delete process.env.NOVA_ARTIFACT_PUBLIC_KEY;
    else process.env.NOVA_ARTIFACT_PUBLIC_KEY = previousArtifactKey;
    Object.assign(generatedSigningConfig, previousGeneratedConfig);
  }
});

test('rejects missing and invalid remote tweak signatures when a public key is configured', async () => {
  const previousTweakKey = process.env.NOVA_TWEAK_PUBLIC_KEY;
  const keys = crypto.generateKeyPairSync('ed25519');
  process.env.NOVA_TWEAK_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  try {
    const missingSignature = createRemoteRunner({ getTweakScript: async () => createArtifactPayload(), allowUnsignedDevelopmentArtifacts: false });
    await assert.rejects(
      () => missingSignature.runner.runTweak({ tweakId: 'windows_game_mode' }),
      (error) => error?.code === 'REMOTE_TWEAK_SCRIPT_SIGNATURE_MISSING'
    );

    const invalidPayload = createArtifactPayload({ signature: 'not-a-valid-ed25519-signature' });
    const invalidSignature = createRemoteRunner({ getTweakScript: async () => invalidPayload, allowUnsignedDevelopmentArtifacts: false });
    await assert.rejects(
      () => invalidSignature.runner.runTweak({ tweakId: 'windows_game_mode' }),
      (error) => error?.code === 'REMOTE_TWEAK_SCRIPT_SIGNATURE_INVALID'
    );
  } finally {
    if (previousTweakKey === undefined) delete process.env.NOVA_TWEAK_PUBLIC_KEY;
    else process.env.NOVA_TWEAK_PUBLIC_KEY = previousTweakKey;
  }
});
