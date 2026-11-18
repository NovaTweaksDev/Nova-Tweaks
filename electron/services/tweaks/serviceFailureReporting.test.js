const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

for (const id of ['disable_fax_service', 'disable_remote_registry', 'disable_print_spooler',
  'disable_windows_search_indexing', 'disable_superfetch', 'xbox_services']) {
  test(`${id} reports service control failures instead of success`, { skip: process.platform !== 'win32' }, () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../resources/tweaks/scripts', id, `${id}.ps1`), 'utf8');
    const body = source.slice(source.indexOf('Set-StrictMode'));
    for (const state of ['On', 'Off']) {
      const mocks = String.raw`
$State = '${state}'
$Silent = $true
function Set-Service { param($Name,$StartupType) }
function Get-Service { param($Name,$ErrorAction) return [pscustomobject]@{Name=$Name;Status='${state === 'On' ? 'Running' : 'Stopped'}';StartType='Manual'} }
function Stop-Service { [CmdletBinding()]param($Name,[switch]$Force) Write-Error 'Simulated SCM stop failure' }
function Start-Service { [CmdletBinding()]param($Name) Write-Error 'Simulated SCM start failure' }
`;
      let error;
      try {
        execFileSync(resolveWindowsSystemExecutable('powershell'), ['-NoProfile', '-NonInteractive', '-Command', mocks + body],
          { encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (reason) { error = reason; }
      assert.ok(error, `${state} must fail when service control fails`);
      assert.equal(error.status, 1);
      const result = JSON.parse(error.stdout.trim());
      assert.equal(result.status, 'Error');
      assert.match(result.message, /Simulated SCM/);
    }
  });
}
