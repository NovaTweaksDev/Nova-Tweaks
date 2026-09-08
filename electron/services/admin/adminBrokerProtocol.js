const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 5 * 60 * 1000;
const PROTOCOL_VERSION = 1;

const ALLOWED_OPERATIONS = new Set([
  'tweak.execute',
  'startup.setEnabled',
  'apps.uninstall',
  'game.configure',
  'apps.optimization.policy',
  'systemRestore.create',
  'systemRestore.restore',
  'network.applyMtu',
  'network.resetMtu',
  'monitoring.installSensorDriver',
  'monitoring.startSidecar',
  'monitoring.stopSidecar',
  'process.terminate'
]);

class AdminBrokerProtocolError extends Error {
  constructor(message, code = 'ADMIN_BROKER_PROTOCOL_ERROR', details = {}) {
    super(message);
    this.name = 'AdminBrokerProtocolError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeTimeout(value, fallback = 60000) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fallback;
  return Math.min(Math.round(timeoutMs), MAX_TIMEOUT_MS);
}

function assertAllowedOperation(operation) {
  const normalized = String(operation || '').trim();
  if (!ALLOWED_OPERATIONS.has(normalized)) {
    throw new AdminBrokerProtocolError('The requested administrator operation is not allowed.', 'ADMIN_BROKER_OPERATION_NOT_ALLOWED', {
      operation: normalized
    });
  }
  return normalized;
}

function createRequest({ id, operation, payload = {}, timeoutMs }) {
  const normalizedId = String(id || '').trim();
  if (!/^[a-f0-9-]{16,64}$/i.test(normalizedId)) {
    throw new AdminBrokerProtocolError('The administrator request id is invalid.');
  }
  if (!isPlainObject(payload)) {
    throw new AdminBrokerProtocolError('The administrator request payload must be an object.');
  }
  return {
    type: 'request',
    protocolVersion: PROTOCOL_VERSION,
    id: normalizedId,
    operation: assertAllowedOperation(operation),
    payload,
    timeoutMs: normalizeTimeout(timeoutMs)
  };
}

function encodeMessage(message) {
  const encoded = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(encoded, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new AdminBrokerProtocolError('The administrator request is too large.', 'ADMIN_BROKER_MESSAGE_TOO_LARGE');
  }
  return encoded;
}

function createLineDecoder(onMessage, onError) {
  let buffered = '';
  return (chunk) => {
    buffered += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    if (Buffer.byteLength(buffered, 'utf8') > MAX_MESSAGE_BYTES) {
      buffered = '';
      onError(new AdminBrokerProtocolError('The administrator response is too large.', 'ADMIN_BROKER_MESSAGE_TOO_LARGE'));
      return;
    }
    let newlineIndex = buffered.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line));
        } catch (error) {
          onError(new AdminBrokerProtocolError('The administrator broker sent invalid JSON.', 'ADMIN_BROKER_PROTOCOL_ERROR', {
            message: error.message
          }));
        }
      }
      newlineIndex = buffered.indexOf('\n');
    }
  };
}

module.exports = {
  ALLOWED_OPERATIONS,
  MAX_MESSAGE_BYTES,
  MAX_TIMEOUT_MS,
  PROTOCOL_VERSION,
  AdminBrokerProtocolError,
  assertAllowedOperation,
  createLineDecoder,
  createRequest,
  encodeMessage,
  normalizeTimeout
};
