const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveExecutionTimeout } = require('./executionTimeout');
test('timeout precedence and integer limits', () => {
  assert.equal(resolveExecutionTimeout(undefined, undefined), 60000);
  assert.equal(resolveExecutionTimeout(undefined, 30000), 30000);
  assert.equal(resolveExecutionTimeout(90000, 30000), 90000);
  assert.equal(resolveExecutionTimeout(1), 1);
  assert.equal(resolveExecutionTimeout(300000), 300000);
  for (const value of [null, 0, -1, 300001, 1.5, NaN, Infinity, '60000']) {
    assert.throws(() => resolveExecutionTimeout(value), { code: 'INVALID_TWEAK_TIMEOUT' });
    assert.throws(() => resolveExecutionTimeout(undefined, value), { code: 'INVALID_TWEAK_TIMEOUT' });
  }
});
