const os = require('os');
const { spawn } = require('child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10000;
const LHM_ENDPOINT = 'http://127.0.0.1:8085/data.json';

const PLACEHOLDER_EXACT = new Set([
  'unknown',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'not available',
  'default string',
  'system product name',
  'system manufacturer'
]);

const PLACEHOLDER_PHRASES = [
  'to be filled by o.e.m.',
  'to be filled by oem'
];

const GPU_NON_PHYSICAL_HINTS = [
  'microsoft basic display',
  'remote display',
  'remote adapter',
  'rdp',
  'virtual',
  'vmware',
  'hyper-v',
  'virtualbox',
  'parallels',
  'citrix',
  'displaylink',
  'mirror driver',
  'parsec',
  'indirect display'
];

const DEDICATED_GPU_HINTS = [
  'geforce',
  'rtx',
  'gtx',
  'quadro',
  'tesla',
  'titan',
  'radeon rx',
  'radeon pro',
  'firepro',
  'firegl',
  'intel arc',
  'arc pro'
];

const INTEGRATED_GPU_HINTS = [
  'integrated',
  'igpu',
  'apu',
  'intel hd graphics',
  'intel uhd graphics',
  'intel iris',
  'iris xe',
  'radeon(tm) graphics',
  ' with radeon graphics',
  'radeon graphics'
];

const RAM_TYPE_BY_CODE = {
  20: 'DDR',
  21: 'DDR2',
  24: 'DDR3',
  26: 'DDR4',
  27: 'LPDDR',
  28: 'LPDDR2',
  29: 'LPDDR3',
  30: 'LPDDR4',
  34: 'DDR5',
  35: 'LPDDR5'
};

const WINDOWS_HARDWARE_QUERY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'function Get-HardwareInstances([string]$ClassName) {',
  "  if (Get-Command -Name Get-CimInstance -ErrorAction SilentlyContinue) {",
  "    try { return @(Get-CimInstance -ClassName $ClassName -ErrorAction Stop) } catch {}",
  '  }',
  "  if (Get-Command -Name Get-WmiObject -ErrorAction SilentlyContinue) {",
  "    try { return @(Get-WmiObject -Class $ClassName -ErrorAction Stop) } catch {}",
  '  }',
  '  return @()',
  '}',
  "$cpu = @(Get-HardwareInstances 'Win32_Processor' | ForEach-Object { $_.Name } | Where-Object { $_ })",
  "$gpu = @(Get-HardwareInstances 'Win32_VideoController' | ForEach-Object { $_.Name } | Where-Object { $_ })",
  "$computer = @(Get-HardwareInstances 'Win32_ComputerSystem' | Select-Object -First 1)",
  '$ramTotalBytes = $null',
  'if ($computer.Count -gt 0) { $ramTotalBytes = $computer[0].TotalPhysicalMemory }',
  "$ramModules = @(Get-HardwareInstances 'Win32_PhysicalMemory' | ForEach-Object {",
  '  [PSCustomObject]@{',
  '    manufacturer = $_.Manufacturer',
  '    partNumber = $_.PartNumber',
  '    speed = $_.Speed',
  '    configuredClockSpeed = $_.ConfiguredClockSpeed',
  '    memoryType = $_.MemoryType',
  '    smbiosMemoryType = $_.SMBIOSMemoryType',
  '    capacity = $_.Capacity',
  '  }',
  '})',
  "$baseboards = @(Get-HardwareInstances 'Win32_BaseBoard' | ForEach-Object {",
  '  [PSCustomObject]@{',
  '    manufacturer = $_.Manufacturer',
  '    product = $_.Product',
  '    model = $_.Model',
  '    name = $_.Name',
  '  }',
  '})',
  '[PSCustomObject]@{',
  '  cpu = $cpu',
  '  gpu = $gpu',
  '  ramTotalBytes = $ramTotalBytes',
  '  ramModules = $ramModules',
  '  baseboards = $baseboards',
  '} | ConvertTo-Json -Depth 8 -Compress'
].join('\n');

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function includesAny(text, hints) {
  if (!text) {
    return false;
  }

  return hints.some((hint) => text.includes(hint));
}

function sanitizeName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const compact = value.trim().replace(/\s+/g, ' ');
  if (!compact) {
    return '';
  }

  const normalized = normalizeText(compact);
  if (!normalized) {
    return '';
  }

  if (PLACEHOLDER_EXACT.has(normalized)) {
    return '';
  }

  if (includesAny(normalized, PLACEHOLDER_PHRASES)) {
    return '';
  }

  return compact;
}

function uniqueNames(values) {
  const result = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const name = sanitizeName(value);
    if (!name) {
      continue;
    }

    const normalized = normalizeText(name);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(name);
  }

  return result;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatRamLabel(totalBytes) {
  const numeric = toFiniteNumber(totalBytes);
  if (numeric === null || numeric <= 0) {
    return '';
  }

  const gib = numeric / (1024 ** 3);
  if (gib >= 100) {
    return `${Math.round(gib)} GB`;
  }

  if (gib >= 10) {
    return `${gib.toFixed(1).replace(/\.0$/, '')} GB`;
  }

  return `${gib.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} GB`;
}

function toPositiveNumber(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }

  return numeric;
}

function normalizeRamModules(modules) {
  return toArray(modules).filter((module) => Boolean(module) && typeof module === 'object');
}

function resolveRamTypeFromCode(code) {
  const numeric = toFiniteNumber(code);
  if (numeric === null) {
    return '';
  }

  const integerCode = Math.trunc(numeric);
  return RAM_TYPE_BY_CODE[integerCode] || '';
}

function resolveRamType(modules) {
  if (!modules.length) {
    return '';
  }

  const detectedTypes = [];
  for (const module of modules) {
    const type = resolveRamTypeFromCode(module.smbiosMemoryType) || resolveRamTypeFromCode(module.memoryType);
    if (type) {
      detectedTypes.push(type);
    }
  }

  const uniqueTypes = Array.from(new Set(detectedTypes));
  if (!uniqueTypes.length) {
    return 'Unknown';
  }

  if (uniqueTypes.length > 1) {
    return 'Mixed';
  }

  return uniqueTypes[0];
}

function resolveRamSpeedMTs(modules) {
  if (!modules.length) {
    return null;
  }

  const speeds = [];
  for (const module of modules) {
    const configuredSpeed = toPositiveNumber(module.configuredClockSpeed);
    const fallbackSpeed = toPositiveNumber(module.speed);
    const effectiveSpeed = configuredSpeed || fallbackSpeed;
    if (effectiveSpeed) {
      speeds.push(effectiveSpeed);
    }
  }

  if (!speeds.length) {
    return null;
  }

  return Math.round(Math.min(...speeds));
}

function resolveRamManufacturer(modules) {
  return uniqueNames(modules.map((module) => module.manufacturer))[0] || '';
}

function resolveRamPartNumber(modules) {
  return uniqueNames(modules.map((module) => module.partNumber))[0] || '';
}

function resolveRamModuleCount(modules) {
  if (!modules.length) {
    return 0;
  }

  const withCapacity = modules.filter((module) => toPositiveNumber(module.capacity));
  if (withCapacity.length) {
    return withCapacity.length;
  }

  return modules.length;
}

function buildRamLabel({ capacityLabel, ramType, speedMTs, vendorLabel }) {
  const segments = [];

  if (capacityLabel) {
    segments.push(capacityLabel);
  }

  if (ramType) {
    segments.push(ramType);
  }

  if (speedMTs) {
    segments.push(`${speedMTs} MT/s`);
  }

  if (vendorLabel) {
    segments.push(vendorLabel);
  }

  return segments.join(' • ');
}

function summarizeRam(modules, totalBytes) {
  const normalizedModules = normalizeRamModules(modules);
  const capacityLabel = formatRamLabel(totalBytes);
  const ramType = resolveRamType(normalizedModules);
  const speedMTs = resolveRamSpeedMTs(normalizedModules);
  const manufacturer = resolveRamManufacturer(normalizedModules);
  const partNumber = resolveRamPartNumber(normalizedModules);
  const moduleCount = resolveRamModuleCount(normalizedModules);
  const vendorLabel = manufacturer || partNumber;

  return {
    type: ramType,
    speedMTs,
    manufacturer,
    partNumber,
    moduleCount,
    label: buildRamLabel({
      capacityLabel,
      ramType,
      speedMTs,
      vendorLabel
    })
  };
}

function pickBoardName(boards) {
  const candidates = [];

  for (const board of toArray(boards)) {
    if (!board || typeof board !== 'object') {
      continue;
    }

    const manufacturer = sanitizeName(board.manufacturer);
    const product = sanitizeName(board.product);
    const model = sanitizeName(board.model);
    const name = sanitizeName(board.name);

    if (manufacturer && product) {
      candidates.push(`${manufacturer} ${product}`.replace(/\s+/g, ' ').trim());
    }

    if (product) {
      candidates.push(product);
    }

    if (model) {
      candidates.push(model);
    }

    if (name) {
      candidates.push(name);
    }
  }

  return uniqueNames(candidates)[0] || '';
}

function filterGpuNames(gpuNames) {
  const all = uniqueNames(gpuNames);
  if (!all.length) {
    return [];
  }

  const physical = all.filter((name) => !includesAny(normalizeText(name), GPU_NON_PHYSICAL_HINTS));
  return physical.length ? physical : all;
}

function gpuClassScore(name) {
  const normalized = normalizeText(name);

  if (includesAny(normalized, DEDICATED_GPU_HINTS)) {
    return 3;
  }

  if (includesAny(normalized, INTEGRATED_GPU_HINTS)) {
    return 1;
  }

  return 2;
}

function pickPrimaryGpu(gpuNames) {
  if (!gpuNames.length) {
    return '';
  }

  let bestName = gpuNames[0];
  let bestScore = gpuClassScore(bestName);

  for (let index = 1; index < gpuNames.length; index += 1) {
    const candidate = gpuNames[index];
    const score = gpuClassScore(candidate);
    if (score > bestScore) {
      bestName = candidate;
      bestScore = score;
    }
  }

  return bestName;
}

function createEmptySnapshot() {
  return {
    updatedAt: Date.now(),
    cpu: {
      detected: false,
      name: ''
    },
    gpu: {
      detected: false,
      primary: '',
      secondary: [],
      all: []
    },
    ram: {
      detected: false,
      totalBytes: null,
      label: '',
      type: '',
      speedMTs: null,
      manufacturer: '',
      partNumber: '',
      moduleCount: 0
    },
    motherboard: {
      detected: false,
      name: ''
    }
  };
}

function runPowerShell(script, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ];

    const child = spawn(resolveWindowsSystemExecutable('powershell'), args, {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

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

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`PowerShell timed out after ${timeoutMs}ms.`));
        return;
      }

      if (exitCode !== 0) {
        const failure = new Error('PowerShell query failed.');
        failure.details = {
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        };
        reject(failure);
        return;
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

async function runPowerShellJson(script, options = {}) {
  const result = await runPowerShell(script, options);
  if (!result.stdout) {
    return null;
  }

  return JSON.parse(result.stdout);
}

function resolveRootNode(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (Array.isArray(payload.Children)) {
    return payload;
  }

  if (payload.Computer && typeof payload.Computer === 'object') {
    return payload.Computer;
  }

  if (payload.Root && typeof payload.Root === 'object') {
    return payload.Root;
  }

  return payload;
}

function walkTreeWithHardware(node, currentHardware, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const hardwareId = typeof node.HardwareId === 'string' ? node.HardwareId : '';
  const nextHardware = hardwareId
    ? {
        id: hardwareId,
        name: typeof node.Text === 'string' ? node.Text : '',
        image: typeof node.ImageURL === 'string' ? node.ImageURL : ''
      }
    : currentHardware;

  visit(node, nextHardware);

  for (const child of toArray(node.Children)) {
    walkTreeWithHardware(child, nextHardware, visit);
  }
}

function looksLikeGpuHardware(hardware) {
  const id = normalizeText(hardware?.id);
  const name = normalizeText(hardware?.name);
  const image = normalizeText(hardware?.image);

  if (id.includes('gpu') || id.includes('/video')) {
    return true;
  }

  if (image.includes('nvidia') || image.includes('ati') || image.includes('intel')) {
    return true;
  }

  if (
    name.includes('gpu') ||
    name.includes('graphics') ||
    name.includes('nvidia') ||
    name.includes('geforce') ||
    name.includes('radeon') ||
    name.includes('intel arc') ||
    name.includes('iris')
  ) {
    return true;
  }

  return false;
}

async function fetchLhmGpuNames(logger) {
  if (typeof fetch !== 'function') {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(LHM_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const root = resolveRootNode(payload);
    if (!root) {
      return [];
    }

    const gpuNames = [];
    walkTreeWithHardware(root, null, (_node, hardware) => {
      if (!hardware || !looksLikeGpuHardware(hardware)) {
        return;
      }

      if (hardware?.name) {
        gpuNames.push(hardware.name);
      }
    });

    return filterGpuNames(gpuNames);
  } catch (error) {
    logger?.debug?.('GPU fallback query via LHM failed.', {
      message: error?.message || 'Unknown LHM error'
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function osCpuFallback() {
  const cpus = os.cpus();
  if (!Array.isArray(cpus) || !cpus.length) {
    return '';
  }

  return sanitizeName(cpus[0]?.model);
}

function osRamFallback() {
  const total = toFiniteNumber(os.totalmem());
  return total && total > 0 ? total : null;
}

async function collectSnapshot(logger) {
  const snapshot = createEmptySnapshot();

  let windowsPayload = null;
  if (process.platform === 'win32') {
    try {
      windowsPayload = await runPowerShellJson(WINDOWS_HARDWARE_QUERY_SCRIPT);
    } catch (error) {
      logger?.warn?.('Primary Windows hardware query failed.', {
        message: error?.message || 'Unknown PowerShell error'
      });
    }
  }

  const cpuCandidates = uniqueNames(toArray(windowsPayload?.cpu));
  const cpuName = cpuCandidates[0] || osCpuFallback();
  snapshot.cpu = {
    detected: Boolean(cpuName),
    name: cpuName || ''
  };

  const ramFromWindows = toFiniteNumber(windowsPayload?.ramTotalBytes);
  const ramTotalBytes = (ramFromWindows && ramFromWindows > 0) ? ramFromWindows : osRamFallback();
  const ramSummary = summarizeRam(windowsPayload?.ramModules, ramTotalBytes);
  snapshot.ram = {
    detected: Boolean(ramTotalBytes && ramTotalBytes > 0),
    totalBytes: ramTotalBytes && ramTotalBytes > 0 ? ramTotalBytes : null,
    label: ramSummary.label || formatRamLabel(ramTotalBytes),
    type: ramSummary.type,
    speedMTs: ramSummary.speedMTs,
    manufacturer: ramSummary.manufacturer,
    partNumber: ramSummary.partNumber,
    moduleCount: ramSummary.moduleCount
  };

  const motherboardName = pickBoardName(windowsPayload?.baseboards);
  snapshot.motherboard = {
    detected: Boolean(motherboardName),
    name: motherboardName || ''
  };

  const windowsGpuNames = filterGpuNames(toArray(windowsPayload?.gpu));
  const lhmGpuNames = windowsGpuNames.length ? [] : await fetchLhmGpuNames(logger);
  const gpuNames = filterGpuNames([...windowsGpuNames, ...lhmGpuNames]);
  const primaryGpu = pickPrimaryGpu(gpuNames);
  const secondaryGpus = gpuNames.filter((name) => normalizeText(name) !== normalizeText(primaryGpu));

  snapshot.gpu = {
    detected: Boolean(primaryGpu),
    primary: primaryGpu || '',
    secondary: secondaryGpus,
    all: gpuNames
  };

  snapshot.updatedAt = Date.now();
  return snapshot;
}

function createSystemDetectionService(options = {}) {
  const logger = options.logger;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : DEFAULT_CACHE_TTL_MS;

  let cachedSnapshot = null;
  let cacheTimestamp = 0;

  async function getSnapshot(override = {}) {
    const forceRefresh = Boolean(override.forceRefresh);
    const now = Date.now();

    if (!forceRefresh && cachedSnapshot && (now - cacheTimestamp) < cacheTtlMs) {
      return cachedSnapshot;
    }

    try {
      const nextSnapshot = await collectSnapshot(logger);
      cachedSnapshot = nextSnapshot;
      cacheTimestamp = Date.now();
      return nextSnapshot;
    } catch (error) {
      logger?.error?.('Failed to collect system detection snapshot.', {
        message: error?.message || 'Unknown detection error'
      });

      if (cachedSnapshot) {
        return {
          ...cachedSnapshot,
          updatedAt: Date.now()
        };
      }

      return createEmptySnapshot();
    }
  }

  function invalidateCache() {
    cachedSnapshot = null;
    cacheTimestamp = 0;
  }

  return {
    getSnapshot,
    invalidateCache
  };
}

module.exports = {
  createSystemDetectionService
};
