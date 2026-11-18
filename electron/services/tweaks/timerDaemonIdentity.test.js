const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

test('timer identity rejects reused PIDs and invalid state without touching live processes', { skip: process.platform !== 'win32' }, () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../resources/tweaks/scripts/set_timer_resolution/set_timer_resolution.ps1'), 'utf8');
  const functions = source.slice(source.indexOf('function Get-ProcessByPid('), source.indexOf('function Get-TimerCapabilities'));
  const script = String.raw`
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
${functions}
$global:fake = [pscustomobject]@{ Id=200; ProcessName='powershell'; StartTime=[DateTime]'2026-11-18T10:00:00Z' }
function Get-Process { param($Id,$ErrorAction) return $global:fake }
$state = [pscustomobject]@{ pid=200; startedAt='2026-11-18T10:00:05Z'; processStartedAtTicks=[string]$global:fake.StartTime.ToUniversalTime().Ticks }
$results = @()
$results += $null -ne (Get-DaemonProcess $state)
$global:fake.StartTime = $global:fake.StartTime.AddSeconds(1)
$results += $null -ne (Get-DaemonProcess $state)
$state.PSObject.Properties.Remove('processStartedAtTicks')
$results += $null -ne (Get-DaemonProcess $state)
$global:fake.StartTime = $global:fake.StartTime.AddDays(1)
$results += $null -ne (Get-DaemonProcess $state)
$global:fake.StartTime = [DateTime]'2026-11-18T10:00:00Z'
$global:fake.ProcessName = 'unrelated'
$results += $null -ne (Get-DaemonProcess $state)
$global:fake.ProcessName = 'powershell'
$state.startedAt = 'invalid'
$results += $null -ne (Get-DaemonProcess $state)
$global:fake = $null
$results += $null -ne (Get-DaemonProcess $state)
ConvertTo-Json -InputObject $results -Compress
`;
  const output = execFileSync(resolveWindowsSystemExecutable('powershell'), ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.deepEqual(JSON.parse(output.trim()), [true, false, true, false, false, false, false]);
});
