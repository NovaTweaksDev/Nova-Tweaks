const { execFile } = require('child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_PROBE_COUNT = 4;
const DEFAULT_PROBE_TIMEOUT_MS = 900;
const DEFAULT_TARGETS = ['1.1.1.1', '8.8.8.8'];
const ALLOWED_STATUSES = new Set(['ok', 'degraded', 'timeout', 'unavailable', 'blocked']);
const ALLOWED_METHODS = new Set(['icmp', 'tcp-fallback']);

const NETWORK_QUALITY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$Targets = @($env:NOVA_NETWORK_QUALITY_TARGETS.Split(',') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$ProbeCount = [int]$env:NOVA_NETWORK_QUALITY_PROBE_COUNT
$TimeoutMs = [int]$env:NOVA_NETWORK_QUALITY_TIMEOUT_MS

function Get-ActiveGateway {
  try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
      Sort-Object RouteMetric, InterfaceMetric |
      Select-Object -First 1
    if ($null -ne $route) {
      $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
      return [pscustomobject]@{
        adapterName = if ($null -ne $adapter) { $adapter.Name } else { "Interface $($route.InterfaceIndex)" }
        adapterDescription = if ($null -ne $adapter) { $adapter.InterfaceDescription } else { $null }
        gatewayTarget = [string]$route.NextHop
      }
    }
  } catch {
  }

  $candidates = @()
  foreach ($interface in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($interface.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
    if ($interface.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }
    if ($interface.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel) { continue }
    try {
      $gateway = $interface.GetIPProperties().GatewayAddresses |
        ForEach-Object { $_.Address } |
        Where-Object {
          $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
          $_.ToString() -ne '0.0.0.0'
        } |
        Select-Object -First 1
      if ($null -eq $gateway) { continue }
      $descriptor = "$($interface.Name) $($interface.Description)"
      $candidates += [pscustomobject]@{
        adapterName = $interface.Name
        adapterDescription = $interface.Description
        gatewayTarget = $gateway.ToString()
        isVirtual = [bool]($descriptor -match '(?i)virtual|hyper-v|vmware|virtualbox|docker|wsl|vpn|wireguard|wintun|tap|tun|zerotier|hamachi|loopback')
      }
    } catch {
    }
  }

  return $candidates | Sort-Object isVirtual | Select-Object -First 1
}

function Invoke-IcmpSamples {
  param([string]$Target, [int]$Count, [int]$Timeout)

  $times = [System.Collections.Generic.List[double]]::new()
  $ping = [System.Net.NetworkInformation.Ping]::new()
  try {
    for ($index = 0; $index -lt $Count; $index += 1) {
      try {
        $reply = $ping.Send($Target, $Timeout)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
          $times.Add([double]$reply.RoundtripTime)
        }
      } catch {
      }
    }
  } finally {
    $ping.Dispose()
  }

  $received = $times.Count
  return [pscustomobject]@{
    target = $Target
    sent = $Count
    received = $received
    latencyMs = if ($received -gt 0) { [math]::Round(($times | Measure-Object -Average).Average, 1) } else { $null }
    packetLossPercent = if ($received -gt 0) { [math]::Round((($Count - $received) * 100.0) / $Count, 1) } else { $null }
  }
}

function Measure-TcpLatency {
  param([string]$Target, [int]$Timeout)

  $client = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $connection = $client.ConnectAsync($Target, 443)
    if (-not $connection.Wait($Timeout)) { return $null }
    $watch.Stop()
    if ($client.Connected) {
      return [math]::Round([double]$watch.Elapsed.TotalMilliseconds, 1)
    }
  } catch {
  } finally {
    if ($null -ne $client) { $client.Dispose() }
  }
  return $null
}

$adapter = Get-ActiveGateway
$gatewayMeasurement = if ($null -ne $adapter -and $adapter.gatewayTarget) {
  Invoke-IcmpSamples -Target $adapter.gatewayTarget -Count 1 -Timeout $TimeoutMs
} else {
  $null
}

$selectedMeasurement = $null
foreach ($target in $Targets) {
  $measurement = Invoke-IcmpSamples -Target $target -Count $ProbeCount -Timeout $TimeoutMs
  if ($null -eq $selectedMeasurement) { $selectedMeasurement = $measurement }
  if ($measurement.received -gt 0) {
    $selectedMeasurement = $measurement
    break
  }
}

$targetUsed = if ($null -ne $selectedMeasurement) { $selectedMeasurement.target } else { $Targets[0] }
$latencyMs = $null
$packetLossPercent = $null
$method = 'icmp'
$status = 'unavailable'

if ($null -ne $selectedMeasurement -and $selectedMeasurement.received -gt 0) {
  $latencyMs = $selectedMeasurement.latencyMs
  $packetLossPercent = $selectedMeasurement.packetLossPercent
  $status = if ($packetLossPercent -gt 0 -or $latencyMs -gt 120) { 'degraded' } else { 'ok' }
} elseif ($null -ne $selectedMeasurement) {
  foreach ($target in $Targets) {
    $tcpLatency = Measure-TcpLatency -Target $target -Timeout $TimeoutMs
    if ($null -ne $tcpLatency) {
      $targetUsed = $target
      $latencyMs = $tcpLatency
      $method = 'tcp-fallback'
      $status = 'blocked'
      break
    }
  }
  if ($method -eq 'icmp') { $status = 'timeout' }
}

[pscustomobject]@{
  adapterName = if ($null -ne $adapter) { $adapter.adapterName } else { $null }
  adapterDescription = if ($null -ne $adapter) { $adapter.adapterDescription } else { $null }
  target = $targetUsed
  gatewayTarget = if ($null -ne $adapter) { $adapter.gatewayTarget } else { $null }
  latencyMs = $latencyMs
  gatewayLatencyMs = if ($null -ne $gatewayMeasurement) { $gatewayMeasurement.latencyMs } else { $null }
  packetLossPercent = $packetLossPercent
  sent = if ($null -ne $selectedMeasurement) { $selectedMeasurement.sent } else { 0 }
  received = if ($null -ne $selectedMeasurement) { $selectedMeasurement.received } else { 0 }
  status = $status
  method = $method
} | ConvertTo-Json -Compress
`;

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asNonNegativeInteger(value) {
  const number = asFiniteNumber(value);
  return number === null ? 0 : Math.max(0, Math.round(number));
}

function sanitizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createUnavailableQuality(target = null, status = 'unavailable', lastChecked = null) {
  return {
    adapterName: null,
    adapterDescription: null,
    target,
    gatewayTarget: null,
    latencyMs: null,
    gatewayLatencyMs: null,
    packetLossPercent: null,
    sent: 0,
    received: 0,
    status,
    lastChecked,
    method: 'icmp',
  };
}

function normalizeMeasurement(result, fallbackTarget, lastChecked) {
  const method = ALLOWED_METHODS.has(result?.method) ? result.method : 'icmp';
  const status = ALLOWED_STATUSES.has(result?.status) ? result.status : 'unavailable';
  const sent = asNonNegativeInteger(result?.sent);
  const received = Math.min(sent, asNonNegativeInteger(result?.received));
  const loss = asFiniteNumber(result?.packetLossPercent);

  return {
    adapterName: sanitizeString(result?.adapterName),
    adapterDescription: sanitizeString(result?.adapterDescription),
    target: sanitizeString(result?.target) || fallbackTarget,
    gatewayTarget: sanitizeString(result?.gatewayTarget),
    latencyMs: asFiniteNumber(result?.latencyMs),
    gatewayLatencyMs: asFiniteNumber(result?.gatewayLatencyMs),
    packetLossPercent: method === 'icmp' && received > 0 && loss !== null
      ? Math.min(100, Math.max(0, loss))
      : null,
    sent,
    received,
    status,
    lastChecked,
    method,
  };
}

function runPowerShellMeasurement({ targets, probeCount, probeTimeoutMs }) {
  const executionTimeout = (targets.length * probeCount * probeTimeoutMs)
    + ((targets.length + 1) * probeTimeoutMs)
    + 1500;

  return new Promise((resolve, reject) => {
    execFile(resolveWindowsSystemExecutable('powershell'), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      NETWORK_QUALITY_SCRIPT,
    ], {
      encoding: 'utf8',
      timeout: executionTimeout,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: {
        ...process.env,
        NOVA_NETWORK_QUALITY_TARGETS: targets.join(','),
        NOVA_NETWORK_QUALITY_PROBE_COUNT: String(probeCount),
        NOVA_NETWORK_QUALITY_TIMEOUT_MS: String(probeTimeoutMs),
      },
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function createNetworkQualityService(options = {}) {
  const logger = options.logger || console;
  const platform = options.platform || process.platform;
  const intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
  const probeCount = Math.max(1, Math.round(Number(options.probeCount) || DEFAULT_PROBE_COUNT));
  const probeTimeoutMs = Math.max(250, Math.round(Number(options.probeTimeoutMs) || DEFAULT_PROBE_TIMEOUT_MS));
  const targets = Array.isArray(options.targets) && options.targets.length
    ? options.targets.map(sanitizeString).filter(Boolean)
    : DEFAULT_TARGETS;
  const measureProvider = options.measureProvider || runPowerShellMeasurement;
  const now = options.nowProvider || (() => Date.now());

  let cachedQuality = null;
  let cachedAt = 0;
  let pendingMeasurement = null;
  let lastWarningAt = 0;

  function startMeasurement(force = false) {
    if (platform !== 'win32') {
      if (!cachedQuality) {
        cachedQuality = createUnavailableQuality(targets[0], 'unavailable', new Date(now()).toISOString());
        cachedAt = now();
      }
      return Promise.resolve(cachedQuality);
    }

    if (pendingMeasurement) return pendingMeasurement;
    if (!force && cachedQuality && (now() - cachedAt) < intervalMs) {
      return Promise.resolve(cachedQuality);
    }

    pendingMeasurement = measureProvider({ targets, probeCount, probeTimeoutMs })
      .then((measurement) => {
        cachedAt = now();
        cachedQuality = normalizeMeasurement(measurement, targets[0], new Date(cachedAt).toISOString());
        return cachedQuality;
      })
      .catch((error) => {
        cachedAt = now();
        cachedQuality = createUnavailableQuality(targets[0], 'unavailable', new Date(cachedAt).toISOString());
        if ((cachedAt - lastWarningAt) >= 30000) {
          logger.warn?.(`[network-quality] Measurement unavailable: ${error.message}`);
          lastWarningAt = cachedAt;
        }
        return cachedQuality;
      })
      .finally(() => {
        pendingMeasurement = null;
      });

    return pendingMeasurement;
  }

  function getLatest() {
    void startMeasurement(false);
    return cachedQuality || createUnavailableQuality(targets[0]);
  }

  return {
    getLatest,
    refreshNow: () => startMeasurement(true),
  };
}

module.exports = {
  createNetworkQualityService,
  normalizeMeasurement,
};
