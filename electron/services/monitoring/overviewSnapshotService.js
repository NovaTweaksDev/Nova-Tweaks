const os = require('os');
const { execFile } = require('child_process');
const { collectOverviewSensors } = require('./metricsParser');
const { createNetworkQualityService } = require('./networkQualityService');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const HISTORY_LIMIT = 90;
const DEFAULT_WINDOWS_TTL_MS = 30000;
const WINDOWS_QUERY_TIMEOUT_MS = 3500;

const WINDOWS_OVERVIEW_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'function Get-Instances([string]$ClassName) {',
  "  if (Get-Command -Name Get-CimInstance -ErrorAction SilentlyContinue) {",
  "    try { return @(Get-CimInstance -ClassName $ClassName -ErrorAction Stop) } catch {}",
  '  }',
  "  if (Get-Command -Name Get-WmiObject -ErrorAction SilentlyContinue) {",
  "    try { return @(Get-WmiObject -Class $ClassName -ErrorAction Stop) } catch {}",
  '  }',
  '  return @()',
  '}',
  "$processors = @(Get-Instances 'Win32_Processor' | ForEach-Object {",
  '  [PSCustomObject]@{',
  '    name = $_.Name',
  '    cores = $_.NumberOfCores',
  '    logicalProcessors = $_.NumberOfLogicalProcessors',
  '  }',
  '})',
  '$storageByLetter = @{}',
  'try {',
  '  if ((Get-Command -Name Get-Partition -ErrorAction SilentlyContinue) -and (Get-Command -Name Get-Disk -ErrorAction SilentlyContinue)) {',
  '    @(Get-Partition -ErrorAction Stop | Where-Object { $_.DriveLetter }) | ForEach-Object {',
  '      $disk = Get-Disk -Number $_.DiskNumber -ErrorAction Stop',
  '      $storageByLetter[("$($_.DriveLetter):")] = [PSCustomObject]@{',
  '        model = $disk.FriendlyName',
  '        healthStatus = if ($null -ne $disk.HealthStatus) { $disk.HealthStatus.ToString() } else { $null }',
  '        operationalStatus = if ($null -ne $disk.OperationalStatus) { $disk.OperationalStatus.ToString() } else { $null }',
  '      }',
  '    }',
  '  }',
  '} catch {}',
  '$drives = @([System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [System.IO.DriveType]::Fixed -or $_.DriveType -eq [System.IO.DriveType]::Removable } | ForEach-Object {',
  '  $driveLetter = $_.Name.TrimEnd("\\")',
  '  $storage = $storageByLetter[$driveLetter]',
  '  [PSCustomObject]@{',
  '    driveLetter = $driveLetter',
  '    name = if ($_.IsReady) { $_.VolumeLabel } else { "" }',
  '    fileSystem = if ($_.IsReady) { $_.DriveFormat } else { "" }',
  '    type = $_.DriveType.ToString()',
  '    capacityBytes = if ($_.IsReady) { $_.TotalSize } else { $null }',
  '    freeBytes = if ($_.IsReady) { $_.AvailableFreeSpace } else { $null }',
  '    diskModel = if ($storage) { $storage.model } else { "" }',
  '    healthStatus = if ($storage) { $storage.healthStatus } else { $null }',
  '    operationalStatus = if ($storage) { $storage.operationalStatus } else { $null }',
  '  }',
  '})',
  '$net = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.NetworkInterfaceType -ne [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback } | ForEach-Object {',
  '  $stats = $null',
  '  try { $stats = $_.GetIPv4Statistics() } catch {}',
  '  [PSCustomObject]@{',
  '    name = $_.Name',
  '    description = $_.Description',
  '    status = $_.OperationalStatus.ToString()',
  '    linkSpeed = $_.Speed',
  '    receivedBytes = if ($stats) { $stats.BytesReceived } else { $null }',
  '    sentBytes = if ($stats) { $stats.BytesSent } else { $null }',
  '  }',
  '})',
  '$processes = @(Get-Process | ForEach-Object {',
  '  try {',
  '    [PSCustomObject]@{',
  '      name = $_.ProcessName',
  '      pid = $_.Id',
  '      cpuSeconds = $_.CPU',
  '      ramBytes = $_.WorkingSet64',
  '      ioReadBytes = $_.IOReadBytes',
  '      ioWriteBytes = $_.IOWriteBytes',
  '      status = if ($_.Responding -eq $false) { "Not responding" } else { "Running" }',
  '    }',
  '  } catch {}',
  '})',
  '[PSCustomObject]@{',
  '  processors = $processors',
  '  drives = $drives',
  '  network = $net',
  '  processes = $processes',
  '} | ConvertTo-Json -Depth 8 -Compress'
].join('\n');

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = toNumberOrNull(value);
  if (number === null) {
    return null;
  }
  return Math.max(0, Math.min(100, number));
}

function bytesToGb(value) {
  const number = toNumberOrNull(value);
  return number === null || number < 0 ? null : number / (1024 ** 3);
}

function pushHistory(historyMap, key, value, timestamp) {
  if (!historyMap.has(key)) {
    historyMap.set(key, []);
  }

  const history = historyMap.get(key);
  const numeric = toNumberOrNull(value);
  if (numeric !== null) {
    history.push({ timestamp, value: numeric });
    if (history.length > HISTORY_LIMIT) {
      history.splice(0, history.length - HISTORY_LIMIT);
    }
  }

  return history.slice();
}

function runPowerShellJson(script, timeoutMs = WINDOWS_QUERY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      resolveWindowsSystemExecutable('powershell'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }

        try {
          resolve(stdout ? JSON.parse(stdout) : null);
        } catch (parseError) {
          reject(parseError);
        }
      }
    );

    child.stdin?.end?.();
  });
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function sensorValue(sensors, predicate) {
  const match = sensors.find((sensor) => predicate(sensor));
  return match ? toNumberOrNull(match.value) : null;
}

function sensorNameIncludes(sensor, fragments) {
  const name = String(sensor?.name || '').toLowerCase();
  return fragments.some((fragment) => name.includes(fragment));
}

function sensorTypeIs(sensor, type) {
  return String(sensor?.type || '').toLowerCase() === String(type || '').toLowerCase();
}

function firstSensorValue(sensors, type, preferredNames = []) {
  for (const name of preferredNames) {
    const value = sensorValue(sensors, (sensor) => sensorTypeIs(sensor, type) && sensorNameIncludes(sensor, [name]));
    if (value !== null) {
      return value;
    }
  }

  return sensorValue(sensors, (sensor) => sensorTypeIs(sensor, type));
}

function maxSensorValue(sensors, predicate) {
  const values = sensors
    .filter((sensor) => predicate(sensor))
    .map((sensor) => toNumberOrNull(sensor.value))
    .filter((value) => value !== null);

  return values.length ? Math.max(...values) : null;
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findStorageHardwareForDrive(drive, storageHardware, driveCount) {
  const model = normalizeMatchText(drive?.diskModel);
  const volumeName = normalizeMatchText(drive?.name);
  const explicitMatch = storageHardware.find((hardware) => {
    const hardwareName = normalizeMatchText(hardware?.name);
    if (!hardwareName) {
      return false;
    }
    return (model && (hardwareName.includes(model) || model.includes(hardwareName))) ||
      (volumeName && (hardwareName.includes(volumeName) || volumeName.includes(hardwareName)));
  });

  if (explicitMatch) {
    return explicitMatch;
  }

  if (driveCount === 1 && storageHardware.length === 1) {
    return storageHardware[0];
  }

  return null;
}

function readGpuMemoryMB(sensors, metricName) {
  const smallData = sensorValue(
    sensors,
    (sensor) => sensorTypeIs(sensor, 'SmallData') && sensorNameIncludes(sensor, [metricName])
  );
  if (smallData !== null) {
    return smallData;
  }

  const data = sensorValue(
    sensors,
    (sensor) => sensorTypeIs(sensor, 'Data') && sensorNameIncludes(sensor, [metricName])
  );
  return data !== null ? data * 1024 : null;
}

function isRelevantTemperatureSensor(sensor) {
  if (!sensorTypeIs(sensor, 'Temperature')) {
    return false;
  }

  const value = toNumberOrNull(sensor.value);
  const name = String(sensor.name || '').toLowerCase();
  if (value === null || value <= 0 || value > 150) {
    return false;
  }

  return !['resolution', 'limit', 'threshold', 'critical', 'warning', 'maximum', 'minimum'].some((fragment) => name.includes(fragment));
}

function readMemoryTimings(sensors) {
  const timingNames = ['taa', 'trcd', 'trp', 'tras'];
  const timings = timingNames.map((name) => sensorValue(
    sensors,
    (sensor) => sensorTypeIs(sensor, 'Timing') && String(sensor.name || '').toLowerCase().startsWith(name)
  ));

  return timings.every((value) => value !== null) ? timings : [];
}

function classifyNetworkAdapter(adapter) {
  const name = `${adapter?.name || ''} ${adapter?.description || ''}`.toLowerCase();
  if (
    name.includes('virtual') ||
    name.includes('hyper-v') ||
    name.includes('vmware') ||
    name.includes('docker') ||
    name.includes('wsl') ||
    name.includes('loopback') ||
    name.includes('vpn') ||
    name.includes('bluetooth') ||
    name.includes('tap') ||
    name.includes('tun')
  ) {
    return 'virtual';
  }
  return 'physical';
}

function calculateCpuUsage(previousCpuTimes) {
  const cpus = os.cpus();
  if (!Array.isArray(cpus) || !cpus.length) {
    return { usagePercent: null, nextCpuTimes: null };
  }

  const totals = cpus.map((cpu) => {
    const times = cpu.times || {};
    const idle = Number(times.idle) || 0;
    const total = Object.values(times).reduce((sum, value) => sum + (Number(value) || 0), 0);
    return { idle, total };
  });

  if (!Array.isArray(previousCpuTimes) || previousCpuTimes.length !== totals.length) {
    return { usagePercent: null, nextCpuTimes: totals };
  }

  let idleDelta = 0;
  let totalDelta = 0;
  for (let index = 0; index < totals.length; index += 1) {
    idleDelta += Math.max(0, totals[index].idle - previousCpuTimes[index].idle);
    totalDelta += Math.max(0, totals[index].total - previousCpuTimes[index].total);
  }

  const usagePercent = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : null;
  return { usagePercent: clampPercent(usagePercent), nextCpuTimes: totals };
}

function createOverviewSnapshotService(options = {}) {
  const logger = options.logger;
  const systemDetectionService = options.systemDetectionService || null;
  const isAdminProvider = typeof options.isAdminProvider === 'function' ? options.isAdminProvider : () => false;
  const windowsTtlMs = Number.isFinite(options.windowsTtlMs) ? options.windowsTtlMs : DEFAULT_WINDOWS_TTL_MS;
  const platform = options.platform || process.platform;
  const windowsSnapshotProvider = typeof options.windowsSnapshotProvider === 'function'
    ? options.windowsSnapshotProvider
    : () => runPowerShellJson(WINDOWS_OVERVIEW_SCRIPT);
  const networkQualityService = options.networkQualityService || createNetworkQualityService({
    logger,
    platform
  });

  const historyMap = new Map();
  let previousCpuTimes = null;
  let previousNetworkStats = new Map();
  let previousProcessStats = new Map();
  let windowsCache = null;
  let windowsCacheAt = 0;
  let windowsQueryPromise = null;
  let windowsWarningAt = 0;

  async function getWindowsSnapshot(errors) {
    if (platform !== 'win32') {
      return null;
    }

    const now = Date.now();
    if (windowsCache && now - windowsCacheAt < windowsTtlMs) {
      return windowsCache;
    }

    if (!windowsQueryPromise) {
      windowsQueryPromise = windowsSnapshotProvider()
        .then((payload) => {
          windowsCache = payload || {};
          windowsCacheAt = Date.now();
          return windowsCache;
        })
        .catch((error) => {
          errors.push('Windows live counters are unavailable.');
          windowsCacheAt = Date.now();
          if (Date.now() - windowsWarningAt > 30000) {
            windowsWarningAt = Date.now();
            logger?.warn?.('Overview Windows sampler failed.', {
              message: error?.message || 'Unknown PowerShell error'
            });
          }
          return windowsCache;
        })
        .finally(() => {
          windowsQueryPromise = null;
        });
    }

    return windowsQueryPromise;
  }

  function buildNetworkSnapshot(windowsNetwork, metrics, timestamp) {
    const adapters = normalizeArray(windowsNetwork)
      .filter((adapter) => adapter && typeof adapter === 'object')
      .map((adapter) => {
        const receivedBytes = toNumberOrNull(adapter.receivedBytes);
        const sentBytes = toNumberOrNull(adapter.sentBytes);
        const key = String(adapter.name || adapter.description || 'adapter');
        const previous = previousNetworkStats.get(key);
        const elapsedSeconds = previous ? Math.max(0.5, (timestamp - previous.timestamp) / 1000) : null;
        const downloadMbps = previous && previous.receivedBytes !== null && receivedBytes !== null && receivedBytes >= previous.receivedBytes
          ? ((receivedBytes - previous.receivedBytes) * 8) / elapsedSeconds / 1_000_000
          : null;
        const uploadMbps = previous && previous.sentBytes !== null && sentBytes !== null && sentBytes >= previous.sentBytes
          ? ((sentBytes - previous.sentBytes) * 8) / elapsedSeconds / 1_000_000
          : null;

        if (receivedBytes !== null || sentBytes !== null) {
          previousNetworkStats.set(key, {
            receivedBytes,
            sentBytes,
            timestamp
          });
        }

        return {
          interfaceName: adapter.name || null,
          name: adapter.description || adapter.name || 'Network adapter',
          status: adapter.status || 'Unknown',
          adapterType: classifyNetworkAdapter(adapter),
          linkSpeedMbps: toNumberOrNull(adapter.linkSpeed) !== null ? toNumberOrNull(adapter.linkSpeed) / 1_000_000 : null,
          downloadMbps,
          uploadMbps,
          history: pushHistory(historyMap, `network:${key}:download`, downloadMbps, timestamp),
          uploadHistory: pushHistory(historyMap, `network:${key}:upload`, uploadMbps, timestamp)
        };
      });

    const physicalAdapters = adapters.filter((adapter) => adapter.adapterType === 'physical');
    const onlinePhysicalAdapters = physicalAdapters.filter((adapter) => String(adapter.status || '').toLowerCase() === 'up');
    const visibleAdapters = onlinePhysicalAdapters.length ? onlinePhysicalAdapters : physicalAdapters.length ? physicalAdapters : adapters;
    if (visibleAdapters.length) {
      return visibleAdapters;
    }

    const lhmDownload = toNumberOrNull(metrics?.networkIn);
    const lhmUpload = toNumberOrNull(metrics?.networkOut);
    if (lhmDownload !== null || lhmUpload !== null) {
      return [{
        interfaceName: null,
        name: 'Network',
        status: 'Online',
        adapterType: 'unknown',
        linkSpeedMbps: null,
        downloadMbps: lhmDownload !== null ? (lhmDownload * 8) / 1_000_000 : null,
        uploadMbps: lhmUpload !== null ? (lhmUpload * 8) / 1_000_000 : null,
        history: pushHistory(historyMap, 'network:lhm:download', lhmDownload !== null ? (lhmDownload * 8) / 1_000_000 : null, timestamp),
        uploadHistory: pushHistory(historyMap, 'network:lhm:upload', lhmUpload !== null ? (lhmUpload * 8) / 1_000_000 : null, timestamp)
      }];
    }

    return [];
  }

  function prioritizeQualityAdapter(adapters, quality) {
    const qualityNames = [quality?.adapterName, quality?.adapterDescription]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    if (!qualityNames.length) {
      return adapters;
    }

    const matchesQualityAdapter = (adapter) => {
      const adapterNames = [adapter.interfaceName, adapter.name]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      return adapterNames.some((value) => qualityNames.includes(value));
    };

    return [...adapters].sort((left, right) => (
      Number(matchesQualityAdapter(right)) - Number(matchesQualityAdapter(left))
    ));
  }

  function buildProcesses(rawProcesses, timestamp) {
    const logicalCores = Math.max(1, os.cpus()?.length || 1);
    const nextProcessStats = new Map();
    const processes = normalizeArray(rawProcesses)
      .filter((processInfo) => processInfo && typeof processInfo === 'object')
      .map((processInfo) => {
        const pid = Number(processInfo.pid);
        const cpuSeconds = toNumberOrNull(processInfo.cpuSeconds);
        const ioReadBytes = toNumberOrNull(processInfo.ioReadBytes);
        const ioWriteBytes = toNumberOrNull(processInfo.ioWriteBytes);
        const previous = Number.isFinite(pid) ? previousProcessStats.get(pid) : null;
        let cpuPercent = null;
        let diskMBs = null;

        if (previous) {
          const elapsedSeconds = Math.max(0.5, (timestamp - previous.timestamp) / 1000);
          if (cpuSeconds !== null && previous.cpuSeconds !== null && cpuSeconds >= previous.cpuSeconds) {
            cpuPercent = clampPercent(((cpuSeconds - previous.cpuSeconds) / elapsedSeconds / logicalCores) * 100);
          }

          if (
            ioReadBytes !== null &&
            ioWriteBytes !== null &&
            previous.ioReadBytes !== null &&
            previous.ioWriteBytes !== null &&
            ioReadBytes >= previous.ioReadBytes &&
            ioWriteBytes >= previous.ioWriteBytes
          ) {
            diskMBs = ((ioReadBytes - previous.ioReadBytes) + (ioWriteBytes - previous.ioWriteBytes)) / elapsedSeconds / (1024 ** 2);
          }
        }

        if (Number.isFinite(pid)) {
          nextProcessStats.set(pid, { cpuSeconds, ioReadBytes, ioWriteBytes, timestamp });
        }

        return {
          name: processInfo.name || 'Process',
          pid: Number.isFinite(pid) ? pid : null,
          cpuPercent,
          gpuPercent: null,
          ramMB: bytesToGb(processInfo.ramBytes) !== null ? bytesToGb(processInfo.ramBytes) * 1024 : null,
          diskMBs,
          networkMbps: null,
          status: processInfo.status || 'Unknown'
        };
      });

    previousProcessStats = nextProcessStats;
    return processes
      .sort((left, right) => {
        const cpuDifference = (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1);
        if (Math.abs(cpuDifference) > 0.01) {
          return cpuDifference;
        }

        const diskDifference = (right.diskMBs ?? -1) - (left.diskMBs ?? -1);
        if (Math.abs(diskDifference) > 0.01) {
          return diskDifference;
        }

        return (right.ramMB ?? 0) - (left.ramMB ?? 0);
      })
      .slice(0, 8);
  }

  function buildStorage(rawDrives, lhmHardware) {
    const storageHardware = lhmHardware.filter((hardware) => hardware.type === 'storage');
    const drives = normalizeArray(rawDrives).filter((drive) => drive && typeof drive === 'object');

    return drives
      .map((drive) => {
        const hardware = findStorageHardwareForDrive(drive, storageHardware, drives.length);
        const storageSensors = hardware?.sensors || [];
        const capacityGB = bytesToGb(drive.capacityBytes);
        const freeGB = bytesToGb(drive.freeBytes);
        const usedGB = capacityGB !== null && freeGB !== null ? Math.max(0, capacityGB - freeGB) : null;
        const usagePercent = capacityGB && usedGB !== null ? clampPercent((usedGB / capacityGB) * 100) : null;
        const temperatureC = firstSensorValue(storageSensors, 'Temperature', ['temperature', 'drive']);
        const readBytes = sensorValue(storageSensors, (sensor) => sensorTypeIs(sensor, 'Throughput') && sensorNameIncludes(sensor, ['read']));
        const writeBytes = sensorValue(storageSensors, (sensor) => sensorTypeIs(sensor, 'Throughput') && sensorNameIncludes(sensor, ['write']));

        return {
          name: drive.name || drive.diskModel || drive.driveLetter || 'Drive',
          diskModel: drive.diskModel || hardware?.name || '',
          driveLetter: drive.driveLetter || '',
          type: drive.type || drive.fileSystem || 'Storage',
          fileSystem: drive.fileSystem || '',
          capacityGB,
          usedGB,
          usagePercent,
          temperatureC,
          readMBs: readBytes !== null ? readBytes / (1024 ** 2) : null,
          writeMBs: writeBytes !== null ? writeBytes / (1024 ** 2) : null,
          healthStatus: drive.healthStatus || drive.operationalStatus || 'Unknown'
        };
      });
  }

  async function buildSnapshot({ rawLhmPayload, metrics, refreshRateMs } = {}) {
    const timestamp = Date.now();
    const errors = [];
    const lhm = collectOverviewSensors(rawLhmPayload);
    const lhmHardware = lhm.hardware || [];
    const lhmSensors = lhm.sensors || [];
    const windowsSnapshot = await getWindowsSnapshot(errors);
    const systemDetection = systemDetectionService?.getSnapshot
      ? await systemDetectionService.getSnapshot().catch(() => null)
      : null;
    const { usagePercent: osCpuUsage, nextCpuTimes } = calculateCpuUsage(previousCpuTimes);
    previousCpuTimes = nextCpuTimes;

    const totalMemoryBytes = toNumberOrNull(systemDetection?.ram?.totalBytes) || os.totalmem();
    const totalMemoryGB = bytesToGb(totalMemoryBytes);
    const usedMemoryGB = toNumberOrNull(metrics?.memoryUsedGB) ?? bytesToGb(totalMemoryBytes - os.freemem());
    const memoryUsagePercent = totalMemoryGB && usedMemoryGB !== null ? clampPercent((usedMemoryGB / totalMemoryGB) * 100) : null;

    const cpuSensors = lhmHardware.filter((hardware) => hardware.type === 'cpu').flatMap((hardware) => hardware.sensors);
    const processors = normalizeArray(windowsSnapshot?.processors);
    const physicalCores = processors.reduce((total, processor) => total + (toNumberOrNull(processor?.cores) || 0), 0) || null;
    const logicalProcessors = processors.reduce((total, processor) => total + (toNumberOrNull(processor?.logicalProcessors) || 0), 0) || null;
    const cpuUsage = toNumberOrNull(metrics?.cpuLoad) ?? osCpuUsage;
    const cpu = {
      name: systemDetection?.cpu?.name || os.cpus()?.[0]?.model || 'CPU',
      usagePercent: cpuUsage,
      temperatureC: toNumberOrNull(metrics?.cpuTemp),
      clockMHz: maxSensorValue(cpuSensors, (sensor) => sensorTypeIs(sensor, 'Clock') && !sensorNameIncludes(sensor, ['bus'])),
      powerW: firstSensorValue(cpuSensors, 'Power', ['package', 'cpu']),
      cores: physicalCores,
      threads: logicalProcessors || os.cpus()?.length || null,
      sensors: cpuSensors.slice(0, 24),
      history: pushHistory(historyMap, 'cpu:usage', cpuUsage, timestamp)
    };

    const primaryGpuName = String(systemDetection?.gpu?.primary || '').toLowerCase();
    const gpuHardware = lhmHardware
      .filter((hardware) => hardware.type === 'gpu')
      .sort((left, right) => {
        if (!primaryGpuName) {
          return 0;
        }
        return Number(String(right.name || '').toLowerCase().includes(primaryGpuName)) -
          Number(String(left.name || '').toLowerCase().includes(primaryGpuName));
      });
    const detectedGpuNames = normalizeArray(systemDetection?.gpu?.all).filter(Boolean);
    const gpus = (gpuHardware.length ? gpuHardware : detectedGpuNames.map((name, index) => ({ id: `detected-gpu-${index}`, name, sensors: [] }))).map((hardware, index) => {
      const sensors = hardware.sensors || [];
      const sensorUsage = firstSensorValue(sensors, 'Load', ['gpu core', 'gpu total', 'gpu usage', 'd3d 3d']);
      const usage = sensorUsage ?? (index === 0 ? toNumberOrNull(metrics?.gpuLoad) : null);
      const memoryUsedMB = readGpuMemoryMB(sensors, 'gpu memory used');
      const memoryTotalMB = readGpuMemoryMB(sensors, 'gpu memory total');
      const sensorTemperature = firstSensorValue(sensors, 'Temperature', ['gpu core', 'gpu temperature', 'gpu package']);

      return {
        name: hardware.name || detectedGpuNames[index] || 'GPU',
        usagePercent: usage,
        temperatureC: sensorTemperature ?? (index === 0 ? toNumberOrNull(metrics?.gpuTemp) : null),
        memoryUsedMB,
        memoryTotalMB,
        powerW: firstSensorValue(sensors, 'Power', ['package', 'board']),
        fanRpm: firstSensorValue(sensors, 'Fan', ['fan 1', 'gpu fan']),
        clockMHz: firstSensorValue(sensors, 'Clock', ['gpu core', 'core']),
        sensors: sensors.slice(0, 24),
        history: pushHistory(historyMap, `gpu:${hardware.id || index}`, usage, timestamp)
      };
    });

    const networkQuality = networkQualityService.getLatest();
    const network = prioritizeQualityAdapter(
      buildNetworkSnapshot(windowsSnapshot?.network, metrics, timestamp),
      networkQuality
    );
    const storage = buildStorage(windowsSnapshot?.drives, lhmHardware);
    const fans = lhmSensors
      .filter((sensor) => sensorTypeIs(sensor, 'Fan'))
      .slice(0, 12)
      .map((sensor) => ({ name: sensor.name, rpm: toNumberOrNull(sensor.value), hardwareName: sensor.hardwareName }));
    const temperatures = lhmSensors
      .filter(isRelevantTemperatureSensor)
      .slice(0, 16)
      .map((sensor) => ({ name: sensor.name, valueC: toNumberOrNull(sensor.value), hardwareName: sensor.hardwareName }));
    const voltages = lhmSensors
      .filter((sensor) => sensorTypeIs(sensor, 'Voltage'))
      .slice(0, 12)
      .map((sensor) => ({ name: sensor.name, valueV: toNumberOrNull(sensor.value), hardwareName: sensor.hardwareName }));

    if (metrics?.monitoring !== 'online') {
      errors.push('LibreHardwareMonitor sensors are unavailable. Basic Windows metrics are still shown.');
    }

    const memory = {
      usedGB: usedMemoryGB,
      totalGB: totalMemoryGB,
      freeGB: totalMemoryGB !== null && usedMemoryGB !== null ? Math.max(0, totalMemoryGB - usedMemoryGB) : bytesToGb(os.freemem()),
      usagePercent: memoryUsagePercent,
      speedMTs: toNumberOrNull(systemDetection?.ram?.speedMTs),
      modules: Number(systemDetection?.ram?.moduleCount) || null,
      type: systemDetection?.ram?.type || '',
      timingsNs: readMemoryTimings(
        lhmHardware
          .filter((hardware) => hardware.type === 'memory' && String(hardware.id || '').toLowerCase().includes('/memory/dimm'))
          .flatMap((hardware) => hardware.sensors)
      ),
      history: pushHistory(historyMap, 'memory:usage', memoryUsagePercent, timestamp)
    };

    return {
      timestamp,
      cpu,
      gpus,
      memory,
      storage,
      network,
      networkQuality,
      cooling: {
        fans,
        temperatures,
        voltages
      },
      processes: buildProcesses(windowsSnapshot?.processes, timestamp),
      system: {
        uptimeSeconds: Math.max(0, os.uptime()),
        lastUpdated: new Date(timestamp).toISOString(),
        refreshRateMs: Number.isFinite(refreshRateMs) ? refreshRateMs : null,
        admin: Boolean(isAdminProvider()),
        errors: Array.from(new Set(errors))
      }
    };
  }

  return {
    buildSnapshot
  };
}

module.exports = {
  createOverviewSnapshotService
};
