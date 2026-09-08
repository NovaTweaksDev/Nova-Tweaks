const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MESSAGE_BYTES,
  MAX_TIMEOUT_MS,
  createRequest,
  encodeMessage
} = require('./adminBrokerProtocol');

test('accepts only fixed administrator operation names and object payloads', () => {
  assert.throws(() => createRequest({
    id: '1234567890abcdef',
    operation: 'powershell.execute',
    payload: { command: 'whoami' }
  }), { code: 'ADMIN_BROKER_OPERATION_NOT_ALLOWED' });
  assert.throws(() => createRequest({
    id: '1234567890abcdef',
    operation: 'process.terminate',
    payload: ['taskkill', '/F']
  }), { code: 'ADMIN_BROKER_PROTOCOL_ERROR' });
});

test('caps operation timeouts and rejects oversized messages', () => {
  const request = createRequest({
    id: '1234567890abcdef',
    operation: 'network.applyMtu',
    payload: {},
    timeoutMs: MAX_TIMEOUT_MS * 2
  });
  assert.equal(request.timeoutMs, MAX_TIMEOUT_MS);
  assert.throws(() => encodeMessage({ payload: 'x'.repeat(MAX_MESSAGE_BYTES) }), {
    code: 'ADMIN_BROKER_MESSAGE_TOO_LARGE'
  });
});
