const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 300000;

/** @param {unknown} explicit @param {unknown} configured */
function resolveExecutionTimeout(explicit, configured) {
  const value = explicit !== undefined ? explicit : configured !== undefined ? configured : DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw Object.assign(new Error('Timeout must be an integer between 1 and 300000 milliseconds.'), {
      code: 'INVALID_TWEAK_TIMEOUT', details: { source: explicit !== undefined ? 'request' : 'configuration' }
    });
  }
  return value;
}
module.exports = { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, resolveExecutionTimeout };
