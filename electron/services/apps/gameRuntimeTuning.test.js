const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAppsManager } = require('./appsManager');
const target = 'C:\\Games\\Example.exe';

test('routes runtime tuning through broker with PID and selective settings', async () => {
  const calls = [];
  const expected = { priorityConfigured: true, runtimePriorityClass: 'High' };
  const manager = createAppsManager({ isAdminProvider: () => false, privilegedExecutor: async (...args) => { calls.push(args); return expected; } });
  assert.equal(await manager.configureActiveGame({ executablePath: target, processId: 42, applyFullscreenOptimizations: false, applyPriority: true }), expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'game.configure');
  assert.equal(calls[0][1].processId, 42);
  assert.equal(calls[0][1].applyFullscreenOptimizations, false);
  assert.equal(calls[0][1].applyCpuAffinity, false);
});

test('rejects invalid targets and affinity before privileged execution', async () => {
  const manager = createAppsManager({ privilegedExecutor: () => assert.fail('invalid input reached broker') });
  for (const payload of [
    { executablePath: 'Example.exe' }, { executablePath: 'C:\\Games\\script.ps1' },
    { executablePath: target, processId: -1 }, { executablePath: target, preferHighPriority: 'false' },
    ...[[], [-1], [64], [1.5], [null]].map(cpuAffinityProcessors => ({ executablePath: target, applyCpuAffinity: true, cpuAffinityProcessors }))
  ]) await assert.rejects(manager.configureActiveGame(payload), { code: 'APPS_INVALID_PAYLOAD' });
});

async function captureScript() {
  let script = '';
  const filename = require.resolve('./appsManager');
  const localRequire = createRequire(filename);
  const sandbox = { module: { exports: {} }, process, Buffer, setTimeout, clearTimeout, console,
    require: name => name === 'child_process' ? { spawn: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = source => { script = source; queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{}')); child.emit('close', 0); }); };
      return child;
    } } : localRequire(name)
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  await sandbox.module.exports.createAppsManager({ isAdminProvider: () => true }).configureActiveGame({ executablePath: target });
  return script;
}

test('Windows tuning preserves tokens, targets by path, and reads back live priority and affinity', { skip: process.platform !== 'win32' }, async () => {
  const script = await captureScript();
  const functions = script.slice(script.indexOf('function Split-LayerTokens'), script.indexOf("$layersPath = 'HKCU:"));
  const priorityBlock = script.slice(script.indexOf('if ($applyPriority) {'), script.indexOf('$cpuAffinityApplyErrors = New-Object'));
  const check = `$ErrorActionPreference = 'Stop'
$parseTokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script).toString('base64')}')), [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
${functions}
$tokens = Split-LayerTokens '~ RUNASADMIN DISABLEDXMAXIMIZEDWINDOWEDMODE'
Remove-LayerToken $tokens 'DISABLEDXMAXIMIZEDWINDOWEDMODE'
if (-not (Contains-LayerToken $tokens 'RUNASADMIN')) { throw 'Removed unrelated compatibility flag' }
Add-LayerToken $tokens 'DISABLEDXMAXIMIZEDWINDOWEDMODE'
Add-LayerToken $tokens 'DISABLEDXMAXIMIZEDWINDOWEDMODE'
if ($tokens.Count -ne 3) { throw 'Duplicated compatibility token' }
$childProcess = Get-Process -Id $PID
$originalPriority = $childProcess.PriorityClass
$originalAffinity = $childProcess.ProcessorAffinity
try {
  $resolved = Resolve-TargetRuntimeProcess $childProcess.Path $PID
  if ($resolved.processId -ne $PID -or $resolved.matchState -ne 'preferred-exact-path') { throw 'Wrong runtime target' }
  $wrongTarget = Resolve-TargetRuntimeProcess 'C:\\Missing\\NotThisProcess.exe' $PID
  if ($wrongTarget.processId -ne 0) { throw 'Accepted mismatched PID' }
  $runtimeProcessId = $PID
  $applyPriority = $true
  $preferHighPriority = $true
  $priorityApplyErrors = New-Object System.Collections.ArrayList
  ${priorityBlock}
  if ($priorityApplyErrors.Count -ne 0 -or (Get-RuntimePriorityClass $PID).priorityClass -ne 'High') { throw 'Live priority not applied' }
  $preferHighPriority = $false
  ${priorityBlock}
  if ((Get-RuntimePriorityClass $PID).priorityClass -ne 'Normal') { throw 'Live priority not reset' }
  $available = (Get-ProcessAffinity $PID).cpuAffinityProcessors
  Set-ProcessAffinity $PID @($available[0])
  $actual = (Get-ProcessAffinity $PID).cpuAffinityProcessors
  if ($actual.Count -ne 1 -or $actual[0] -ne $available[0]) { throw 'Affinity readback mismatch' }
  $emptyRejected = $false
  try { Convert-ProcessorsToAffinityMask @() 8 } catch { $emptyRejected = $true }
  if (-not $emptyRejected) { throw 'Accepted empty affinity' }
  $mask = Convert-ProcessorsToAffinityMask @(0, 63) 64
  $roundtrip = Convert-AffinityMaskToProcessors $mask 64
  if ($roundtrip.Count -ne 2 -or $roundtrip[1] -ne 63) { throw '64-bit mask failure' }
  $runtimeProcessId = 0
  ${priorityBlock}
  if ($priorityApplyErrors[0].code -ne 'TARGET_PROCESS_NOT_RUNNING') { throw 'Missing process error lost' }
  $runtimeProcessId = $PID
  $priorityApplyErrors.Clear()
  function Get-Process { throw [UnauthorizedAccessException]::new('Access denied') }
  try {
    ${priorityBlock}
    if ($priorityApplyErrors[0].code -ne 'ACCESS_DENIED') { throw 'Access denied error lost' }
  } finally { Remove-Item Function:Get-Process }
} finally {
  $childProcess.PriorityClass = $originalPriority
  $childProcess.ProcessorAffinity = $originalAffinity
}
'Runtime checks passed'
`;
  const scriptPath = path.join(os.tmpdir(), `nova-runtime-test-${randomUUID()}.ps1`);
  try {
    fs.writeFileSync(scriptPath, check);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /Runtime checks passed/);
  } finally {
    fs.unlinkSync(scriptPath);
  }
});
