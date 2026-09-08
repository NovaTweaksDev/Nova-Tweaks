const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const BACKUP_SCHEMA = 'nova-tweaks-backup';
const BACKUP_SCHEMA_VERSION = 1;
const INDEX_SCHEMA = 'nova-tweaks-backup-index';
const INDEX_SCHEMA_VERSION = 1;
const INDEX_FILE_NAME = 'index.json';
const ALLOWED_TYPES = new Set(['manual', 'automatic', 'auto', 'beforeApply']);
const BACKUP_STATUSES = new Set(['successful', 'failed', 'running', 'ready']);
const DEFAULT_BACKUP_SETTINGS = {
  automaticBackupsEnabled: false,
  frequencyDays: 7,
  cleanOlderThanDays: 30,
  maxStorageBytes: 0
};
const ALLOWED_SCOPES = new Set([
  'tweakStates',
  'powerPlans',
  'timerProfiles',
  'bootBcd',
  'registryChanges',
  'serviceTweaks',
  'appSettings'
]);
const CAPTURE_STATUSES = new Set(['complete', 'partial', 'unavailable']);
const WINDOWS_RESTORE_SCOPE = ['systemRestore', 'bootBcd', 'registryChanges'];
const WINDOWS_RESTORE_POINT_PREFIX = 'winrp-';
const WINDOWS_RESTORE_TIMEOUT_MS = 180000;
const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;

class BackupManagerError extends Error {
  constructor(message, code = 'BACKUP_MANAGER_ERROR', details = {}) {
    super(message);
    this.name = 'BackupManagerError';
    this.code = code;
    this.details = details;
  }
}

function createDefaultIndex() {
  return {
    schema: INDEX_SCHEMA,
    schemaVersion: INDEX_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    settings: { ...DEFAULT_BACKUP_SETTINGS },
    backups: [],
    windowsRestorePoints: [],
    storage: {
      engine: 'nova-json'
    }
  };
}

function normalizeBackupType(value) {
  const type = typeof value === 'string' ? value.trim() : '';
  if (type === 'auto') {
    return 'automatic';
  }

  return ALLOWED_TYPES.has(type) ? type : 'manual';
}

function normalizeBackupStatus(value) {
  const status = typeof value === 'string' ? value.trim() : '';
  if (status === 'ready') {
    return 'successful';
  }

  return BACKUP_STATUSES.has(status) ? status : 'successful';
}

function normalizeBackupSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const frequencyDays = Number.parseInt(String(source.frequencyDays ?? DEFAULT_BACKUP_SETTINGS.frequencyDays), 10);
  const cleanOlderThanDays = Number.parseInt(String(source.cleanOlderThanDays ?? DEFAULT_BACKUP_SETTINGS.cleanOlderThanDays), 10);
  const maxStorageBytes = Number.parseInt(String(source.maxStorageBytes ?? DEFAULT_BACKUP_SETTINGS.maxStorageBytes), 10);

  return {
    automaticBackupsEnabled: source.automaticBackupsEnabled === true,
    frequencyDays: Number.isInteger(frequencyDays) && frequencyDays > 0 ? frequencyDays : DEFAULT_BACKUP_SETTINGS.frequencyDays,
    cleanOlderThanDays: Number.isInteger(cleanOlderThanDays) && cleanOlderThanDays > 0
      ? cleanOlderThanDays
      : DEFAULT_BACKUP_SETTINGS.cleanOlderThanDays,
    maxStorageBytes: Number.isInteger(maxStorageBytes) && maxStorageBytes > 0 ? maxStorageBytes : 0
  };
}

function cleanName(value) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized || 'Nova Backup';
}

function toFileSafeName(value) {
  return cleanName(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 120) || 'nova-backup';
}

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '0 B';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kiloBytes = sizeBytes / 1024;
  if (kiloBytes < 1024) {
    return `${Math.max(1, Math.round(kiloBytes))} KB`;
  }

  return `${(kiloBytes / 1024).toFixed(1)} MB`;
}

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function normalizeIsoTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  return new Date().toISOString();
}

function toWindowsRestorePointId(sequenceNumber) {
  return `${WINDOWS_RESTORE_POINT_PREFIX}${sequenceNumber}`;
}

function parseWindowsRestorePointId(backupId) {
  const value = typeof backupId === 'string' ? backupId.trim().toLowerCase() : '';
  if (!value.startsWith(WINDOWS_RESTORE_POINT_PREFIX)) {
    return null;
  }

  const parsed = Number.parseInt(value.slice(WINDOWS_RESTORE_POINT_PREFIX.length), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function repairWindowsRestorePointText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '';
  }

  return text
    .replace(/Geplanter Pr�fpunkt/g, 'Geplanter Prüfpunkt')
    .replace(/Pr�fpunkt/g, 'Prüfpunkt')
    .replace(/Wiederherstellungspunkt f�r/g, 'Wiederherstellungspunkt für');
}

function normalizeWindowsRestorePoint(entry) {
  const sequenceNumber = Number.parseInt(String(entry?.sequenceNumber ?? ''), 10);
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
    return null;
  }

  const description = repairWindowsRestorePointText(entry?.description);
  const createdAt = normalizeIsoTimestamp(entry?.createdAt);
  const numericEventType = Number.parseInt(String(entry?.eventType ?? ''), 10);
  const numericRestorePointType = Number.parseInt(String(entry?.restorePointType ?? ''), 10);

  return {
    id: toWindowsRestorePointId(sequenceNumber),
    sequenceNumber,
    name: description || `Windows Restore Point #${sequenceNumber}`,
    fileName: '',
    createdAt,
    updatedAt: createdAt,
    type: 'restorePoint',
    origin: 'windows',
    scope: [...WINDOWS_RESTORE_SCOPE],
    sizeBytes: 0,
    sizeLabel: 'System-managed',
    status: 'successful',
    description: 'Windows System Restore point',
    path: '',
    appVersion: '',
    includedItems: [...WINDOWS_RESTORE_SCOPE],
    adminRequired: true,
    rebootLikely: true,
    eventType: Number.isInteger(numericEventType) ? numericEventType : null,
    restorePointType: Number.isInteger(numericRestorePointType) ? numericRestorePointType : null
  };
}

function mapWindowsRestoreError(error, fallbackMessage, details = {}) {
  const source = error instanceof BackupManagerError
    ? {
        code: error.code,
        message: error.message,
        stdout: typeof error?.details?.stdout === 'string' ? error.details.stdout : '',
        stderr: typeof error?.details?.stderr === 'string' ? error.details.stderr : '',
        exitCode: error?.details?.exitCode
      }
    : {
        code: error?.code,
        message: typeof error?.message === 'string' ? error.message : '',
        stdout: typeof error?.stdout === 'string' ? error.stdout : '',
        stderr: typeof error?.stderr === 'string' ? error.stderr : '',
        exitCode: error?.exitCode
      };

  const stderr = source.stderr;
  const stdout = source.stdout;
  const message = source.message;
  const combined = [stderr, stdout, message].join('\n').toLowerCase();

  let code = 'WINDOWS_RESTORE_FAILED';
  let resolvedMessage = fallbackMessage;

  if (combined.includes('already been created within the past') || combined.includes('0x81000101')) {
    code = 'WINDOWS_RESTORE_THROTTLED';
    resolvedMessage = 'Windows is limiting restore point creation (commonly to one per 24 hours). This is not a Nova error. Use "Save Nova Config" now or try the Windows restore point again later.';
  } else if (
    combined.includes('system restore is disabled')
    || combined.includes('not enabled on this drive')
    || combined.includes('enable-computerrestore')
  ) {
    code = 'WINDOWS_RESTORE_DISABLED';
    resolvedMessage = 'System Restore is disabled for the system drive.';
  } else if (
    combined.includes('access is denied')
    || combined.includes('access denied')
    || combined.includes('administrator')
    || combined.includes('requires elevation')
  ) {
    code = 'WINDOWS_RESTORE_ADMIN_REQUIRED';
    resolvedMessage = 'Administrator privileges are required for Windows restore operations.';
  } else if (combined.includes('checkpoint_computer_not_available')) {
    code = 'WINDOWS_RESTORE_UNSUPPORTED';
    resolvedMessage = 'Checkpoint-Computer is unavailable on this system.';
  } else if (combined.includes('invalid class')) {
    code = 'WINDOWS_RESTORE_UNSUPPORTED';
    resolvedMessage = 'System Restore provider is unavailable on this system.';
  } else if (combined.includes('restore_point_not_found')) {
    code = 'WINDOWS_RESTORE_POINT_NOT_FOUND';
    resolvedMessage = 'The selected Windows restore point could not be found.';
  } else if (source.code === 'WINDOWS_RESTORE_TIMEOUT') {
    code = source.code;
    resolvedMessage = 'Timed out while accessing Windows restore points.';
  } else if (source.code === 'WINDOWS_RESTORE_PROCESS_FAILED') {
    code = source.code;
    resolvedMessage = 'Could not start PowerShell for Windows restore operations.';
  }

  return new BackupManagerError(resolvedMessage, code, {
    ...details,
    sourceCode: typeof source.code === 'string' ? source.code : '',
    message,
    stdout,
    stderr,
    exitCode: Number.isInteger(source.exitCode) ? source.exitCode : null
  });
}

function normalizeScope(scope) {
  const list = Array.isArray(scope) ? scope : [];
  return Array.from(
    new Set(
      list
        .map((entry) => String(entry || '').trim())
        .filter((entry) => ALLOWED_SCOPES.has(entry))
    )
  );
}

function getSectionEntries(section) {
  if (!section || typeof section !== 'object') {
    return [];
  }

  const data = section.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter((entry) => entry && typeof entry === 'object');
}

function resolveRestoreScope(availableScope, requestedScope) {
  const normalizedAvailable = normalizeScope(availableScope);
  const availableSet = new Set(normalizedAvailable);
  const normalizedRequested = normalizeScope(requestedScope);

  if (!normalizedRequested.length) {
    return normalizedAvailable;
  }

  return normalizedRequested.filter((scopeId) => availableSet.has(scopeId));
}

function inferCaptureStatus(section) {
  if (CAPTURE_STATUSES.has(section?.captureStatus)) {
    return section.captureStatus;
  }

  const data = Array.isArray(section?.data)
    ? section.data
    : section?.data && typeof section.data === 'object'
      ? section.data
      : null;

  if (Array.isArray(data) && data.length > 0) {
    return 'complete';
  }

  if (data && !Array.isArray(data) && Object.keys(data).length > 0) {
    return 'complete';
  }

  return 'unavailable';
}

function normalizeSection(scopeId, source) {
  const section = source && typeof source === 'object' ? source : {};
  const captureStatus = inferCaptureStatus(section);
  const data = Array.isArray(section.data)
    ? section.data
    : section.data && typeof section.data === 'object'
      ? section.data
      : [];

  const itemCount = Number.isFinite(section.itemCount)
    ? Math.max(0, Math.trunc(section.itemCount))
    : Array.isArray(data)
      ? data.length
      : Object.keys(data || {}).length;

  return {
    scopeId,
    capturedAt: typeof section.capturedAt === 'string' && section.capturedAt.trim()
      ? section.capturedAt
      : new Date().toISOString(),
    captureStatus,
    itemCount,
    summary: typeof section.summary === 'string' ? section.summary.trim() : '',
    data
  };
}

function normalizeSnapshot(snapshot, scope) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const normalized = {};

  for (const scopeId of scope) {
    normalized[scopeId] = normalizeSection(scopeId, source[scopeId]);
  }

  return normalized;
}

function computeAdminRequired(scope, snapshot = null) {
  if (scope.includes('bootBcd') || scope.includes('registryChanges') || scope.includes('serviceTweaks')) {
    return true;
  }

  for (const scopeId of scope) {
    const entries = getSectionEntries(snapshot?.[scopeId]);
    if (entries.some((entry) => Boolean(entry?.requiresAdmin))) {
      return true;
    }
  }

  return false;
}

function computeRebootLikely(scope, snapshot = null) {
  if (scope.includes('bootBcd')) {
    return true;
  }

  for (const scopeId of scope) {
    const entries = getSectionEntries(snapshot?.[scopeId]);
    if (entries.some((entry) => Boolean(entry?.rebootRequired))) {
      return true;
    }
  }

  return false;
}

function createMetadataFromDocument(document, stat = null, filePath = '') {
  const sizeBytes = Number.isFinite(stat?.size)
    ? stat.size
    : Buffer.byteLength(JSON.stringify(document), 'utf8');
  const scope = normalizeScope(document.scope);
  const description = typeof document.description === 'string' && document.description.trim()
    ? document.description.trim()
    : typeof document?.meta?.description === 'string'
      ? document.meta.description.trim()
      : 'Nova Tweaks configuration backup';

  return {
    id: document.id,
    name: cleanName(document.name),
    fileName: document.fileName,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt || document.createdAt,
    type: normalizeBackupType(document.type),
    origin: 'nova',
    scope,
    includedItems: scope,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    status: normalizeBackupStatus(document.status),
    description,
    path: filePath,
    appVersion: typeof document?.app?.version === 'string' ? document.app.version : '',
    adminRequired: computeAdminRequired(scope, document.snapshot),
    rebootLikely: computeRebootLikely(scope, document.snapshot)
  };
}

function validateBackupDocument(input) {
  const document = input && typeof input === 'object' ? input : null;
  if (!document) {
    throw new BackupManagerError('Backup document must be an object.', 'INVALID_BACKUP_FILE');
  }

  if (document.schema !== BACKUP_SCHEMA || Number(document.schemaVersion) !== BACKUP_SCHEMA_VERSION) {
    throw new BackupManagerError('Backup file schema is not supported.', 'INVALID_BACKUP_FILE', {
      schema: document.schema,
      schemaVersion: document.schemaVersion
    });
  }

  const id = typeof document.id === 'string' ? document.id.trim() : '';
  if (!id) {
    throw new BackupManagerError('Backup file is missing a valid id.', 'INVALID_BACKUP_FILE');
  }

  const scope = normalizeScope(document.scope);
  if (!scope.length) {
    throw new BackupManagerError('Backup file does not contain a valid scope.', 'INVALID_BACKUP_FILE');
  }

  const name = cleanName(document.name);
  const createdAt = typeof document.createdAt === 'string' ? document.createdAt : '';
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) {
    throw new BackupManagerError('Backup file is missing a valid creation date.', 'INVALID_BACKUP_FILE');
  }

  if (document.origin && document.origin !== 'nova') {
    throw new BackupManagerError('Only Nova backup files can be imported.', 'INVALID_BACKUP_FILE', {
      origin: document.origin
    });
  }

  const updatedAt = typeof document.updatedAt === 'string' && Number.isFinite(Date.parse(document.updatedAt))
    ? document.updatedAt
    : createdAt;

  const type = normalizeBackupType(document.type);
  const snapshot = normalizeSnapshot(document.snapshot, scope);

  return {
    schema: BACKUP_SCHEMA,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    id,
    fileName: typeof document.fileName === 'string' && document.fileName.trim()
      ? document.fileName.trim()
      : `${id}.json`,
    name,
    createdAt,
    updatedAt,
    type,
    status: normalizeBackupStatus(document.status),
    description: typeof document.description === 'string' ? document.description.trim() : '',
    origin: 'nova',
    scope,
    app: document.app && typeof document.app === 'object' ? document.app : {},
    meta: document.meta && typeof document.meta === 'object' ? document.meta : {},
    snapshot
  };
}

function dedupeName(name, existingNames) {
  const taken = new Set(existingNames.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean));
  const base = cleanName(name);
  if (!taken.has(base.toLowerCase())) {
    return base;
  }

  let counter = 2;
  while (taken.has(`${base} (${counter})`.toLowerCase())) {
    counter += 1;
  }

  return `${base} (${counter})`;
}

async function readJsonFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BACKUP_FILE_BYTES) {
    throw new BackupManagerError(
      'Backup file is empty or exceeds the supported size limit.',
      'INVALID_BACKUP_FILE_SIZE'
    );
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });

  try {
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') {
        throw error;
      }

      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') {
          throw unlinkError;
        }
      }
      await fs.rename(tempPath, filePath);
    }
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw cleanupError;
      }
    }
  }
  if (process.platform !== 'win32') {
    await fs.chmod(filePath, 0o600);
  }
}

function createBackupManager({ app, dialog, logger, getAppVersion, getBackupRoot, windowsRestoreStateProvider }) {
  if (!app?.getPath) {
    throw new Error('createBackupManager requires an Electron app instance.');
  }

  if (!dialog?.showOpenDialog || !dialog?.showSaveDialog) {
    throw new Error('createBackupManager requires Electron dialog access.');
  }

  const appDataDirectoryName = typeof app.getName === 'function' && app.getName()
    ? app.getName()
    : 'Nova Tweaks';
  const defaultBackupsRoot = path.join(app.getPath('appData'), appDataDirectoryName, 'backups');
  let backupsRoot = normalizeBackupRoot(typeof getBackupRoot === 'function' ? getBackupRoot() : defaultBackupsRoot);
  let indexPath = path.join(backupsRoot, INDEX_FILE_NAME);
  let indexWriteQueue = Promise.resolve();

  function normalizeBackupRoot(value) {
    const source = typeof value === 'string' && value.trim() ? value.trim() : defaultBackupsRoot;
    const resolved = path.resolve(source);
    const parsed = path.parse(resolved);
    if (resolved === parsed.root) {
      return defaultBackupsRoot;
    }
    return resolved;
  }

  function setBackupRoot(nextRoot) {
    backupsRoot = normalizeBackupRoot(nextRoot);
    indexPath = path.join(backupsRoot, INDEX_FILE_NAME);
    return {
      backupsRoot,
      indexPath
    };
  }

  function refreshBackupRoot() {
    if (typeof getBackupRoot === 'function') {
      setBackupRoot(getBackupRoot());
    }
  }

  function parsePowerShellJson(stdout, errorCode) {
    const rawOutput = String(stdout || '').trim();
    if (!rawOutput) {
      return [];
    }

    try {
      return JSON.parse(rawOutput);
    } catch (error) {
      throw new BackupManagerError('Failed to parse PowerShell output.', errorCode, {
        message: error.message,
        stdout: rawOutput
      });
    }
  }

  function runPowerShellScript(command, timeoutMs = WINDOWS_RESTORE_TIMEOUT_MS) {
    if (process.platform !== 'win32') {
      throw new BackupManagerError(
        'Windows restore points are only available on Windows.',
        'WINDOWS_RESTORE_UNSUPPORTED_PLATFORM',
        {
          platform: process.platform
        }
      );
    }

    const encodedCommand = [
      '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
      '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
      '$OutputEncoding = New-Object System.Text.UTF8Encoding $false',
      command
    ].join('\n');

    return new Promise((resolve, reject) => {
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        encodedCommand
      ];

      const child = spawn(resolveWindowsSystemExecutable('powershell'), args, {
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      let didTimeout = false;

      const timer = setTimeout(() => {
        didTimeout = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new BackupManagerError('Failed to start PowerShell process.', 'WINDOWS_RESTORE_PROCESS_FAILED', {
          message: error.message,
          timeoutMs
        }));
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        if (didTimeout) {
          reject(new BackupManagerError('PowerShell command timed out.', 'WINDOWS_RESTORE_TIMEOUT', {
            timeoutMs,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          }));
          return;
        }

        if (exitCode !== 0) {
          reject(new BackupManagerError('PowerShell command failed.', 'WINDOWS_RESTORE_COMMAND_FAILED', {
            exitCode,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          }));
          return;
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode
        });
      });
    });
  }

  async function queryWindowsRestorePoints() {
    const queryScript = [
      "$ErrorActionPreference = 'Stop'",
      'function Convert-CreationTimeToIso([object]$value) {',
      '  if ($value -is [datetime]) {',
      "    return $value.ToUniversalTime().ToString('o')",
      '  }',
      "  return ([Management.ManagementDateTimeConverter]::ToDateTime([string]$value)).ToUniversalTime().ToString('o')",
      '}',
      'function Get-RestorePoints {',
      '  if (Get-Command -Name Get-CimInstance -ErrorAction SilentlyContinue) {',
      "    try { return @(Get-CimInstance -Namespace 'root/default' -ClassName SystemRestore -ErrorAction Stop) } catch { $cimError = $_ }",
      '  }',
      "  try { return @(Get-WmiObject -Namespace 'root/default' -Class SystemRestore -ErrorAction Stop) } catch { $wmiError = $_ }",
      '  if ($cimError) { throw $cimError }',
      '  if ($wmiError) { throw $wmiError }',
      "  throw 'SYSTEM_RESTORE_QUERY_FAILED'",
      '}',
      '$points = Get-RestorePoints',
      '$mapped = @($points | Sort-Object -Property SequenceNumber -Descending | ForEach-Object {',
      '  [pscustomobject]@{',
      '    sequenceNumber = [int]$_.SequenceNumber',
      '    description = [string]$_.Description',
      '    createdAt = Convert-CreationTimeToIso $_.CreationTime',
      '    eventType = [int]$_.EventType',
      '    restorePointType = [int]$_.RestorePointType',
      '  }',
      '})',
      '$mapped | ConvertTo-Json -Depth 5 -Compress'
    ].join('\n');

    const result = await runPowerShellScript(queryScript);
    const parsed = parsePowerShellJson(result.stdout, 'WINDOWS_RESTORE_PARSE_FAILED');
    const sourceEntries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? [parsed]
        : [];

    return sourceEntries
      .map((entry) => normalizeWindowsRestorePoint(entry))
      .filter(Boolean)
      .sort((left, right) => {
        const sequenceDiff = (Number(right?.sequenceNumber) || 0) - (Number(left?.sequenceNumber) || 0);
        if (sequenceDiff !== 0) {
          return sequenceDiff;
        }

        return Date.parse(right?.createdAt || 0) - Date.parse(left?.createdAt || 0);
      });
  }

  async function createWindowsRestorePoint(name) {
    const restorePointName = typeof name === 'string' && name.trim()
      ? name.trim()
      : `Nova Restore Point ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;
    const escapedName = escapePowerShellSingleQuoted(restorePointName);
    const createScript = [
      "$ErrorActionPreference = 'Stop'",
      `$description = '${escapedName}'`,
      'function Convert-CreationTimeToIso([object]$value) {',
      '  if ($value -is [datetime]) {',
      "    return $value.ToUniversalTime().ToString('o')",
      '  }',
      "  return ([Management.ManagementDateTimeConverter]::ToDateTime([string]$value)).ToUniversalTime().ToString('o')",
      '}',
      'function Get-RestorePoints {',
      '  if (Get-Command -Name Get-CimInstance -ErrorAction SilentlyContinue) {',
      "    try { return @(Get-CimInstance -Namespace 'root/default' -ClassName SystemRestore -ErrorAction Stop) } catch { $cimError = $_ }",
      '  }',
      "  try { return @(Get-WmiObject -Namespace 'root/default' -Class SystemRestore -ErrorAction Stop) } catch { $wmiError = $_ }",
      '  if ($cimError) { throw $cimError }',
      '  if ($wmiError) { throw $wmiError }',
      "  throw 'SYSTEM_RESTORE_QUERY_FAILED'",
      '}',
      'if (Get-Command -Name Enable-ComputerRestore -ErrorAction SilentlyContinue) {',
      '  try {',
      "    $systemDrive = [Environment]::GetEnvironmentVariable('SystemDrive')",
      '    if ($systemDrive) {',
      '      Enable-ComputerRestore -Drive "$systemDrive\\" -ErrorAction SilentlyContinue | Out-Null',
      '    }',
      '  } catch {',
      '    # System restore may already be configured.',
      '  }',
      '}',
      'if (-not (Get-Command -Name Checkpoint-Computer -ErrorAction SilentlyContinue)) {',
      "  throw 'CHECKPOINT_COMPUTER_NOT_AVAILABLE'",
      '}',
      "Checkpoint-Computer -Description $description -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop | Out-Null",
      'Start-Sleep -Seconds 2',
      '$points = Get-RestorePoints',
      '$latest = $points |',
      '  Where-Object { $_.Description -eq $description } |',
      '  Sort-Object -Property SequenceNumber -Descending |',
      '  Select-Object -First 1',
      'if (-not $latest) {',
      '  $latest = $points | Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1',
      '}',
      'if (-not $latest) {',
      "  throw 'RESTORE_POINT_NOT_FOUND_AFTER_CREATE'",
      '}',
      '[pscustomobject]@{',
      '  sequenceNumber = [int]$latest.SequenceNumber',
      '  description = [string]$latest.Description',
      '  createdAt = Convert-CreationTimeToIso $latest.CreationTime',
      '  eventType = [int]$latest.EventType',
      '  restorePointType = [int]$latest.RestorePointType',
      '} | ConvertTo-Json -Depth 5 -Compress'
    ].join('\n');

    try {
      const result = await runPowerShellScript(createScript);
      const parsed = parsePowerShellJson(result.stdout, 'WINDOWS_RESTORE_CREATE_PARSE_FAILED');
      const metadata = normalizeWindowsRestorePoint(parsed);
      if (!metadata) {
        throw new BackupManagerError(
          'Windows restore point metadata is invalid.',
          'WINDOWS_RESTORE_INVALID_METADATA',
          {
            stdout: result.stdout
          }
        );
      }

      return metadata;
    } catch (error) {
      throw mapWindowsRestoreError(error, 'Unable to create a Windows restore point.', {
        restorePointName
      });
    }
  }

  async function restoreWindowsRestorePoint(sequenceNumber) {
    const normalizedSequence = Number.parseInt(String(sequenceNumber), 10);
    if (!Number.isInteger(normalizedSequence) || normalizedSequence < 0) {
      throw new BackupManagerError('A valid Windows restore point id is required.', 'INVALID_PAYLOAD', {
        sequenceNumber
      });
    }

    const restoreScript = [
      "$ErrorActionPreference = 'Stop'",
      `$sequenceNumber = ${normalizedSequence}`,
      'function Convert-CreationTimeToIso([object]$value) {',
      '  if ($value -is [datetime]) {',
      "    return $value.ToUniversalTime().ToString('o')",
      '  }',
      "  return ([Management.ManagementDateTimeConverter]::ToDateTime([string]$value)).ToUniversalTime().ToString('o')",
      '}',
      'function Get-RestorePoints {',
      '  if (Get-Command -Name Get-CimInstance -ErrorAction SilentlyContinue) {',
      "    try { return @(Get-CimInstance -Namespace 'root/default' -ClassName SystemRestore -ErrorAction Stop) } catch { $cimError = $_ }",
      '  }',
      "  try { return @(Get-WmiObject -Namespace 'root/default' -Class SystemRestore -ErrorAction Stop) } catch { $wmiError = $_ }",
      '  if ($cimError) { throw $cimError }',
      '  if ($wmiError) { throw $wmiError }',
      "  throw 'SYSTEM_RESTORE_QUERY_FAILED'",
      '}',
      '$points = Get-RestorePoints',
      '$target = $points | Where-Object { [int]$_.SequenceNumber -eq $sequenceNumber } | Select-Object -First 1',
      'if (-not $target) {',
      "  throw 'RESTORE_POINT_NOT_FOUND'",
      '}',
      'Restore-Computer -RestorePoint $sequenceNumber -Confirm:$false -ErrorAction Stop | Out-Null',
      '[pscustomobject]@{',
      '  sequenceNumber = [int]$target.SequenceNumber',
      '  description = [string]$target.Description',
      '  createdAt = Convert-CreationTimeToIso $target.CreationTime',
      '  eventType = [int]$target.EventType',
      '  restorePointType = [int]$target.RestorePointType',
      '} | ConvertTo-Json -Depth 5 -Compress'
    ].join('\n');

    try {
      const result = await runPowerShellScript(restoreScript);
      const parsed = parsePowerShellJson(result.stdout, 'WINDOWS_RESTORE_RESTORE_PARSE_FAILED');
      const metadata = normalizeWindowsRestorePoint(parsed);
      if (!metadata) {
        throw new BackupManagerError(
          'Windows restore point metadata is invalid.',
          'WINDOWS_RESTORE_INVALID_METADATA',
          {
            stdout: result.stdout,
            sequenceNumber: normalizedSequence
          }
        );
      }

      return metadata;
    } catch (error) {
      throw mapWindowsRestoreError(error, 'Unable to start Windows restore.', {
        sequenceNumber: normalizedSequence
      });
    }
  }

  async function getWindowsRestoreState() {
    if (process.platform !== 'win32') {
      return {
        available: false,
        code: 'WINDOWS_RESTORE_UNSUPPORTED_PLATFORM',
        message: 'Windows restore points are only available on Windows.',
        points: []
      };
    }

    try {
      const points = await queryWindowsRestorePoints();
      return {
        available: true,
        code: 'WINDOWS_RESTORE_AVAILABLE',
        message: '',
        points
      };
    } catch (error) {
      const wrapped = mapWindowsRestoreError(error, 'Windows restore points are currently unavailable.');
      logger?.warn?.('Windows restore point query failed.', {
        code: wrapped.code,
        message: wrapped.message,
        details: wrapped.details
      });

      return {
        available: false,
        code: wrapped.code,
        message: wrapped.message,
        points: []
      };
    }
  }

  async function ensureStorage() {
    refreshBackupRoot();
    await fs.mkdir(backupsRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await fs.chmod(backupsRoot, 0o700);
    }
  }

  async function readIndex() {
    await ensureStorage();

    try {
      const parsed = await readJsonFile(indexPath);
      if (parsed?.schema !== INDEX_SCHEMA || Number(parsed?.schemaVersion) !== INDEX_SCHEMA_VERSION) {
        return createDefaultIndex();
      }

      return {
        ...createDefaultIndex(),
        ...parsed,
        backups: Array.isArray(parsed.backups) ? parsed.backups : [],
        windowsRestorePoints: Array.isArray(parsed.windowsRestorePoints) ? parsed.windowsRestorePoints : [],
        settings: normalizeBackupSettings(parsed.settings)
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return createDefaultIndex();
      }

      logger?.warn?.('Backup index could not be parsed. Rebuilding from backup files.', {
        message: error.message
      });
      return createDefaultIndex();
    }
  }

  async function writeIndex(index) {
    const nextIndex = {
      ...createDefaultIndex(),
      ...index,
      updatedAt: new Date().toISOString()
    };
    const targetIndexPath = indexPath;
    const pendingWrite = indexWriteQueue.then(async () => {
      await writeJsonAtomic(targetIndexPath, nextIndex);
      return nextIndex;
    });
    indexWriteQueue = pendingWrite.catch(() => undefined);
    return pendingWrite;
  }

  async function readBackupDocumentByPath(filePath) {
    return validateBackupDocument(await readJsonFile(filePath));
  }

  async function resolveBackupFilePath(backupId) {
    if (parseWindowsRestorePointId(backupId) !== null) {
      throw new BackupManagerError(
        'Windows restore points are managed by Windows and cannot be modified as Nova backup files.',
        'WINDOWS_RESTORE_READ_ONLY',
        { backupId }
      );
    }

    const index = await syncIndex();
    const backup = index.backups.find((entry) => entry.id === backupId);
    if (!backup) {
      throw new BackupManagerError('Backup entry was not found.', 'BACKUP_NOT_FOUND', { backupId });
    }

    return {
      index,
      backup,
      filePath: path.join(backupsRoot, backup.fileName || `${backup.id}.json`)
    };
  }

  async function syncIndex() {
    await ensureStorage();
    const existingIndex = await readIndex();
    const entries = await fs.readdir(backupsRoot, { withFileTypes: true });
    const backupEntries = [];

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json' || entry.name === INDEX_FILE_NAME) {
        continue;
      }

      const filePath = path.join(backupsRoot, entry.name);

      try {
        const [document, stat] = await Promise.all([
          readBackupDocumentByPath(filePath),
          fs.stat(filePath)
        ]);

        backupEntries.push(
          createMetadataFromDocument(
            {
              ...document,
              fileName: entry.name
            },
            stat,
            filePath
          )
        );
      } catch (error) {
        logger?.warn?.('Skipping invalid backup file.', {
          filePath,
          code: error?.code || 'INVALID_BACKUP_FILE',
          message: error?.message || 'Unknown backup file error'
        });
      }
    }

    backupEntries.sort((left, right) => {
      return Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0);
    });

    const nextIndex = await writeIndex({
      ...existingIndex,
      backups: backupEntries,
      windowsRestorePoints: Array.isArray(existingIndex.windowsRestorePoints)
        ? existingIndex.windowsRestorePoints
        : [],
      storage: {
        engine: 'nova-json',
        rootPath: backupsRoot
      },
      settings: normalizeBackupSettings(existingIndex.settings)
    });

    return nextIndex;
  }

  function createStateFromIndex(index, windowsRestoreState = null) {
    const cachedRestorePoints = Array.isArray(index.windowsRestorePoints)
      ? index.windowsRestorePoints
      : [];
    const cachedRestorePointById = new Map(
      cachedRestorePoints
        .map((entry) => [String(entry?.id || '').trim(), entry])
        .filter(([id]) => id)
    );
    const hasLiveRestorePointState = windowsRestoreState?.available === true
      && Array.isArray(windowsRestoreState?.points);
    const restorePointSource = hasLiveRestorePointState
      ? windowsRestoreState.points
      : cachedRestorePoints;
    const restorePoints = restorePointSource.map((restorePoint) => {
      const cached = cachedRestorePointById.get(String(restorePoint?.id || '').trim());
      const cachedDescription = repairWindowsRestorePointText(cached?.description);
      if (!cachedDescription) {
        return restorePoint;
      }

      return {
        ...restorePoint,
        description: cachedDescription
      };
    });
    const windowsAvailable = typeof windowsRestoreState?.available === 'boolean'
      ? windowsRestoreState.available
      : process.platform === 'win32';
    const windowsCode = typeof windowsRestoreState?.code === 'string' && windowsRestoreState.code.trim()
      ? windowsRestoreState.code
      : windowsAvailable
        ? 'WINDOWS_RESTORE_AVAILABLE'
        : 'WINDOWS_RESTORE_UNSUPPORTED_PLATFORM';
    const windowsMessage = typeof windowsRestoreState?.message === 'string' ? windowsRestoreState.message : '';

    return {
      backups: Array.isArray(index.backups) ? index.backups : [],
      windowsRestorePoints: restorePoints,
      windowsRestoreIntegration: {
        available: windowsAvailable,
        code: windowsCode,
        message: windowsMessage
      },
      storage: {
        rootPath: backupsRoot,
        indexPath
      },
      settings: normalizeBackupSettings(index.settings)
    };
  }

  async function buildStateFromIndex(index) {
    const windowsRestoreState = typeof windowsRestoreStateProvider === 'function'
      ? await windowsRestoreStateProvider()
      : await getWindowsRestoreState();
    return createStateFromIndex(index, windowsRestoreState);
  }

  async function listBackups() {
    const index = await syncIndex();
    return buildStateFromIndex(index);
  }

  async function createBackup(payload = {}, options = {}) {
    const engine = typeof payload?.engine === 'string' ? payload.engine.trim().toLowerCase() : 'nova';
    if (engine === 'windows') {
      const createdRestorePoint = typeof options.createWindowsProvider === 'function'
        ? await options.createWindowsProvider(payload?.name)
        : await createWindowsRestorePoint(payload?.name);
      const customDescription = typeof payload?.description === 'string' && payload.description.trim()
        ? payload.description.trim()
        : '';
      const index = await syncIndex();
      const createdRestorePointMetadata = customDescription
        ? {
            ...createdRestorePoint,
            description: customDescription
          }
        : createdRestorePoint;
      const nextCachedRestorePoints = [
        createdRestorePointMetadata,
        ...(Array.isArray(index.windowsRestorePoints) ? index.windowsRestorePoints : [])
          .filter((entry) => entry?.id !== createdRestorePoint.id)
      ].slice(0, 200);
      const nextIndex = await writeIndex({
        ...index,
        windowsRestorePoints: nextCachedRestorePoints
      });
      const state = await buildStateFromIndex(nextIndex);
      const backup = state.windowsRestorePoints.find((entry) => entry.id === createdRestorePoint.id)
        || createdRestorePointMetadata;
      const windowsRestorePoints = [
        backup,
        ...state.windowsRestorePoints.filter((entry) => entry.id !== backup.id)
      ];

      return {
        ...state,
        backup,
        windowsRestorePoints
      };
    }

    if (engine !== 'nova') {
      throw new BackupManagerError('Unsupported backup engine.', 'INVALID_BACKUP_ENGINE', { engine });
    }

    const scope = normalizeScope(payload.scope);
    if (!scope.length) {
      throw new BackupManagerError('Backup scope must contain at least one supported section.', 'INVALID_PAYLOAD');
    }

    const type = normalizeBackupType(payload.type);
    const index = await syncIndex();
    const name = dedupeName(payload.name, index.backups.map((entry) => entry.name));
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const fileName = `${id}.json`;
    const description = typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : `Manual backup created with ${scope.length} included sections.`;
    const document = {
      schema: BACKUP_SCHEMA,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      id,
      fileName,
      name,
      createdAt,
      updatedAt: createdAt,
      type,
      status: 'successful',
      description,
      origin: 'nova',
      scope,
      app: {
        name: 'Nova Tweaks',
        version: typeof getAppVersion === 'function' ? getAppVersion() : '',
        platform: process.platform
      },
      meta: {
        source: 'nova-tweaks-desktop',
        description,
        adminRequired: computeAdminRequired(scope),
        rebootLikely: computeRebootLikely(scope)
      },
      snapshot: normalizeSnapshot(payload.snapshot, scope)
    };

    await writeJsonAtomic(path.join(backupsRoot, fileName), document);
    const nextIndex = await syncIndex();
    const createdBackup = nextIndex.backups.find((entry) => entry.id === id) || null;
    const state = await buildStateFromIndex(nextIndex);

    return {
      backup: createdBackup,
      ...state
    };
  }

  async function renameBackup(payload = {}) {
    const backupId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const nextName = cleanName(payload?.name);
    if (!backupId || !nextName) {
      throw new BackupManagerError('A valid backup id and name are required.', 'INVALID_PAYLOAD');
    }

    const { filePath } = await resolveBackupFilePath(backupId);
    const document = await readBackupDocumentByPath(filePath);
    document.name = nextName;
    document.updatedAt = new Date().toISOString();
    await writeJsonAtomic(filePath, document);

    const nextIndex = await syncIndex();
    const state = await buildStateFromIndex(nextIndex);
    return {
      backup: nextIndex.backups.find((entry) => entry.id === backupId) || null,
      ...state
    };
  }

  async function deleteBackup(payload = {}) {
    const backupId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!backupId) {
      throw new BackupManagerError('A valid backup id is required.', 'INVALID_PAYLOAD');
    }

    const { filePath } = await resolveBackupFilePath(backupId);
    await fs.unlink(filePath);
    const nextIndex = await syncIndex();

    return buildStateFromIndex(nextIndex);
  }

  async function exportBackup(payload = {}) {
    const backupId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!backupId) {
      throw new BackupManagerError('A valid backup id is required.', 'INVALID_PAYLOAD');
    }

    const { backup, filePath } = await resolveBackupFilePath(backupId);
    const defaultPath = path.join(
      app.getPath('documents'),
      `${toFileSafeName(backup.name)}.json`
    );
    const result = await dialog.showSaveDialog({
      title: 'Export Backup',
      defaultPath,
      showOverwriteConfirmation: true,
      filters: [
        { name: 'Nova Backup JSON', extensions: ['json'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return {
        canceled: true,
        backup
      };
    }

    await fs.copyFile(filePath, result.filePath);
    if (process.platform !== 'win32') {
      await fs.chmod(result.filePath, 0o600);
    }
    return {
      canceled: false,
      backup,
      filePath: result.filePath
    };
  }

  async function importBackup() {
    const dialogResult = await dialog.showOpenDialog({
      title: 'Import Backup',
      properties: ['openFile'],
      filters: [
        { name: 'Nova Backup JSON', extensions: ['json'] }
      ]
    });

    if (dialogResult.canceled || !dialogResult.filePaths?.[0]) {
      const state = await buildStateFromIndex(await syncIndex());
      return {
        canceled: true,
        ...state
      };
    }

    const sourcePath = dialogResult.filePaths[0];
    const importedDocument = await readBackupDocumentByPath(sourcePath);
    const currentIndex = await syncIndex();
    const importedId = crypto.randomUUID();
    const importedName = dedupeName(importedDocument.name, currentIndex.backups.map((entry) => entry.name));
    const fileName = `${importedId}.json`;
    const document = {
      ...importedDocument,
      id: importedId,
      fileName,
      name: importedName,
      updatedAt: new Date().toISOString(),
      meta: {
        ...(importedDocument.meta || {}),
        importedAt: new Date().toISOString(),
        importedFrom: {
          fileName: path.basename(sourcePath),
          originalBackupId: importedDocument.id
        }
      }
    };

    await writeJsonAtomic(path.join(backupsRoot, fileName), document);
    const nextIndex = await syncIndex();
    const state = await buildStateFromIndex(nextIndex);

    return {
      canceled: false,
      backup: nextIndex.backups.find((entry) => entry.id === importedId) || null,
      ...state
    };
  }

  async function restoreBackup(payload = {}, options = {}) {
    const backupId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!backupId) {
      throw new BackupManagerError('A valid backup id is required.', 'INVALID_PAYLOAD');
    }

    const windowsSequence = parseWindowsRestorePointId(backupId);
    if (windowsSequence !== null) {
      const restoredPoint = typeof options.restoreWindowsProvider === 'function'
        ? await options.restoreWindowsProvider(windowsSequence)
        : await restoreWindowsRestorePoint(windowsSequence);
      return {
        backup: restoredPoint,
        restorePlan: {
          backupId: restoredPoint.id,
          name: restoredPoint.name,
          createdAt: restoredPoint.createdAt,
          updatedAt: restoredPoint.updatedAt,
          type: restoredPoint.type,
          origin: restoredPoint.origin,
          scope: [...WINDOWS_RESTORE_SCOPE],
          adminRequired: true,
          rebootLikely: true,
          partialScopes: [],
          app: {
            name: 'Windows System Restore'
          },
          meta: {
            sequenceNumber: windowsSequence,
            operation: 'system-restore'
          },
          snapshot: {}
        }
      };
    }

    const { filePath } = await resolveBackupFilePath(backupId);

    const document = await readBackupDocumentByPath(filePath);
    const restoreScope = resolveRestoreScope(document.scope, payload.scope);
    if (!restoreScope.length) {
      throw new BackupManagerError(
        'The requested restore scope is empty or unsupported for this backup.',
        'INVALID_RESTORE_SCOPE',
        { backupId, requestedScope: payload?.scope }
      );
    }

    const snapshot = normalizeSnapshot(document.snapshot, restoreScope);
    const partialScopes = restoreScope.filter((scopeId) => snapshot?.[scopeId]?.captureStatus !== 'complete');

    return {
      backup: createMetadataFromDocument(document),
      restorePlan: {
        backupId: document.id,
        name: document.name,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        type: document.type,
        origin: document.origin,
        scope: restoreScope,
        adminRequired: computeAdminRequired(restoreScope, snapshot),
        rebootLikely: computeRebootLikely(restoreScope, snapshot),
        partialScopes,
        app: document.app && typeof document.app === 'object' ? document.app : {},
        meta: document.meta && typeof document.meta === 'object' ? document.meta : {},
        snapshot
      }
    };
  }

  let automaticBackupRunning = false;
  async function runAutomaticBackup(captureSnapshot) {
    if (automaticBackupRunning) return { skipped: true };
    automaticBackupRunning = true;
    try {
      const { settings } = await getBackupSettings();
      if (!settings.automaticBackupsEnabled) return { skipped: true };
      const index = await syncIndex();
      const latest = index.backups.filter((entry) => entry.type === 'automatic' && entry.status === 'successful')
        .reduce((timestamp, entry) => Math.max(timestamp, Date.parse(entry.createdAt) || 0), 0);
      if (latest && Date.now() - latest < settings.frequencyDays * 86400000) return { skipped: true };
      const snapshot = await captureSnapshot();
      // Recheck settings after capture, which can take time on systems with many tweaks.
      const current = await getBackupSettings();
      if (!current.settings.automaticBackupsEnabled) return { skipped: true };
      const result = await createBackup({
        engine: 'nova', type: 'automatic', name: 'Automatic Nova Backup',
        description: 'Scheduled Nova settings and verified tweak states.',
        scope: Object.keys(snapshot), snapshot
      });
      const refreshed = await syncIndex();
      const candidates = refreshed.backups.filter((entry) => entry.type === 'automatic' && entry.id !== result.backup?.id)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      let totalBytes = refreshed.backups.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
      const cutoff = Date.now() - current.settings.cleanOlderThanDays * 86400000;
      for (const entry of candidates) {
        if (Date.parse(entry.createdAt) < cutoff || (current.settings.maxStorageBytes > 0 && totalBytes > current.settings.maxStorageBytes)) {
          await fs.unlink(path.join(backupsRoot, entry.fileName));
          totalBytes -= entry.sizeBytes || 0;
        }
      }
      await syncIndex();
      return result;
    } finally {
      automaticBackupRunning = false;
    }
  }

  async function getBackupSettings() {
    const index = await readIndex();
    return {
      settings: normalizeBackupSettings(index.settings)
    };
  }

  async function updateBackupSettings(payload = {}) {
    const index = await readIndex();
    const nextSettings = normalizeBackupSettings({
      ...index.settings,
      ...(payload && typeof payload === 'object' ? payload : {})
    });
    const nextIndex = await writeIndex({
      ...index,
      settings: nextSettings
    });

    return {
      settings: normalizeBackupSettings(nextIndex.settings)
    };
  }

  async function cleanOldBackups(payload = {}) {
    const olderThanDays = Number.parseInt(String(payload?.olderThanDays ?? DEFAULT_BACKUP_SETTINGS.cleanOlderThanDays), 10);
    const thresholdDays = Number.isInteger(olderThanDays) && olderThanDays > 0
      ? olderThanDays
      : DEFAULT_BACKUP_SETTINGS.cleanOlderThanDays;
    const cutoff = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
    const index = await syncIndex();
    const targets = index.backups.filter((backup) => {
      const timestamp = Date.parse(backup?.createdAt || '');
      return Number.isFinite(timestamp) && timestamp < cutoff;
    });
    let deletedCount = 0;

    for (const backup of targets) {
      try {
        await fs.unlink(path.join(backupsRoot, backup.fileName || `${backup.id}.json`));
        deletedCount += 1;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    const nextIndex = await syncIndex();
    const state = await buildStateFromIndex(nextIndex);
    return {
      deletedCount,
      olderThanDays: thresholdDays,
      ...state
    };
  }

  return {
    getStoragePaths: () => {
      refreshBackupRoot();
      return {
        backupsRoot,
        indexPath
      };
    },
    setBackupRoot,
    listBackups,
    createBackup,
    renameBackup,
    deleteBackup,
    exportBackup,
    importBackup,
    restoreBackup,
    restoreWindowsRestorePoint,
    createWindowsRestorePoint,
    cleanOldBackups,
    getBackupSettings,
    updateBackupSettings,
    runAutomaticBackup
  };
}

module.exports = {
  BackupManagerError,
  createBackupManager
};
