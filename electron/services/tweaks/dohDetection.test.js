const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const scriptPath = path.resolve(__dirname, '../../../resources/tweaks/scripts/enable_dns_over_https_doh/enable_dns_over_https_doh.ps1');
const scenarios = [
  { name: 'no DNS servers', addresses: [], doh: [], status: 'Disabled' },
  { name: 'one DNS server with DoH', addresses: ['1.1.1.1'], doh: [{ ServerAddress: '1.1.1.1', AutoUpgrade: true }], status: 'Enabled' },
  { name: 'one DNS server without DoH', addresses: ['1.1.1.1'], doh: [{ ServerAddress: '1.1.1.1', AutoUpgrade: false }], status: 'Disabled' },
  { name: 'unconfigured DNS server', addresses: ['192.168.1.1'], doh: [], status: 'Disabled' },
  { name: 'multiple servers with one enabled', addresses: ['1.1.1.1', '8.8.8.8'], doh: [{ ServerAddress: '8.8.8.8', AutoUpgrade: true }], status: 'Enabled' },
  { name: 'DoH on an unused server', addresses: ['192.168.1.1'], doh: [{ ServerAddress: '1.1.1.1', AutoUpgrade: true }], status: 'Disabled' },
  { name: 'DNS query failure', addresses: ['1.1.1.1'], doh: [], failDns: true, status: 'Error' },
  { name: 'DoH query failure', addresses: ['1.1.1.1'], doh: [], failDoh: true, status: 'Error' }
];

for (const scenario of scenarios) {
  test(`DoH Check handles ${scenario.name} without writing network settings`, { skip: process.platform !== 'win32' }, () => {
    const fixture = JSON.stringify({ failDns: false, failDoh: false, ...scenario }).replace(/'/g, "''");
    // Every Windows query is mocked. Modification commands are rejected even
    // if the script were accidentally to enter an apply/restore branch.
    const command = `
$fixture = '${fixture}' | ConvertFrom-Json
function Get-DnsClientServerAddress {
  [CmdletBinding()] param($AddressFamily)
  if ($fixture.failDns) { throw 'DNS query denied' }
  [pscustomobject]@{ ServerAddresses = @($fixture.addresses) }
}
function Get-DnsClientDohServerAddress {
  [CmdletBinding()] param($ServerAddress)
  if ($fixture.failDoh) { throw 'DoH query denied' }
  $fixture.doh
}
function Add-DnsClientDohServerAddress { throw 'Unexpected network modification' }
function Set-DnsClientDohServerAddress { throw 'Unexpected network modification' }
& '${scriptPath.replace(/'/g, "''")}' -State Check -Silent
`;
    const result = spawnSync(resolveWindowsSystemExecutable('powershell'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.ifError(result.error);
    assert.equal(result.status, scenario.status === 'Error' ? 1 : 0, result.stdout + result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.status, scenario.status, output.message);
    if (scenario.failDns) assert.match(output.message, /DNS query denied/);
    if (scenario.failDoh) assert.match(output.message, /DoH query denied/);
  });
}
