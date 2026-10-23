const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');
const { closeApps } = require('./backgroundApps');
const { createBackgroundServiceControl } = require('./backgroundServiceControl');

// Execute generated control flow against fake SCM/process APIs only. These
// tests never enumerate, stop or close real services/processes.
function run(script) {
  return JSON.parse(execFileSync(resolveWindowsSystemExecutable('powershell'), ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 }).trim());
}

test('generated service script verifies disable, refuses dependencies and detects stale snapshots', { skip: process.platform !== 'win32' }, async () => {
  let script;
  const original = { startType: 'Automatic', status: 'Running', delayed: true };
  const target = { startType: 'Disabled', status: 'Stopped', delayed: true };
  await createBackgroundServiceControl({ execute: (_file, args, _options, done) => { script = args.at(-1); done(null, '{}'); } })({ action: 'disable', name: 'WSearch', expected: original, target });
  const mocks = String.raw`
$global:fake = [pscustomobject]@{ Name='WSearch'; StartType='Automatic'; Status='Running'; DependentServices=@() }
$global:fake | Add-Member ScriptMethod WaitForStatus { param($state,$timeout) if ($this.Status -ne $state) { throw 'Wrong state' } }
function Get-Service { param($Name,$ErrorAction) return $global:fake }
function Get-ItemProperty { param($LiteralPath) return [pscustomobject]@{DelayedAutoStart=1} }
function Set-ItemProperty { param($LiteralPath,$Name,$Type,$Value) }
function Stop-Service { param($Name,$ErrorAction,[switch]$NoWait) $global:fake.Status='Stopped' }
function Start-Service { param($Name,$ErrorAction) $global:fake.Status='Running' }
function Set-Service { param($Name,$StartupType,$ErrorAction) $global:fake.StartType=$StartupType }
`;
  const result = run(mocks + script);
  assert.equal(result.ok, true);
  assert.equal(result.state.startType, 'Disabled');
  assert.equal(result.state.status, 'Stopped');
  assert.equal(result.state.delayed, true);
  const dependents = run(mocks + "$global:fake.DependentServices=@([pscustomobject]@{Name='Required';Status='Running'})\n" + script);
  assert.equal(dependents.code, 'SERVICE_DEPENDENTS_RUNNING');
  assert.equal(dependents.state.startType, 'Automatic');
  const conflict = run(mocks + "$global:fake.StartType='Manual'\n" + script);
  assert.equal(conflict.code, 'SERVICE_STATE_CONFLICT');
});

test('generated app close script rejects PID reuse and other owners, handles refusals and shares one deadline', { skip: process.platform !== 'win32' }, async () => {
  let script;
  const targets = [201, 202, 203, 204, 205, 206].map((pid) => ({ pid, startTime: 'original', executablePath: 'C:\\Apps\\browser.exe', ownerSid: 'OWN' }));
  await closeApps(targets, async (value) => { script = value; return []; });
  const body = script.slice(script.indexOf('$targets =')).replace('$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value', "$sid = 'OWN'");
  const mocks = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public static class NovaProcessIdentity {
  public static HashSet<int> Closed = new HashSet<int>();
  public static string[] Query(int pid) {
    if (Closed.Contains(pid)) return new string[]{"", ""};
    return new string[]{@"C:\Apps\browser.exe", pid == 201 ? "reused" : "original"};
  }
}
'@
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) return [pscustomobject]@{pid=[int]($Filter -replace 'ProcessId=','')} }
function Invoke-CimMethod { param($InputObject,$MethodName,$ErrorAction) return [pscustomobject]@{Sid=$(if($InputObject.pid -eq 202){'OTHER'}else{'OWN'})} }
function Get-Process {
  param($Id,$ErrorAction)
  $item=[pscustomobject]@{Id=$Id;MainWindowHandle=1}
  $item | Add-Member ScriptMethod CloseMainWindow {
    if($this.Id -eq 203){ return $false }
    if($this.Id -eq 204){ [void][NovaProcessIdentity]::Closed.Add($this.Id) }
    return $true
  }
  return $item
}
$global:now=[DateTime]::UtcNow
`;
  // Capture elapsed time inside PowerShell so process startup/compilation does
  // not affect the shared five-second window assertion.
  const timed = body.replace('ConvertTo-Json -InputObject @($results) -Depth 5 -Compress', "@{results=@($results);elapsed=([DateTime]::UtcNow-$global:now).TotalSeconds} | ConvertTo-Json -Depth 6 -Compress");
  const result = run(mocks + timed);
  assert.equal(result.results.find((item) => item.pid === 201).code, 'PROCESS_IDENTITY_CHANGED');
  assert.equal(result.results.find((item) => item.pid === 202).code, 'PROCESS_IDENTITY_CHANGED');
  assert.equal(result.results.find((item) => item.pid === 203).code, 'APP_CLOSE_UNSUPPORTED');
  assert.equal(result.results.find((item) => item.pid === 204).status, 'closed');
  assert.equal(result.results.find((item) => item.pid === 205).code, 'APP_STILL_RUNNING');
  assert.equal(result.results.find((item) => item.pid === 206).code, 'APP_STILL_RUNNING');
  assert.ok(result.elapsed >= 5 && result.elapsed < 8, `Expected one shared wait, got ${result.elapsed}s`);
});
