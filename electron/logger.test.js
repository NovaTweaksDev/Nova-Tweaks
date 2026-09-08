const test = require('node:test');
const assert = require('node:assert/strict');

const { redactMeta, redactString } = require('./logger');

test('desktop logger redacts account, process, token, network, and query data', () => {
  const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  const redacted = redactMeta({
    appId: 'sensitive-health-app',
    entryId: 'private-startup-entry',
    processName: 'private-game.exe',
    username: 'customer',
    mfaCode: '123456',
    safeCount: 2,
    message: `user@example.com ${jwt} 192.168.1.20 2001:db8::7 https://example.test/?q=private`
  });

  assert.equal(redacted.appId, '[redacted]');
  assert.equal(redacted.entryId, '[redacted]');
  assert.equal(redacted.processName, '[redacted]');
  assert.equal(redacted.username, '[redacted]');
  assert.equal(redacted.mfaCode, '[redacted]');
  assert.equal(redacted.safeCount, 2);
  assert.doesNotMatch(redacted.message, /user@example\.com|192\.168\.1\.20|2001:db8|private|a{20}/);
  assert.match(redactString('C:\\Users\\Alice\\report.txt'), /redacted-user/);
  assert.match(redactString('/home/alice/report.txt'), /redacted-user/);
});
