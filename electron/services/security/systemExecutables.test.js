const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const {
  resolveWindowsSystemExecutable
} = require('./systemExecutables');

test('resolves security-sensitive Windows tools without current-directory search', () => {
  for (const [name, expectedFile] of [
    ['powershell', 'powershell.exe'],
    ['cmd', 'cmd.exe'],
    ['msiexec', 'msiexec.exe'],
    ['reg', 'reg.exe'],
    ['taskkill', 'taskkill.exe'],
    ['tasklist', 'tasklist.exe']
  ]) {
    const resolved = resolveWindowsSystemExecutable(name);
    assert.equal(path.basename(resolved).toLowerCase(), expectedFile);
    if (process.platform === 'win32') {
      assert.equal(path.isAbsolute(resolved), true);
    }
  }
});

test('rejects executables outside the fixed system allowlist', () => {
  assert.throws(
    () => resolveWindowsSystemExecutable('arbitrary-tool'),
    { code: 'TRUSTED_SYSTEM_EXECUTABLE_UNAVAILABLE' }
  );
});
