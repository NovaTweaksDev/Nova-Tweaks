function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function safeRawNumber(rawValue) {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }

  return null;
}

const GPU_LOAD_SENSOR_NAMES = [
  'gpu core',
  'gpu',
  'gpu total',
  'gpu package',
  'gpu usage',
  'gpu utilization'
];

const GPU_FALLBACK_LOAD_SENSOR_NAMES = [
  'GPU Core',
  'GPU',
  'GPU Total',
  'GPU Package',
  'GPU Usage',
  'GPU Utilization',
  'D3D 3D',
  '3D'
];

const DEDICATED_GPU_ID_HINTS = [
  'gpu-nvidia',
  'nvidiagpu',
  'gpu-intel/',
  '/gpu-intel/',
  'discretegpu',
  '/dgpu/'
];

const INTEGRATED_GPU_ID_HINTS = [
  'gpu-intel-integrated',
  'intelgpu',
  '/igpu/',
  'integratedgpu'
];

const DEDICATED_GPU_NAME_HINTS = [
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

const INTEGRATED_GPU_NAME_HINTS = [
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

const NON_PHYSICAL_NIC_HINTS = [
  'virtual',
  'vmware',
  'hyper-v',
  'vethernet',
  'docker',
  'wsl',
  'vpn',
  'wireguard',
  'wintun',
  'tap',
  'tun',
  'zerotier',
  'hamachi',
  'loopback',
  'bluetooth',
  'npcap'
];

const TOTAL_MEMORY_HINTS = [
  'total memory',
  'physical memory',
  'system memory'
];

const VIRTUAL_MEMORY_HINTS = [
  'virtual memory',
  'commit memory',
  'swap',
  'page file',
  'pagefile'
];

function includesAny(text, hints) {
  if (!text) {
    return false;
  }

  return hints.some((hint) => text.includes(hint));
}

function resolveRoot(payload) {
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

function walkTree(node, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }

  try {
    visit(node);
  } catch (_error) {
    // Parser must never crash due to malformed nodes.
  }

  for (const child of toArray(node.Children)) {
    walkTree(child, visit);
  }
}

function walkTreeWithHardwareContext(node, currentHardware, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const hardwareId = typeof node.HardwareId === 'string' ? node.HardwareId : '';
  const nextHardware = hardwareId
    ? {
        id: hardwareId,
        text: typeof node.Text === 'string' ? node.Text : '',
        imageUrl: typeof node.ImageURL === 'string' ? node.ImageURL : ''
      }
    : currentHardware;

  try {
    visit(node, nextHardware);
  } catch (_error) {
    // Parser must never crash due to malformed nodes.
  }

  for (const child of toArray(node.Children)) {
    walkTreeWithHardwareContext(child, nextHardware, visit);
  }
}

function isSensorMatch(node, sensorText, sensorType) {
  return normalizeText(node?.Text) === normalizeText(sensorText) &&
         normalizeText(node?.Type) === normalizeText(sensorType);
}

function findSensorRawValue(payload, sensorText, sensorType) {
  const root = resolveRoot(payload);
  if (!root) {
    return null;
  }

  let match = null;

  walkTree(root, (node) => {
    if (match !== null) {
      return;
    }

    if (!isSensorMatch(node, sensorText, sensorType)) {
      return;
    }

    match = safeRawNumber(node?.RawValue);
  });

  return match;
}

function findSensorRawValues(payload, sensorText, sensorType) {
  const root = resolveRoot(payload);
  if (!root) {
    return [];
  }

  const matches = [];

  walkTreeWithHardwareContext(root, null, (node, hardware) => {
    if (!isSensorMatch(node, sensorText, sensorType)) {
      return;
    }

    const value = safeRawNumber(node?.RawValue);
    if (value === null) {
      return;
    }

    matches.push({
      value,
      sensorText: typeof node?.Text === 'string' ? node.Text : '',
      sensorType: typeof node?.Type === 'string' ? node.Type : '',
      sensorId: typeof node?.SensorId === 'string' ? node.SensorId : '',
      hardwareId: typeof hardware?.id === 'string' ? hardware.id : '',
      hardwareName: typeof hardware?.text === 'string' ? hardware.text : '',
      hardwareImageUrl: typeof hardware?.imageUrl === 'string' ? hardware.imageUrl : ''
    });
  });

  return matches;
}

function looksLikeNetworkHardware(hardwareId, hardwareName, sensorId) {
  const id = normalizeText(hardwareId);
  const name = normalizeText(hardwareName);
  const normalizedSensorId = normalizeText(sensorId);

  if (id.includes('/nic/') || normalizedSensorId.includes('/nic/')) {
    return true;
  }

  if (
    name.includes('ethernet') ||
    name.includes('wi-fi') ||
    name.includes('wifi') ||
    name.includes('wlan') ||
    name.includes('network') ||
    name.includes('adapter') ||
    name.includes('lan')
  ) {
    return true;
  }

  return false;
}

function collectNetworkThroughputCandidates(payload, sensorText) {
  const root = resolveRoot(payload);
  if (!root) {
    return [];
  }

  const candidates = [];

  walkTreeWithHardwareContext(root, null, (node, hardware) => {
    if (normalizeText(node?.Type) !== 'throughput') {
      return;
    }

    if (normalizeText(node?.Text) !== normalizeText(sensorText)) {
      return;
    }

    const rawValue = safeRawNumber(node?.RawValue);
    if (rawValue === null) {
      return;
    }

    const sensorId = typeof node?.SensorId === 'string' ? node.SensorId : '';
    const hardwareId = typeof hardware?.id === 'string' ? hardware.id : '';
    const hardwareName = typeof hardware?.text === 'string' ? hardware.text : '';

    if (!looksLikeNetworkHardware(hardwareId, hardwareName, sensorId)) {
      return;
    }

    candidates.push({
      value: Math.max(0, rawValue),
      hardwareId,
      hardwareName,
      sensorId
    });
  });

  return candidates;
}

function isPhysicalNicCandidate(candidate) {
  const name = normalizeText(candidate?.hardwareName);
  const id = normalizeText(candidate?.hardwareId);
  const sensorId = normalizeText(candidate?.sensorId);

  return !includesAny(name, NON_PHYSICAL_NIC_HINTS) &&
         !includesAny(id, NON_PHYSICAL_NIC_HINTS) &&
         !includesAny(sensorId, NON_PHYSICAL_NIC_HINTS);
}

function sumCandidateValues(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  let total = 0;
  for (const candidate of candidates) {
    total += Math.max(0, safeRawNumber(candidate?.value) ?? 0);
  }

  return Number.isFinite(total) ? total : null;
}

function findPreferredNetworkRate(payload, sensorText) {
  const candidates = collectNetworkThroughputCandidates(payload, sensorText);
  if (!candidates.length) {
    return null;
  }

  const physicalCandidates = candidates.filter(isPhysicalNicCandidate);
  if (physicalCandidates.length) {
    return sumCandidateValues(physicalCandidates);
  }

  return sumCandidateValues(candidates);
}

function looksLikeGpuHardware(hardwareId, hardwareName, hardwareImageUrl, sensorId) {
  const id = normalizeText(hardwareId);
  const name = normalizeText(hardwareName);
  const image = normalizeText(hardwareImageUrl);
  const normalizedSensorId = normalizeText(sensorId);

  if (id.includes('gpu') || normalizedSensorId.includes('/gpu')) {
    return true;
  }

  if (image.includes('nvidia.png') || image.includes('ati.png') || image.includes('intel.png')) {
    return true;
  }

  if (
    name.includes('gpu') ||
    name.includes('graphics') ||
    name.includes('nvidia') ||
    name.includes('radeon') ||
    name.includes('geforce') ||
    name.includes('intel arc')
  ) {
    return true;
  }

  return false;
}

function isCandidateGpuLoadSensor(sensorText, sensorId) {
  const text = normalizeText(sensorText);
  const id = normalizeText(sensorId);
  if (!text) {
    return false;
  }

  if (GPU_LOAD_SENSOR_NAMES.includes(text)) {
    return true;
  }

  if (text.startsWith('gpu ')) {
    return true;
  }

  if (text === 'd3d 3d' || text === '3d' || text.startsWith('d3d ')) {
    return true;
  }

  if (text.includes('gpu') && (text.includes('usage') || text.includes('utilization') || text.includes('load'))) {
    return true;
  }

  if (id.includes('/load/0') && text.includes('gpu')) {
    return true;
  }

  return false;
}

function collectGpuLoadCandidates(payload) {
  const root = resolveRoot(payload);
  if (!root) {
    return [];
  }

  const matches = [];

  walkTreeWithHardwareContext(root, null, (node, hardware) => {
    if (normalizeText(node?.Type) !== 'load') {
      return;
    }

    const value = safeRawNumber(node?.RawValue);
    if (value === null) {
      return;
    }

    const sensorText = typeof node?.Text === 'string' ? node.Text : '';
    const sensorId = typeof node?.SensorId === 'string' ? node.SensorId : '';
    const hardwareId = typeof hardware?.id === 'string' ? hardware.id : '';
    const hardwareName = typeof hardware?.text === 'string' ? hardware.text : '';
    const hardwareImageUrl = typeof hardware?.imageUrl === 'string' ? hardware.imageUrl : '';

    if (!looksLikeGpuHardware(hardwareId, hardwareName, hardwareImageUrl, sensorId)) {
      return;
    }

    if (!isCandidateGpuLoadSensor(sensorText, sensorId)) {
      return;
    }

    matches.push({
      value,
      sensorText,
      sensorId,
      hardwareId,
      hardwareName,
      hardwareImageUrl
    });
  });

  return matches;
}

function classifyGpuType(candidate) {
  const id = normalizeText(candidate?.hardwareId);
  const name = normalizeText(candidate?.hardwareName);
  const image = normalizeText(candidate?.hardwareImageUrl);

  if (includesAny(id, INTEGRATED_GPU_ID_HINTS)) {
    return 'integrated';
  }

  if (includesAny(id, DEDICATED_GPU_ID_HINTS)) {
    return 'dedicated';
  }

  if (includesAny(name, DEDICATED_GPU_NAME_HINTS)) {
    return 'dedicated';
  }

  if (includesAny(name, INTEGRATED_GPU_NAME_HINTS)) {
    return 'integrated';
  }

  if (id.includes('gpu-intel')) {
    if (name.includes('arc')) {
      return 'dedicated';
    }
    return 'integrated';
  }

  if (image.includes('nvidia.png') || name.includes('nvidia')) {
    return 'dedicated';
  }

  if (image.includes('intel.png') || id.includes('intel')) {
    if (name.includes('arc')) {
      return 'dedicated';
    }
    return 'integrated';
  }

  if (
    id.includes('gpu-amd') ||
    id.includes('amdgpu') ||
    id.includes('atigpu') ||
    image.includes('ati.png') ||
    name.includes('amd') ||
    name.includes('radeon')
  ) {
    if (includesAny(name, DEDICATED_GPU_NAME_HINTS)) {
      return 'dedicated';
    }

    if (includesAny(name, INTEGRATED_GPU_NAME_HINTS)) {
      return 'integrated';
    }

    return 'unknown';
  }

  return 'unknown';
}

function gpuClassScore(gpuType) {
  if (gpuType === 'dedicated') {
    return 300;
  }

  if (gpuType === 'unknown') {
    return 200;
  }

  if (gpuType === 'integrated') {
    return 100;
  }

  return 1;
}

function sensorQualityScore(candidate) {
  const text = normalizeText(candidate?.sensorText);
  const sensorId = normalizeText(candidate?.sensorId);

  if (text === 'gpu core') {
    return 100;
  }

  if (text === 'gpu') {
    return 96;
  }

  if (text === 'gpu total' || text === 'gpu package') {
    return 92;
  }

  if (text.includes('gpu') && (text.includes('usage') || text.includes('utilization') || text.includes('load'))) {
    return 88;
  }

  if (text.startsWith('gpu ')) {
    return 82;
  }

  if (text === 'd3d 3d' || text === '3d') {
    return 72;
  }

  if (text.startsWith('d3d ') && text.includes('3d')) {
    return 64;
  }

  if (text.startsWith('d3d ')) {
    return 48;
  }

  let score = 16;
  if (sensorId.includes('/load/0')) {
    score += 8;
  }

  if (text.includes('gpu')) {
    score += 6;
  }

  return score;
}

function findFallbackGpuLoad(payload) {
  for (const sensorName of GPU_FALLBACK_LOAD_SENSOR_NAMES) {
    const value = findSensorRawValue(payload, sensorName, 'Load');
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function findPreferredGpuLoad(payload) {
  const candidates = collectGpuLoadCandidates(payload);
  if (!candidates.length) {
    return findFallbackGpuLoad(payload);
  }

  let preferred = candidates[0];
  let preferredScore = (gpuClassScore(classifyGpuType(preferred)) * 1000) + sensorQualityScore(preferred);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = (gpuClassScore(classifyGpuType(candidate)) * 1000) + sensorQualityScore(candidate);
    if (score > preferredScore) {
      preferred = candidate;
      preferredScore = score;
    }
  }

  return preferred.value;
}

function isPlausibleTemperature(value) {
  return Number.isFinite(value) && value > 0 && value <= 150;
}

function looksLikeCpuHardware(hardwareId, hardwareName, sensorId) {
  const id = normalizeText(hardwareId);
  const name = normalizeText(hardwareName);
  const normalizedSensorId = normalizeText(sensorId);

  return id.includes('cpu') ||
    normalizedSensorId.includes('/cpu') ||
    name.includes('cpu') ||
    name.includes('processor') ||
    name.includes('ryzen') ||
    name.includes('intel core');
}

function looksLikeGpuTemperatureHardware(hardwareId, sensorId) {
  const id = normalizeText(hardwareId);
  const normalizedSensorId = normalizeText(sensorId);

  return id.includes('gpu') || normalizedSensorId.includes('/gpu');
}

function collectTemperatureCandidates(payload, hardwareType) {
  const root = resolveRoot(payload);
  if (!root) {
    return [];
  }

  const matches = [];
  walkTreeWithHardwareContext(root, null, (node, hardware) => {
    if (normalizeText(node?.Type) !== 'temperature') {
      return;
    }

    const value = safeRawNumber(node?.RawValue);
    if (!isPlausibleTemperature(value)) {
      return;
    }

    const sensorText = typeof node?.Text === 'string' ? node.Text : '';
    const sensorId = typeof node?.SensorId === 'string' ? node.SensorId : '';
    const hardwareId = typeof hardware?.id === 'string' ? hardware.id : '';
    const hardwareName = typeof hardware?.text === 'string' ? hardware.text : '';
    const hardwareImageUrl = typeof hardware?.imageUrl === 'string' ? hardware.imageUrl : '';
    const text = normalizeText(sensorText);
    const matchesHardware = hardwareType === 'gpu'
      ? looksLikeGpuTemperatureHardware(hardwareId, sensorId)
      : looksLikeCpuHardware(hardwareId, hardwareName, sensorId) || text.includes('cpu package') || text.includes('tctl');

    if (!matchesHardware) {
      return;
    }

    matches.push({ value, sensorText, sensorId, hardwareId, hardwareName, hardwareImageUrl });
  });

  return matches;
}

function cpuTemperatureSensorScore(candidate) {
  const text = normalizeText(candidate?.sensorText);
  if (text === 'cpu package') return 100;
  if (text.includes('tctl') || text.includes('tdie')) return 96;
  if (text === 'package') return 92;
  if (text.includes('core average')) return 88;
  if (text.includes('core max')) return 84;
  if (text.includes('core')) return 72;
  return 40;
}

function gpuTemperatureSensorScore(candidate) {
  const text = normalizeText(candidate?.sensorText);
  if (text === 'gpu core' || text === 'gpu temperature') return 100;
  if (text === 'gpu package') return 94;
  if (text.includes('hot spot') || text.includes('hotspot')) return 82;
  if (text.startsWith('gpu ')) return 72;
  return 40;
}

function pickPreferredTemperature(candidates, scoreCandidate) {
  if (!candidates.length) {
    return null;
  }

  let preferred = candidates[0];
  let preferredScore = scoreCandidate(preferred);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreCandidate(candidate);
    if (score > preferredScore || (score === preferredScore && candidate.value > preferred.value)) {
      preferred = candidate;
      preferredScore = score;
    }
  }

  return preferred.value;
}

function findPreferredCpuTemperature(payload) {
  return pickPreferredTemperature(collectTemperatureCandidates(payload, 'cpu'), cpuTemperatureSensorScore);
}

function findPreferredGpuTemperature(payload) {
  return pickPreferredTemperature(
    collectTemperatureCandidates(payload, 'gpu'),
    (candidate) => (gpuClassScore(classifyGpuType(candidate)) * 1000) + gpuTemperatureSensorScore(candidate)
  );
}

function isVirtualMemoryCandidate(candidate) {
  const name = normalizeText(candidate.hardwareName);
  const id = normalizeText(candidate.hardwareId);
  const sensorId = normalizeText(candidate.sensorId);

  return includesAny(name, VIRTUAL_MEMORY_HINTS) ||
         includesAny(id, VIRTUAL_MEMORY_HINTS) ||
         includesAny(sensorId, VIRTUAL_MEMORY_HINTS);
}

function memorySensorScore(candidate) {
  const name = normalizeText(candidate.hardwareName);
  const id = normalizeText(candidate.hardwareId);
  const sensorId = normalizeText(candidate.sensorId);

  let score = 0;

  if (name === 'total memory') {
    score += 1000;
  }

  if (includesAny(name, TOTAL_MEMORY_HINTS)) {
    score += 400;
  }

  if (name.includes('memory')) {
    score += 40;
  }

  if (id.includes('/memory/')) {
    score += 20;
  }

  if (sensorId.includes('/memory/')) {
    score += 10;
  }

  if (isVirtualMemoryCandidate(candidate)) {
    score -= 2000;
  }

  return score;
}

function findPreferredMemoryUsed(payload) {
  const candidates = findSensorRawValues(payload, 'Memory Used', 'Data');
  if (!candidates.length) {
    return null;
  }

  let preferred = candidates[0];
  let preferredScore = memorySensorScore(preferred);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = memorySensorScore(candidate);
    if (score > preferredScore) {
      preferred = candidate;
      preferredScore = score;
    }
  }

  return preferred.value;
}

function parseMonitoringSensors(payload) {
  try {
    return {
      cpuLoad: findSensorRawValue(payload, 'CPU Total', 'Load'),
      gpuLoad: findPreferredGpuLoad(payload),
      cpuTemp: findPreferredCpuTemperature(payload),
      gpuTemp: findPreferredGpuTemperature(payload),
      memoryUsedGB: findPreferredMemoryUsed(payload),
      networkIn: findPreferredNetworkRate(payload, 'Download Speed'),
      networkOut: findPreferredNetworkRate(payload, 'Upload Speed')
    };
  } catch (_error) {
    return {
      cpuLoad: null,
      gpuLoad: null,
      cpuTemp: null,
      gpuTemp: null,
      memoryUsedGB: null,
      networkIn: null,
      networkOut: null
    };
  }
}

function hasSensorIdentity(node) {
  return typeof node?.Type === 'string' &&
    typeof node?.Text === 'string' &&
    safeRawNumber(node?.RawValue) !== null;
}

function classifyHardware(hardware = {}) {
  const id = normalizeText(hardware.id);
  const name = normalizeText(hardware.text || hardware.name);
  const image = normalizeText(hardware.imageUrl || hardware.image);

  if (id.includes('cpu') || name.includes('cpu') || name.includes('processor') || name.includes('ryzen') || name.includes('intel core')) {
    return 'cpu';
  }

  if (looksLikeGpuHardware(id, name, image, '')) {
    return 'gpu';
  }

  if (id.includes('/memory') || name.includes('memory') || name.includes('ram')) {
    return 'memory';
  }

  if (id.includes('/hdd') || id.includes('/storage') || name.includes('ssd') || name.includes('hdd') || name.includes('nvme') || name.includes('drive')) {
    return 'storage';
  }

  if (looksLikeNetworkHardware(id, name, '')) {
    return 'network';
  }

  if (id.includes('mainboard') || id.includes('motherboard') || name.includes('motherboard') || name.includes('mainboard') || name.includes('chipset')) {
    return 'motherboard';
  }

  if (id.includes('fan') || name.includes('fan') || name.includes('controller')) {
    return 'cooling';
  }

  return 'other';
}

function normalizeSensorUnit(sensorType, sensorText) {
  const type = normalizeText(sensorType);
  const text = normalizeText(sensorText);

  if (type === 'temperature') return 'C';
  if (type === 'load' || type === 'control' || type === 'level') return '%';
  if (type === 'clock') return 'MHz';
  if (type === 'power') return 'W';
  if (type === 'voltage') return 'V';
  if (type === 'fan') return 'RPM';
  if (type === 'throughput') return text.includes('speed') ? 'B/s' : '';
  if (type === 'data') return 'GB';
  if (type === 'smalldata') return 'MB';
  if (type === 'timing') return 'ns';
  return '';
}

function collectOverviewSensors(payload) {
  const root = resolveRoot(payload);
  if (!root) {
    return {
      hardware: [],
      sensors: []
    };
  }

  const hardwareMap = new Map();
  const sensors = [];

  walkTreeWithHardwareContext(root, null, (node, hardware) => {
    if (hardware?.id) {
      const existing = hardwareMap.get(hardware.id);
      if (!existing) {
        hardwareMap.set(hardware.id, {
          id: hardware.id,
          name: hardware.text || '',
          type: classifyHardware(hardware),
          imageUrl: hardware.imageUrl || '',
          sensors: []
        });
      }
    }

    if (!hasSensorIdentity(node)) {
      return;
    }

    const hardwareId = typeof hardware?.id === 'string' ? hardware.id : '';
    const sensor = {
      id: typeof node.SensorId === 'string' ? node.SensorId : `${hardwareId}:${node.Type}:${node.Text}`,
      name: node.Text,
      type: node.Type,
      value: safeRawNumber(node.RawValue),
      unit: normalizeSensorUnit(node.Type, node.Text),
      hardwareId,
      hardwareName: typeof hardware?.text === 'string' ? hardware.text : '',
      hardwareType: classifyHardware(hardware || {})
    };

    sensors.push(sensor);

    if (hardwareId && hardwareMap.has(hardwareId)) {
      hardwareMap.get(hardwareId).sensors.push(sensor);
    }
  });

  return {
    hardware: Array.from(hardwareMap.values()),
    sensors
  };
}

module.exports = {
  safeRawNumber,
  findSensorRawValue,
  findSensorRawValues,
  findPreferredGpuLoad,
  findPreferredCpuTemperature,
  findPreferredGpuTemperature,
  parseMonitoringSensors,
  collectOverviewSensors
};
