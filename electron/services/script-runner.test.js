const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createScriptRunner } = require('./script-runner');

test('script runner lists scripts below the configured root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-script-runner-'));
  fs.mkdirSync(path.join(tempRoot, 'network'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'network', 'flushdns.ps1'), 'Write-Output "ok"', 'utf8');

  const runner = createScriptRunner({ scriptsPath: tempRoot });

  assert.deepEqual(runner.listScripts(), ['network/flushdns.ps1']);
});

test('script runner rejects traversal paths before spawning PowerShell', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-script-runner-'));
  const runner = createScriptRunner({ scriptsPath: tempRoot });

  await assert.rejects(
    () => runner.runScript({ scriptName: '../outside.ps1' }),
    /Invalid script name/
  );
});

test('script runner rejects invalid parameter names before spawning PowerShell', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-script-runner-'));
  fs.writeFileSync(path.join(tempRoot, 'safe.ps1'), 'Write-Output "ok"', 'utf8');
  const runner = createScriptRunner({ scriptsPath: tempRoot });

  await assert.rejects(
    () => runner.runScript({ scriptName: 'safe.ps1', params: { 'Bad-Name': true } }),
    /Invalid script parameter name/
  );
});
