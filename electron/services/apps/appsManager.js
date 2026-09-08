const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { runGameDetectionScan } = require('./gameDetectionBridge');
const { createAppOptimizationService } = require('./appOptimizationService');
const {
  resolveWindowsRoot,
  resolveWindowsSystemExecutable
} = require('../security/systemExecutables');

const DEFAULT_LIST_TIMEOUT_MS = 120000;
const DEFAULT_UNINSTALL_TIMEOUT_MS = 180000;
const DEFAULT_ICON_TIMEOUT_MS = 180000;
const DEFAULT_STARTUP_TIMEOUT_MS = 150000;
const DEFAULT_STARTUP_TOGGLE_TIMEOUT_MS = 90000;
const DEFAULT_GAME_DETECTION_TIMEOUT_MS = 15000;
const DEFAULT_GAME_TUNING_TIMEOUT_MS = 60000;
const DEFAULT_GAME_ICON_TIMEOUT_MS = 15000;
const GAME_DETECTION_STICKINESS_MS = 12000;
const GAME_DETECTION_RESULT_CACHE_MS = 1500;
const MAX_ICON_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.ico']);
const BINARY_ICON_EXTENSIONS = new Set(['.exe', '.dll', '.cpl', '.mun']);
const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
};
const TECHNICAL_NAME_PATTERNS = [
  /^vs_/i,
  /^microsoft\.net\./i,
  /^microsoft\s+\.net\b/i,
  /^icecap_/i,
  /^diagnosticshub_/i,
  /^intellitrace/i,
  /\b\.net\s+(sdk|runtime|host|toolset|templates|targeting|apphost|workload|desktop)\b/i,
  /\btargeting pack\b/i,
  /\bapphost pack\b/i,
  /\bhost fx resolver\b/i,
  /\bdesktop runtime\b/i,
  /\basp\.net core runtime\b/i,
  /\basp\.net core targeting pack\b/i,
  /\bframework cumulative intellisense pack\b/i,
  /\bentity framework .* tools\b/i,
  /\bvisual c\+\+.*redistributable\b/i,
  /\bclr types?\b/i,
  /\bclickoncebootstrapper\b/i,
  /\bworkload\..*manifest\b/i,
  /\bsdk\..*manifest\b/i
];
const USER_VISIBLE_ALLOWLIST_PATTERNS = [
  /^microsoft edge\b/i,
  /^microsoft edge webview2 runtime\b/i,
  /^microsoft onedrive\b/i,
  /^microsoft onenote\b/i,
  /^microsoft office\b/i,
  /^microsoft visual studio code\b/i,
  /^microsoft visual studio installer\b/i,
  /^visual studio community\b/i
];
class AppsManagerError extends Error {
  constructor(message, code = 'APPS_MANAGER_ERROR', details = {}) {
    super(message);
    this.name = 'AppsManagerError';
    this.code = code;
    this.details = details;
  }
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload || {}), 'utf8').toString('base64');
}

function normalizeIconPath(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  let candidate = raw;
  const quotedMatch = /^\s*"([^"]+)"/.exec(candidate);
  if (quotedMatch?.[1]) {
    candidate = quotedMatch[1];
  } else {
    candidate = candidate.split(',')[0] || '';
  }

  const withoutQuotes = candidate.trim().replace(/^"+|"+$/g, '');
  return withoutQuotes.replace(/%([^%]+)%/g, (_full, key) => process.env[key] || _full);
}

function extensionOf(value) {
  return path.extname(String(value || '')).toLowerCase();
}

function isImageIconPath(value) {
  return IMAGE_EXTENSIONS.has(extensionOf(value));
}

function isBinaryIconPath(value) {
  return BINARY_ICON_EXTENSIONS.has(extensionOf(value));
}

function normalizeWindowsPathKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isLikelyMicrosoftApp(entry) {
  const publisher = String(entry?.publisher || '').toLowerCase();
  const name = String(entry?.name || '').toLowerCase();
  const packageFamilyName = String(entry?.packageFamilyName || '').toLowerCase();
  const id = String(entry?.id || '').toLowerCase();

  if (publisher.includes('microsoft')) {
    return true;
  }
  if (packageFamilyName.includes('microsoft')) {
    return true;
  }
  if (id.includes('microsoft')) {
    return true;
  }
  if (name.startsWith('microsoft ')) {
    return true;
  }

  return false;
}

function isLikelyTechnicalComponent(entry) {
  const source = String(entry?.source || '').toLowerCase();
  const installType = String(entry?.installType || '').toLowerCase();
  const name = String(entry?.name || '');
  const trimmedName = name.trim();
  const parentDisplayName = String(entry?.parentDisplayName || '').trim();
  const parentKeyName = String(entry?.parentKeyName || '').trim();
  const releaseType = String(entry?.releaseType || '').toLowerCase();
  const isSystemComponent = Boolean(entry?.isSystemComponent);

  if (USER_VISIBLE_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(trimmedName))) {
    return false;
  }

  if (isSystemComponent) {
    return true;
  }

  if (parentDisplayName || parentKeyName) {
    return true;
  }

  if (releaseType && /(update|hotfix|security|rollup|service pack)/i.test(releaseType)) {
    return true;
  }

  if (source === 'appx') {
    return installType === 'framework' || installType === 'system';
  }

  if (TECHNICAL_NAME_PATTERNS.some((pattern) => pattern.test(trimmedName))) {
    return true;
  }

  const isMachineLikeName = /^[a-z0-9._-]{20,}$/i.test(trimmedName);
  if (isMachineLikeName && trimmedName.includes('_')) {
    return true;
  }

  return false;
}

function normalizeAppsPayload(payload) {
  const source = Array.isArray(payload) ? payload : payload ? [payload] : [];

  return source
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id || '').trim(),
      name: String(entry.name || '').trim(),
      publisher: String(entry.publisher || '').trim(),
      version: String(entry.version || '').trim(),
      source: String(entry.source || '').trim().toLowerCase() || 'unknown',
      installScope: String(entry.installScope || '').trim().toLowerCase() === 'machine' ? 'machine' : 'user',
      installType: String(entry.installType || '').trim(),
      canUninstall: Boolean(entry.canUninstall),
      uninstallReason: String(entry.uninstallReason || '').trim(),
      uninstallCommand: String(entry.uninstallCommand || ''),
      quietUninstallCommand: String(entry.quietUninstallCommand || ''),
      packageFullName: String(entry.packageFullName || ''),
      packageFamilyName: String(entry.packageFamilyName || ''),
      parentDisplayName: String(entry.parentDisplayName || '').trim(),
      parentKeyName: String(entry.parentKeyName || '').trim(),
      releaseType: String(entry.releaseType || '').trim(),
      installLocation: String(entry.installLocation || '').trim(),
      installDate: String(entry.installDate || '').trim(),
      lastUsed: String(entry.lastUsed || '').trim(),
      estimatedSize: Number.isFinite(Number(entry.estimatedSize)) ? Number(entry.estimatedSize) : 0,
      sizeBytes: Number.isFinite(Number(entry.sizeBytes)) ? Number(entry.sizeBytes) : 0,
      runtimeStatus: String(entry.runtimeStatus || '').trim(),
      processActive: Boolean(entry.processActive),
      processId: Number.isFinite(Number(entry.processId)) ? Math.trunc(Number(entry.processId)) : 0,
      executablePath: String(entry.executablePath || '').trim(),
      iconPath: normalizeIconPath(entry.iconPath),
      iconDataUrl: '',
      isMicrosoft: false,
      isTechnical: false,
      isSystemComponent: Boolean(entry.isSystemComponent)
    }))
    .map((entry) => ({
      ...entry,
      isMicrosoft: isLikelyMicrosoftApp(entry),
      isTechnical: isLikelyTechnicalComponent(entry)
    }))
    .filter((entry) => entry.id && entry.name);
}

function toPublicAppShape(entry) {
  return {
    id: entry.id,
    name: entry.name,
    publisher: entry.publisher,
    version: entry.version,
    source: entry.source,
    installScope: entry.installScope,
    installType: entry.installType,
    canUninstall: entry.canUninstall,
    uninstallReason: entry.uninstallReason,
    installLocation: entry.installLocation,
    installDate: entry.installDate,
    lastUsed: entry.lastUsed,
    estimatedSize: entry.estimatedSize,
    sizeBytes: entry.sizeBytes,
    runtimeStatus: entry.runtimeStatus,
    processActive: Boolean(entry.processActive),
    processId: entry.processId,
    executablePath: entry.executablePath,
    iconPath: entry.iconPath,
    iconDataUrl: entry.iconDataUrl,
    isMicrosoft: Boolean(entry.isMicrosoft),
    isTechnical: Boolean(entry.isTechnical),
    isSystemComponent: entry.isSystemComponent,
    optimization: entry.optimization && typeof entry.optimization === 'object'
      ? entry.optimization
      : null
  };
}

function normalizeStartupType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'registry') {
    return 'registry';
  }
  if (raw === 'startup-folder' || raw === 'startupfolder') {
    return 'startup-folder';
  }
  if (raw === 'scheduled-task' || raw === 'scheduledtask' || raw === 'task') {
    return 'scheduled-task';
  }
  if (raw === 'appx' || raw === 'uwp') {
    return 'appx';
  }
  return 'unknown';
}

function normalizeStartupScope(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'user') {
    return 'user';
  }
  if (raw === 'machine' || raw === 'system') {
    return 'machine';
  }
  return 'unknown';
}

function isStartupAccessDeniedError(error) {
  if (!(error instanceof AppsManagerError) || error.code !== 'APPS_POWERSHELL_FAILED') {
    return false;
  }

  const detailsText = `${String(error?.details?.stderr || '')}\n${String(error?.details?.stdout || '')}`.toLowerCase();
  return [
    'access is denied',
    'access to the registry key is denied',
    'requested registry access is not allowed',
    'unauthorizedaccessexception',
    'verweigert',
    'refus',
    'non autoris',
    '0x80070005'
  ].some((marker) => detailsText.includes(marker));
}

function normalizeStartupPayload(payload) {
  const source = Array.isArray(payload) ? payload : payload ? [payload] : [];
  return source
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const startupType = normalizeStartupType(entry.startupType);
      const availableStartupTypes = Array.isArray(entry.availableStartupTypes)
        ? entry.availableStartupTypes.map(normalizeStartupType).filter((type) => type !== 'unknown')
        : [];

      const normalizedAvailableTypes = availableStartupTypes.length
        ? Array.from(new Set(availableStartupTypes))
        : [startupType];

      return {
        id: String(entry.id || '').trim(),
        name: String(entry.name || '').trim(),
        startupType,
        startupScope: normalizeStartupScope(entry.startupScope),
        startupKind: String(entry.startupKind || '').trim(),
        sourcePath: String(entry.sourcePath || '').trim(),
        command: String(entry.command || '').trim(),
        iconPath: normalizeIconPath(entry.iconPath),
        iconDataUrl: '',
        enabled: Boolean(entry.enabled),
        canToggle: typeof entry.canToggle === 'boolean' ? entry.canToggle : true,
        canChangeType: Boolean(entry.canChangeType),
        availableStartupTypes: normalizedAvailableTypes,
        typeChangeReason: String(entry.typeChangeReason || '').trim(),
        startupApprovedPath: String(entry.startupApprovedPath || '').trim(),
        entryName: String(entry.entryName || '').trim(),
        registryPath: String(entry.registryPath || '').trim(),
        taskPath: String(entry.taskPath || '').trim(),
        taskName: String(entry.taskName || '').trim(),
        isStandard: Boolean(entry.isStandard)
      };
    })
    .filter((entry) => entry.id && entry.name);
}

function toPublicStartupEntryShape(entry) {
  return {
    id: entry.id,
    name: entry.name,
    startupType: entry.startupType,
    startupScope: entry.startupScope,
    startupKind: entry.startupKind,
    sourcePath: entry.sourcePath,
    command: entry.command,
    iconPath: entry.iconPath,
    iconDataUrl: entry.iconDataUrl,
    enabled: Boolean(entry.enabled),
    canToggle: Boolean(entry.canToggle),
    canChangeType: Boolean(entry.canChangeType),
    availableStartupTypes: Array.isArray(entry.availableStartupTypes) ? entry.availableStartupTypes : [entry.startupType],
    typeChangeReason: entry.typeChangeReason,
    isStandard: Boolean(entry.isStandard)
  };
}

function createAppsManager({
  getFileIcon,
  logger,
  onOptimizationUpdate,
  optimizationBackupRoot,
  isAdminProvider,
  privilegedExecutor,
  isPackaged = false
} = {}) {
  const currentProcessIsAdmin =
    typeof isAdminProvider === 'function' ? isAdminProvider : () => false;
  let lastDetectedGame = null;
  let lastDetectedGameAt = 0;
  let lastActiveGameDetectionResult = null;
  let lastActiveGameDetectionAt = 0;
  let activeGameDetectionPromise = null;
  let lastGameDetectionSnapshot = null;
  let lastGameDetectionSnapshotAt = 0;
  let gameDetectionScanPromise = null;
  const iconDataUrlCache = new Map();
  const loadFileIcon = typeof getFileIcon === 'function'
    ? require('./fileIconLoader').createFileIconLoader(getFileIcon)
    : null;
  const installedAppsScanPromises = new Map();
  let appOptimizationService = null;

  function getAppOptimizationService() {
    if (!appOptimizationService) {
      appOptimizationService = createAppOptimizationService({
        logger,
        onUpdate: onOptimizationUpdate,
        backupRoot: optimizationBackupRoot,
        getApps: (options) => listInstalledAppsInternal(options),
        getStartupEntries: () => listStartupAppsInternal(),
        setStartupEntryEnabled: (payload) => setStartupEntryEnabled(payload),
        executePrivilegedPolicy: typeof privilegedExecutor === 'function'
          ? (payload) => privilegedExecutor(
              'apps.optimization.policy',
              payload,
              { reason: 'app-optimization', timeoutMs: 60000 }
            )
          : null
      });
    }
    return appOptimizationService;
  }

  function getStickyDetectedGameFallback() {
    if (!lastDetectedGame || !lastDetectedGameAt) {
      return null;
    }

    const now = Date.now();
    if (now - lastDetectedGameAt > GAME_DETECTION_STICKINESS_MS) {
      lastDetectedGame = null;
      lastDetectedGameAt = 0;
      return null;
    }

    try {
      process.kill(lastDetectedGame.processId, 0);
      return {
        ...lastDetectedGame
      };
    } catch (error) {
      if (error && String(error.code || '') === 'EPERM') {
        return {
          ...lastDetectedGame
        };
      }
      lastDetectedGame = null;
      lastDetectedGameAt = 0;
      return null;
    }
  }

  function setLastDetectedGameCache(gameEntry) {
    const normalizedProcessId = Number(gameEntry?.processId);
    const executablePath = String(gameEntry?.executablePath || '').trim();
    const canonicalExecutableName = String(gameEntry?.canonicalExecutableName || '').trim();
    const processName = String(gameEntry?.processName || '').trim();
    if (
      !Number.isFinite(normalizedProcessId) ||
      normalizedProcessId <= 0 ||
      (!executablePath && !canonicalExecutableName && !processName)
    ) {
      return;
    }
    const normalizedAnchorProcessId = Number(gameEntry?.anchorProcessId);
    const normalizedTargetProcessId = Number(gameEntry?.targetProcessId);
    const normalizedDetectionMode = String(gameEntry?.detectionMode || '').trim().toLowerCase();

    lastDetectedGame = {
      processId: Math.trunc(normalizedProcessId),
      processName,
      executablePath,
      displayName: String(gameEntry?.displayName || '').trim(),
      normalizedGameId: String(gameEntry?.normalizedGameId || '').trim(),
      canonicalGameName: String(gameEntry?.canonicalGameName || '').trim(),
      canonicalExecutableName,
      actualDetectedProcessName: String(gameEntry?.actualDetectedProcessName || '').trim(),
      actualDetectedExecutablePath: String(gameEntry?.actualDetectedExecutablePath || '').trim(),
      runtimeExecutablePath: String(gameEntry?.runtimeExecutablePath || '').trim(),
      runtimeProcessMatchState: String(gameEntry?.runtimeProcessMatchState || '').trim(),
      confidence: Number.isFinite(Number(gameEntry?.confidence)) ? Number(gameEntry.confidence) : 0,
      confidenceTier: String(gameEntry?.confidenceTier || '').trim(),
      detectionReason: String(gameEntry?.detectionReason || '').trim(),
      aliasesMatched: Array.isArray(gameEntry?.aliasesMatched) ? [...gameEntry.aliasesMatched] : [],
      helperProcessesFound: Array.isArray(gameEntry?.helperProcessesFound) ? [...gameEntry.helperProcessesFound] : [],
      windowTitle: String(gameEntry?.windowTitle || '').trim(),
      iconDataUrl: String(gameEntry?.iconDataUrl || '').trim(),
      fullscreenOptimizationsDisabled: Boolean(gameEntry?.fullscreenOptimizationsDisabled),
      priorityClass: String(gameEntry?.priorityClass || '').trim(),
      runtimePriorityClass: String(gameEntry?.runtimePriorityClass || gameEntry?.priorityClass || '').trim(),
      priorityReadError: String(gameEntry?.priorityReadError || '').trim(),
      priorityConfigured: Boolean(gameEntry?.priorityConfigured),
      priorityConfigurationState: String(gameEntry?.priorityConfigurationState || '').trim(),
      priorityConfiguredExecutablePaths: Array.isArray(gameEntry?.priorityConfiguredExecutablePaths)
        ? [...gameEntry.priorityConfiguredExecutablePaths]
        : [],
      priorityMissingExecutablePaths: Array.isArray(gameEntry?.priorityMissingExecutablePaths)
        ? [...gameEntry.priorityMissingExecutablePaths]
        : [],
      priorityRegistryPaths: Array.isArray(gameEntry?.priorityRegistryPaths) ? [...gameEntry.priorityRegistryPaths] : [],
      logicalProcessorCount: Number.isFinite(Number(gameEntry?.logicalProcessorCount)) ? Math.trunc(Number(gameEntry.logicalProcessorCount)) : 0,
      cpuAffinityMask: String(gameEntry?.cpuAffinityMask || '').trim(),
      cpuAffinityProcessors: Array.isArray(gameEntry?.cpuAffinityProcessors) ? [...gameEntry.cpuAffinityProcessors] : [],
      cpuAffinityReadError: String(gameEntry?.cpuAffinityReadError || '').trim(),
      detectionMode: ['direct', 'bridged', 'background', 'exact-executable'].includes(normalizedDetectionMode)
        ? normalizedDetectionMode
        : 'direct',
      anchorProcessId: Number.isFinite(normalizedAnchorProcessId) && normalizedAnchorProcessId > 0
        ? Math.trunc(normalizedAnchorProcessId)
        : Math.trunc(normalizedProcessId),
      targetProcessId: Number.isFinite(normalizedTargetProcessId) && normalizedTargetProcessId > 0
        ? Math.trunc(normalizedTargetProcessId)
        : Math.trunc(normalizedProcessId)
    };
    lastDetectedGameAt = Date.now();
  }

  function ensureWindowsPlatform() {
    if (process.platform !== 'win32') {
      throw new AppsManagerError('Apps management is currently supported on Windows only.', 'APPS_PLATFORM_UNSUPPORTED', {
        platform: process.platform
      });
    }
  }

  function runPowerShell(script, { timeoutMs = DEFAULT_LIST_TIMEOUT_MS } = {}) {
    ensureWindowsPlatform();
    const scriptSource = String(script || '');
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '-'
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(resolveWindowsSystemExecutable('powershell'), args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const finalizeReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      const finalizeResolve = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.stdin.on('error', () => {
        // Process-start and close handlers report the actionable failure.
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        finalizeReject(
          new AppsManagerError('Unable to launch PowerShell.', 'APPS_POWERSHELL_START_FAILED', {
            message: error.message
          })
        );
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        if (timedOut) {
          finalizeReject(
            new AppsManagerError('PowerShell command timed out.', 'APPS_TIMEOUT', {
              timeoutMs
            })
          );
          return;
        }

        if (exitCode !== 0) {
          finalizeReject(
            new AppsManagerError('PowerShell command failed.', 'APPS_POWERSHELL_FAILED', {
              exitCode,
              stderr: stderr.trim(),
              stdout: stdout.trim()
            })
          );
          return;
        }

        finalizeResolve({
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      child.stdin.end(scriptSource, 'utf8');
    });
  }

  async function runPowerShellJson(script, options = {}) {
    const result = await runPowerShell(script, options);
    if (!result.stdout) {
      return [];
    }

    try {
      return JSON.parse(result.stdout);
    } catch (_error) {
      throw new AppsManagerError('Unable to parse PowerShell JSON output.', 'APPS_JSON_PARSE_FAILED', {
        outputPreview: result.stdout.slice(0, 1000)
      });
    }
  }

  async function readRuntimeStateForExecutable({ executablePath, processId = 0 } = {}) {
    const normalizedExecutablePath = String(executablePath || '').trim();
    if (!normalizedExecutablePath) {
      return null;
    }

    const normalizedProcessId = Number(processId);
    const payload = encodePayload({
      executablePath: normalizedExecutablePath,
      processId: Number.isFinite(normalizedProcessId) && normalizedProcessId > 0 ? Math.trunc(normalizedProcessId) : 0
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$executablePath = [Environment]::ExpandEnvironmentVariables([string]$payload.executablePath).Trim()
$processId = [int]$payload.processId

function Normalize-ExecutablePath([string]$value) {
  $candidate = [Environment]::ExpandEnvironmentVariables([string]$value).Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }

  try {
    $candidate = [IO.Path]::GetFullPath($candidate)
  } catch {
    # Keep the expanded value when GetFullPath cannot normalize it.
  }

  return $candidate
}

function Split-LayerTokens([string]$value) {
  $tokens = New-Object 'System.Collections.Generic.List[string]'
  if ([string]::IsNullOrWhiteSpace($value)) {
    return ,$tokens
  }

  foreach ($token in ($value -split '\\s+')) {
    $trimmedToken = [string]$token
    if (-not [string]::IsNullOrWhiteSpace($trimmedToken)) {
      $tokens.Add($trimmedToken) | Out-Null
    }
  }

  return ,$tokens
}

function Contains-LayerToken([System.Collections.Generic.List[string]]$tokens, [string]$tokenName) {
  if ($null -eq $tokens -or [string]::IsNullOrWhiteSpace($tokenName)) { return $false }
  foreach ($token in $tokens) {
    if ([string]$token -ieq $tokenName) {
      return $true
    }
  }
  return $false
}

function Add-UniquePath([System.Collections.Generic.List[string]]$paths, [string]$value) {
  if ($null -eq $paths) { return }
  $candidate = Normalize-ExecutablePath -value $value
  if ([string]::IsNullOrWhiteSpace($candidate)) { return }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return }

  foreach ($pathEntry in $paths) {
    if ([string]::Equals([string]$pathEntry, $candidate, [StringComparison]::OrdinalIgnoreCase)) {
      return
    }
  }

  $paths.Add($candidate) | Out-Null
}

function Get-CompatibilityExecutablePaths([string]$targetPath) {
  $paths = New-Object 'System.Collections.Generic.List[string]'
  $normalizedTargetPath = Normalize-ExecutablePath -value $targetPath
  Add-UniquePath -paths $paths -value $normalizedTargetPath

  if ([string]::IsNullOrWhiteSpace($normalizedTargetPath)) {
    return ,$paths
  }

  $fileName = ''
  $directory = ''
  try {
    $fileName = [IO.Path]::GetFileName($normalizedTargetPath)
    $directory = [IO.Path]::GetDirectoryName($normalizedTargetPath)
  } catch {
    return ,$paths
  }

  if (
    -not [string]::IsNullOrWhiteSpace($directory) -and
    $fileName -match '(?i)^FortniteClient-Win64-Shipping(?:_.+)?\\.exe$'
  ) {
    try {
      $fortniteRuntimeExecutables = Get-ChildItem -LiteralPath $directory -Filter 'FortniteClient-Win64-Shipping*.exe' -File -ErrorAction SilentlyContinue
      foreach ($runtimeExecutable in @($fortniteRuntimeExecutables)) {
        Add-UniquePath -paths $paths -value ([string]$runtimeExecutable.FullName)
      }
    } catch {
      # best effort only
    }
  }

  return ,$paths
}

function Get-IfeoPriorityPaths([string]$targetPath) {
  $normalizedTargetPath = Normalize-ExecutablePath -value $targetPath
  $exeName = ''
  try {
    $exeName = [IO.Path]::GetFileName($normalizedTargetPath)
  } catch {
    $exeName = ''
  }

  if ([string]::IsNullOrWhiteSpace($exeName)) {
    return [PSCustomObject]@{
      exeName = ''
      exeKeyPath = ''
      perfOptionsPath = ''
    }
  }

  $ifeoBasePath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options'
  $exeKeyPath = Join-Path -Path $ifeoBasePath -ChildPath $exeName
  $perfOptionsPath = Join-Path -Path $exeKeyPath -ChildPath 'PerfOptions'

  return [PSCustomObject]@{
    exeName = $exeName
    exeKeyPath = $exeKeyPath
    perfOptionsPath = $perfOptionsPath
  }
}

function Get-IfeoPriorityClass([string]$targetPath) {
  $priorityPaths = Get-IfeoPriorityPaths -targetPath $targetPath
  if ([string]::IsNullOrWhiteSpace([string]$priorityPaths.perfOptionsPath)) {
    return ''
  }

  try {
    $perfOptions = Get-Item -LiteralPath ([string]$priorityPaths.perfOptionsPath) -ErrorAction SilentlyContinue
    if (
      $perfOptions -and
      $perfOptions.GetValueKind('CpuPriorityClass') -eq [Microsoft.Win32.RegistryValueKind]::DWord -and
      [int]$perfOptions.GetValue('CpuPriorityClass') -eq 3
    ) {
      return 'High'
    }
  } catch {
    return ''
  }

  return ''
}

function Get-PriorityConfigurationState([System.Collections.Generic.List[string]]$targetPaths) {
  $configuredExecutablePaths = New-Object 'System.Collections.Generic.List[string]'
  $missingExecutablePaths = New-Object 'System.Collections.Generic.List[string]'
  $registryPaths = New-Object 'System.Collections.Generic.List[string]'

  foreach ($targetPath in @($targetPaths)) {
    $priorityPaths = Get-IfeoPriorityPaths -targetPath ([string]$targetPath)
    if ([string]::IsNullOrWhiteSpace([string]$priorityPaths.perfOptionsPath)) {
      continue
    }

    $registryPaths.Add([string]$priorityPaths.perfOptionsPath) | Out-Null
    if ((Get-IfeoPriorityClass -targetPath ([string]$targetPath)) -ieq 'High') {
      $configuredExecutablePaths.Add([string]$targetPath) | Out-Null
    } else {
      $missingExecutablePaths.Add([string]$targetPath) | Out-Null
    }
  }

  $configurationState = 'missing'
  if ($configuredExecutablePaths.Count -gt 0 -and $missingExecutablePaths.Count -eq 0) {
    $configurationState = 'configured'
  } elseif ($configuredExecutablePaths.Count -gt 0) {
    $configurationState = 'partial'
  }

  return [PSCustomObject]@{
    configured = [bool]($configuredExecutablePaths.Count -gt 0)
    configurationState = $configurationState
    configuredExecutablePaths = @($configuredExecutablePaths)
    missingExecutablePaths = @($missingExecutablePaths)
    registryPaths = @($registryPaths)
  }
}

function Get-FullscreenOptimizationState([System.Collections.Generic.List[string]]$targetPaths) {
  if ($null -eq $targetPaths -or $targetPaths.Count -le 0) {
    return $false
  }

  $layersPath = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
  $layers = Get-ItemProperty -Path $layersPath -ErrorAction SilentlyContinue
  if (-not $layers) {
    return $false
  }

  foreach ($targetPath in @($targetPaths)) {
    if ([string]::IsNullOrWhiteSpace([string]$targetPath)) {
      continue
    }

    $layerEntry = $layers.PSObject.Properties | Where-Object { $_.Name -eq [string]$targetPath } | Select-Object -First 1
    if (-not $layerEntry) {
      continue
    }

    $layerValue = [string]$layerEntry.Value
    $layerTokens = Split-LayerTokens -value $layerValue
    if (Contains-LayerToken -tokens $layerTokens -tokenName 'DISABLEDXMAXIMIZEDWINDOWEDMODE') {
      return $true
    }
  }

  return $false
}

function Resolve-ProcessExecutablePath([Diagnostics.Process]$process) {
  if ($null -eq $process) { return '' }

  $resolvedPath = ''
  try {
    $resolvedPath = [string]$process.MainModule.FileName
  } catch {
    $resolvedPath = ''
  }

  if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
    try {
      $candidateProcessId = [int]$process.Id
      $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $candidateProcessId" -ErrorAction Stop
      $resolvedPath = [string]$cimProcess.ExecutablePath
    } catch {
      $resolvedPath = ''
    }
  }

  return Normalize-ExecutablePath -value $resolvedPath
}

function New-RuntimeTarget([int]$targetProcessId, [string]$targetExecutablePath, [string]$matchState) {
  return [PSCustomObject]@{
    processId = [int]$targetProcessId
    executablePath = [string]$targetExecutablePath
    matchState = [string]$matchState
  }
}

function Resolve-TargetRuntimeProcess([string]$targetPath, [int]$preferredProcessId) {
  $normalizedTargetPath = Normalize-ExecutablePath -value $targetPath
  if ([string]::IsNullOrWhiteSpace($normalizedTargetPath)) {
    return (New-RuntimeTarget -targetProcessId 0 -targetExecutablePath '' -matchState 'missing-target-path')
  }

  $targetBaseName = ''
  try {
    $targetBaseName = [IO.Path]::GetFileNameWithoutExtension($normalizedTargetPath)
  } catch {
    $targetBaseName = ''
  }

  if ($preferredProcessId -gt 0) {
    try {
      $preferredProcess = Get-Process -Id $preferredProcessId -ErrorAction Stop
      $preferredPath = Resolve-ProcessExecutablePath -process $preferredProcess
      if ([string]::Equals($preferredPath, $normalizedTargetPath, [StringComparison]::OrdinalIgnoreCase)) {
        return (New-RuntimeTarget -targetProcessId ([int]$preferredProcess.Id) -targetExecutablePath $preferredPath -matchState 'preferred-exact-path')
      }
    } catch {
      # Ignore mismatched or unavailable preferred PID.
    }
  }

  $nameOnlyFallback = $null
  if (-not [string]::IsNullOrWhiteSpace($targetBaseName)) {
    foreach ($candidateProcess in @(Get-Process -Name $targetBaseName -ErrorAction SilentlyContinue)) {
      $candidatePath = Resolve-ProcessExecutablePath -process $candidateProcess
      if ([string]::Equals($candidatePath, $normalizedTargetPath, [StringComparison]::OrdinalIgnoreCase)) {
        return (New-RuntimeTarget -targetProcessId ([int]$candidateProcess.Id) -targetExecutablePath $candidatePath -matchState 'exact-path')
      }

      if (
        $null -eq $nameOnlyFallback -and
        [string]::IsNullOrWhiteSpace($candidatePath) -and
        [string]::Equals([string]$candidateProcess.ProcessName, $targetBaseName, [StringComparison]::OrdinalIgnoreCase)
      ) {
        $nameOnlyFallback = $candidateProcess
      }
    }
  }

  if ($null -ne $nameOnlyFallback) {
    return (New-RuntimeTarget -targetProcessId ([int]$nameOnlyFallback.Id) -targetExecutablePath $normalizedTargetPath -matchState 'exact-name')
  }

  return (New-RuntimeTarget -targetProcessId 0 -targetExecutablePath $normalizedTargetPath -matchState 'not-running')
}

function Convert-ProcessPriorityValue([int]$priorityValue) {
  if ($priorityValue -ge 24) { return 'RealTime' }
  if ($priorityValue -ge 13) { return 'High' }
  if ($priorityValue -ge 10) { return 'AboveNormal' }
  if ($priorityValue -le 4 -and $priorityValue -gt 0) { return 'Idle' }
  if ($priorityValue -le 6 -and $priorityValue -gt 0) { return 'BelowNormal' }
  if ($priorityValue -gt 0) { return 'Normal' }
  return ''
}

function Get-RuntimePriorityClass([int]$targetProcessId) {
  $priorityClass = ''
  $priorityReadError = ''

  if ($targetProcessId -le 0) {
    return [PSCustomObject]@{
      priorityClass = ''
      priorityReadError = 'PROCESS_NOT_FOUND'
    }
  }

  try {
    $priorityProcess = Get-Process -Id $targetProcessId -ErrorAction Stop
    if ($priorityProcess) {
      $priorityClass = [string]$priorityProcess.PriorityClass
    }
  } catch {
    $priorityReadError = 'PROCESS_PRIORITY_READ_FAILED'
  }

  if ([string]::IsNullOrWhiteSpace($priorityClass)) {
    try {
      $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $targetProcessId" -ErrorAction Stop
      if ($cimProcess) {
        $priorityClass = Convert-ProcessPriorityValue -priorityValue ([int]$cimProcess.Priority)
        $priorityReadError = ''
      }
    } catch {
      if ([string]::IsNullOrWhiteSpace($priorityReadError)) {
        $priorityReadError = 'PROCESS_PRIORITY_READ_FAILED'
      }
    }
  }

  return [PSCustomObject]@{
    priorityClass = $priorityClass
    priorityReadError = $priorityReadError
  }
}

function Get-LogicalProcessorCount {
  try {
    $count = [int][Environment]::ProcessorCount
    if ($count -gt 0) {
      return [Math]::Min($count, 64)
    }
  } catch {
    # keep default below
  }

  return 0
}

function Convert-Int64ToUInt64([Int64]$value) {
  return [BitConverter]::ToUInt64([BitConverter]::GetBytes($value), 0)
}

function Convert-AffinityMaskToProcessors([UInt64]$mask, [int]$logicalProcessorCount) {
  $processors = New-Object 'System.Collections.Generic.List[int]'
  $count = [Math]::Max(0, [Math]::Min(64, $logicalProcessorCount))

  for ($index = 0; $index -lt $count; $index++) {
    $bit = [UInt64][Math]::Pow(2, $index)
    if (($mask -band $bit) -ne 0) {
      $processors.Add([int]$index) | Out-Null
    }
  }

  return ,$processors
}

function Get-ProcessAffinity([int]$targetProcessId) {
  $logicalProcessorCount = Get-LogicalProcessorCount

  if ($targetProcessId -le 0) {
    return [PSCustomObject]@{
      logicalProcessorCount = [int]$logicalProcessorCount
      cpuAffinityMask = ''
      cpuAffinityProcessors = @()
      cpuAffinityReadError = 'PROCESS_NOT_FOUND'
    }
  }

  try {
    $process = Get-Process -Id $targetProcessId -ErrorAction Stop
    $mask = Convert-Int64ToUInt64 -value ([Int64]$process.ProcessorAffinity.ToInt64())
    $processors = Convert-AffinityMaskToProcessors -mask $mask -logicalProcessorCount $logicalProcessorCount

    return [PSCustomObject]@{
      logicalProcessorCount = [int]$logicalProcessorCount
      cpuAffinityMask = [string]$mask
      cpuAffinityProcessors = @($processors)
      cpuAffinityReadError = ''
    }
  } catch {
    return [PSCustomObject]@{
      logicalProcessorCount = [int]$logicalProcessorCount
      cpuAffinityMask = ''
      cpuAffinityProcessors = @()
      cpuAffinityReadError = 'PROCESS_AFFINITY_READ_FAILED'
    }
  }
}

$runtimeTarget = Resolve-TargetRuntimeProcess -targetPath $executablePath -preferredProcessId $processId
$runtimePriority = Get-RuntimePriorityClass -targetProcessId ([int]$runtimeTarget.processId)
$cpuAffinity = Get-ProcessAffinity -targetProcessId ([int]$runtimeTarget.processId)
$compatibilityExecutablePaths = Get-CompatibilityExecutablePaths -targetPath $executablePath
$priorityConfiguration = Get-PriorityConfigurationState -targetPaths $compatibilityExecutablePaths
$fullscreenOptimizationsDisabled = [bool](Get-FullscreenOptimizationState -targetPaths $compatibilityExecutablePaths)

[PSCustomObject]@{
  runtimeProcessId = [int]$runtimeTarget.processId
  runtimeExecutablePath = [string]$runtimeTarget.executablePath
  runtimeProcessMatchState = [string]$runtimeTarget.matchState
  fullscreenOptimizationsDisabled = $fullscreenOptimizationsDisabled
  compatibilityExecutablePaths = @($compatibilityExecutablePaths)
  priorityClass = [string]$runtimePriority.priorityClass
  runtimePriorityClass = [string]$runtimePriority.priorityClass
  priorityReadError = [string]$runtimePriority.priorityReadError
  priorityConfigured = [bool]$priorityConfiguration.configured
  priorityConfigurationState = [string]$priorityConfiguration.configurationState
  priorityConfiguredExecutablePaths = @($priorityConfiguration.configuredExecutablePaths)
  priorityMissingExecutablePaths = @($priorityConfiguration.missingExecutablePaths)
  priorityRegistryPaths = @($priorityConfiguration.registryPaths)
  logicalProcessorCount = [int]$cpuAffinity.logicalProcessorCount
  cpuAffinityMask = [string]$cpuAffinity.cpuAffinityMask
  cpuAffinityProcessors = @($cpuAffinity.cpuAffinityProcessors)
  cpuAffinityReadError = [string]$cpuAffinity.cpuAffinityReadError
} | ConvertTo-Json -Compress -Depth 6
`;

    try {
      const result = await runPowerShellJson(script, { timeoutMs: DEFAULT_GAME_TUNING_TIMEOUT_MS });
      const toStringList = (value) => {
        const values = Array.isArray(value) ? value : [value];
        return values.map((entry) => String(entry || '').trim()).filter(Boolean);
      };
      const toNumberList = (value) => {
        const values = Array.isArray(value) ? value : [value];
        return values
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
          .map((entry) => Math.trunc(entry));
      };

      return {
        runtimeProcessId: Number.isFinite(Number(result?.runtimeProcessId)) && Number(result.runtimeProcessId) > 0
          ? Math.trunc(Number(result.runtimeProcessId))
          : 0,
        runtimeExecutablePath: String(result?.runtimeExecutablePath || '').trim(),
        runtimeProcessMatchState: String(result?.runtimeProcessMatchState || '').trim(),
        fullscreenOptimizationsDisabled: Boolean(result?.fullscreenOptimizationsDisabled),
        compatibilityExecutablePaths: toStringList(result?.compatibilityExecutablePaths),
        priorityClass: String(result?.priorityClass || '').trim(),
        runtimePriorityClass: String(result?.runtimePriorityClass || result?.priorityClass || '').trim(),
        priorityReadError: String(result?.priorityReadError || '').trim(),
        priorityConfigured: Boolean(result?.priorityConfigured),
        priorityConfigurationState: String(result?.priorityConfigurationState || '').trim(),
        priorityConfiguredExecutablePaths: toStringList(result?.priorityConfiguredExecutablePaths),
        priorityMissingExecutablePaths: toStringList(result?.priorityMissingExecutablePaths),
        priorityRegistryPaths: toStringList(result?.priorityRegistryPaths),
        logicalProcessorCount: Number.isFinite(Number(result?.logicalProcessorCount))
          ? Math.trunc(Number(result.logicalProcessorCount))
          : 0,
        cpuAffinityMask: String(result?.cpuAffinityMask || '').trim(),
        cpuAffinityProcessors: toNumberList(result?.cpuAffinityProcessors),
        cpuAffinityReadError: String(result?.cpuAffinityReadError || '').trim()
      };
    } catch (error) {
      logger?.warn?.('Unable to read runtime state for executable.', {
        executablePath: normalizedExecutablePath,
        message: error?.message || String(error)
      });

      return null;
    }
  }

  async function iconFileToDataUrl(iconPath) {
    const normalized = String(iconPath || '').trim();
    if (!normalized || !isImageIconPath(normalized)) {
      return '';
    }

    try {
      const stats = await fs.stat(normalized);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_ICON_FILE_SIZE_BYTES) {
        return '';
      }

      const buffer = await fs.readFile(normalized);
      const mimeType = MIME_BY_EXTENSION[extensionOf(normalized)] || 'application/octet-stream';
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (_error) {
      return '';
    }
  }

  async function extractBinaryIconDataUrls(iconPaths) {
    const normalizedPaths = Array.isArray(iconPaths)
      ? iconPaths.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (!normalizedPaths.length) {
      return new Map();
    }

    if (loadFileIcon) {
      return new Map(await Promise.all(normalizedPaths.map(async (iconPath) => [
        normalizeWindowsPathKey(iconPath), await loadFileIcon(iconPath)
      ])));
    }

    const payload = encodePayload({
      paths: normalizedPaths
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$paths = @($payload.paths)
$result = New-Object System.Collections.Generic.List[object]

try {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
  $result | ConvertTo-Json -Compress -Depth 6
  return
}

foreach ($rawPath in $paths) {
  $iconPath = [string]$rawPath
  if ([string]::IsNullOrWhiteSpace($iconPath)) { continue }
  if (-not (Test-Path -LiteralPath $iconPath)) { continue }
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath)
    if ($null -eq $icon) { continue }
    $bitmap = $icon.ToBitmap()
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $dataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
    $result.Add([PSCustomObject]@{
      path = $iconPath
      dataUrl = $dataUrl
    }) | Out-Null
    $stream.Dispose()
    $bitmap.Dispose()
    $icon.Dispose()
  } catch {
    # best effort only
  }
}

$result | ConvertTo-Json -Compress -Depth 6
`;

    const rawResult = await runPowerShellJson(script, { timeoutMs: DEFAULT_ICON_TIMEOUT_MS });
    const list = Array.isArray(rawResult) ? rawResult : rawResult ? [rawResult] : [];
    const map = new Map();
    for (const row of list) {
      const rowPath = String(row?.path || '').trim();
      const dataUrl = String(row?.dataUrl || '').trim();
      if (!rowPath || !dataUrl) {
        continue;
      }
      map.set(normalizeWindowsPathKey(rowPath), dataUrl);
    }
    return map;
  }

  async function extractBestGameIconDataUrl(executablePath) {
    const normalizedPath = String(executablePath || '').trim();
    if (!normalizedPath || !isBinaryIconPath(normalizedPath)) {
      return '';
    }

    const cacheKey = normalizeWindowsPathKey(normalizedPath);
    if (iconDataUrlCache.has(cacheKey)) {
      return iconDataUrlCache.get(cacheKey) || '';
    }

    const payload = encodePayload({
      path: normalizedPath,
      sizes: [256, 128, 64, 48, 32, 16]
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$exePath = [string]$payload.path
$sizes = @($payload.sizes)

if ([string]::IsNullOrWhiteSpace($exePath) -or -not (Test-Path -LiteralPath $exePath)) {
  $null | ConvertTo-Json -Compress -Depth 4
  return
}

try {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
  $null | ConvertTo-Json -Compress -Depth 4
  return
}

try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NovaGameIconExtractor {
  [DllImport("User32.dll", CharSet = CharSet.Unicode)]
  public static extern int PrivateExtractIcons(
    string szFileName,
    int nIconIndex,
    int cxIcon,
    int cyIcon,
    IntPtr[] phicon,
    int[] piconid,
    uint nIcons,
    uint flags
  );

  [DllImport("User32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
"@ -ErrorAction Stop
} catch {
  # Type may already exist in this PowerShell process; continue if it does.
}

foreach ($rawSize in $sizes) {
  $size = 0
  if (-not [int]::TryParse([string]$rawSize, [ref]$size) -or $size -le 0) { continue }

  $icons = New-Object IntPtr[] 1
  $ids = New-Object int[] 1
  $icon = $null
  $bitmap = $null
  $stream = $null

  try {
    $result = [NovaGameIconExtractor]::PrivateExtractIcons(
      $exePath,
      0,
      $size,
      $size,
      $icons,
      $ids,
      1,
      0
    )

    if ($result -le 0 -or $icons[0] -eq [IntPtr]::Zero) { continue }

    $icon = [System.Drawing.Icon]::FromHandle($icons[0])
    if ($null -eq $icon) { continue }

    $bitmap = $icon.ToBitmap()
    if ($null -eq $bitmap) { continue }

    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $dataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($bytes)

    [PSCustomObject]@{
      path = $exePath
      size = $size
      dataUrl = $dataUrl
    } | ConvertTo-Json -Compress -Depth 4
    return
  } catch {
    # Best effort only. Try the next icon size.
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $icon) { $icon.Dispose() }
    if ($icons[0] -ne [IntPtr]::Zero) {
      [NovaGameIconExtractor]::DestroyIcon($icons[0]) | Out-Null
    }
  }
}

$null | ConvertTo-Json -Compress -Depth 4
`;

    try {
      const rawResult = await runPowerShellJson(script, { timeoutMs: DEFAULT_GAME_ICON_TIMEOUT_MS });
      const dataUrl = String(rawResult?.dataUrl || '').trim();
      const normalizedDataUrl = dataUrl.startsWith('data:image/png;base64,') ? dataUrl : '';
      iconDataUrlCache.set(cacheKey, normalizedDataUrl);
      return normalizedDataUrl;
    } catch (error) {
      iconDataUrlCache.set(cacheKey, '');
      logger?.debug?.('Unable to extract game icon.', {
        executablePath: normalizedPath,
        message: error?.message || String(error)
      });
      return '';
    }
  }

  async function withIconData(internalApps) {
    const sourceApps = Array.isArray(internalApps) ? internalApps : [];
    if (!sourceApps.length) {
      return [];
    }

    const imagePathSet = new Set();
    const binaryPathSet = new Set();
    const cachedIconMap = new Map();

    for (const app of sourceApps) {
      const iconPath = String(app?.iconPath || '').trim();
      if (!iconPath) {
        continue;
      }

      const cacheKey = normalizeWindowsPathKey(iconPath);
      if (iconDataUrlCache.has(cacheKey)) {
        const cachedDataUrl = iconDataUrlCache.get(cacheKey);
        if (cachedDataUrl) {
          cachedIconMap.set(cacheKey, cachedDataUrl);
        }
        continue;
      }

      if (isImageIconPath(iconPath)) {
        imagePathSet.add(iconPath);
      } else if (isBinaryIconPath(iconPath)) {
        binaryPathSet.add(iconPath);
      }
    }

    const imageMap = new Map();
    await Promise.all(
      Array.from(imagePathSet).map(async (iconPath) => {
        const dataUrl = await iconFileToDataUrl(iconPath);
        const cacheKey = normalizeWindowsPathKey(iconPath);
        imageMap.set(cacheKey, dataUrl || '');
        iconDataUrlCache.set(cacheKey, dataUrl || '');
      })
    );

    const binaryMap = await extractBinaryIconDataUrls(Array.from(binaryPathSet));
    for (const iconPath of binaryPathSet) {
      const cacheKey = normalizeWindowsPathKey(iconPath);
      const dataUrl = binaryMap.get(cacheKey) || '';
      binaryMap.set(cacheKey, dataUrl);
      if (dataUrl) iconDataUrlCache.set(cacheKey, dataUrl);
    }

    return sourceApps.map((app) => {
      const key = normalizeWindowsPathKey(app.iconPath);
      const iconDataUrl = cachedIconMap.get(key) || imageMap.get(key) || binaryMap.get(key) || '';
      return {
        ...app,
        iconDataUrl
      };
    });
  }

  async function scanInstalledApps(detailLevel = 'full') {
    const includeDetails = detailLevel === 'full';
    const script = `
$ErrorActionPreference = 'Stop'
$includeDetails = ${includeDetails ? '$true' : '$false'}
$apps = @()

$registryPaths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)

function Normalize-Token([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return (($value -replace '[^a-zA-Z0-9]', '').ToLowerInvariant())
}

function Get-SafeExtension([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  try {
    return [IO.Path]::GetExtension($value)
  } catch {
    return ''
  }
}

function Resolve-ExistingLeafPath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  try {
    if (Test-Path -LiteralPath $value -PathType Leaf) {
      return (Resolve-Path -LiteralPath $value).Path
    }
  } catch {
    return ''
  }
  return ''
}

function Resolve-ExecutableFromCommand([string]$commandLine) {
  if ([string]::IsNullOrWhiteSpace($commandLine)) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables($commandLine).Trim()
  if ([string]::IsNullOrWhiteSpace($expanded)) { return '' }

  $candidate = ''
  $quoted = [Regex]::Match($expanded, '^\s*"([^"]+)"')
  if ($quoted.Success) {
    $candidate = [string]$quoted.Groups[1].Value
  } else {
    $plain = [Regex]::Match($expanded, '^\s*([^\s]+)')
    if ($plain.Success) {
      $candidate = [string]$plain.Groups[1].Value
    }
  }

  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
  return Resolve-ExistingLeafPath -value $candidate
}

function Get-StartMenuShortcutEntries() {
  $result = New-Object System.Collections.Generic.List[object]
  $roots = @(
    (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
    (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')
  )

  try {
    $shell = New-Object -ComObject WScript.Shell
  } catch {
    return [object[]]@()
  }

  foreach ($root in $roots) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) { continue }
    $links = Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue
    foreach ($link in $links) {
      try {
        $shortcut = $shell.CreateShortcut($link.FullName)
        $result.Add([PSCustomObject]@{
          name = [string]$link.BaseName
          targetPath = [string]$shortcut.TargetPath
          arguments = [string]$shortcut.Arguments
          iconLocation = [string]$shortcut.IconLocation
        }) | Out-Null
      } catch {
        # Skip broken shortcuts.
      }
    }
  }

  return [object[]]$result.ToArray()
}

function Resolve-IconFromShortcuts([string]$displayName, [object[]]$shortcuts, [string]$installLocation) {
  if ([string]::IsNullOrWhiteSpace($displayName)) { return '' }
  if (-not $shortcuts -or $shortcuts.Count -eq 0) { return '' }

  $nameToken = Normalize-Token $displayName
  if ([string]::IsNullOrWhiteSpace($nameToken)) { return '' }
  $installToken = Normalize-Token $installLocation

  $direct = $shortcuts | Where-Object { (Normalize-Token ([string]$_.name)) -eq $nameToken } | Select-Object -First 1
  if ($null -eq $direct) {
    $direct = $shortcuts | Where-Object {
      $shortcutToken = Normalize-Token ([string]$_.name)
      if ([string]::IsNullOrWhiteSpace($shortcutToken)) { return $false }
      if ($shortcutToken.Contains($nameToken) -or $nameToken.Contains($shortcutToken)) { return $true }

      if (-not [string]::IsNullOrWhiteSpace($installToken)) {
        $shortcutTargetToken = Normalize-Token ([string]$_.targetPath)
        if (-not [string]::IsNullOrWhiteSpace($shortcutTargetToken) -and $shortcutTargetToken.Contains($installToken)) {
          return $true
        }
      }
      return $false
    } | Select-Object -First 1
  }

  if ($null -eq $direct) { return '' }

  $iconLocation = [string]$direct.iconLocation
  if (-not [string]::IsNullOrWhiteSpace($iconLocation)) {
    $iconCandidate = $iconLocation.Trim()
    $iconMatch = [Regex]::Match($iconCandidate, '^\s*"([^"]+)"')
    if ($iconMatch.Success) {
      $iconCandidate = [string]$iconMatch.Groups[1].Value
    } else {
      $iconCandidate = ($iconCandidate -split ',')[0]
    }

    $iconCandidate = [Environment]::ExpandEnvironmentVariables($iconCandidate.Trim())
    $resolvedIconCandidate = Resolve-ExistingLeafPath -value $iconCandidate
    if (-not [string]::IsNullOrWhiteSpace($resolvedIconCandidate)) {
      return $resolvedIconCandidate
    }
  }

  $targetPath = [Environment]::ExpandEnvironmentVariables(([string]$direct.targetPath).Trim())
  $resolvedTargetPath = Resolve-ExistingLeafPath -value $targetPath
  if (-not [string]::IsNullOrWhiteSpace($resolvedTargetPath)) {
    return $resolvedTargetPath
  }

  return ''
}

function Format-RegistryInstallDate([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  $trimmed = $value.Trim()
  if ($trimmed -match '^\\d{8}$') {
    try {
      $year = [int]$trimmed.Substring(0, 4)
      $month = [int]$trimmed.Substring(4, 2)
      $day = [int]$trimmed.Substring(6, 2)
      $parsed = [DateTime]::new($year, $month, $day)
      return $parsed.ToString('yyyy-MM-dd')
    } catch {
      return ''
    }
  }
  return $trimmed
}

function Resolve-AppExecutablePath([string]$displayName, [string]$installLocation, [string]$iconPath, [string]$uninstallCommand, [object[]]$shortcuts) {
  $iconCandidate = [Environment]::ExpandEnvironmentVariables(([string]$iconPath).Trim())
  if ((Get-SafeExtension -value $iconCandidate) -ieq '.exe') {
    $resolvedIconCandidate = Resolve-ExistingLeafPath -value $iconCandidate
    if (-not [string]::IsNullOrWhiteSpace($resolvedIconCandidate)) {
      return $resolvedIconCandidate
    }
  }

  $commandExe = Resolve-ExecutableFromCommand -commandLine $uninstallCommand
  if (-not [string]::IsNullOrWhiteSpace($commandExe) -and (Get-SafeExtension -value $commandExe) -ieq '.exe') {
    return $commandExe
  }

  $shortcutExe = Resolve-IconFromShortcuts -displayName $displayName -shortcuts $shortcuts -installLocation $installLocation
  if ((Get-SafeExtension -value $shortcutExe) -ieq '.exe') {
    $resolvedShortcutExe = Resolve-ExistingLeafPath -value $shortcutExe
    if (-not [string]::IsNullOrWhiteSpace($resolvedShortcutExe)) {
      return $resolvedShortcutExe
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($installLocation) -and (Test-Path -LiteralPath $installLocation -PathType Container)) {
    $exeCandidates = Get-ChildItem -LiteralPath $installLocation -Filter '*.exe' -File -ErrorAction SilentlyContinue
    if ($exeCandidates) {
      $nameToken = Normalize-Token $displayName
      $preferredExe = $exeCandidates | Where-Object {
        $baseToken = Normalize-Token ([string]$_.BaseName)
        -not [string]::IsNullOrWhiteSpace($nameToken) -and ($baseToken.Contains($nameToken) -or $nameToken.Contains($baseToken))
      } | Select-Object -First 1

      if ($preferredExe) { return [string]$preferredExe.FullName }
      $firstExe = $exeCandidates | Select-Object -First 1
      if ($firstExe) { return [string]$firstExe.FullName }
    }
  }

  return ''
}

function New-RuntimeState([string]$status, [bool]$active, [int]$processId) {
  return [PSCustomObject]@{
    runtimeStatus = [string]$status
    processActive = [bool]$active
    processId = [int]$processId
  }
}

function Add-UniqueRuntimeHint($items, [string]$value) {
  $normalized = Normalize-Token $value
  if ([string]::IsNullOrWhiteSpace($normalized)) { return }
  if (-not $items.Contains($normalized)) {
    $items.Add($normalized) | Out-Null
  }
}

function Add-ExecutableRuntimeHint($items, [string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $clean = ([string]$value).Trim().Trim('"')
  if ([string]::IsNullOrWhiteSpace($clean)) { return }

  $baseName = ''
  try {
    $baseName = [IO.Path]::GetFileNameWithoutExtension($clean)
  } catch {
    $baseName = ($clean -replace '(?i)\.exe$', '')
  }

  Add-UniqueRuntimeHint -items $items -value $baseName
}

function Get-CommandRuntimeHints([string]$commandLine) {
  $hints = New-Object 'System.Collections.Generic.List[string]'
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return [string[]]@()
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($commandLine)
  foreach ($match in [Regex]::Matches($expanded, '"([^"]+?\.exe)"', [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    Add-ExecutableRuntimeHint -items $hints -value ([string]$match.Groups[1].Value)
  }

  foreach ($match in [Regex]::Matches($expanded, '(?i)(?<![a-z0-9._-])([a-z0-9._-]+\.exe)(?![a-z0-9._-])')) {
    Add-ExecutableRuntimeHint -items $hints -value ([string]$match.Groups[1].Value)
  }

  $processStartMatch = [Regex]::Match($expanded, '(?i)(?:--processStart|--process-start|/processStart)\s+("?[^"\s]+\.exe"?)')
  if ($processStartMatch.Success) {
    Add-ExecutableRuntimeHint -items $hints -value ([string]$processStartMatch.Groups[1].Value)
  }

  return [string[]]$hints.ToArray()
}

function Get-KnownRuntimeAliases([string]$displayName) {
  $nameKey = Normalize-Token $displayName
  switch ($nameKey) {
    'discord' { return [string[]]@('discord') }
    'spotify' { return [string[]]@('spotify') }
    'spotifyabspotifymusic' { return [string[]]@('spotify') }
    'codex' { return [string[]]@('codex') }
    'openaicodex' { return [string[]]@('codex') }
    'openaichatgptdesktop' { return [string[]]@('chatgpt') }
    'microsoftvisualstudiocode' { return [string[]]@('code') }
    'visualstudiocode' { return [string[]]@('code') }
    'steam' { return [string[]]@('steam') }
    'epicgameslauncher' { return [string[]]@('epicgameslauncher') }
    default { return [string[]]@() }
  }
}

function Get-ShortcutRuntimeHints([string]$displayName, [string]$installLocation, [object[]]$shortcuts) {
  $hints = New-Object 'System.Collections.Generic.List[string]'
  if (-not $shortcuts -or $shortcuts.Count -eq 0) {
    return [string[]]@()
  }

  $displayToken = Normalize-Token $displayName
  $installToken = Normalize-Token $installLocation

  foreach ($shortcut in $shortcuts) {
    $shortcutName = [string]$shortcut.name
    $shortcutTarget = [string]$shortcut.targetPath
    $shortcutArguments = [string]$shortcut.arguments
    $shortcutIcon = [string]$shortcut.iconLocation
    $shortcutToken = Normalize-Token $shortcutName
    $targetToken = Normalize-Token $shortcutTarget

    $isCandidate = $false
    if (
      -not [string]::IsNullOrWhiteSpace($displayToken) -and
      -not [string]::IsNullOrWhiteSpace($shortcutToken) -and
      ($shortcutToken -eq $displayToken -or $shortcutToken.Contains($displayToken) -or $displayToken.Contains($shortcutToken))
    ) {
      $isCandidate = $true
    }

    if (
      -not $isCandidate -and
      -not [string]::IsNullOrWhiteSpace($installToken) -and
      -not [string]::IsNullOrWhiteSpace($targetToken) -and
      $targetToken.Contains($installToken)
    ) {
      $isCandidate = $true
    }

    if (-not $isCandidate) { continue }

    Add-ExecutableRuntimeHint -items $hints -value $shortcutTarget
    Add-ExecutableRuntimeHint -items $hints -value $shortcutIcon
    foreach ($commandHint in Get-CommandRuntimeHints -commandLine "$shortcutTarget $shortcutArguments") {
      Add-UniqueRuntimeHint -items $hints -value $commandHint
    }
  }

  return [string[]]$hints.ToArray()
}

function Normalize-PathForRuntime([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables(([string]$value).Trim())
  if ([string]::IsNullOrWhiteSpace($expanded)) { return '' }
  try {
    if (Test-Path -LiteralPath $expanded) {
      return ((Resolve-Path -LiteralPath $expanded).Path).TrimEnd('\').ToLowerInvariant()
    }
  } catch {
    # Fall through to textual normalization.
  }
  return $expanded.TrimEnd('\').ToLowerInvariant()
}

function Test-SpecificRuntimeDirectory([string]$directoryPath) {
  $normalized = Normalize-PathForRuntime -value $directoryPath
  if ([string]::IsNullOrWhiteSpace($normalized)) { return $false }

  $leaf = ''
  try {
    $leaf = [IO.Path]::GetFileName($normalized)
  } catch {
    $leaf = ''
  }

  $genericLeafs = @(
    'program files',
    'program files (x86)',
    'common files',
    'windows',
    'system32',
    'syswow64',
    'microsoft',
    'application'
  )
  if ($genericLeafs -contains $leaf) { return $false }

  $segments = @($normalized -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  return $segments.Count -ge 2
}

function Test-ProcessInsideDirectory([string]$processPath, [string]$directoryPath) {
  if (-not (Test-SpecificRuntimeDirectory -directoryPath $directoryPath)) { return $false }

  $processKey = Normalize-PathForRuntime -value $processPath
  $directoryKey = Normalize-PathForRuntime -value $directoryPath
  if ([string]::IsNullOrWhiteSpace($processKey) -or [string]::IsNullOrWhiteSpace($directoryKey)) { return $false }

  return $processKey -eq $directoryKey -or $processKey.StartsWith("$directoryKey\")
}

function Resolve-RuntimeState(
  [string]$displayName,
  [string]$installLocation,
  [string]$executablePath,
  [string]$uninstallCommand,
  [string]$iconPath,
  [object[]]$shortcuts,
  [hashtable]$processByPath,
  [hashtable]$processByName,
  $runningProcesses
) {
  $pathKey = Normalize-PathForRuntime -value $executablePath
  if (-not [string]::IsNullOrWhiteSpace($pathKey) -and $processByPath.ContainsKey($pathKey)) {
    return (New-RuntimeState -status 'running' -active $true -processId ([int]$processByPath[$pathKey]))
  }

  $directoryCandidates = New-Object 'System.Collections.Generic.List[string]'
  if (-not [string]::IsNullOrWhiteSpace($installLocation)) {
    $directoryCandidates.Add([string]$installLocation) | Out-Null
  }
  if (-not [string]::IsNullOrWhiteSpace($executablePath)) {
    try {
      $executableDirectory = [IO.Path]::GetDirectoryName($executablePath)
      if (-not [string]::IsNullOrWhiteSpace($executableDirectory)) {
        $directoryCandidates.Add([string]$executableDirectory) | Out-Null
      }
    } catch {
      # Ignore malformed executable paths.
    }
  }

  if ($null -ne $runningProcesses) {
    foreach ($directoryCandidate in $directoryCandidates) {
      foreach ($processInfo in $runningProcesses) {
        if (Test-ProcessInsideDirectory -processPath ([string]$processInfo.executablePath) -directoryPath ([string]$directoryCandidate)) {
          return (New-RuntimeState -status 'running' -active $true -processId ([int]$processInfo.processId))
        }
      }
    }
  }

  $nameHints = New-Object 'System.Collections.Generic.List[string]'
  Add-ExecutableRuntimeHint -items $nameHints -value $executablePath
  Add-ExecutableRuntimeHint -items $nameHints -value $iconPath
  Add-UniqueRuntimeHint -items $nameHints -value $displayName
  foreach ($displayNamePart in @(([string]$displayName) -split '[\s._-]+')) {
    Add-UniqueRuntimeHint -items $nameHints -value $displayNamePart
  }

  foreach ($alias in Get-KnownRuntimeAliases -displayName $displayName) {
    Add-UniqueRuntimeHint -items $nameHints -value $alias
  }
  foreach ($commandHint in Get-CommandRuntimeHints -commandLine $uninstallCommand) {
    Add-UniqueRuntimeHint -items $nameHints -value $commandHint
  }
  foreach ($shortcutHint in Get-ShortcutRuntimeHints -displayName $displayName -installLocation $installLocation -shortcuts $shortcuts) {
    Add-UniqueRuntimeHint -items $nameHints -value $shortcutHint
  }

  foreach ($nameHint in $nameHints) {
    if (-not [string]::IsNullOrWhiteSpace($nameHint) -and $processByName.ContainsKey($nameHint)) {
      return (New-RuntimeState -status 'running' -active $true -processId ([int]$processByName[$nameHint]))
    }
  }

  if ([string]::IsNullOrWhiteSpace($executablePath) -and $nameHints.Count -le 0) {
    return (New-RuntimeState -status 'unknown' -active $false -processId 0)
  }

  return (New-RuntimeState -status 'stopped' -active $false -processId 0)
}

function Get-DirectorySizeBytes([string]$directoryPath, [hashtable]$sizeCache) {
  if ([string]::IsNullOrWhiteSpace($directoryPath)) { return [int64]0 }

  try {
    $resolved = (Resolve-Path -LiteralPath $directoryPath -ErrorAction Stop).Path
  } catch {
    return [int64]0
  }

  if ([string]::IsNullOrWhiteSpace($resolved) -or -not (Test-Path -LiteralPath $resolved -PathType Container)) {
    return [int64]0
  }

  $cacheKey = $resolved.ToLowerInvariant()
  if ($sizeCache.ContainsKey($cacheKey)) {
    return [int64]$sizeCache[$cacheKey]
  }

  $total = [int64]0
  try {
    $files = Get-ChildItem -LiteralPath $resolved -File -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($file in $files) {
      try {
        $total += [int64]$file.Length
      } catch {
        # Ignore files that disappear during enumeration.
      }
    }
  } catch {
    $total = [int64]0
  }

  $sizeCache[$cacheKey] = [int64]$total
  return [int64]$total
}

function Resolve-AppSizeBytes([int64]$estimatedSizeKb, [string]$installLocation, [string]$executablePath, [hashtable]$sizeCache) {
  if ($estimatedSizeKb -gt 0) {
    return [int64]$estimatedSizeKb * 1024
  }

  $sizeRoot = ''
  if (-not [string]::IsNullOrWhiteSpace($installLocation) -and (Test-Path -LiteralPath $installLocation -PathType Container)) {
    $sizeRoot = $installLocation
  } elseif (-not [string]::IsNullOrWhiteSpace($executablePath) -and (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    $sizeRoot = [IO.Path]::GetDirectoryName($executablePath)
  }

  if ([string]::IsNullOrWhiteSpace($sizeRoot)) {
    return [int64]0
  }

  return Get-DirectorySizeBytes -directoryPath $sizeRoot -sizeCache $sizeCache
}

$shortcutEntries = if ($includeDetails) { Get-StartMenuShortcutEntries } else { @() }
$processByPath = @{}
$processByName = @{}
$runningProcesses = New-Object 'System.Collections.Generic.List[object]'
$directorySizeCache = @{}
try {
  $processes = if ($includeDetails) { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue } else { @() }
  foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    $processPath = [string]$process.ExecutablePath
    $processName = [string]$process.Name
    if ([string]::IsNullOrWhiteSpace($processName) -and -not [string]::IsNullOrWhiteSpace($processPath)) {
      $processName = [IO.Path]::GetFileNameWithoutExtension($processPath)
    }

    if (-not [string]::IsNullOrWhiteSpace($processPath)) {
      $pathKey = Normalize-PathForRuntime -value $processPath
      if (-not [string]::IsNullOrWhiteSpace($pathKey) -and -not $processByPath.ContainsKey($pathKey)) {
        $processByPath[$pathKey] = $processId
      }
    }

    $nameKey = Normalize-Token ([IO.Path]::GetFileNameWithoutExtension($processName))
    if (-not [string]::IsNullOrWhiteSpace($nameKey) -and -not $processByName.ContainsKey($nameKey)) {
      $processByName[$nameKey] = $processId
    }

    $runningProcesses.Add([PSCustomObject]@{
      processId = [int]$processId
      processName = [string]$processName
      executablePath = [string]$processPath
    }) | Out-Null
  }
} catch {
  $processByPath = @{}
  $processByName = @{}
  $runningProcesses = New-Object 'System.Collections.Generic.List[object]'
}

foreach ($registryPath in $registryPaths) {
  $entries = Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue
  foreach ($entry in $entries) {
    $name = [string]$entry.DisplayName
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $quietUninstall = [string]$entry.QuietUninstallString
    $fallbackUninstall = [string]$entry.UninstallString
    $rawUninstall = if (-not [string]::IsNullOrWhiteSpace($quietUninstall)) { $quietUninstall } else { $fallbackUninstall }
    $canUninstall = -not [string]::IsNullOrWhiteSpace($rawUninstall)
    $installLocation = [string]$entry.InstallLocation
    $registryKey = [string]$entry.PSChildName
    if ([string]::IsNullOrWhiteSpace($registryKey)) {
      $registryKey = [Guid]::NewGuid().ToString()
    }
    $iconPath = [string]$entry.DisplayIcon
    if ($includeDetails -and [string]::IsNullOrWhiteSpace($iconPath)) {
      if (-not [string]::IsNullOrWhiteSpace($installLocation) -and (Test-Path -LiteralPath $installLocation)) {
        $exeCandidates = Get-ChildItem -LiteralPath $installLocation -Filter '*.exe' -File -ErrorAction SilentlyContinue
        if ($exeCandidates) {
          $normalizedName = ($name -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()
          $preferredExe = $exeCandidates | Where-Object {
            $base = (($_.BaseName -replace '[^a-zA-Z0-9]', '').ToLowerInvariant())
            if ([string]::IsNullOrWhiteSpace($normalizedName)) { return $false }
            return $base -like "*$normalizedName*"
          } | Select-Object -First 1

          if ($preferredExe) {
            $iconPath = [string]$preferredExe.FullName
          } else {
            $firstExe = $exeCandidates | Select-Object -First 1
            if ($firstExe) {
              $iconPath = [string]$firstExe.FullName
            }
          }
        }
      }
    }
    if ($includeDetails -and [string]::IsNullOrWhiteSpace($iconPath)) {
      $iconFromCommand = Resolve-ExecutableFromCommand -commandLine $rawUninstall
      if (-not [string]::IsNullOrWhiteSpace($iconFromCommand)) {
        $iconPath = $iconFromCommand
      }
    }
    if ($includeDetails -and [string]::IsNullOrWhiteSpace($iconPath)) {
      $iconFromShortcut = Resolve-IconFromShortcuts -displayName $name -shortcuts $shortcutEntries -installLocation $installLocation
      if (-not [string]::IsNullOrWhiteSpace($iconFromShortcut)) {
        $iconPath = $iconFromShortcut
      }
    }
    $executablePath = if ($includeDetails) { Resolve-AppExecutablePath -displayName $name -installLocation $installLocation -iconPath $iconPath -uninstallCommand $rawUninstall -shortcuts $shortcutEntries } else { '' }
    $runtimeState = if ($includeDetails) {
      Resolve-RuntimeState -displayName $name -installLocation $installLocation -executablePath $executablePath -uninstallCommand $rawUninstall -iconPath $iconPath -shortcuts $shortcutEntries -processByPath $processByPath -processByName $processByName -runningProcesses $runningProcesses
    } else {
      New-RuntimeState -status 'unknown' -active $false -processId 0
    }
    $estimatedSize = 0
    if ($null -ne $entry.EstimatedSize) {
      try { $estimatedSize = [int64]$entry.EstimatedSize } catch { $estimatedSize = 0 }
    }
    $sizeBytes = if ($includeDetails) {
      Resolve-AppSizeBytes -estimatedSizeKb $estimatedSize -installLocation $installLocation -executablePath $executablePath -sizeCache $directorySizeCache
    } elseif ($estimatedSize -gt 0) {
      [int64]$estimatedSize * 1024
    } else {
      [int64]0
    }
    $installDate = Format-RegistryInstallDate -value ([string]$entry.InstallDate)

    $apps += [PSCustomObject]@{
      id = "win32::$registryKey::$($name.ToLowerInvariant())"
      name = $name.Trim()
      publisher = [string]$entry.Publisher
      version = [string]$entry.DisplayVersion
      source = 'win32'
      installScope = if ($registryPath -like 'HKLM:*') { 'machine' } else { 'user' }
      installType = if ([int]$entry.WindowsInstaller -eq 1) { 'MSI' } else { 'Installer' }
      canUninstall = [bool]$canUninstall
      uninstallReason = if ($canUninstall) { '' } else { 'missing_uninstall_command' }
      uninstallCommand = [string]$rawUninstall
      quietUninstallCommand = [string]$quietUninstall
      packageFullName = ''
      packageFamilyName = ''
      parentDisplayName = [string]$entry.ParentDisplayName
      parentKeyName = [string]$entry.ParentKeyName
      releaseType = [string]$entry.ReleaseType
      installLocation = [string]$installLocation
      installDate = [string]$installDate
      lastUsed = ''
      estimatedSize = [int64]$estimatedSize
      sizeBytes = [int64]$sizeBytes
      runtimeStatus = [string]$runtimeState.runtimeStatus
      processActive = [bool]$runtimeState.processActive
      processId = [int]$runtimeState.processId
      executablePath = [string]$executablePath
      iconPath = [string]$iconPath
      isSystemComponent = [int]$entry.SystemComponent -eq 1
    }
  }
}

function Resolve-AppxLogoPath([string]$InstallLocation, [string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($InstallLocation)) { return '' }
  if ([string]::IsNullOrWhiteSpace($RelativePath)) { return '' }

  $relative = $RelativePath.Trim().TrimStart('\\')
  $relative = $relative -replace '/', '\\'
  $directPath = Join-Path $InstallLocation $relative
  if (Test-Path -LiteralPath $directPath) {
    return (Resolve-Path -LiteralPath $directPath).Path
  }

  $parent = [string][IO.Path]::GetDirectoryName($directPath)
  $fileName = [IO.Path]::GetFileNameWithoutExtension($directPath)
  $extension = [IO.Path]::GetExtension($directPath)
  if ([string]::IsNullOrWhiteSpace($parent) -or [string]::IsNullOrWhiteSpace($fileName) -or [string]::IsNullOrWhiteSpace($extension)) {
    return ''
  }

  $variants = @(
    "$fileName.scale-200$extension",
    "$fileName.scale-150$extension",
    "$fileName.scale-125$extension",
    "$fileName.scale-100$extension",
    "$fileName.targetsize-256$extension",
    "$fileName.targetsize-128$extension",
    "$fileName.targetsize-64$extension",
    "$fileName.targetsize-48$extension",
    "$fileName.targetsize-32$extension",
    "$fileName$extension"
  )

  foreach ($variant in $variants) {
    $variantPath = Join-Path $parent $variant
    if (Test-Path -LiteralPath $variantPath) {
      return (Resolve-Path -LiteralPath $variantPath).Path
    }
  }

  return ''
}

function Get-AppxLogoPath([object]$Package) {
  $installLocation = [string]$Package.InstallLocation
  if ([string]::IsNullOrWhiteSpace($installLocation)) { return '' }
  if (-not (Test-Path -LiteralPath $installLocation)) { return '' }

  $manifestPath = Join-Path $installLocation 'AppxManifest.xml'
  if (-not (Test-Path -LiteralPath $manifestPath)) { return '' }

  try {
    [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
  } catch {
    return ''
  }

  $applicationNode = $manifest.SelectSingleNode("//*[local-name()='Applications']/*[local-name()='Application']")
  if ($null -eq $applicationNode) { return '' }

  $visualElementsNode = $applicationNode.SelectSingleNode("./*[local-name()='VisualElements']")
  if ($null -eq $visualElementsNode) { return '' }

  $logoCandidates = @(
    [string]$visualElementsNode.GetAttribute('Square44x44Logo'),
    [string]$visualElementsNode.GetAttribute('Square150x150Logo'),
    [string]$visualElementsNode.GetAttribute('Logo'),
    [string]$visualElementsNode.GetAttribute('SmallLogo')
  )

  foreach ($relativeLogo in $logoCandidates) {
    $resolvedLogo = Resolve-AppxLogoPath -InstallLocation $installLocation -RelativePath $relativeLogo
    if (-not [string]::IsNullOrWhiteSpace($resolvedLogo)) {
      return $resolvedLogo
    }
  }

  return ''
}

$appxPackages = Get-AppxPackage -ErrorAction SilentlyContinue
foreach ($pkg in $appxPackages) {
  $pkgName = [string]$pkg.Name
  if ([string]::IsNullOrWhiteSpace($pkgName)) { continue }

  $isFramework = [bool]$pkg.IsFramework
  $isResourcePackage = [bool]$pkg.IsResourcePackage
  $nonRemovable = [bool]$pkg.NonRemovable
  $canUninstall = -not ($isFramework -or $isResourcePackage -or $nonRemovable)
  $logoPath = Get-AppxLogoPath -Package $pkg
  $packageSizeBytes = if ($includeDetails) { Get-DirectorySizeBytes -directoryPath ([string]$pkg.InstallLocation) -sizeCache $directorySizeCache } else { [int64]0 }
  $runtimeState = if ($includeDetails) {
    Resolve-RuntimeState -displayName $pkgName -installLocation ([string]$pkg.InstallLocation) -executablePath '' -uninstallCommand '' -iconPath $logoPath -shortcuts $shortcutEntries -processByPath $processByPath -processByName $processByName -runningProcesses $runningProcesses
  } else {
    New-RuntimeState -status 'unknown' -active $false -processId 0
  }

  $apps += [PSCustomObject]@{
    id = "appx::$([string]$pkg.PackageFullName)"
    name = $pkgName
    publisher = if ($pkg.PublisherDisplayName) { [string]$pkg.PublisherDisplayName } else { [string]$pkg.Publisher }
    version = [string]$pkg.Version
    source = 'appx'
    installType = if ($nonRemovable) { 'System' } elseif ($isFramework) { 'Framework' } else { 'Store' }
    canUninstall = [bool]$canUninstall
    uninstallReason = if ($canUninstall) { '' } elseif ($nonRemovable) { 'appx_non_removable' } elseif ($isFramework) { 'appx_framework' } else { 'appx_protected' }
    uninstallCommand = ''
    quietUninstallCommand = ''
    packageFullName = [string]$pkg.PackageFullName
    packageFamilyName = [string]$pkg.PackageFamilyName
    parentDisplayName = ''
    parentKeyName = ''
    releaseType = ''
    installLocation = [string]$pkg.InstallLocation
    installDate = if ($pkg.InstallDate) { [string]$pkg.InstallDate } else { '' }
    lastUsed = ''
    estimatedSize = [int64]0
    sizeBytes = [int64]$packageSizeBytes
    runtimeStatus = [string]$runtimeState.runtimeStatus
    processActive = [bool]$runtimeState.processActive
    processId = [int]$runtimeState.processId
    executablePath = ''
    iconPath = [string]$logoPath
    isSystemComponent = [bool]$nonRemovable
  }
}

$seen = @{}
$result = foreach ($app in $apps) {
  $sourceKey = ([string]$app.source).ToLowerInvariant()
  $nameKey = ([string]$app.name).ToLowerInvariant()
  $publisherKey = ([string]$app.publisher).ToLowerInvariant()
  $versionKey = ([string]$app.version).ToLowerInvariant()
  $dedupeKey = "{0}|{1}|{2}|{3}" -f $sourceKey, $nameKey, $publisherKey, $versionKey
  if ($seen.ContainsKey($dedupeKey)) { continue }
  $seen[$dedupeKey] = $true
  $app
}

$result | ConvertTo-Json -Compress -Depth 4
`;

    const payload = await runPowerShellJson(script, { timeoutMs: DEFAULT_LIST_TIMEOUT_MS });
    const normalized = normalizeAppsPayload(payload)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    let withIcons = normalized;
    try {
      withIcons = await withIconData(normalized);
    } catch (error) {
      logger?.warn?.('Unable to enrich app list with icons.', {
        code: error?.code || 'APPS_ICON_HYDRATE_FAILED',
        message: error?.message || 'Unknown icon enrichment error'
      });
    }

    logger?.info?.('Installed applications loaded.', {
      detailLevel,
      count: withIcons.length,
      iconsResolved: withIcons.filter((entry) => Boolean(entry.iconDataUrl)).length
    });

    return withIcons;
  }

  async function listInstalledAppsInternal(options = {}) {
    const detailLevel = options?.detailLevel === 'summary' ? 'summary' : 'full';
    const activeScan = installedAppsScanPromises.get(detailLevel);
    if (activeScan) {
      return activeScan;
    }

    const scanPromise = scanInstalledApps(detailLevel);
    installedAppsScanPromises.set(detailLevel, scanPromise);
    try {
      return await scanPromise;
    } finally {
      if (installedAppsScanPromises.get(detailLevel) === scanPromise) {
        installedAppsScanPromises.delete(detailLevel);
      }
    }
  }

  async function listInstalledApps(options = {}) {
    const internalApps = await listInstalledAppsInternal(options);
    const detailLevel = options?.detailLevel === 'summary' ? 'summary' : 'full';
    const enrichedApps = await getAppOptimizationService().enrichApps(internalApps, { detailLevel });
    return enrichedApps.map(toPublicAppShape);
  }

  async function listStartupAppsInternal() {
    const script = `
$ErrorActionPreference = 'Stop'
$entries = New-Object System.Collections.Generic.List[object]
$script:wshShell = $null

function New-StableId([string]$prefix, [string]$raw) {
  $value = [string]$raw
  $bytes = [Text.Encoding]::UTF8.GetBytes($value.ToLowerInvariant())
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $hash = $sha1.ComputeHash($bytes)
  } finally {
    $sha1.Dispose()
  }
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  return "$prefix::$hex"
}

function Get-StartupApprovedState([string]$approvedPath, [string]$entryName) {
  if ([string]::IsNullOrWhiteSpace($approvedPath) -or [string]::IsNullOrWhiteSpace($entryName)) {
    return $null
  }

  try {
    $raw = Get-ItemPropertyValue -LiteralPath $approvedPath -Name $entryName -ErrorAction Stop
    if ($null -eq $raw) { return $null }
    if (-not ($raw -is [byte[]])) { return $null }
    if ($raw.Length -lt 1) { return $null }

    $state = [int]$raw[0]
    if ($state -eq 2) { return $true }
    if ($state -eq 3) { return $false }
    return $null
  } catch {
    return $null
  }
}

function Resolve-StartupState([string]$approvedPath, [string]$entryName, [bool]$defaultEnabled = $true) {
  $approvedState = Get-StartupApprovedState -approvedPath $approvedPath -entryName $entryName
  if ($null -ne $approvedState) {
    return [bool]$approvedState
  }
  return [bool]$defaultEnabled
}

function Resolve-ExecutableFromCommand([string]$commandLine) {
  if ([string]::IsNullOrWhiteSpace($commandLine)) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables($commandLine).Trim()
  if ([string]::IsNullOrWhiteSpace($expanded)) { return '' }

  $candidate = ''
  $quoted = [Regex]::Match($expanded, '^\s*"([^"]+)"')
  if ($quoted.Success) {
    $candidate = [string]$quoted.Groups[1].Value
  } else {
    $plain = [Regex]::Match($expanded, '^\s*([^\s]+)')
    if ($plain.Success) {
      $candidate = [string]$plain.Groups[1].Value
    }
  }

  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
  $candidate = $candidate.Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }

  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  try {
    $command = Get-Command -Name $candidate -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $command.Source).Path
    }
  } catch {
    # best effort only
  }

  return ''
}

function Parse-IconLocation([string]$iconLocation) {
  if ([string]::IsNullOrWhiteSpace($iconLocation)) { return '' }
  $candidate = [string]$iconLocation
  $quoted = [Regex]::Match($candidate, '^\s*"([^"]+)"')
  if ($quoted.Success) {
    $candidate = [string]$quoted.Groups[1].Value
  } else {
    $candidate = ($candidate -split ',')[0]
  }

  $candidate = [Environment]::ExpandEnvironmentVariables($candidate.Trim())
  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return '' }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Get-ShortcutInfo([string]$shortcutPath) {
  $result = [PSCustomObject]@{
    targetPath = ''
    arguments = ''
    iconPath = ''
  }

  if ([string]::IsNullOrWhiteSpace($shortcutPath)) { return $result }
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { return $result }

  if ($null -eq $script:wshShell) {
    try {
      $script:wshShell = New-Object -ComObject WScript.Shell
    } catch {
      return $result
    }
  }

  try {
    $shortcut = $script:wshShell.CreateShortcut($shortcutPath)
    $targetPath = [string]$shortcut.TargetPath
    $arguments = [string]$shortcut.Arguments
    $iconPath = Parse-IconLocation -iconLocation ([string]$shortcut.IconLocation)
    if ([string]::IsNullOrWhiteSpace($iconPath)) {
      $iconPath = Resolve-ExecutableFromCommand -commandLine $targetPath
    }

    return [PSCustomObject]@{
      targetPath = [string]$targetPath
      arguments = [string]$arguments
      iconPath = [string]$iconPath
    }
  } catch {
    return $result
  }
}

function Resolve-AppxLogoPath([string]$InstallLocation, [string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($InstallLocation)) { return '' }
  if ([string]::IsNullOrWhiteSpace($RelativePath)) { return '' }

  $relative = $RelativePath.Trim().TrimStart('\\')
  $relative = $relative -replace '/', '\\'
  $directPath = Join-Path $InstallLocation $relative
  if (Test-Path -LiteralPath $directPath) {
    return (Resolve-Path -LiteralPath $directPath).Path
  }

  $parent = [string][IO.Path]::GetDirectoryName($directPath)
  $fileName = [IO.Path]::GetFileNameWithoutExtension($directPath)
  $extension = [IO.Path]::GetExtension($directPath)
  if ([string]::IsNullOrWhiteSpace($parent) -or [string]::IsNullOrWhiteSpace($fileName) -or [string]::IsNullOrWhiteSpace($extension)) {
    return ''
  }

  $variants = @(
    "$fileName.scale-200$extension",
    "$fileName.scale-150$extension",
    "$fileName.scale-125$extension",
    "$fileName.scale-100$extension",
    "$fileName.targetsize-256$extension",
    "$fileName.targetsize-128$extension",
    "$fileName.targetsize-64$extension",
    "$fileName.targetsize-48$extension",
    "$fileName.targetsize-32$extension",
    "$fileName$extension"
  )

  foreach ($variant in $variants) {
    $variantPath = Join-Path $parent $variant
    if (Test-Path -LiteralPath $variantPath) {
      return (Resolve-Path -LiteralPath $variantPath).Path
    }
  }

  return ''
}

function Get-AppxLogoPath([object]$Package) {
  $installLocation = [string]$Package.InstallLocation
  if ([string]::IsNullOrWhiteSpace($installLocation)) { return '' }
  if (-not (Test-Path -LiteralPath $installLocation)) { return '' }

  $manifestPath = Join-Path $installLocation 'AppxManifest.xml'
  if (-not (Test-Path -LiteralPath $manifestPath)) { return '' }

  try {
    [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
  } catch {
    return ''
  }

  $applicationNode = $manifest.SelectSingleNode("//*[local-name()='Applications']/*[local-name()='Application']")
  if ($null -eq $applicationNode) { return '' }

  $visualElementsNode = $applicationNode.SelectSingleNode("./*[local-name()='VisualElements']")
  if ($null -eq $visualElementsNode) { return '' }

  $logoCandidates = @(
    [string]$visualElementsNode.GetAttribute('Square44x44Logo'),
    [string]$visualElementsNode.GetAttribute('Square150x150Logo'),
    [string]$visualElementsNode.GetAttribute('Logo'),
    [string]$visualElementsNode.GetAttribute('SmallLogo')
  )

  foreach ($relativeLogo in $logoCandidates) {
    $resolvedLogo = Resolve-AppxLogoPath -InstallLocation $installLocation -RelativePath $relativeLogo
    if (-not [string]::IsNullOrWhiteSpace($resolvedLogo)) {
      return $resolvedLogo
    }
  }

  return ''
}

function Normalize-StartupMatchToken([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables([string]$value)
  $normalized = $expanded.Trim()
  if ([string]::IsNullOrWhiteSpace($normalized)) { return '' }
  $normalized = $normalized -replace '"', ''
  $normalized = $normalized -replace '\s+', ' '
  return $normalized.ToLowerInvariant()
}

function Build-StartupNameCommandKey([string]$name, [string]$command) {
  $nameKey = Normalize-StartupMatchToken -value $name
  $commandKey = Normalize-StartupMatchToken -value $command
  if ([string]::IsNullOrWhiteSpace($nameKey) -and [string]::IsNullOrWhiteSpace($commandKey)) {
    return ''
  }
  return "$nameKey|$commandKey"
}

$standardNameCommandLookup = @{}
$standardCommandLookup = @{}
try {
  $standardCommands = Get-CimInstance Win32_StartupCommand -ErrorAction Stop | Select-Object Name, Command, Location, User

  foreach ($standard in $standardCommands) {
    $standardName = [string]$standard.Name
    $standardCommand = [string]$standard.Command
    $nameCommandKey = Build-StartupNameCommandKey -name $standardName -command $standardCommand
    if (-not [string]::IsNullOrWhiteSpace($nameCommandKey)) {
      $standardNameCommandLookup[$nameCommandKey] = $true
    }

    $commandKey = Normalize-StartupMatchToken -value $standardCommand
    if (-not [string]::IsNullOrWhiteSpace($commandKey)) {
      $standardCommandLookup[$commandKey] = $true
    }
  }
} catch {
  $standardNameCommandLookup = @{}
  $standardCommandLookup = @{}
}

$registrySources = @(
  [PSCustomObject]@{
    runPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
    approvedPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    scope = 'user'
    startupKind = 'Run'
  },
  [PSCustomObject]@{
    runPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
    approvedPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    scope = 'machine'
    startupKind = 'Run'
  },
  [PSCustomObject]@{
    runPath = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
    approvedPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32'
    scope = 'machine'
    startupKind = 'Run'
  },
  [PSCustomObject]@{
    runPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
    approvedPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    scope = 'user'
    startupKind = 'RunOnce'
  },
  [PSCustomObject]@{
    runPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
    approvedPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    scope = 'machine'
    startupKind = 'RunOnce'
  }
)

foreach ($source in $registrySources) {
  if (-not (Test-Path -LiteralPath $source.runPath)) { continue }

  try {
    $registryKey = Get-Item -LiteralPath $source.runPath -ErrorAction Stop
    $valueNames = @($registryKey.GetValueNames())
    foreach ($valueName in $valueNames) {
      if ([string]::IsNullOrWhiteSpace($valueName)) { continue }
      $rawCommand = [string](Get-ItemPropertyValue -LiteralPath $source.runPath -Name $valueName -ErrorAction SilentlyContinue)
      if ([string]::IsNullOrWhiteSpace($rawCommand)) { continue }

      $enabled = Resolve-StartupState -approvedPath $source.approvedPath -entryName $valueName -defaultEnabled $true
      $iconPath = Resolve-ExecutableFromCommand -commandLine $rawCommand
      $entryId = New-StableId -prefix 'registry' -raw "$($source.scope)|$($source.runPath)|$valueName"

      $entries.Add([PSCustomObject]@{
        id = $entryId
        name = [string]$valueName
        startupType = 'registry'
        startupScope = [string]$source.scope
        startupKind = [string]$source.startupKind
        sourcePath = [string]$source.runPath
        command = [string]$rawCommand
        iconPath = [string]$iconPath
        enabled = [bool]$enabled
        canToggle = $true
        canChangeType = $false
        availableStartupTypes = @('registry')
        typeChangeReason = 'not_implemented'
        startupApprovedPath = [string]$source.approvedPath
        entryName = [string]$valueName
        registryPath = [string]$source.runPath
        taskPath = ''
        taskName = ''
        isStandard = $false
      }) | Out-Null
    }
  } catch {
    # best effort only
  }
}

$startupFolders = @(
  [PSCustomObject]@{
    folderPath = (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup')
    approvedPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'
    scope = 'user'
  },
  [PSCustomObject]@{
    folderPath = (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs\\Startup')
    approvedPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'
    scope = 'machine'
  }
)

$startupFolderExt = @('.lnk', '.url', '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.com')

foreach ($folder in $startupFolders) {
  if ([string]::IsNullOrWhiteSpace($folder.folderPath) -or -not (Test-Path -LiteralPath $folder.folderPath)) { continue }

  $files = Get-ChildItem -LiteralPath $folder.folderPath -File -Force -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $extension = [string]$file.Extension
    if (-not ($startupFolderExt -contains $extension.ToLowerInvariant())) { continue }

    $name = [string]$file.BaseName
    if ([string]::IsNullOrWhiteSpace($name)) {
      $name = [string]$file.Name
    }

    $command = [string]$file.FullName
    $iconPath = ''
    if ($extension -ieq '.lnk') {
      $shortcutInfo = Get-ShortcutInfo -shortcutPath $file.FullName
      $targetPath = [string]$shortcutInfo.targetPath
      $arguments = [string]$shortcutInfo.arguments
      if (-not [string]::IsNullOrWhiteSpace($targetPath)) {
        $command = if ([string]::IsNullOrWhiteSpace($arguments)) { $targetPath } else { "$targetPath $arguments" }
      }
      $iconPath = [string]$shortcutInfo.iconPath
    }

    if ([string]::IsNullOrWhiteSpace($iconPath)) {
      $iconPath = Resolve-ExecutableFromCommand -commandLine $command
    }

    $enabled = Resolve-StartupState -approvedPath $folder.approvedPath -entryName $file.Name -defaultEnabled $true
    $entryId = New-StableId -prefix 'startup-folder' -raw "$($folder.scope)|$($file.FullName)"

    $entries.Add([PSCustomObject]@{
      id = $entryId
      name = [string]$name
      startupType = 'startup-folder'
      startupScope = [string]$folder.scope
      startupKind = 'Startup Folder'
      sourcePath = [string]$file.FullName
      command = [string]$command
      iconPath = [string]$iconPath
      enabled = [bool]$enabled
      canToggle = $true
      canChangeType = $false
      availableStartupTypes = @('startup-folder')
      typeChangeReason = 'not_implemented'
      startupApprovedPath = [string]$folder.approvedPath
      entryName = [string]$file.Name
      registryPath = ''
      taskPath = ''
      taskName = ''
      isStandard = $false
    }) | Out-Null
  }
}

$scheduledTasks = @()
try {
  $scheduledTasks = Get-ScheduledTask -ErrorAction SilentlyContinue
} catch {
  $scheduledTasks = @()
}

foreach ($task in $scheduledTasks) {
  $triggers = @($task.Triggers)
  if (-not $triggers.Count) { continue }

  $startupTriggers = @(
    $triggers | Where-Object {
      $className = [string]$_.CimClass.CimClassName
      $className -eq 'MSFT_TaskBootTrigger' -or $className -eq 'MSFT_TaskLogonTrigger'
    }
  )

  if (-not $startupTriggers.Count) { continue }

  $hasBootTrigger = $startupTriggers | Where-Object { [string]$_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' } | Select-Object -First 1
  $hasLogonTrigger = $startupTriggers | Where-Object { [string]$_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' } | Select-Object -First 1

  $startupKind = if ($hasBootTrigger -and $hasLogonTrigger) {
    'Boot + Logon Trigger'
  } elseif ($hasBootTrigger) {
    'Boot Trigger'
  } else {
    'Logon Trigger'
  }

  $actions = @($task.Actions | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.Execute) })
  $primaryAction = $actions | Select-Object -First 1
  $execute = [string]$primaryAction.Execute
  $arguments = [string]$primaryAction.Arguments
  $command = if ([string]::IsNullOrWhiteSpace($execute)) { '' } elseif ([string]::IsNullOrWhiteSpace($arguments)) { $execute } else { "$execute $arguments" }
  $iconPath = Resolve-ExecutableFromCommand -commandLine $execute

  $taskPath = [string]$task.TaskPath
  $taskName = [string]$task.TaskName
  $taskRef = "$taskPath$taskName"
  $scope = 'machine'
  $principalUser = [string]$task.Principal.UserId
  if (-not [string]::IsNullOrWhiteSpace($principalUser) -and $principalUser.ToLowerInvariant().Contains($env:USERNAME.ToLowerInvariant())) {
    $scope = 'user'
  }

  $enabled = [string]$task.State -ne 'Disabled'
  $entryId = New-StableId -prefix 'scheduled-task' -raw $taskRef
  $displayName = if ([string]::IsNullOrWhiteSpace($taskName)) { $taskRef } else { $taskName }

  $entries.Add([PSCustomObject]@{
    id = $entryId
    name = [string]$displayName
    startupType = 'scheduled-task'
    startupScope = [string]$scope
    startupKind = [string]$startupKind
    sourcePath = [string]$taskRef
    command = [string]$command
    iconPath = [string]$iconPath
    enabled = [bool]$enabled
    canToggle = $true
    canChangeType = $false
    availableStartupTypes = @('scheduled-task')
    typeChangeReason = 'not_implemented'
    startupApprovedPath = ''
    entryName = ''
    registryPath = ''
    taskPath = [string]$taskPath
    taskName = [string]$taskName
    isStandard = $false
  }) | Out-Null
}

$appxPackages = @()
try {
  $appxPackages = Get-AppxPackage -ErrorAction SilentlyContinue
} catch {
  $appxPackages = @()
}

$appxPackageLookup = @{}
foreach ($pkg in $appxPackages) {
  $familyName = [string]$pkg.PackageFamilyName
  if ([string]::IsNullOrWhiteSpace($familyName)) { continue }
  $appxPackageLookup[$familyName.ToLowerInvariant()] = $pkg
}

$appxApprovedSources = @(
  [PSCustomObject]@{
    approvedPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupTasks'
    scope = 'user'
  },
  [PSCustomObject]@{
    approvedPath = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupTasks'
    scope = 'machine'
  }
)

foreach ($source in $appxApprovedSources) {
  if (-not (Test-Path -LiteralPath $source.approvedPath)) { continue }
  try {
    $props = Get-ItemProperty -LiteralPath $source.approvedPath -ErrorAction Stop
    $entriesRaw = @($props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' })
    foreach ($prop in $entriesRaw) {
      $entryName = [string]$prop.Name
      if ([string]::IsNullOrWhiteSpace($entryName)) { continue }

      $enabled = Get-StartupApprovedState -approvedPath $source.approvedPath -entryName $entryName
      if ($null -eq $enabled) { continue }

      $familyName = ''
      $match = [Regex]::Match($entryName, '^([^!]+)!')
      if ($match.Success) {
        $familyName = [string]$match.Groups[1].Value
      }

      $displayName = $entryName
      $iconPath = ''
      if (-not [string]::IsNullOrWhiteSpace($familyName)) {
        $normalizedFamilyName = $familyName.ToLowerInvariant()
        if ($appxPackageLookup.ContainsKey($normalizedFamilyName)) {
          $pkg = $appxPackageLookup[$normalizedFamilyName]
          $displayName = [string]$pkg.Name
          $iconPath = Get-AppxLogoPath -Package $pkg
        }
      }

      $entryId = New-StableId -prefix 'appx' -raw "$($source.scope)|$entryName"
      $entries.Add([PSCustomObject]@{
        id = $entryId
        name = [string]$displayName
        startupType = 'appx'
        startupScope = [string]$source.scope
        startupKind = 'Startup Task'
        sourcePath = [string]$entryName
        command = [string]$entryName
        iconPath = [string]$iconPath
        enabled = [bool]$enabled
        canToggle = $true
        canChangeType = $false
        availableStartupTypes = @('appx')
        typeChangeReason = 'not_implemented'
        startupApprovedPath = [string]$source.approvedPath
        entryName = [string]$entryName
        registryPath = ''
        taskPath = ''
        taskName = ''
        isStandard = $false
      }) | Out-Null
    }
  } catch {
    # best effort only
  }
}

$seen = @{}
$result = foreach ($entry in $entries) {
  $entryId = [string]$entry.id
  if ([string]::IsNullOrWhiteSpace($entryId)) { continue }
  if ($seen.ContainsKey($entryId)) { continue }
  $seen[$entryId] = $true

  $entryNameKey = [string]$entry.name
  $entryCommandKey = [string]$entry.command
  $nameCommandKey = Build-StartupNameCommandKey -name $entryNameKey -command $entryCommandKey
  $commandKey = Normalize-StartupMatchToken -value $entryCommandKey
  $isStandard = $false
  if (
    (-not [string]::IsNullOrWhiteSpace($nameCommandKey) -and $standardNameCommandLookup.ContainsKey($nameCommandKey)) -or
    (-not [string]::IsNullOrWhiteSpace($commandKey) -and $standardCommandLookup.ContainsKey($commandKey))
  ) {
    $isStandard = $true
  }

  $entry.isStandard = [bool]$isStandard
  $entry
}

$result | Sort-Object -Property @{ Expression = { [string]$_.name }; Ascending = $true }, @{ Expression = { [string]$_.startupType }; Ascending = $true } | ConvertTo-Json -Compress -Depth 6
`;

    const payload = await runPowerShellJson(script, { timeoutMs: DEFAULT_STARTUP_TIMEOUT_MS });
    const normalized = normalizeStartupPayload(payload)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    let withIcons = normalized;
    try {
      withIcons = await withIconData(normalized);
    } catch (error) {
      logger?.warn?.('Unable to enrich startup list with icons.', {
        code: error?.code || 'STARTUP_ICON_HYDRATE_FAILED',
        message: error?.message || 'Unknown startup icon enrichment error'
      });
    }

    logger?.info?.('Startup entries loaded.', {
      count: withIcons.length,
      iconsResolved: withIcons.filter((entry) => Boolean(entry.iconDataUrl)).length
    });

    return withIcons;
  }

  async function listStartupApps() {
    const internalEntries = await listStartupAppsInternal();
    return internalEntries.map(toPublicStartupEntryShape);
  }

  async function setStartupApprovedEntryState({ approvedPath, entryName, enabled }) {
    const payload = encodePayload({
      approvedPath,
      entryName,
      enabled
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$approvedPath = [string]$payload.approvedPath
$entryName = [string]$payload.entryName
$enabled = [bool]$payload.enabled

if ([string]::IsNullOrWhiteSpace($approvedPath) -or [string]::IsNullOrWhiteSpace($entryName)) {
  throw 'missing_startup_registry_target'
}

if (-not (Test-Path -LiteralPath $approvedPath)) {
  New-Item -Path $approvedPath -Force | Out-Null
}

$state = if ($enabled) { 2 } else { 3 }
$valueBytes = [byte[]]($state, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
New-ItemProperty -LiteralPath $approvedPath -Name $entryName -PropertyType Binary -Value $valueBytes -Force | Out-Null

[PSCustomObject]@{
  enabled = [bool]$enabled
} | ConvertTo-Json -Compress
`;

    await runPowerShellJson(script, { timeoutMs: DEFAULT_STARTUP_TOGGLE_TIMEOUT_MS });
  }

  async function setScheduledTaskState({ taskPath, taskName, enabled }) {
    const payload = encodePayload({
      taskPath,
      taskName,
      enabled
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$taskPath = [string]$payload.taskPath
$taskName = [string]$payload.taskName
$enabled = [bool]$payload.enabled

if ([string]::IsNullOrWhiteSpace($taskName)) {
  throw 'missing_task_name'
}

if ($enabled) {
  Enable-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction Stop | Out-Null
} else {
  Disable-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction Stop | Out-Null
}

[PSCustomObject]@{
  enabled = [bool]$enabled
} | ConvertTo-Json -Compress
`;

    await runPowerShellJson(script, { timeoutMs: DEFAULT_STARTUP_TOGGLE_TIMEOUT_MS });
  }

  async function setStartupEntryEnabled({ entryId, enabled, expectedScope } = {}) {
    if (typeof entryId !== 'string' || !entryId.trim()) {
      throw new AppsManagerError('A valid startup entry id is required.', 'APPS_INVALID_PAYLOAD');
    }

    if (typeof enabled !== 'boolean') {
      throw new AppsManagerError('A boolean "enabled" value is required.', 'APPS_INVALID_PAYLOAD');
    }

    const normalizedEntryId = entryId.trim();
    const startupEntries = await listStartupAppsInternal();
    const targetEntry = startupEntries.find((entry) => entry.id === normalizedEntryId);

    if (!targetEntry) {
      throw new AppsManagerError('Requested startup entry was not found.', 'APPS_STARTUP_ENTRY_NOT_FOUND', {
        entryId: normalizedEntryId
      });
    }

    if (!targetEntry.canToggle) {
      throw new AppsManagerError('This startup entry cannot be toggled.', 'APPS_STARTUP_TOGGLE_NOT_SUPPORTED', {
        entryId: normalizedEntryId,
        startupType: targetEntry.startupType
      });
    }

    const normalizedExpectedScope = String(expectedScope || '').trim().toLowerCase();
    if (normalizedExpectedScope && targetEntry.startupScope !== normalizedExpectedScope) {
      throw new AppsManagerError('The requested startup scope changed before execution.', 'APPS_STARTUP_SCOPE_CHANGED', {
        entryId: normalizedEntryId,
        expectedScope: normalizedExpectedScope,
        actualScope: targetEntry.startupScope
      });
    }

    const isAdmin = Boolean(currentProcessIsAdmin());
    if (targetEntry.startupScope === 'machine' && !isAdmin) {
      throw new AppsManagerError(
        'Administrator access is required to change this system-wide startup entry.',
        'ADMIN_REQUIRED',
        {
          entryId: normalizedEntryId,
          startupType: targetEntry.startupType,
          startupScope: targetEntry.startupScope
        }
      );
    }

    try {
      if (targetEntry.startupType === 'scheduled-task') {
        if (!targetEntry.taskName) {
          throw new AppsManagerError('Scheduled task metadata is incomplete.', 'APPS_STARTUP_TOGGLE_NOT_SUPPORTED', {
            entryId: normalizedEntryId,
            startupType: targetEntry.startupType
          });
        }

        await setScheduledTaskState({
          taskPath: targetEntry.taskPath || '\\',
          taskName: targetEntry.taskName,
          enabled
        });
      } else {
        if (!targetEntry.startupApprovedPath || !targetEntry.entryName) {
          throw new AppsManagerError('Startup registry metadata is incomplete.', 'APPS_STARTUP_TOGGLE_NOT_SUPPORTED', {
            entryId: normalizedEntryId,
            startupType: targetEntry.startupType
          });
        }

        await setStartupApprovedEntryState({
          approvedPath: targetEntry.startupApprovedPath,
          entryName: targetEntry.entryName,
          enabled
        });
      }
    } catch (error) {
      if (isStartupAccessDeniedError(error)) {
        if (!isAdmin) {
          throw new AppsManagerError(
            'Administrator access is required to change this startup entry.',
            'ADMIN_REQUIRED',
            {
              entryId: normalizedEntryId,
              startupType: targetEntry.startupType,
              startupScope: targetEntry.startupScope
            }
          );
        }

        throw new AppsManagerError(
          'Windows denied access to this protected startup entry.',
          'APPS_STARTUP_TOGGLE_NOT_SUPPORTED',
          {
            entryId: normalizedEntryId,
            startupType: targetEntry.startupType,
            startupScope: targetEntry.startupScope
          }
        );
      }

      if (error instanceof AppsManagerError && error.code === 'APPS_POWERSHELL_FAILED') {
        throw new AppsManagerError(
          'Windows could not update this startup entry.',
          'APPS_STARTUP_TOGGLE_FAILED',
          {
            entryId: normalizedEntryId,
            startupType: targetEntry.startupType,
            startupScope: targetEntry.startupScope
          }
        );
      }

      throw error;
    }

    const updatedEntry = {
      ...targetEntry,
      enabled
    };

    logger?.info?.('Startup entry state updated.', {
      entryId: targetEntry.id,
      name: targetEntry.name,
      startupType: targetEntry.startupType,
      enabled
    });

    return {
      entry: toPublicStartupEntryShape(updatedEntry)
    };
  }

  async function setStartupEntryType({ entryId, startupType } = {}) {
    if (typeof entryId !== 'string' || !entryId.trim()) {
      throw new AppsManagerError('A valid startup entry id is required.', 'APPS_INVALID_PAYLOAD');
    }

    const normalizedType = normalizeStartupType(startupType);
    if (normalizedType === 'unknown') {
      throw new AppsManagerError('A valid startup type is required.', 'APPS_INVALID_PAYLOAD', {
        startupType
      });
    }

    const normalizedEntryId = entryId.trim();
    const startupEntries = await listStartupAppsInternal();
    const targetEntry = startupEntries.find((entry) => entry.id === normalizedEntryId);

    if (!targetEntry) {
      throw new AppsManagerError('Requested startup entry was not found.', 'APPS_STARTUP_ENTRY_NOT_FOUND', {
        entryId: normalizedEntryId
      });
    }

    if (targetEntry.startupType === normalizedType) {
      return {
        entry: toPublicStartupEntryShape(targetEntry)
      };
    }

    // Startup-source conversion stays blocked until each source has explicit migration and rollback rules.
    throw new AppsManagerError(
      'Changing startup type is not implemented yet.',
      'APPS_STARTUP_TYPE_CHANGE_NOT_SUPPORTED',
      {
        entryId: normalizedEntryId,
        currentType: targetEntry.startupType,
        requestedType: normalizedType
      }
    );
  }

  async function uninstallWin32App(targetApp) {
    const payload = encodePayload({
      uninstallCommand: targetApp.uninstallCommand,
      quietUninstallCommand: targetApp.quietUninstallCommand,
      installType: targetApp.installType,
      appId: targetApp.id,
      appName: targetApp.name,
      elevated: Boolean(currentProcessIsAdmin()),
      trustedMsiExecPath: resolveWindowsSystemExecutable('msiexec'),
      trustedWindowsRoot: resolveWindowsRoot()
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$quietCommand = [string]$payload.quietUninstallCommand
$fallbackCommand = [string]$payload.uninstallCommand
$installType = [string]$payload.installType
$elevated = [bool]$payload.elevated
$trustedMsiExecPath = [string]$payload.trustedMsiExecPath
$trustedWindowsRoot = [string]$payload.trustedWindowsRoot
$command = if (-not [string]::IsNullOrWhiteSpace($quietCommand)) { $quietCommand } else { $fallbackCommand }
$command = [Environment]::ExpandEnvironmentVariables($command)
if ([string]::IsNullOrWhiteSpace($command)) {
  throw 'missing_uninstall_command'
}

function Test-ProtectedMachinePath([string]$candidatePath) {
  $protectedRoots = @(
    $trustedWindowsRoot,
    [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),
    [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($root in $protectedRoots) {
    $normalizedRoot = [IO.Path]::GetFullPath([string]$root).TrimEnd('\\') + '\\'
    if ($candidatePath.StartsWith($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

function Invoke-GenericUninstall([string]$commandLine, [bool]$isQuietProvided) {
  $resolved = $commandLine
  if (-not $isQuietProvided -and $resolved -match '(?i)unins\\d*\\.exe' -and $resolved -notmatch '(?i)/VERYSILENT|/S') {
    $resolved = "$resolved /VERYSILENT /SUPPRESSMSGBOXES /NORESTART"
  }

  $trimmed = $resolved.Trim()
  $exePath = ''
  $args = ''

  $quoted = [Regex]::Match($trimmed, '^\\s*"([^"]+)"\\s*(.*)$')
  if ($quoted.Success) {
    $exePath = [string]$quoted.Groups[1].Value
    $args = [string]$quoted.Groups[2].Value
  } else {
    $plain = [Regex]::Match($trimmed, '^\\s*([^\\s]+)\\s*(.*)$')
    if ($plain.Success) {
      $exePath = [string]$plain.Groups[1].Value
      $args = [string]$plain.Groups[2].Value
    }
  }

  if (
    [string]::IsNullOrWhiteSpace($exePath) -or
    $exePath -notmatch '^(?:[A-Za-z]:[\\\\/]|\\\\\\\\)' -or
    [IO.Path]::GetExtension($exePath) -ine '.exe'
  ) {
    throw 'untrusted_uninstall_command'
  }

  $exePath = [IO.Path]::GetFullPath($exePath)
  if (([Uri]$exePath).IsUnc -or -not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw 'untrusted_uninstall_command'
  }
  if ($elevated -and -not (Test-ProtectedMachinePath -candidatePath $exePath)) {
    throw 'untrusted_elevated_uninstall_path'
  }

  $proc = Start-Process -FilePath $exePath -ArgumentList $args -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop
  return [int]$proc.ExitCode
}

$exitCode = 0
if ($installType -eq 'MSI' -or $command -match '(?i)msiexec(?:\\.exe)?|/(?:I|X)\\s*\\{[0-9A-F-]{36}\\}') {
  $guidMatch = [Regex]::Match($command, '(?i)\\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\\}')
  if (
    -not $guidMatch.Success -or
    [string]::IsNullOrWhiteSpace($trustedMsiExecPath) -or
    -not (Test-Path -LiteralPath $trustedMsiExecPath -PathType Leaf)
  ) {
    throw 'untrusted_uninstall_command'
  }
  $args = @('/X', $guidMatch.Value, '/qn', '/norestart')
  $proc = Start-Process -FilePath $trustedMsiExecPath -ArgumentList $args -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop
  $exitCode = [int]$proc.ExitCode
} else {
  $exitCode = Invoke-GenericUninstall -commandLine $command -isQuietProvided (-not [string]::IsNullOrWhiteSpace($quietCommand))
}

if ($exitCode -ne 0 -and $exitCode -ne 3010 -and $exitCode -ne 1641) {
  throw "uninstall_failed:$exitCode"
}

[PSCustomObject]@{
  exitCode = $exitCode
  restartRequired = [bool]($exitCode -eq 3010 -or $exitCode -eq 1641)
} | ConvertTo-Json -Compress
`;

    try {
      const result = await runPowerShellJson(script, { timeoutMs: DEFAULT_UNINSTALL_TIMEOUT_MS });
      return {
        exitCode: Number(result?.exitCode) || 0,
        restartRequired: Boolean(result?.restartRequired)
      };
    } catch (error) {
      if (error instanceof AppsManagerError && error.code === 'APPS_POWERSHELL_FAILED') {
        const stderr = String(error?.details?.stderr || '');
        const stdout = String(error?.details?.stdout || '');
        const detailsText = `${stderr}\n${stdout}`;
        if (
          detailsText.includes('missing_uninstall_command')
          || detailsText.includes('untrusted_uninstall_command')
          || detailsText.includes('untrusted_elevated_uninstall_path')
        ) {
          throw new AppsManagerError('No trusted uninstall command was found for this app.', 'APPS_UNINSTALL_NOT_SUPPORTED', {
            ...error.details
          });
        }

        const exitCodeMatch = detailsText.match(/uninstall_failed:(-?\d+)/i);
        if (exitCodeMatch?.[1]) {
          const exitCode = Number(exitCodeMatch[1]);
          throw new AppsManagerError(
            `Uninstall command failed with exit code ${exitCode}.`,
            'APPS_UNINSTALL_FAILED',
            {
              ...error.details,
              exitCode
            }
          );
        }
      }
      throw error;
    }
  }

  async function uninstallAppxApp(targetApp) {
    const payload = encodePayload({
      packageFullName: targetApp.packageFullName
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$packageFullName = [string]$payload.packageFullName
if ([string]::IsNullOrWhiteSpace($packageFullName)) {
  throw 'missing_package_full_name'
}

Remove-AppxPackage -Package $packageFullName -ErrorAction Stop
[PSCustomObject]@{
  exitCode = 0
  restartRequired = $false
} | ConvertTo-Json -Compress
`;

    try {
      const result = await runPowerShellJson(script, { timeoutMs: DEFAULT_UNINSTALL_TIMEOUT_MS });
      return {
        exitCode: Number(result?.exitCode) || 0,
        restartRequired: Boolean(result?.restartRequired)
      };
    } catch (error) {
      if (error instanceof AppsManagerError && error.code === 'APPS_POWERSHELL_FAILED') {
        const stderr = String(error?.details?.stderr || '');
        throw new AppsManagerError('AppX uninstall failed.', 'APPS_UNINSTALL_FAILED', {
          ...error.details,
          stderr
        });
      }
      throw error;
    }
  }

  async function uninstallApp({ appId, expectedScope } = {}) {
    if (typeof appId !== 'string' || !appId.trim()) {
      throw new AppsManagerError('A valid appId is required.', 'APPS_INVALID_PAYLOAD');
    }

    const normalizedAppId = appId.trim();
    const apps = await listInstalledAppsInternal();
    const targetApp = apps.find((entry) => entry.id === normalizedAppId);

    if (!targetApp) {
      throw new AppsManagerError('Requested app was not found.', 'APPS_APP_NOT_FOUND', {
        appId: normalizedAppId
      });
    }

    const normalizedExpectedScope = String(expectedScope || '').trim().toLowerCase();
    if (normalizedExpectedScope && targetApp.installScope !== normalizedExpectedScope) {
      throw new AppsManagerError('The requested app scope changed before uninstall.', 'APPS_UNINSTALL_SCOPE_CHANGED', {
        appId: normalizedAppId,
        expectedScope: normalizedExpectedScope,
        actualScope: targetApp.installScope
      });
    }

    if (!targetApp.canUninstall) {
      throw new AppsManagerError('This app cannot be uninstalled automatically.', 'APPS_UNINSTALL_NOT_SUPPORTED', {
        appId: normalizedAppId,
        uninstallReason: targetApp.uninstallReason || 'unsupported'
      });
    }

    let runResult = null;
    if (targetApp.source === 'appx') {
      runResult = await uninstallAppxApp(targetApp);
    } else if (targetApp.source === 'win32') {
      runResult = await uninstallWin32App(targetApp);
    } else {
      throw new AppsManagerError('Unsupported app source for uninstall.', 'APPS_UNINSTALL_NOT_SUPPORTED', {
        appId: normalizedAppId,
        source: targetApp.source
      });
    }

    logger?.info?.('Application uninstall completed.', {
      appId: targetApp.id,
      name: targetApp.name,
      source: targetApp.source,
      restartRequired: runResult.restartRequired
    });

    return {
      app: toPublicAppShape(targetApp),
      restartRequired: runResult.restartRequired,
      exitCode: runResult.exitCode
    };
  }

  function createEmptyGameDetectionResult(error = '') {
    const normalizedError = String(error || '').trim();
    const result = {
      games: [],
      activeGame: null,
      lastUpdatedAt: new Date().toISOString()
    };

    if (normalizedError) {
      result.error = normalizedError;
    }

    return result;
  }

  function normalizeIsoTimestamp(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      return new Date().toISOString();
    }

    const parsedTimestamp = Date.parse(normalizedValue);
    return Number.isNaN(parsedTimestamp) ? new Date().toISOString() : new Date(parsedTimestamp).toISOString();
  }

  function normalizeGameRunningState(value) {
    return String(value || '').trim().toLowerCase() === 'active_foreground'
      ? 'active_foreground'
      : 'running_background';
  }

  function toConfidenceTier(value) {
    const confidence = Number(value);
    if (!Number.isFinite(confidence)) {
      return '';
    }

    if (confidence >= 90) {
      return 'trusted';
    }

    if (confidence >= 70) {
      return 'strong';
    }

    return 'weak';
  }

  function normalizeHelperDetectedGame(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const pid = Number(entry.pid);
    const processName = String(entry.processName || '').trim();
    const exePath = String(entry.exePath || '').trim();
    if (!Number.isFinite(pid) || pid <= 0 || !processName || !exePath) {
      return null;
    }

    const confidence = Number(entry.confidence);
    const normalizedConfidence = Number.isFinite(confidence)
      ? Math.max(0, Math.min(100, Math.trunc(confidence)))
      : 0;
    const reasons = Array.isArray(entry.reasons)
      ? entry.reasons.map((reason) => String(reason || '').trim()).filter(Boolean)
      : [];

    return {
      id: String(entry.id || '').trim(),
      displayName: String(entry.displayName || '').trim(),
      processName,
      pid: Math.trunc(pid),
      exePath,
      installDir: String(entry.installDir || '').trim() || undefined,
      launcher: String(entry.launcher || '').trim() || undefined,
      state: normalizeGameRunningState(entry.state),
      confidence: normalizedConfidence,
      reasons,
      detectedAt: normalizeIsoTimestamp(entry.detectedAt),
      lastForegroundAt: entry.lastForegroundAt ? normalizeIsoTimestamp(entry.lastForegroundAt) : undefined
    };
  }

  function cloneNormalizedDetectionResult(result) {
    const source = result && typeof result === 'object' ? result : createEmptyGameDetectionResult();
    return {
      games: Array.isArray(source.games)
        ? source.games.map((entry) => ({
            ...entry,
            reasons: Array.isArray(entry?.reasons) ? [...entry.reasons] : []
          }))
        : [],
      activeGame: source.activeGame
        ? {
            ...source.activeGame,
            reasons: Array.isArray(source.activeGame?.reasons) ? [...source.activeGame.reasons] : []
          }
        : null,
      lastUpdatedAt: normalizeIsoTimestamp(source.lastUpdatedAt),
      ...(source.error ? { error: String(source.error).trim() } : {})
    };
  }

  function normalizeHelperDetectionResult(payload, fallbackError = '') {
    if (!payload || typeof payload !== 'object') {
      return createEmptyGameDetectionResult(fallbackError);
    }

    const games = Array.isArray(payload.games)
      ? payload.games.map(normalizeHelperDetectedGame).filter(Boolean)
      : [];

    const payloadActiveGame = normalizeHelperDetectedGame(payload.activeGame);
    const activeGame = payloadActiveGame && payloadActiveGame.state === 'active_foreground'
      ? payloadActiveGame
      : games.find((entry) => entry.state === 'active_foreground') || null;

    const normalizedError = String(payload.error || fallbackError || '').trim();
    return {
      games,
      activeGame,
      lastUpdatedAt: normalizeIsoTimestamp(payload.lastUpdatedAt),
      ...(normalizedError ? { error: normalizedError } : {})
    };
  }

  async function scanGameDetectionUncached() {
    try {
      const helperResult = await runGameDetectionScan({
        timeoutMs: DEFAULT_GAME_DETECTION_TIMEOUT_MS,
        isPackaged: isPackaged === true
      });

      if (!helperResult?.ok) {
        const code = String(helperResult?.code || 'GAME_DETECTION_FAILED').trim();
        const message = String(helperResult?.message || 'Game detector helper failed.').trim();
        return createEmptyGameDetectionResult(`${code}: ${message}`);
      }

      return normalizeHelperDetectionResult(helperResult.result, helperResult.stderr);
    } catch (error) {
      return createEmptyGameDetectionResult(error?.message || 'Unexpected game detection failure.');
    }
  }

  async function scanGameDetection() {
    const now = Date.now();
    if (
      lastGameDetectionSnapshot &&
      lastGameDetectionSnapshotAt > 0 &&
      now - lastGameDetectionSnapshotAt <= GAME_DETECTION_RESULT_CACHE_MS
    ) {
      return cloneNormalizedDetectionResult(lastGameDetectionSnapshot);
    }

    if (gameDetectionScanPromise) {
      return gameDetectionScanPromise;
    }

    gameDetectionScanPromise = (async () => {
      try {
        const scannedResult = await scanGameDetectionUncached();
        lastGameDetectionSnapshot = scannedResult;
        lastGameDetectionSnapshotAt = Date.now();
        return cloneNormalizedDetectionResult(scannedResult);
      } finally {
        gameDetectionScanPromise = null;
      }
    })();

    return gameDetectionScanPromise;
  }

  async function getCurrentGameDetection() {
    if (lastGameDetectionSnapshot) {
      return cloneNormalizedDetectionResult(lastGameDetectionSnapshot);
    }

    return scanGameDetection();
  }

  function mapDetectedGameForLegacyGameMode(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const processId = Number(entry.pid);
    const processName = String(entry.processName || '').trim();
    const executablePath = String(entry.exePath || '').trim();
    if (!Number.isFinite(processId) || processId <= 0 || !processName || !executablePath) {
      return null;
    }

    const confidence = Number(entry.confidence);
    const normalizedConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0;
    const reasons = Array.isArray(entry.reasons)
      ? entry.reasons.map((reason) => String(reason || '').trim()).filter(Boolean)
      : [];
    const detectionReason = reasons.join('. ').trim();
    const normalizedDisplayName = String(entry.displayName || '').trim() || processName.replace(/\.exe$/i, '');

    return {
      processId: Math.trunc(processId),
      processName,
      executablePath,
      displayName: normalizedDisplayName,
      normalizedGameId: String(entry.id || '').trim(),
      canonicalGameName: normalizedDisplayName,
      canonicalExecutableName: processName,
      actualDetectedProcessName: processName,
      actualDetectedExecutablePath: executablePath,
      confidence: normalizedConfidence,
      confidenceTier: toConfidenceTier(normalizedConfidence),
      detectionReason,
      aliasesMatched: processName ? [processName] : [],
      helperProcessesFound: [],
      windowTitle: '',
      iconDataUrl: '',
      installDir: String(entry.installDir || '').trim(),
      launcher: String(entry.launcher || '').trim(),
      state: normalizeGameRunningState(entry.state),
      reasons,
      detectedAt: normalizeIsoTimestamp(entry.detectedAt),
      lastForegroundAt: entry.lastForegroundAt ? normalizeIsoTimestamp(entry.lastForegroundAt) : undefined,
      fullscreenOptimizationsDisabled: false,
      priorityClass: '',
      runtimePriorityClass: '',
      priorityReadError: '',
      priorityConfigured: false,
      priorityConfigurationState: '',
      priorityConfiguredExecutablePaths: [],
      priorityMissingExecutablePaths: [],
      priorityRegistryPaths: [],
      logicalProcessorCount: 0,
      cpuAffinityMask: '',
      cpuAffinityProcessors: [],
      cpuAffinityReadError: '',
      detectionMode: normalizeGameRunningState(entry.state) === 'active_foreground' ? 'direct' : 'background',
      anchorProcessId: Math.trunc(processId),
      targetProcessId: Math.trunc(processId)
    };
  }

  async function detectActiveGameUncached() {
    const detectionResult = await scanGameDetection();
    const activeDetection = detectionResult?.activeGame && typeof detectionResult.activeGame === 'object'
      ? detectionResult.activeGame
      : Array.isArray(detectionResult?.games) && detectionResult.games.length > 0
      ? detectionResult.games[0]
      : null;

    if (!activeDetection) {
      if (detectionResult?.error) {
        logger?.warn?.('Game detector helper returned no active game.', {
          error: detectionResult.error
        });
        return getStickyDetectedGameFallback();
      }

      return null;
    }

    let detectedGame = mapDetectedGameForLegacyGameMode(activeDetection);
    if (!detectedGame) {
      return getStickyDetectedGameFallback();
    }

    const runtimeState = await readRuntimeStateForExecutable({
      executablePath: detectedGame.executablePath,
      processId: detectedGame.processId
    });

    if (runtimeState) {
      const runtimeProcessId = Number(runtimeState.runtimeProcessId);
      const normalizedRuntimeProcessId = Number.isFinite(runtimeProcessId) && runtimeProcessId > 0
        ? Math.trunc(runtimeProcessId)
        : detectedGame.processId;

      detectedGame = {
        ...detectedGame,
        processId: normalizedRuntimeProcessId,
        targetProcessId: normalizedRuntimeProcessId,
        runtimeExecutablePath: String(runtimeState.runtimeExecutablePath || '').trim(),
        runtimeProcessMatchState: String(runtimeState.runtimeProcessMatchState || '').trim(),
        fullscreenOptimizationsDisabled: Boolean(runtimeState.fullscreenOptimizationsDisabled),
        priorityClass: String(runtimeState.priorityClass || '').trim(),
        runtimePriorityClass: String(runtimeState.runtimePriorityClass || runtimeState.priorityClass || '').trim(),
        priorityReadError: String(runtimeState.priorityReadError || '').trim(),
        priorityConfigured: Boolean(runtimeState.priorityConfigured),
        priorityConfigurationState: String(runtimeState.priorityConfigurationState || '').trim(),
        priorityConfiguredExecutablePaths: Array.isArray(runtimeState.priorityConfiguredExecutablePaths)
          ? runtimeState.priorityConfiguredExecutablePaths
          : [],
        priorityMissingExecutablePaths: Array.isArray(runtimeState.priorityMissingExecutablePaths)
          ? runtimeState.priorityMissingExecutablePaths
          : [],
        priorityRegistryPaths: Array.isArray(runtimeState.priorityRegistryPaths) ? runtimeState.priorityRegistryPaths : [],
        logicalProcessorCount: Number.isFinite(Number(runtimeState.logicalProcessorCount))
          ? Math.trunc(Number(runtimeState.logicalProcessorCount))
          : 0,
        cpuAffinityMask: String(runtimeState.cpuAffinityMask || '').trim(),
        cpuAffinityProcessors: Array.isArray(runtimeState.cpuAffinityProcessors) ? runtimeState.cpuAffinityProcessors : [],
        cpuAffinityReadError: String(runtimeState.cpuAffinityReadError || '').trim()
      };
    }

    const iconCandidatePaths = [
      detectedGame.runtimeExecutablePath,
      detectedGame.actualDetectedExecutablePath,
      detectedGame.executablePath
    ].map((value) => String(value || '').trim()).filter(Boolean);

    for (const iconCandidatePath of iconCandidatePaths) {
      const iconDataUrl = await extractBestGameIconDataUrl(iconCandidatePath);
      if (iconDataUrl) {
        detectedGame = {
          ...detectedGame,
          iconDataUrl
        };
        break;
      }
    }

    if (process.env.NOVA_GAME_DETECTION_DEBUG === '1') {
      detectedGame.detectionDebug = {
        source: 'NovaGameDetector',
        helperState: activeDetection.state,
        helperReasons: Array.isArray(activeDetection.reasons) ? activeDetection.reasons : [],
        helperConfidence: Number(activeDetection.confidence) || 0
      };
    }

    setLastDetectedGameCache(detectedGame);
    return detectedGame;
  }
  async function detectActiveGame() {
    const now = Date.now();
    if (lastActiveGameDetectionAt > 0 && now - lastActiveGameDetectionAt <= GAME_DETECTION_RESULT_CACHE_MS) {
      return lastActiveGameDetectionResult;
    }

    if (activeGameDetectionPromise) {
      return activeGameDetectionPromise;
    }

    activeGameDetectionPromise = (async () => {
      try {
        const detectedGame = await detectActiveGameUncached();
        lastActiveGameDetectionResult = detectedGame;
        lastActiveGameDetectionAt = Date.now();
        return detectedGame;
      } finally {
        activeGameDetectionPromise = null;
      }
    })();

    return activeGameDetectionPromise;
  }

  async function configureActiveGame({
    executablePath,
    processId = 0,
    disableFullscreenOptimizations = true,
    preferHighPriority = true,
    applyFullscreenOptimizations = true,
    applyPriority = true,
    applyCpuAffinity = false,
    cpuAffinityProcessors = []
  } = {}) {
    const normalizedExecutablePath = String(executablePath || '').trim();
    if (!normalizedExecutablePath) {
      throw new AppsManagerError('A valid executablePath is required.', 'APPS_INVALID_PAYLOAD');
    }

    if (!/\.exe$/i.test(normalizedExecutablePath) || !path.win32.isAbsolute(normalizedExecutablePath) || /[\x00-\x1f]/.test(normalizedExecutablePath)) {
      throw new AppsManagerError('An absolute executable path is required.', 'APPS_INVALID_PAYLOAD');
    }
    if (applyCpuAffinity && (!Array.isArray(cpuAffinityProcessors) || !cpuAffinityProcessors.length || cpuAffinityProcessors.some((value) => !Number.isInteger(value) || value < 0 || value > 63))) {
      throw new AppsManagerError('Select valid logical processors.', 'APPS_INVALID_PAYLOAD');
    }
    if ([disableFullscreenOptimizations, preferHighPriority, applyFullscreenOptimizations, applyPriority, applyCpuAffinity].some((value) => typeof value !== 'boolean') ||
        !Number.isInteger(processId) || processId < 0 || processId > 0x7fffffff) {
      throw new AppsManagerError('Invalid game tuning options.', 'APPS_INVALID_PAYLOAD');
    }
    if (!currentProcessIsAdmin() && typeof privilegedExecutor === 'function') {
      return privilegedExecutor('game.configure', {
        executablePath: normalizedExecutablePath, processId,
        disableFullscreenOptimizations, preferHighPriority,
        applyFullscreenOptimizations, applyPriority, applyCpuAffinity, cpuAffinityProcessors
      }, { reason: 'game-runtime-tuning', timeoutMs: DEFAULT_GAME_TUNING_TIMEOUT_MS });
    }
    const normalizedProcessId = Number(processId);
    const payload = encodePayload({
      executablePath: normalizedExecutablePath,
      processId: Number.isFinite(normalizedProcessId) && normalizedProcessId > 0 ? Math.trunc(normalizedProcessId) : 0,
      disableFullscreenOptimizations: Boolean(disableFullscreenOptimizations),
      preferHighPriority: Boolean(preferHighPriority),
      applyFullscreenOptimizations: Boolean(applyFullscreenOptimizations),
      applyPriority: Boolean(applyPriority),
      applyCpuAffinity: Boolean(applyCpuAffinity),
      cpuAffinityProcessors: Array.isArray(cpuAffinityProcessors)
        ? cpuAffinityProcessors
            .map((entry) => Number(entry))
            .filter((entry) => Number.isFinite(entry))
            .map((entry) => Math.trunc(entry))
        : []
    });

    const script = `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$payload = $payloadJson | ConvertFrom-Json
$executablePath = [Environment]::ExpandEnvironmentVariables([string]$payload.executablePath).Trim()
$processId = [int]$payload.processId
$disableFullscreenOptimizations = [bool]$payload.disableFullscreenOptimizations
$preferHighPriority = [bool]$payload.preferHighPriority
$applyFullscreenOptimizations = [bool]$payload.applyFullscreenOptimizations
$applyPriority = [bool]$payload.applyPriority
$applyCpuAffinity = [bool]$payload.applyCpuAffinity
$cpuAffinityProcessors = @($payload.cpuAffinityProcessors | ForEach-Object { [int]$_ })

if ([string]::IsNullOrWhiteSpace($executablePath)) {
  throw 'missing_executable_path'
}
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
  throw 'executable_path_not_found'
}

function Split-LayerTokens([string]$value) {
  $tokens = New-Object 'System.Collections.Generic.List[string]'
  if ([string]::IsNullOrWhiteSpace($value)) {
    return ,$tokens
  }

  foreach ($token in @($value -split '\\s+')) {
    $trimmed = [string]$token
    $trimmed = $trimmed.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
    if (-not $tokens.Contains($trimmed)) {
      $tokens.Add($trimmed) | Out-Null
    }
  }

  return ,$tokens
}

function Contains-LayerToken([System.Collections.Generic.List[string]]$tokens, [string]$tokenName) {
  if ($null -eq $tokens -or [string]::IsNullOrWhiteSpace($tokenName)) { return $false }
  foreach ($token in $tokens) {
    if ([string]$token -ieq $tokenName) {
      return $true
    }
  }
  return $false
}

function Add-LayerToken([System.Collections.Generic.List[string]]$tokens, [string]$tokenName) {
  if ($null -eq $tokens -or [string]::IsNullOrWhiteSpace($tokenName)) { return }
  if (-not (Contains-LayerToken -tokens $tokens -tokenName $tokenName)) {
    $tokens.Add($tokenName) | Out-Null
  }
}

function Ensure-LayerMarkerToken([System.Collections.Generic.List[string]]$tokens) {
  if ($null -eq $tokens) { return }
  if (-not (Contains-LayerToken -tokens $tokens -tokenName '~')) {
    $tokens.Insert(0, '~')
  }
}

function Remove-LayerToken([System.Collections.Generic.List[string]]$tokens, [string]$tokenName) {
  if ($null -eq $tokens -or [string]::IsNullOrWhiteSpace($tokenName)) { return }
  for ($index = $tokens.Count - 1; $index -ge 0; $index--) {
    if ([string]$tokens[$index] -ieq $tokenName) {
      $tokens.RemoveAt($index)
    }
  }
}

function Has-MeaningfulLayerToken([System.Collections.Generic.List[string]]$tokens) {
  if ($null -eq $tokens) { return $false }
  foreach ($token in $tokens) {
    $candidate = [string]$token
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and $candidate -ine '~') {
      return $true
    }
  }
  return $false
}

function Normalize-ExecutablePath([string]$value) {
  $candidate = [Environment]::ExpandEnvironmentVariables([string]$value).Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }

  try {
    $candidate = [IO.Path]::GetFullPath($candidate)
  } catch {
    # Keep the expanded value when GetFullPath cannot normalize it.
  }

  return $candidate
}

function Add-UniquePath([System.Collections.Generic.List[string]]$paths, [string]$value) {
  if ($null -eq $paths) { return }
  $candidate = Normalize-ExecutablePath -value $value
  if ([string]::IsNullOrWhiteSpace($candidate)) { return }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return }

  foreach ($pathEntry in $paths) {
    if ([string]::Equals([string]$pathEntry, $candidate, [StringComparison]::OrdinalIgnoreCase)) {
      return
    }
  }

  $paths.Add($candidate) | Out-Null
}

function Get-CompatibilityExecutablePaths([string]$targetPath) {
  $paths = New-Object 'System.Collections.Generic.List[string]'
  $normalizedTargetPath = Normalize-ExecutablePath -value $targetPath
  Add-UniquePath -paths $paths -value $normalizedTargetPath

  if ([string]::IsNullOrWhiteSpace($normalizedTargetPath)) {
    return ,$paths
  }

  $fileName = ''
  $directory = ''
  try {
    $fileName = [IO.Path]::GetFileName($normalizedTargetPath)
    $directory = [IO.Path]::GetDirectoryName($normalizedTargetPath)
  } catch {
    return ,$paths
  }

  if (
    -not [string]::IsNullOrWhiteSpace($directory) -and
    $fileName -match '(?i)^FortniteClient-Win64-Shipping(?:_.+)?\\.exe$'
  ) {
    try {
      $fortniteRuntimeExecutables = Get-ChildItem -LiteralPath $directory -Filter 'FortniteClient-Win64-Shipping*.exe' -File -ErrorAction SilentlyContinue
      foreach ($runtimeExecutable in @($fortniteRuntimeExecutables)) {
        Add-UniquePath -paths $paths -value ([string]$runtimeExecutable.FullName)
      }
    } catch {
      # best effort only
    }
  }

  return ,$paths
}

function Get-IfeoPriorityPaths([string]$targetPath) {
  $normalizedTargetPath = Normalize-ExecutablePath -value $targetPath
  $exeName = ''
  try {
    $exeName = [IO.Path]::GetFileName($normalizedTargetPath)
  } catch {
    $exeName = ''
  }

  if ([string]::IsNullOrWhiteSpace($exeName)) {
    return [PSCustomObject]@{
      exeName = ''
      exeKeyPath = ''
      perfOptionsPath = ''
    }
  }

  $ifeoBasePath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options'
  $exeKeyPath = Join-Path -Path $ifeoBasePath -ChildPath $exeName
  $perfOptionsPath = Join-Path -Path $exeKeyPath -ChildPath 'PerfOptions'

  return [PSCustomObject]@{
    exeName = $exeName
    exeKeyPath = $exeKeyPath
    perfOptionsPath = $perfOptionsPath
  }
}

function Get-IfeoPriorityClass([string]$targetPath) {
  $priorityPaths = Get-IfeoPriorityPaths -targetPath $targetPath
  if ([string]::IsNullOrWhiteSpace([string]$priorityPaths.perfOptionsPath)) {
    return ''
  }

  try {
    $perfOptions = Get-Item -LiteralPath ([string]$priorityPaths.perfOptionsPath) -ErrorAction SilentlyContinue
    if (
      $perfOptions -and
      $perfOptions.GetValueKind('CpuPriorityClass') -eq [Microsoft.Win32.RegistryValueKind]::DWord -and
      [int]$perfOptions.GetValue('CpuPriorityClass') -eq 3
    ) {
      return 'High'
    }
  } catch {
    return ''
  }

  return ''
}

function Convert-ProcessPriorityValue([int]$priorityValue) {
  if ($priorityValue -ge 24) { return 'RealTime' }
  if ($priorityValue -ge 13) { return 'High' }
  if ($priorityValue -ge 10) { return 'AboveNormal' }
  if ($priorityValue -le 4 -and $priorityValue -gt 0) { return 'Idle' }
  if ($priorityValue -le 6 -and $priorityValue -gt 0) { return 'BelowNormal' }
  if ($priorityValue -gt 0) { return 'Normal' }
  return ''
}

function Get-RuntimePriorityClass([int]$processId) {
  $priorityClass = ''
  $priorityReadError = ''

  if ($processId -le 0) {
    return [PSCustomObject]@{
      priorityClass = ''
      priorityReadError = 'PROCESS_NOT_FOUND'
    }
  }

  try {
    $priorityProcess = Get-Process -Id $processId -ErrorAction Stop
    if ($priorityProcess) {
      $priorityClass = [string]$priorityProcess.PriorityClass
    }
  } catch {
    $priorityReadError = 'PROCESS_PRIORITY_READ_FAILED'
  }

  if ([string]::IsNullOrWhiteSpace($priorityClass)) {
    try {
      $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
      if ($cimProcess) {
        $priorityClass = Convert-ProcessPriorityValue -priorityValue ([int]$cimProcess.Priority)
        $priorityReadError = ''
      }
    } catch {
      if ([string]::IsNullOrWhiteSpace($priorityReadError)) {
        $priorityReadError = 'PROCESS_PRIORITY_READ_FAILED'
      }
    }
  }

  return [PSCustomObject]@{
    priorityClass = $priorityClass
    priorityReadError = $priorityReadError
  }
}

function Get-LogicalProcessorCount {
  try {
    $count = [int][Environment]::ProcessorCount
    if ($count -gt 0) {
      return [Math]::Min($count, 64)
    }
  } catch {
    # keep default below
  }

  return 0
}

function Convert-Int64ToUInt64([Int64]$value) {
  return [BitConverter]::ToUInt64([BitConverter]::GetBytes($value), 0)
}

function Convert-UInt64ToInt64([UInt64]$value) {
  return [BitConverter]::ToInt64([BitConverter]::GetBytes($value), 0)
}

function Convert-AffinityMaskToProcessors([UInt64]$mask, [int]$logicalProcessorCount) {
  $processors = New-Object 'System.Collections.Generic.List[int]'
  $count = [Math]::Max(0, [Math]::Min(64, $logicalProcessorCount))

  for ($index = 0; $index -lt $count; $index++) {
    $bit = [UInt64][Math]::Pow(2, $index)
    if (($mask -band $bit) -ne 0) {
      $processors.Add([int]$index) | Out-Null
    }
  }

  return ,$processors
}

function Convert-ProcessorsToAffinityMask([int[]]$processorIndexes, [int]$logicalProcessorCount) {
  $count = [Math]::Max(0, [Math]::Min(64, $logicalProcessorCount))
  if ($count -le 0) {
    throw 'AFFINITY_CPU_COUNT_UNAVAILABLE'
  }

  $mask = [UInt64]0
  $hasProcessor = $false
  foreach ($processorIndex in @($processorIndexes)) {
    $index = [int]$processorIndex
    if ($index -lt 0 -or $index -ge $count) {
      throw 'AFFINITY_PROCESSOR_OUT_OF_RANGE'
    }

    $bit = [UInt64][Math]::Pow(2, $index)
    $mask = $mask -bor $bit
    $hasProcessor = $true
  }

  if (-not $hasProcessor -or $mask -eq 0) {
    throw 'AFFINITY_SELECTION_EMPTY'
  }

  return $mask
}

function Get-ProcessAffinity([int]$processId) {
  $logicalProcessorCount = Get-LogicalProcessorCount

  if ($processId -le 0) {
    return [PSCustomObject]@{
      logicalProcessorCount = [int]$logicalProcessorCount
      cpuAffinityMask = ''
      cpuAffinityProcessors = @()
      cpuAffinityReadError = 'PROCESS_NOT_FOUND'
    }
  }

  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    $mask = Convert-Int64ToUInt64 -value ([Int64]$process.ProcessorAffinity.ToInt64())
    $processors = Convert-AffinityMaskToProcessors -mask $mask -logicalProcessorCount $logicalProcessorCount

    return [PSCustomObject]@{
      logicalProcessorCount = [int]$logicalProcessorCount
      cpuAffinityMask = [string]$mask
      cpuAffinityProcessors = @($processors)
      cpuAffinityReadError = ''
    }
  } catch {
    return [PSCustomObject]@{
      logicalProcessorCount = [int]$logicalProcessorCount
      cpuAffinityMask = ''
      cpuAffinityProcessors = @()
      cpuAffinityReadError = 'PROCESS_AFFINITY_READ_FAILED'
    }
  }
}

function Set-ProcessAffinity([int]$processId, [int[]]$processorIndexes) {
  if ($processId -le 0) {
    throw 'PROCESS_NOT_FOUND'
  }

  $logicalProcessorCount = Get-LogicalProcessorCount
  $mask = Convert-ProcessorsToAffinityMask -processorIndexes $processorIndexes -logicalProcessorCount $logicalProcessorCount
  $process = Get-Process -Id $processId -ErrorAction Stop
  $process.ProcessorAffinity = [IntPtr](Convert-UInt64ToInt64 -value $mask)
}

function Resolve-ProcessExecutablePath([Diagnostics.Process]$process) {
  if ($null -eq $process) { return '' }

  $resolvedPath = ''
  try {
    $resolvedPath = [string]$process.MainModule.FileName
  } catch {
    $resolvedPath = ''
  }

  if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
    try {
      $processId = [int]$process.Id
      $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
      $resolvedPath = [string]$cimProcess.ExecutablePath
    } catch {
      $resolvedPath = ''
    }
  }

  return Normalize-ExecutablePath -value $resolvedPath
}

function New-RuntimeTarget([int]$processId, [string]$executablePath, [string]$matchState) {
  return [PSCustomObject]@{
    processId = [int]$processId
    executablePath = [string]$executablePath
    matchState = [string]$matchState
  }
}

function Resolve-TargetRuntimeProcess([string]$targetPath, [int]$preferredProcessId) {
  $normalizedTargetPath = Normalize-ExecutablePath -value $targetPath
  if ([string]::IsNullOrWhiteSpace($normalizedTargetPath)) {
    return (New-RuntimeTarget -processId 0 -executablePath '' -matchState 'missing-target-path')
  }

  $targetBaseName = ''
  try {
    $targetBaseName = [IO.Path]::GetFileNameWithoutExtension($normalizedTargetPath)
  } catch {
    $targetBaseName = ''
  }

  if ($preferredProcessId -gt 0) {
    try {
      $preferredProcess = Get-Process -Id $preferredProcessId -ErrorAction Stop
      $preferredPath = Resolve-ProcessExecutablePath -process $preferredProcess
      if ([string]::Equals($preferredPath, $normalizedTargetPath, [StringComparison]::OrdinalIgnoreCase)) {
        return (New-RuntimeTarget -processId ([int]$preferredProcess.Id) -executablePath $preferredPath -matchState 'preferred-exact-path')
      }
    } catch {
      # Ignore mismatched or unavailable preferred PID. Runtime actions must target the executable path.
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($targetBaseName)) {
    foreach ($candidateProcess in @(Get-Process -Name $targetBaseName -ErrorAction SilentlyContinue)) {
      $candidatePath = Resolve-ProcessExecutablePath -process $candidateProcess
      if ([string]::Equals($candidatePath, $normalizedTargetPath, [StringComparison]::OrdinalIgnoreCase)) {
        return (New-RuntimeTarget -processId ([int]$candidateProcess.Id) -executablePath $candidatePath -matchState 'exact-path')
      }
    }
  }

  return (New-RuntimeTarget -processId 0 -executablePath $normalizedTargetPath -matchState 'not-running')
}

function Get-PriorityConfigurationState([System.Collections.Generic.List[string]]$targetPaths) {
  $configuredExecutablePaths = New-Object 'System.Collections.Generic.List[string]'
  $missingExecutablePaths = New-Object 'System.Collections.Generic.List[string]'
  $registryPaths = New-Object 'System.Collections.Generic.List[string]'

  foreach ($targetPath in @($targetPaths)) {
    $priorityPaths = Get-IfeoPriorityPaths -targetPath ([string]$targetPath)
    if ([string]::IsNullOrWhiteSpace([string]$priorityPaths.perfOptionsPath)) {
      continue
    }

    $registryPaths.Add([string]$priorityPaths.perfOptionsPath) | Out-Null
    if ((Get-IfeoPriorityClass -targetPath ([string]$targetPath)) -ieq 'High') {
      $configuredExecutablePaths.Add([string]$targetPath) | Out-Null
    } else {
      $missingExecutablePaths.Add([string]$targetPath) | Out-Null
    }
  }

  $configurationState = 'missing'
  if ($configuredExecutablePaths.Count -gt 0 -and $missingExecutablePaths.Count -eq 0) {
    $configurationState = 'configured'
  } elseif ($configuredExecutablePaths.Count -gt 0) {
    $configurationState = 'partial'
  }

  return [PSCustomObject]@{
    configured = [bool]($configuredExecutablePaths.Count -gt 0)
    configurationState = $configurationState
    configuredExecutablePaths = @($configuredExecutablePaths)
    missingExecutablePaths = @($missingExecutablePaths)
    registryPaths = @($registryPaths)
  }
}

$layersPath = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
if ($applyFullscreenOptimizations -and -not (Test-Path -LiteralPath $layersPath)) {
  New-Item -Path $layersPath -Force | Out-Null
}

$compatibilityExecutablePaths = Get-CompatibilityExecutablePaths -targetPath $executablePath
$updatedCompatibilityPaths = New-Object 'System.Collections.Generic.List[string]'

foreach ($compatibilityPath in @($compatibilityExecutablePaths)) {
  if (-not $applyFullscreenOptimizations) { continue }
  $existingLayerValue = ''
  $hadLayerEntry = $false
  $layers = Get-ItemProperty -Path $layersPath -ErrorAction SilentlyContinue
  if ($layers) {
    $layerEntry = $layers.PSObject.Properties | Where-Object { $_.Name -eq [string]$compatibilityPath } | Select-Object -First 1
    if ($layerEntry) {
      $hadLayerEntry = $true
      $existingLayerValue = [string]$layerEntry.Value
    }
  }

  $layerTokens = Split-LayerTokens -value $existingLayerValue
  if ($disableFullscreenOptimizations) {
    Ensure-LayerMarkerToken -tokens $layerTokens
    Add-LayerToken -tokens $layerTokens -tokenName 'DISABLEDXMAXIMIZEDWINDOWEDMODE'
  } else {
    Remove-LayerToken -tokens $layerTokens -tokenName 'DISABLEDXMAXIMIZEDWINDOWEDMODE'
    if (-not (Has-MeaningfulLayerToken -tokens $layerTokens)) {
      $layerTokens.Clear()
    }
  }

  $nextLayerValue = [string]::Join(' ', @($layerTokens))
  if ([string]::IsNullOrWhiteSpace($nextLayerValue)) {
    if ($hadLayerEntry) {
      Remove-ItemProperty -Path $layersPath -Name ([string]$compatibilityPath) -ErrorAction SilentlyContinue
      $updatedCompatibilityPaths.Add([string]$compatibilityPath) | Out-Null
    }
  } elseif ($nextLayerValue -cne $existingLayerValue) {
    New-ItemProperty -Path $layersPath -Name ([string]$compatibilityPath) -Value $nextLayerValue -PropertyType String -Force | Out-Null
    $updatedCompatibilityPaths.Add([string]$compatibilityPath) | Out-Null
  }
}

$verifiedLayerValue = ''
$verifiedLayers = Get-ItemProperty -Path $layersPath -ErrorAction SilentlyContinue
if ($verifiedLayers) {
  $verifiedLayerEntry = $verifiedLayers.PSObject.Properties | Where-Object { $_.Name -eq $executablePath } | Select-Object -First 1
  if ($verifiedLayerEntry) {
    $verifiedLayerValue = [string]$verifiedLayerEntry.Value
  }
}
$verifiedLayerTokens = Split-LayerTokens -value $verifiedLayerValue

$priorityExecutablePaths = Get-CompatibilityExecutablePaths -targetPath $executablePath
$priorityApplyErrors = New-Object System.Collections.ArrayList

foreach ($priorityExecutablePath in @($priorityExecutablePaths)) {
  if (-not $applyPriority) { continue }
  $priorityPaths = Get-IfeoPriorityPaths -targetPath ([string]$priorityExecutablePath)
  $priorityRegistryPath = [string]$priorityPaths.perfOptionsPath
  if ([string]::IsNullOrWhiteSpace($priorityRegistryPath)) {
    continue
  }

  try {
    $currentPriorityClass = Get-IfeoPriorityClass -targetPath ([string]$priorityExecutablePath)
    if ($preferHighPriority -and $currentPriorityClass -ine 'High') {
      if (-not (Test-Path -LiteralPath ([string]$priorityPaths.exeKeyPath))) {
        New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options' -Name ([string]$priorityPaths.exeName) -Force | Out-Null
      }
      if (-not (Test-Path -LiteralPath $priorityRegistryPath)) {
        New-Item -Path ([string]$priorityPaths.exeKeyPath) -Name 'PerfOptions' -Force | Out-Null
      }
      New-ItemProperty -Path $priorityRegistryPath -Name 'CpuPriorityClass' -Value 3 -PropertyType DWord -Force | Out-Null
    } elseif (-not $preferHighPriority -and $currentPriorityClass -ieq 'High' -and (Test-Path -LiteralPath $priorityRegistryPath)) {
      Remove-ItemProperty -Path $priorityRegistryPath -Name 'CpuPriorityClass' -ErrorAction Stop
    }
  } catch {
    $priorityErrorText = [string]$_.Exception.Message
    $priorityErrorCode = if ($priorityErrorText -match '(?i)access.*denied|zugriff.*verweigert|denied|unauthorized') { 'ACCESS_DENIED' } else { 'REGISTRY_WRITE_FAILED' }
    $priorityApplyErrors.Add([PSCustomObject]@{
      executablePath = [string]$priorityExecutablePath
      registryPath = $priorityRegistryPath
      code = $priorityErrorCode
      message = $priorityErrorText
    }) | Out-Null
  }
}

$runtimeTarget = Resolve-TargetRuntimeProcess -targetPath $executablePath -preferredProcessId $processId
$runtimeProcessId = [int]$runtimeTarget.processId
if ($applyPriority) {
  try {
    if ($runtimeProcessId -le 0) { throw 'TARGET_PROCESS_NOT_RUNNING' }
    $runtimeProcess = Get-Process -Id $runtimeProcessId -ErrorAction Stop
    $runtimeProcess.PriorityClass = if ($preferHighPriority) { 'High' } else { 'Normal' }
  } catch {
    $priorityErrorText = [string]$_.Exception.Message
    $priorityErrorCode = if ($runtimeProcessId -le 0) { 'TARGET_PROCESS_NOT_RUNNING' } elseif ($_.Exception -is [UnauthorizedAccessException] -or $priorityErrorText -match '(?i)access.*denied|zugriff.*verweigert|denied|unauthorized') { 'ACCESS_DENIED' } else { 'PROCESS_PRIORITY_SET_FAILED' }
    $priorityApplyErrors.Add([PSCustomObject]@{
      processId = $runtimeProcessId
      code = $priorityErrorCode
      message = $priorityErrorText
    }) | Out-Null
  }
}
$cpuAffinityApplyErrors = New-Object System.Collections.ArrayList
if ($applyCpuAffinity) {
  if ($runtimeProcessId -le 0) {
    $cpuAffinityApplyErrors.Add([PSCustomObject]@{
      processId = 0
      executablePath = [string]$executablePath
      code = 'TARGET_PROCESS_NOT_RUNNING'
      message = 'Target executable process is not running.'
    }) | Out-Null
  } else {
    try {
      Set-ProcessAffinity -processId $runtimeProcessId -processorIndexes $cpuAffinityProcessors
    } catch {
      $affinityErrorText = [string]$_.Exception.Message
      $affinityErrorCode = if ($affinityErrorText -match '(?i)access.*denied|zugriff.*verweigert|denied|unauthorized') { 'ACCESS_DENIED' } else { 'PROCESS_AFFINITY_SET_FAILED' }
      $cpuAffinityApplyErrors.Add([PSCustomObject]@{
        processId = [int]$runtimeProcessId
        executablePath = [string]$runtimeTarget.executablePath
        code = $affinityErrorCode
        message = $affinityErrorText
      }) | Out-Null
    }
  }
}

$priorityConfiguration = Get-PriorityConfigurationState -targetPaths $priorityExecutablePaths
$runtimePriority = Get-RuntimePriorityClass -processId $runtimeProcessId
$cpuAffinity = Get-ProcessAffinity -processId $runtimeProcessId
$priorityClass = [string]$runtimePriority.priorityClass
$priorityApplyErrorCode = ''
if ($priorityApplyErrors.Count -gt 0) {
  $priorityApplyErrorCode = [string]$priorityApplyErrors[0].code
}
$cpuAffinityApplyErrorCode = ''
if ($cpuAffinityApplyErrors.Count -gt 0) {
  $cpuAffinityApplyErrorCode = [string]$cpuAffinityApplyErrors[0].code
}

[PSCustomObject]@{
  executablePath = $executablePath
  runtimeProcessId = [int]$runtimeProcessId
  runtimeExecutablePath = [string]$runtimeTarget.executablePath
  runtimeProcessMatchState = [string]$runtimeTarget.matchState
  fullscreenOptimizationsDisabled = [bool](Contains-LayerToken -tokens $verifiedLayerTokens -tokenName 'DISABLEDXMAXIMIZEDWINDOWEDMODE')
  compatibilityExecutablePaths = @($compatibilityExecutablePaths)
  updatedCompatibilityPaths = @($updatedCompatibilityPaths)
  priorityClass = $priorityClass
  runtimePriorityClass = $priorityClass
  priorityReadError = [string]$runtimePriority.priorityReadError
  priorityConfigured = [bool]$priorityConfiguration.configured
  priorityConfigurationState = [string]$priorityConfiguration.configurationState
  priorityConfiguredExecutablePaths = @($priorityConfiguration.configuredExecutablePaths)
  priorityMissingExecutablePaths = @($priorityConfiguration.missingExecutablePaths)
  priorityRegistryPaths = @($priorityConfiguration.registryPaths)
  priorityApplyErrorCode = $priorityApplyErrorCode
  priorityApplyErrors = @($priorityApplyErrors.ToArray())
  logicalProcessorCount = [int]$cpuAffinity.logicalProcessorCount
  cpuAffinityMask = [string]$cpuAffinity.cpuAffinityMask
  cpuAffinityProcessors = @($cpuAffinity.cpuAffinityProcessors)
  cpuAffinityReadError = [string]$cpuAffinity.cpuAffinityReadError
  cpuAffinityApplyErrorCode = $cpuAffinityApplyErrorCode
  cpuAffinityApplyErrors = @($cpuAffinityApplyErrors.ToArray())
} | ConvertTo-Json -Compress -Depth 6
`;

    try {
      const result = await runPowerShellJson(script, { timeoutMs: DEFAULT_GAME_TUNING_TIMEOUT_MS });
      const toStringList = (value) => {
        const values = Array.isArray(value) ? value : [value];
        return values.map((entry) => String(entry || '').trim()).filter(Boolean);
      };
      const toNumberList = (value) => {
        const values = Array.isArray(value) ? value : [value];
        return values
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
          .map((entry) => Math.trunc(entry));
      };

      return {
        executablePath: String(result?.executablePath || normalizedExecutablePath).trim(),
        runtimeProcessId: Number.isFinite(Number(result?.runtimeProcessId)) && Number(result.runtimeProcessId) > 0
          ? Math.trunc(Number(result.runtimeProcessId))
          : 0,
        runtimeExecutablePath: String(result?.runtimeExecutablePath || '').trim(),
        runtimeProcessMatchState: String(result?.runtimeProcessMatchState || '').trim(),
        fullscreenOptimizationsDisabled: Boolean(result?.fullscreenOptimizationsDisabled),
        compatibilityExecutablePaths: toStringList(result?.compatibilityExecutablePaths),
        updatedCompatibilityPaths: toStringList(result?.updatedCompatibilityPaths),
        priorityClass: String(result?.priorityClass || '').trim(),
        runtimePriorityClass: String(result?.runtimePriorityClass || result?.priorityClass || '').trim(),
        priorityReadError: String(result?.priorityReadError || '').trim(),
        priorityConfigured: Boolean(result?.priorityConfigured),
        priorityConfigurationState: String(result?.priorityConfigurationState || '').trim(),
        priorityConfiguredExecutablePaths: toStringList(result?.priorityConfiguredExecutablePaths),
        priorityMissingExecutablePaths: toStringList(result?.priorityMissingExecutablePaths),
        priorityRegistryPaths: toStringList(result?.priorityRegistryPaths),
        priorityApplyErrorCode: String(result?.priorityApplyErrorCode || '').trim(),
        priorityApplyErrors: Array.isArray(result?.priorityApplyErrors)
          ? result.priorityApplyErrors
          : result?.priorityApplyErrors
            ? [result.priorityApplyErrors]
            : [],
        logicalProcessorCount: Number.isFinite(Number(result?.logicalProcessorCount))
          ? Math.trunc(Number(result.logicalProcessorCount))
          : 0,
        cpuAffinityMask: String(result?.cpuAffinityMask || '').trim(),
        cpuAffinityProcessors: toNumberList(result?.cpuAffinityProcessors),
        cpuAffinityReadError: String(result?.cpuAffinityReadError || '').trim(),
        cpuAffinityApplyErrorCode: String(result?.cpuAffinityApplyErrorCode || '').trim(),
        cpuAffinityApplyErrors: Array.isArray(result?.cpuAffinityApplyErrors)
          ? result.cpuAffinityApplyErrors
          : result?.cpuAffinityApplyErrors
            ? [result.cpuAffinityApplyErrors]
            : []
      };
    } catch (error) {
      if (error instanceof AppsManagerError && error.code === 'APPS_POWERSHELL_FAILED') {
        const stderr = String(error?.details?.stderr || '');
        const stdout = String(error?.details?.stdout || '');
        const detailsText = `${stderr}\n${stdout}`;
        if (detailsText.includes('missing_executable_path') || detailsText.includes('executable_path_not_found')) {
          throw new AppsManagerError('The selected game executable path is invalid.', 'APPS_INVALID_PAYLOAD', {
            ...error.details,
            executablePath: normalizedExecutablePath
          });
        }
      }
      throw error;
    }
  }

  async function optimizeApp({ appId, actionIds } = {}) {
    if (typeof appId !== 'string' || !appId.trim()) {
      throw new AppsManagerError('A valid appId is required.', 'APPS_INVALID_PAYLOAD');
    }

    return getAppOptimizationService().start({
      appId: appId.trim(),
      actionIds: Array.isArray(actionIds) ? actionIds : null
    });
  }

  return {
    listInstalledApps,
    listStartupApps,
    setStartupEntryEnabled,
    setStartupEntryType,
    scanGameDetection,
    getCurrentGameDetection,
    detectActiveGame,
    configureActiveGame,
    uninstallApp,
    optimizeApp,
    analyzeAppOptimization: ({ appId, includeCacheSize = true } = {}) =>
      getAppOptimizationService().analyzeById(String(appId || '').trim(), { includeCacheSize }),
    confirmAppOptimizationClose: (payload) => getAppOptimizationService().confirmClose(payload),
    cancelAppOptimization: (payload) => getAppOptimizationService().cancel(payload),
    resetAppOptimizations: (payload) => getAppOptimizationService().reset(payload),
    cleanupInactiveAppCaches: () => getAppOptimizationService().cleanupInactiveAppCaches(),
    getAppOptimizationState: () => getAppOptimizationService().getState()
  };
}

module.exports = {
  createAppsManager,
  AppsManagerError,
  isStartupAccessDeniedError
};


