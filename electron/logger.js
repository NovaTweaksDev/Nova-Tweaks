const fs = require('fs');
const net = require('net');
const path = require('path');
const { app } = require('electron');

const SENSITIVE_KEY_PATTERN = /token|password|authorization|cookie|secret|mfa|otp|totp|recovery|email|hwid|installid|deviceid|stripe|checkout|command(line)?|arguments?|args|process(name)?|activeTarget|stderr|stdout|user(name|id)?|contact|consumer|avatar|dataurl|image|ip(address)?|appId|appName|entryId|entryName|gameId|gameName|executable(Path|Name)?|path$/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_+/=-]{16,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const OPAQUE_SECRET_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;
const SENSITIVE_QUERY_PATTERN = /([?&][^=&#\s]{1,64}=)[^&#\s]*/g;
const HEX64_PATTERN = /\b[a-f0-9]{64}\b/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const IPV4_PATTERN = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const WINDOWS_USER_PATH_PATTERN = /([A-Z]:\\Users\\)[^\\/\s"]+/gi;
const UNIX_USER_PATH_PATTERN = /(\/(?:home|Users)\/)[^/\s"]+/g;
const IPV6_CANDIDATE_PATTERN = /[0-9a-f:]{2,}(?:%[0-9a-z_.-]+)?/gi;
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function redactIpv6(value) {
  return String(value).replace(IPV6_CANDIDATE_PATTERN, (candidate) => (
    net.isIP(candidate.split('%', 1)[0]) === 6 ? '[redacted-ip]' : candidate
  ));
}

function redactString(value) {
  const redacted = String(value)
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(JWT_PATTERN, '[redacted-token]')
    .replace(BEARER_PATTERN, 'Bearer [redacted-token]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[redacted]')
    .replace(OPAQUE_SECRET_PATTERN, '[redacted-secret]')
    .replace(HEX64_PATTERN, '[redacted-hash]')
    .replace(UUID_PATTERN, '[redacted-id]')
    .replace(IPV4_PATTERN, '[redacted-ip]')
    .replace(WINDOWS_USER_PATH_PATTERN, '$1[redacted-user]')
    .replace(UNIX_USER_PATH_PATTERN, '$1[redacted-user]');
  return redactIpv6(redacted);
}

function redactMeta(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactMeta(entry));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactMeta(entryValue, entryKey)])
    );
  }

  return value;
}

function safeSerialize(meta) {
  try {
    return meta ? ` ${JSON.stringify(redactMeta(meta))}` : '';
  } catch (_error) {
    return ' {"meta":"unserializable"}';
  }
}

function resolveLogFilePath(fileName) {
  try {
    const logsPath = app.getPath('logs');
    fs.mkdirSync(logsPath, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      fs.chmodSync(logsPath, 0o700);
    }
    return path.join(logsPath, fileName);
  } catch (_error) {
    const fallback = path.join(process.cwd(), 'logs');
    fs.mkdirSync(fallback, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      fs.chmodSync(fallback, 0o700);
    }
    return path.join(fallback, fileName);
  }
}

function createLogger(scope = 'main') {
  const logFilePath = resolveLogFilePath(`${scope}.log`);
  const rotatedLogFilePath = resolveLogFilePath(`${scope}.previous.log`);
  for (const candidate of [logFilePath, rotatedLogFilePath]) {
    try {
      if (Date.now() - fs.statSync(candidate).mtimeMs > MAX_LOG_AGE_MS) {
        fs.rmSync(candidate, { force: true });
      } else if (process.platform !== 'win32') {
        fs.chmodSync(candidate, 0o600);
      }
    } catch (_error) {}
  }
  let currentSize = 0;
  try {
    currentSize = fs.statSync(logFilePath).size;
  } catch (_error) {}

  function write(level, message, meta) {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${redactString(message)}${safeSerialize(meta)}\n`;

    try {
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (currentSize > 0 && currentSize + lineBytes > MAX_LOG_FILE_BYTES) {
        fs.rmSync(rotatedLogFilePath, { force: true });
        fs.renameSync(logFilePath, rotatedLogFilePath);
        currentSize = 0;
      }
      fs.appendFileSync(logFilePath, line, {
        encoding: 'utf8',
        mode: 0o600
      });
      if (process.platform !== 'win32') {
        fs.chmodSync(logFilePath, 0o600);
      }
      currentSize += lineBytes;
    } catch (_error) {
      // Avoid recursive logger failures.
    }

    if (level === 'error') {
      console.error(line.trim());
      return;
    }

    if (level === 'warn') {
      console.warn(line.trim());
      return;
    }

    console.log(line.trim());
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta)
  };
}

module.exports = {
  createLogger,
  redactMeta,
  redactString
};
