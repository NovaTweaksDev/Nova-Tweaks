const https = require('https');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const DOWNLOAD_URL = 'https://speed.cloudflare.com/__down';
const UPLOAD_URL = 'https://speed.cloudflare.com/__up';
const DOWNLOAD_SIZES = [100_000, 1_000_000, 5_000_000, 15_000_000, 15_000_000];
const UPLOAD_SIZES = [100_000, 1_000_000, 4_000_000, 4_000_000];
const MTU_STATE_FILE = 'mtu-settings.json';

const DIAGNOSTIC_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Invoke-Pings([string]$Target, [int]$Count, [int]$TimeoutMs = 1200) {
  $values = @()
  $ping = [System.Net.NetworkInformation.Ping]::new()
  try {
    1..$Count | ForEach-Object {
      try {
        $reply = $ping.Send($Target, $TimeoutMs)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { $values += [double]$reply.RoundtripTime }
      } catch {}
    }
  } finally { $ping.Dispose() }
  return $values
}
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 |
  Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
  Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
$adapter = if ($route) { Get-NetAdapter -InterfaceIndex $route.InterfaceIndex | Select-Object -First 1 } else { $null }
$ipInterface = if ($route) { Get-NetIPInterface -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1 } else { $null }
$dns = if ($route) { @(Get-DnsClientServerAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4).ServerAddresses } else { @() }
$dnsTarget = @($dns | Where-Object { $_ }) | Select-Object -First 1
$dnsTimes = @()
if ($dnsTarget) {
  1..5 | ForEach-Object {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
      Resolve-DnsName -Name 'one.one.one.one' -Type A -Server $dnsTarget -DnsOnly -QuickTimeout -ErrorAction Stop | Out-Null
      $watch.Stop()
      $dnsTimes += $watch.Elapsed.TotalMilliseconds
    } catch {}
  }
}
$gateway = if ($route) { [string]$route.NextHop } else { $null }
$internetTarget = $null
$internetSamples = @()
$internetExpectedSamples = 0
$bestProbeCount = 0
$bestProbeAverage = [double]::PositiveInfinity
foreach ($target in @('1.1.1.1')) {
  $probe = @(Invoke-Pings $target 3 900)
  $probeAverage = if ($probe.Count -gt 0) { [double](($probe | Measure-Object -Average).Average) } else { [double]::PositiveInfinity }
  if ($probe.Count -gt $bestProbeCount -or ($probe.Count -eq $bestProbeCount -and $probeAverage -lt $bestProbeAverage)) {
    $internetTarget = $target
    $internetSamples = @($probe)
    $bestProbeCount = $probe.Count
    $bestProbeAverage = $probeAverage
  }
}
if ($internetTarget) {
  $internetSamples += @(Invoke-Pings $internetTarget 17)
  $internetExpectedSamples = 20
}
$linkSpeedMbps = $null
if ($adapter -and ([string]$adapter.LinkSpeed) -match '([\d\.,]+)\s*([GMK])bps') {
  $number = [double]($matches[1].Replace(',', '.'))
  $linkSpeedMbps = [math]::Round($number * $(if ($matches[2] -eq 'G') { 1000 } elseif ($matches[2] -eq 'K') { 0.001 } else { 1 }), 0)
}
[pscustomobject]@{
  adapterName = if ($adapter) { $adapter.Name } else { $null }
  adapterDescription = if ($adapter) { $adapter.InterfaceDescription } else { $null }
  interfaceIndex = if ($route) { [int]$route.InterfaceIndex } else { $null }
  currentMtu = if ($ipInterface) { [int]$ipInterface.NlMtu } else { $null }
  hardwareInterface = if ($adapter) { [bool]$adapter.HardwareInterface } else { $false }
  connectionType = if ($adapter -and "$($adapter.NdisPhysicalMedium)" -match 'Wireless') { 'wifi' } elseif ($adapter) { 'ethernet' } else { 'unknown' }
  linkSpeedMbps = $linkSpeedMbps
  gateway = $gateway
  dnsServers = @($dns)
  dnsTarget = $dnsTarget
  dnsExpectedSamples = if ($dnsTarget) { 5 } else { 0 }
  gatewaySamples = if ($gateway) { @(Invoke-Pings $gateway 10) } else { @() }
  gatewayExpectedSamples = if ($gateway) { 10 } else { 0 }
  internetTarget = $internetTarget
  internetSamples = @($internetSamples)
  internetExpectedSamples = $internetExpectedSamples
  dnsSamples = @($dnsTimes)
} | ConvertTo-Json -Depth 5 -Compress
`; 

const MTU_TEST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$routeCandidates = @(& "$env:SystemRoot\System32\route.exe" PRINT -4 0.0.0.0) |
  ForEach-Object {
    if ([string]$_ -match '^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s*$') {
      [pscustomobject]@{ InterfaceAddress = $matches[1]; Metric = [int]$matches[2] }
    }
  } |
  Sort-Object Metric
$activeRoute = $routeCandidates | Select-Object -First 1
$allInterfaces = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()
$networkInterface = if ($activeRoute) {
  $allInterfaces |
    Where-Object {
      @($_.GetIPProperties().UnicastAddresses | Where-Object {
        $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
        $_.Address.ToString() -eq [string]$activeRoute.InterfaceAddress
      }).Count -gt 0
    } |
    Select-Object -First 1
} else { $null }
if (-not $networkInterface) {
  $networkInterface = $allInterfaces |
  Where-Object {
    $_.OperationalStatus -eq [System.Net.NetworkInformation.OperationalStatus]::Up -and
    $_.NetworkInterfaceType -ne [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback -and
    @($_.GetIPProperties().GatewayAddresses | Where-Object {
      $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
      $_.Address.ToString() -ne '0.0.0.0'
    }).Count -gt 0
  } |
  Sort-Object @{ Expression = {
    if ($_.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Ethernet) { 0 }
    elseif ($_.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Wireless80211) { 1 }
    else { 2 }
  }} |
  Select-Object -First 1
}
if (-not $networkInterface) { throw 'no_active_ipv4_route' }
$ipv4 = $networkInterface.GetIPProperties().GetIPv4Properties()
if (-not $ipv4) { throw 'active_adapter_not_found' }
$description = [string]$networkInterface.Description
$interfaceType = [string]$networkInterface.NetworkInterfaceType
$isVirtual = $networkInterface.NetworkInterfaceType -in @(
    [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel,
    [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback,
    [System.Net.NetworkInformation.NetworkInterfaceType]::Unknown
  ) -or
  $description -match '(?i)\b(vpn|tap|tun|wireguard|wintun|hyper-v|virtual|loopback)\b'
if ($isVirtual) {
  [pscustomobject]@{
    available = $false
    reason = 'virtual-adapter'
    interfaceIndex = [int]$ipv4.Index
    adapterName = [string]$networkInterface.Name
    adapterDescription = $description
    currentMtu = [int]$ipv4.Mtu
  } | ConvertTo-Json -Compress
  exit 0
}

$currentMtu = [int]$ipv4.Mtu
$upperPayload = [Math]::Min(1472, [Math]::Max(548, $currentMtu - 28))
$targets = @('1.1.1.1')
$ping = [System.Net.NetworkInformation.Ping]::new()
$bestPayload = 0
$selectedTarget = ''
$attempts = 0
try {
  foreach ($target in $targets) {
    $low = 548
    $high = $upperPayload
    $targetBest = 0
    while ($low -le $high) {
      $candidate = [int][Math]::Floor(($low + $high) / 2)
      $buffer = New-Object byte[] $candidate
      $options = [System.Net.NetworkInformation.PingOptions]::new()
      $options.DontFragment = $true
      $success = $false
      1..2 | ForEach-Object {
        $attempts += 1
        try {
          $reply = $ping.Send($target, 1100, $buffer, $options)
          if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { $success = $true }
        } catch {}
      }
      if ($success) {
        $targetBest = $candidate
        $low = $candidate + 1
      } else {
        $high = $candidate - 1
      }
    }
    if ($targetBest -gt 0) {
      $bestPayload = $targetBest
      $selectedTarget = $target
      break
    }
  }
} finally {
  $ping.Dispose()
}

if ($bestPayload -le 0) {
  [pscustomobject]@{
    available = $false
    reason = 'icmp-unavailable'
    interfaceIndex = [int]$ipv4.Index
    adapterName = [string]$networkInterface.Name
    adapterDescription = $description
    currentMtu = $currentMtu
    attempts = $attempts
  } | ConvertTo-Json -Compress
  exit 0
}

$recommendedMtu = [Math]::Min(1500, $bestPayload + 28)
[pscustomobject]@{
  available = $true
  reason = ''
  interfaceIndex = [int]$ipv4.Index
  adapterName = [string]$networkInterface.Name
  adapterDescription = $description
  currentMtu = $currentMtu
  recommendedMtu = [int]$recommendedMtu
  payloadBytes = [int]$bestPayload
  target = $selectedTarget
  attempts = $attempts
} | ConvertTo-Json -Compress
`;

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeSamples(raw, expected) {
  const samples = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .filter((value) => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === ''))
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const expectedCount = Number.isFinite(Number(expected)) && Number(expected) > 0
    ? Math.max(samples.length, Math.trunc(Number(expected)))
    : 0;
  const differences = samples.slice(1).map((value, index) => Math.abs(value - samples[index]));
  return {
    samples,
    expectedCount,
    receivedCount: samples.length,
    available: samples.length > 0,
    minMs: samples.length ? Math.min(...samples) : null,
    medianMs: median(samples),
    maxMs: samples.length ? Math.max(...samples) : null,
    jitterMs: median(differences),
    packetLossPercent: expectedCount > 0 && samples.length > 0
      ? Math.max(0, Math.min(100, ((expectedCount - samples.length) / expectedCount) * 100))
      : null
  };
}

function bucket(value, thresholds, scores) {
  if (!Number.isFinite(value)) return null;
  if (value <= thresholds[0]) return scores[0];
  if (value <= thresholds[1]) return scores[1];
  if (value <= thresholds[2]) return scores[2];
  return scores[3];
}

function evaluateGamingQuality(metrics = {}) {
  const entries = [
    { value: bucket(metrics.latencyMs, [25, 50, 80], [100, 80, 55, 25]), weight: 0.3 },
    { value: bucket(metrics.jitterMs, [5, 10, 20], [100, 80, 55, 25]), weight: 0.25 },
    { value: bucket(metrics.packetLossPercent, [0, 0.5, 2], [100, 80, 50, 15]), weight: 0.3 },
    { value: bucket(metrics.loadedLatencyIncreaseMs, [20, 50, 100], [100, 80, 50, 20]), weight: 0.15 }
  ].filter((entry) => entry.value !== null);
  if (entries.length < 2) return { score: null, label: 'unavailable' };
  const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let score = Math.round(entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight);
  if (Number(metrics.packetLossPercent) > 5) {
    score = Math.min(score, 35);
  } else if (Number(metrics.packetLossPercent) > 1) {
    score = Math.min(score, 55);
  }
  return { score, label: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor' };
}

function buildRecommendations(result) {
  const recommendations = [];
  if (result.internetProbeAvailable === false) {
    recommendations.push({ id: 'stability-unavailable', tone: 'warning', subcategory: null });
  }
  if (!Number.isFinite(result.dnsLatencyMs)) {
    recommendations.push({ id: 'dns-unavailable', tone: 'warning', subcategory: null });
  } else if (result.dnsLatencyMs > 100) {
    recommendations.push({ id: 'dns', tone: 'warning', subcategory: 'DNS' });
  }
  if (Number(result.loadedLatencyIncreaseMs) > 50) {
    recommendations.push({ id: 'bufferbloat', tone: 'warning', subcategory: 'Network Latency' });
  }
  if (Number.isFinite(result.packetLossPercent) && result.packetLossPercent > 1) {
    const gatewayAvailable = result.gateway?.available === true && Number.isFinite(result.gateway?.medianMs);
    const local = gatewayAvailable &&
      (Number(result.gateway.packetLossPercent) > 0 || Number(result.gateway.medianMs) > 20);
    const id = !gatewayAvailable ? 'loss-location-unknown' : local ? 'local-loss' : 'internet-loss';
    recommendations.push({
      id,
      tone: 'danger',
      subcategory: local ? 'Adapter' : gatewayAvailable ? 'Maintenance' : null
    });
  }
  if (result.connectionType === 'wifi' &&
      ((Number.isFinite(result.jitterMs) && result.jitterMs > 10) ||
       (Number.isFinite(result.packetLossPercent) && result.packetLossPercent > 0))) {
    recommendations.push({ id: 'wifi-stability', tone: 'warning', subcategory: 'Adapter' });
  }
  if (!recommendations.length) recommendations.push({ id: 'healthy', tone: 'success', subcategory: null });
  return recommendations;
}

function runDiagnostics(signal) {
  return new Promise((resolve, reject) => {
    const child = execFile(resolveWindowsSystemExecutable('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DIAGNOSTIC_SCRIPT], {
      encoding: 'utf8', timeout: 35000, windowsHide: true, maxBuffer: 512 * 1024
    }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout.trim())); } catch (parseError) { reject(parseError); }
    });
    signal?.addEventListener('abort', () => {
      child.kill();
      reject(Object.assign(new Error('Network test cancelled.'), { code: 'CANCELLED' }));
    }, { once: true });
  });
}

function runPowerShellJson(script, { signal, timeout = 35000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = execFile(resolveWindowsSystemExecutable('powershell'), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      maxBuffer: 512 * 1024
    }, (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      if (error) {
        error.stderr = String(stderr || '').trim();
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(String(stdout || '').trim()));
      } catch (parseError) {
        reject(parseError);
      }
    });
    signal?.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(Object.assign(new Error('Network test cancelled.'), { code: 'CANCELLED' }));
    }, { once: true });
  });
}

function normalizeMtuResult(raw = {}) {
  const currentMtu = Number(raw.currentMtu);
  const recommendedMtu = Number(raw.recommendedMtu);
  const available = raw.available === true &&
    Number.isInteger(recommendedMtu) &&
    recommendedMtu >= 576 &&
    recommendedMtu <= 1500;
  return {
    available,
    reason: available ? '' : String(raw.reason || 'unavailable'),
    interfaceIndex: Number.isInteger(Number(raw.interfaceIndex)) ? Number(raw.interfaceIndex) : null,
    adapterName: String(raw.adapterName || ''),
    adapterDescription: String(raw.adapterDescription || ''),
    currentMtu: Number.isInteger(currentMtu) ? currentMtu : null,
    recommendedMtu: available ? recommendedMtu : null,
    payloadBytes: available && Number.isInteger(Number(raw.payloadBytes)) ? Number(raw.payloadBytes) : null,
    target: available ? String(raw.target || '') : '',
    attempts: Math.max(0, Number(raw.attempts) || 0),
    status: available
      ? recommendedMtu === currentMtu ? 'optimal' : 'recommended'
      : 'unavailable',
    applied: false,
    canApply: available && recommendedMtu !== currentMtu,
    canReset: false
  };
}

async function runMtuTest(signal) {
  return normalizeMtuResult(await runPowerShellJson(MTU_TEST_SCRIPT, { signal, timeout: 45000 }));
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function buildSetMtuScript({ interfaceIndex, mtu }) {
  const payload = encodePayload({ interfaceIndex, mtu });
  return `
$ErrorActionPreference = 'Stop'
$item = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 |
  Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
  Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
if (-not $route -or [int]$route.InterfaceIndex -ne [int]$item.interfaceIndex) { throw 'active_adapter_changed' }
$adapter = Get-NetAdapter -InterfaceIndex ([int]$item.interfaceIndex) | Select-Object -First 1
if (-not $adapter -or -not [bool]$adapter.HardwareInterface -or [string]$adapter.InterfaceDescription -match '(?i)\\b(vpn|tap|tun|wireguard|wintun|hyper-v|virtual|loopback)\\b') { throw 'unsafe_adapter' }
$before = Get-NetIPInterface -InterfaceIndex ([int]$item.interfaceIndex) -AddressFamily IPv4 | Select-Object -First 1
Set-NetIPInterface -InterfaceIndex ([int]$item.interfaceIndex) -AddressFamily IPv4 -NlMtuBytes ([int]$item.mtu) -ErrorAction Stop
$after = Get-NetIPInterface -InterfaceIndex ([int]$item.interfaceIndex) -AddressFamily IPv4 | Select-Object -First 1
[pscustomobject]@{
  interfaceIndex = [int]$item.interfaceIndex
  adapterName = [string]$adapter.Name
  previousMtu = [int]$before.NlMtu
  currentMtu = [int]$after.NlMtu
} | ConvertTo-Json -Compress
`;
}

function httpTransfer(url, { method = 'GET', bytes = 0, signal } = {}) {
  return new Promise((resolve, reject) => {
    const target = method === 'GET' ? `${url}?bytes=${bytes}&t=${Date.now()}` : url;
    const started = process.hrtime.bigint();
    let received = 0;
    let settled = false;
    let request;
    const abortError = () => Object.assign(new Error('Network test cancelled.'), { code: 'CANCELLED' });
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => request?.destroy(abortError());
    request = https.request(target, {
      method,
      headers: method === 'POST'
        ? { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes }
        : { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' }
    }, (response) => {
      const statusCode = Number(response.statusCode);
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        response.on('end', () => settle(reject, new Error(`Network transfer returned HTTP ${statusCode || 'unknown'}.`)));
        return;
      }
      response.on('data', (chunk) => { received += chunk.length; });
      response.on('end', () => {
        if (method === 'GET' && bytes > 0 && received === 0) {
          settle(reject, new Error('Download endpoint returned an empty response.'));
          return;
        }
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        settle(resolve, {
          bps: ((method === 'POST' ? bytes : received) * 8) / Math.max(0.001, seconds),
          latencyMs: seconds * 1000,
          bytesTransferred: method === 'POST' ? bytes : received
        });
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error('Network transfer timed out.')));
    request.on('error', (error) => settle(reject, error));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (method === 'POST') request.end(Buffer.alloc(bytes, 0x61));
    else request.end();
  });
}

async function runSpeedTest({ signal, onPhase = () => {}, transfer = httpTransfer } = {}) {
  const download = [];
  const transferErrors = [];
  const captureTransfer = async (target, operation) => {
    try {
      const result = await operation;
      if (Number(result?.bps) > 0) target.push(result);
    } catch (error) {
      if (error?.code === 'CANCELLED' || signal?.aborted) throw error;
      transferErrors.push(error?.message || 'Network transfer failed.');
    }
  };
  const captureLatencyProbes = async (operations) => {
    const results = await Promise.allSettled(operations);
    const cancelled = results.find((entry) => entry.status === 'rejected' && entry.reason?.code === 'CANCELLED');
    if (cancelled) throw cancelled.reason;
    return results
      .filter((entry) => entry.status === 'fulfilled' && Number.isFinite(Number(entry.value?.latencyMs)))
      .map((entry) => entry.value);
  };

  let loadedDownload = [];
  for (let index = 0; index < DOWNLOAD_SIZES.length; index += 1) {
    onPhase('download', 48 + Math.round((index / DOWNLOAD_SIZES.length) * 22));
    if (index === DOWNLOAD_SIZES.length - 1) {
      const loadedPromise = captureLatencyProbes([0, 1, 2].map(() => transfer(DOWNLOAD_URL, { bytes: 0, signal })));
      try {
        await captureTransfer(download, transfer(DOWNLOAD_URL, { bytes: DOWNLOAD_SIZES[index], signal }));
      } finally {
        loadedDownload = await loadedPromise;
      }
    } else {
      await captureTransfer(download, transfer(DOWNLOAD_URL, { bytes: DOWNLOAD_SIZES[index], signal }));
    }
  }

  const upload = [];
  let loadedUpload = [];
  for (let index = 0; index < UPLOAD_SIZES.length; index += 1) {
    onPhase('upload', 72 + Math.round((index / UPLOAD_SIZES.length) * 18));
    if (index === UPLOAD_SIZES.length - 1) {
      const loadedPromise = captureLatencyProbes([0, 1, 2].map(() => transfer(DOWNLOAD_URL, { bytes: 0, signal })));
      try {
        await captureTransfer(upload, transfer(UPLOAD_URL, { method: 'POST', bytes: UPLOAD_SIZES[index], signal }));
      } finally {
        loadedUpload = await loadedPromise;
      }
    } else {
      await captureTransfer(upload, transfer(UPLOAD_URL, { method: 'POST', bytes: UPLOAD_SIZES[index], signal }));
    }
  }

  const downloadBps = median(download.slice(-2).map((entry) => entry.bps));
  const uploadBps = median(upload.slice(-2).map((entry) => entry.bps));
  const unavailableDirections = [
    downloadBps === null ? 'download' : '',
    uploadBps === null ? 'upload' : ''
  ].filter(Boolean);

  return {
    downloadMbps: downloadBps === null ? null : downloadBps / 1_000_000,
    uploadMbps: uploadBps === null ? null : uploadBps / 1_000_000,
    loadedLatencyMs: median([...loadedDownload, ...loadedUpload].map((entry) => entry.latencyMs)),
    downloadSampleCount: download.length,
    uploadSampleCount: upload.length,
    loadedLatencySampleCount: loadedDownload.length + loadedUpload.length,
    speedError: unavailableDirections.length
      ? `${unavailableDirections.join(' and ')} measurement unavailable${transferErrors.length ? `: ${transferErrors[0]}` : '.'}`
      : '',
    transferredBytes: [...download, ...upload]
      .reduce((total, entry) => total + Math.max(0, Number(entry.bytesTransferred) || 0), 0)
  };
}

function createExtendedNetworkTestService(options = {}) {
  const diagnosticProvider = options.diagnosticProvider || runDiagnostics;
  const speedProvider = options.speedProvider || runSpeedTest;
  const mtuProvider = options.mtuProvider || runMtuTest;
  const mtuCommandProvider = options.mtuCommandProvider || ((script) => runPowerShellJson(script, { timeout: 30000 }));
  const privilegedExecutor = typeof options.privilegedExecutor === 'function' ? options.privilegedExecutor : null;
  const mtuStatePath = String(options.mtuStatePath || path.join(process.cwd(), MTU_STATE_FILE));
  const onUpdate = options.onUpdate || (() => {});
  let controller = null;
  let state = { status: 'idle', phase: 'ready', progress: 0, result: null, error: '' };
  const emit = (patch) => {
    state = { ...state, ...patch };
    onUpdate({ ...state });
    return { ...state };
  };

  async function readMtuState() {
    try {
      const parsed = JSON.parse(await fs.readFile(mtuStatePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : { interfaces: {} };
    } catch (_error) {
      return { interfaces: {} };
    }
  }

  async function writeMtuState(snapshot) {
    const stateDirectory = path.dirname(mtuStatePath);
    await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await fs.chmod(stateDirectory, 0o700);
    }
    const temporaryPath = `${mtuStatePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.rename(temporaryPath, mtuStatePath);
    if (process.platform !== 'win32') {
      await fs.chmod(mtuStatePath, 0o600);
    }
  }

  async function addResetState(mtu) {
    const snapshot = await readMtuState();
    const saved = snapshot.interfaces?.[String(mtu.interfaceIndex)];
    return {
      ...mtu,
      applied: Boolean(saved && Number(saved.appliedMtu) === Number(mtu.currentMtu)),
      canReset: Boolean(saved && Number.isInteger(Number(saved.previousMtu)))
    };
  }

  function updateMtuState(nextMtu) {
    if (!state.result) return { ...state };
    return emit({
      result: {
        ...state.result,
        mtu: nextMtu
      }
    });
  }

  async function start() {
    if (state.status === 'running') return { ok: false, code: 'NETWORK_TEST_RUNNING', state: { ...state } };
    controller = new AbortController();
    emit({ status: 'running', phase: 'preflight', progress: 5, result: null, error: '' });
    try {
      const diagnostic = await diagnosticProvider(controller.signal);
      emit({ phase: 'mtu', progress: 32 });
      let mtu;
      try {
        mtu = await addResetState(normalizeMtuResult(await mtuProvider(controller.signal)));
      } catch (error) {
        if (error?.code === 'CANCELLED' || controller.signal.aborted) throw error;
        mtu = normalizeMtuResult({ available: false, reason: 'test-failed' });
      }
      emit({ phase: 'stability', progress: 42 });
      let speed = {};
      try {
        speed = await speedProvider({ signal: controller.signal, onPhase: (phase, progress) => emit({ phase, progress }) });
      } catch (error) {
        if (error?.code === 'CANCELLED' || controller.signal.aborted) throw error;
        speed = { speedError: error?.message || 'Speed measurement unavailable.' };
      }
      emit({ phase: 'analysis', progress: 95 });
      const internetExpectedSamples = Number.isFinite(Number(diagnostic.internetExpectedSamples))
        ? Math.max(0, Math.trunc(Number(diagnostic.internetExpectedSamples)))
        : 20;
      const gatewayExpectedSamples = Number.isFinite(Number(diagnostic.gatewayExpectedSamples))
        ? Math.max(0, Math.trunc(Number(diagnostic.gatewayExpectedSamples)))
        : 10;
      const dnsExpectedSamples = Number.isFinite(Number(diagnostic.dnsExpectedSamples))
        ? Math.max(0, Math.trunc(Number(diagnostic.dnsExpectedSamples)))
        : 5;
      const internet = summarizeSamples(diagnostic.internetSamples, internetExpectedSamples);
      const gateway = summarizeSamples(diagnostic.gatewaySamples, gatewayExpectedSamples);
      const dns = summarizeSamples(diagnostic.dnsSamples, dnsExpectedSamples);
      const dnsLatencyMs = dns.medianMs;
      const loadedLatencyIncreaseMs = Number.isFinite(speed.loadedLatencyMs) && Number.isFinite(internet.medianMs)
        ? Math.max(0, speed.loadedLatencyMs - internet.medianMs) : null;
      const result = {
        ...diagnostic,
        gateway,
        latencyMs: internet.medianMs,
        minLatencyMs: internet.minMs,
        maxLatencyMs: internet.maxMs,
        jitterMs: internet.jitterMs,
        packetLossPercent: internet.packetLossPercent,
        pingSamples: internet.samples,
        internetProbeAvailable: internet.available,
        internetProbeExpectedCount: internet.expectedCount,
        internetProbeReceivedCount: internet.receivedCount,
        internetJitterAvailable: internet.receivedCount >= 2,
        gatewayProbeExpectedCount: gateway.expectedCount,
        gatewayProbeReceivedCount: gateway.receivedCount,
        dnsLatencyMs,
        dnsProbeExpectedCount: dns.expectedCount,
        dnsProbeReceivedCount: dns.receivedCount,
        mtu,
        ...speed,
        loadedLatencyIncreaseMs
      };
      result.gaming = evaluateGamingQuality(result);
      result.recommendations = buildRecommendations(result);
      return { ok: true, state: emit({ status: 'complete', phase: 'complete', progress: 100, result }) };
    } catch (error) {
      const cancelled = controller?.signal.aborted || error?.code === 'CANCELLED';
      return { ok: false, code: cancelled ? 'CANCELLED' : 'NETWORK_TEST_FAILED', state: emit({ status: cancelled ? 'cancelled' : 'error', phase: cancelled ? 'cancelled' : 'error', error: cancelled ? '' : error?.message || 'Network test failed.' }) };
    } finally {
      controller = null;
    }
  }
  function cancel() {
    controller?.abort();
    return { ok: true, state: { ...state } };
  }

  async function applyMtu() {
    const mtu = state.result?.mtu;
    if (state.status !== 'complete' || !mtu?.available || !mtu?.canApply) {
      return { ok: false, code: 'MTU_NOT_APPLICABLE', message: 'No MTU recommendation is ready to apply.', state: { ...state } };
    }
    const interfaceIndex = Number(mtu.interfaceIndex);
    const recommendedMtu = Number(mtu.recommendedMtu);
    if (!Number.isInteger(interfaceIndex) || !Number.isInteger(recommendedMtu) || recommendedMtu < 576 || recommendedMtu > 1500) {
      return { ok: false, code: 'MTU_INVALID_RESULT', message: 'The MTU recommendation is invalid.', state: { ...state } };
    }

    const snapshot = await readMtuState();
    snapshot.interfaces ||= {};
    const key = String(interfaceIndex);
    const previousSnapshot = snapshot.interfaces[key];
    snapshot.interfaces[key] = previousSnapshot || {
      interfaceIndex,
      adapterName: mtu.adapterName,
      previousMtu: Number(mtu.currentMtu),
      createdAt: new Date().toISOString()
    };
    snapshot.interfaces[key].appliedMtu = recommendedMtu;
    snapshot.interfaces[key].updatedAt = new Date().toISOString();
    await writeMtuState(snapshot);

    try {
      const result = privilegedExecutor
        ? await privilegedExecutor('network.applyMtu', { interfaceIndex, mtu: recommendedMtu }, { reason: 'network-mtu', timeoutMs: 30000 })
        : await mtuCommandProvider(buildSetMtuScript({ interfaceIndex, mtu: recommendedMtu }));
      if (Number(result?.currentMtu) !== recommendedMtu) {
        throw new Error('mtu_verification_failed');
      }
      const nextMtu = {
        ...mtu,
        currentMtu: recommendedMtu,
        status: 'optimal',
        applied: true,
        canApply: false,
        canReset: true
      };
      return { ok: true, result, state: updateMtuState(nextMtu) };
    } catch (error) {
      if (previousSnapshot) {
        snapshot.interfaces[key] = previousSnapshot;
      } else {
        delete snapshot.interfaces[key];
      }
      await writeMtuState(snapshot);
      return {
        ok: false,
        code: String(error?.stderr || error?.message || '').toLowerCase().includes('access') ? 'ADMIN_REQUIRED' : 'MTU_APPLY_FAILED',
        message: 'The recommended MTU could not be applied.',
        state: { ...state }
      };
    }
  }

  async function resetMtu() {
    const mtu = state.result?.mtu;
    const interfaceIndex = Number(mtu?.interfaceIndex);
    if (!Number.isInteger(interfaceIndex)) {
      return { ok: false, code: 'MTU_RESET_NOT_AVAILABLE', message: 'No saved MTU setting is available.', state: { ...state } };
    }
    const snapshot = await readMtuState();
    const key = String(interfaceIndex);
    const saved = snapshot.interfaces?.[key];
    const previousMtu = Number(saved?.previousMtu);
    if (!Number.isInteger(previousMtu) || previousMtu < 576 || previousMtu > 1500) {
      return { ok: false, code: 'MTU_RESET_NOT_AVAILABLE', message: 'No saved MTU setting is available.', state: { ...state } };
    }
    try {
      const result = privilegedExecutor
        ? await privilegedExecutor('network.resetMtu', { interfaceIndex, mtu: previousMtu }, { reason: 'network-mtu-reset', timeoutMs: 30000 })
        : await mtuCommandProvider(buildSetMtuScript({ interfaceIndex, mtu: previousMtu }));
      if (Number(result?.currentMtu) !== previousMtu) {
        throw new Error('mtu_reset_verification_failed');
      }
      delete snapshot.interfaces[key];
      await writeMtuState(snapshot);
      const nextMtu = {
        ...mtu,
        currentMtu: previousMtu,
        status: previousMtu === Number(mtu.recommendedMtu) ? 'optimal' : 'recommended',
        applied: false,
        canApply: previousMtu !== Number(mtu.recommendedMtu),
        canReset: false
      };
      return { ok: true, result, state: updateMtuState(nextMtu) };
    } catch (error) {
      return {
        ok: false,
        code: String(error?.stderr || error?.message || '').toLowerCase().includes('access') ? 'ADMIN_REQUIRED' : 'MTU_RESET_FAILED',
        message: 'The previous MTU could not be restored.',
        state: { ...state }
      };
    }
  }

  return { start, cancel, applyMtu, resetMtu, getState: () => ({ ...state }) };
}

module.exports = {
  buildRecommendations,
  buildSetMtuScript,
  createExtendedNetworkTestService,
  evaluateGamingQuality,
  normalizeMtuResult,
  runMtuTest,
  runSpeedTest,
  summarizeSamples
};
