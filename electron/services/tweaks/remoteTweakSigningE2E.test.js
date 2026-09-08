const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createScriptRunner } = require('../script-runner');
const { createTweakRunner } = require('./tweakRunner');
const { canonicalJson } = require('../security/artifactVerifier');
const { buildSignedPayload, sha256Hex } = require('./remoteTweakArtifactCache');

const privateKey = String(process.env.NOVA_TWEAK_SIGNING_PRIVATE_KEY || process.env.NOVA_ARTIFACT_SIGNING_PRIVATE_KEY || '').trim();
const publicKey = String(process.env.NOVA_TWEAK_PUBLIC_KEY || process.env.NOVA_ARTIFACT_PUBLIC_KEY || '').trim();

function createSafeConfig() {
  const action = (state) => ({
    args: ['-State', state, '-Silent'],
    success_exit_codes: [0],
    requires_admin: false
  });
  return {
    id: 'safe_signing_test',
    name: 'Safe signing test',
    script: 'safe_signing_test.ps1',
    requires_admin: false,
    reboot_required: false,
    execution: {
      type: 'powershell',
      script: 'safe_signing_test.ps1',
      requires_admin: false,
      timeout_ms: 10000,
      supports_status_detection: true,
      actions: {
        apply: action('On'),
        detect: action('Check'),
        restore: action('Off')
      }
    }
  };
}

function createSignedApiArtifact() {
  const content = [
    'param([ValidateSet("Check", "On", "Off")][string]$State, [switch]$Silent)',
    'if ($State -eq "Check") { Write-Output \'{"status":"disabled"}\'; exit 0 }',
    'Write-Output \'{"status":"enabled"}\'',
    'exit 0'
  ].join('\r\n');
  const artifact = {
    tweakId: 'safe_signing_test',
    artifactVersion: 'e2e-1',
    scriptFileName: 'safe_signing_test.ps1',
    sha256: sha256Hex(content),
    allowedActions: ['Check', 'Off', 'On'],
    allowedParameters: [],
    requiresAdmin: false,
    requiresReboot: false,
    minimumAppVersion: '',
    expiresAt: '',
    revoked: false
  };
  const signedPayload = buildSignedPayload(artifact);
  return {
    ...artifact,
    script: artifact.scriptFileName,
    hash: artifact.sha256,
    content,
    signedPayload,
    signature: crypto.sign(
      null,
      Buffer.from(canonicalJson(signedPayload), 'utf8'),
      privateKey
    ).toString('base64')
  };
}

test('signs a safe local API artifact, verifies it in the desktop, executes it, and uses the offline cache', {
  skip: !privateKey || !publicKey ? 'Set NOVA_TWEAK_SIGNING_PRIVATE_KEY and NOVA_TWEAK_PUBLIC_KEY for the local signing E2E test.' : false
}, async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-signing-e2e-'));
  const config = createSafeConfig();
  const artifact = createSignedApiArtifact();
  let online = true;
  const scriptRunner = createScriptRunner({ scriptsPath: cacheRoot });
  const runner = createTweakRunner({
    novaApi: {
      getTweakConfig: async () => config,
      getTweakScript: async () => {
        if (!online) {
          const error = new Error('local API unavailable');
          error.code = 'LOCAL_API_UNAVAILABLE';
          throw error;
        }
        return artifact;
      }
    },
    remoteScriptRunner: scriptRunner,
    remoteScriptsPath: cacheRoot,
    getAppVersion: () => '1.0.0',
    tweakCatalog: { getConfigById: () => config }
  });

  const firstRun = await runner.runTweak({ tweakId: 'safe_signing_test', targetState: 'enabled' });
  assert.equal(firstRun.ok, true);
  assert.equal(firstRun.status, 'enabled');
  const metadataPath = path.join(cacheRoot, 'safe_signing_test', 'e2e-1', 'metadata.json');
  assert.equal(fs.existsSync(path.join(cacheRoot, 'safe_signing_test', 'e2e-1', 'script.ps1')), true);
  assert.equal(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).signatureStatus, 'verified');

  online = false;
  const offlineRun = await runner.runTweak({ tweakId: 'safe_signing_test', targetState: 'enabled' });
  assert.equal(offlineRun.ok, true);
  assert.equal(offlineRun.status, 'enabled');
});
