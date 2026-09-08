const DEFAULT_ENDPOINT = 'http://127.0.0.1:8085/data.json';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_RETRY_DELAY_MS = 400;
const DEFAULT_MAX_RETRIES = 5;

class LhmClientError extends Error {
  constructor(message, code = 'LHM_CLIENT_ERROR', details = {}) {
    super(message);
    this.name = 'LhmClientError';
    this.code = code;
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasNodeTree(value) {
  if (!isObject(value)) {
    return false;
  }

  if (Array.isArray(value.Children)) {
    return true;
  }

  if (isObject(value.Computer) && Array.isArray(value.Computer.Children)) {
    return true;
  }

  if (isObject(value.Root) && Array.isArray(value.Root.Children)) {
    return true;
  }

  return false;
}

async function fetchJsonWithTimeout(endpoint, timeoutMs, authorizationHeader = '') {
  if (typeof fetch !== 'function') {
    throw new LhmClientError('Global fetch API is not available.', 'FETCH_NOT_AVAILABLE');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { Accept: 'application/json' };
    if (authorizationHeader) {
      headers.Authorization = authorizationHeader;
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new LhmClientError('LHM endpoint returned non-success status.', 'LHM_HTTP_ERROR', {
        status: response.status,
        statusText: response.statusText
      });
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new LhmClientError('LHM returned malformed JSON.', 'LHM_INVALID_JSON', {
        message: error.message
      });
    }

    if (!hasNodeTree(payload)) {
      throw new LhmClientError('LHM JSON tree is missing Children nodes.', 'LHM_INVALID_SCHEMA');
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new LhmClientError('LHM request timed out.', 'LHM_TIMEOUT', { timeoutMs });
    }

    if (error instanceof LhmClientError) {
      throw error;
    }

    throw new LhmClientError('Failed to connect to LHM endpoint.', 'LHM_CONNECTION_FAILED', {
      message: error?.message || 'Unknown connection error'
    });
  } finally {
    clearTimeout(timer);
  }
}

function createLhmClient(options = {}) {
  const endpoint = typeof options.endpoint === 'string' && options.endpoint.trim() ? options.endpoint : DEFAULT_ENDPOINT;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : DEFAULT_RETRY_DELAY_MS;
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES;
  const logger = options.logger;
  const username = typeof options.username === 'string' ? options.username : '';
  const password = typeof options.password === 'string' ? options.password : '';
  const authorizationHeader = username && password
    ? `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
    : '';

  async function fetchOnce(override = {}) {
    const effectiveTimeoutMs = Number.isFinite(override.timeoutMs) ? override.timeoutMs : timeoutMs;
    return fetchJsonWithTimeout(endpoint, effectiveTimeoutMs, authorizationHeader);
  }

  async function fetchWithRetry(override = {}) {
    const retries = Number.isFinite(override.maxRetries) ? override.maxRetries : maxRetries;
    const delayMs = Number.isFinite(override.retryDelayMs) ? override.retryDelayMs : retryDelayMs;
    const effectiveTimeoutMs = Number.isFinite(override.timeoutMs) ? override.timeoutMs : timeoutMs;

    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await fetchOnce({ timeoutMs: effectiveTimeoutMs });
      } catch (error) {
        lastError = error;

        logger?.warn?.('LHM fetch attempt failed.', {
          attempt,
          retries,
          code: error.code,
          message: error.message
        });

        if (attempt < retries) {
          await sleep(delayMs);
        }
      }
    }

    throw lastError || new LhmClientError('LHM request failed after retries.', 'LHM_RETRY_EXHAUSTED');
  }

  async function isReachable() {
    try {
      await fetchWithRetry();
      return true;
    } catch (_error) {
      return false;
    }
  }

  return {
    endpoint,
    fetchOnce,
    fetchWithRetry,
    isReachable
  };
}

module.exports = {
  createLhmClient,
  LhmClientError,
  DEFAULT_ENDPOINT
};
