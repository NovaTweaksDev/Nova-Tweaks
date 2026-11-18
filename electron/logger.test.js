const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { redactMeta, redactString } = require('./logger');

test('packaged builds omit debug output and console mirroring while retaining diagnostic files', () => {
  const writes = [];
  const consoleCalls = [];
  const context = { module: { exports: {} }, process, Buffer,
    console: Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => consoleCalls.push(args)])),
    require: (name) => name === 'electron' ? { app: { isPackaged: true, getPath: () => 'logs' } }
      : name === 'fs' ? { mkdirSync() {}, chmodSync() {}, statSync: () => ({ size: 0, mtimeMs: Date.now() }),
        appendFileSync: (_file, text) => writes.push(text) } : require(name)
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./logger'), 'utf8'), context);
  const logger = context.module.exports.createLogger('audit');
  logger.debug('Noisy debug payload');
  logger.info('Startup completed');
  logger.warn('Recoverable failure');
  logger.error('Operation failed');
  assert.equal(writes.length, 3);
  assert.equal(consoleCalls.length, 0);
  assert.ok(writes.every((line) => !line.includes('Noisy debug payload')));
});

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
