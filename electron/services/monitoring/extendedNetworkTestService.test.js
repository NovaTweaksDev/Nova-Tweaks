const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  buildRecommendations,
  createExtendedNetworkTestService,
  evaluateGamingQuality,
  normalizeMtuResult,
  runSpeedTest,
  summarizeSamples
} = require('./extendedNetworkTestService');

const healthyDiagnostics = {
  internetSamples: Array(20).fill(20),
  gatewaySamples: Array(10).fill(1),
  dnsSamples: [10],
  connectionType: 'ethernet'
};

test('summarizes latency, jitter and packet loss', () => {
  const result = summarizeSamples([10, 12, 14, 12], 5);
  assert.equal(result.medianMs, 12);
  assert.equal(result.packetLossPercent, 20);
  assert.equal(result.jitterMs, 2);
  assert.equal(result.expectedCount, 5);
  assert.equal(result.receivedCount, 4);
  assert.equal(result.available, true);
});

test('does not report total packet loss when the ICMP target returns no samples', () => {
  const result = summarizeSamples([], 20);
  assert.equal(result.medianMs, null);
  assert.equal(result.packetLossPercent, null);
  assert.equal(result.available, false);
});

test('ignores invalid probe values and keeps packet loss bounded', () => {
  const result = summarizeSamples([null, '', -1, '5', 7, Number.NaN], 1);
  assert.deepEqual(result.samples, [5, 7]);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.packetLossPercent, 0);
});

test('scores a healthy gaming connection as excellent', () => {
  assert.deepEqual(evaluateGamingQuality({ latencyMs: 18, jitterMs: 3, packetLossPercent: 0, loadedLatencyIncreaseMs: 12 }), { score: 100, label: 'excellent' });
});

test('caps gaming quality when packet loss is severe', () => {
  assert.deepEqual(
    evaluateGamingQuality({ latencyMs: 6, jitterMs: null, packetLossPercent: 95, loadedLatencyIncreaseMs: 50 }),
    { score: 35, label: 'poor' }
  );
});

test('maps DNS and bufferbloat findings to network subcategories', () => {
  const recommendations = buildRecommendations({ dnsLatencyMs: 160, loadedLatencyIncreaseMs: 80, packetLossPercent: 0, connectionType: 'ethernet' });
  assert.deepEqual(recommendations.map((entry) => entry.subcategory), ['DNS', 'Network Latency']);
});

test('reports unavailable DNS separately from a slow DNS response', () => {
  const recommendations = buildRecommendations({
    internetProbeAvailable: true,
    dnsLatencyMs: null,
    loadedLatencyIncreaseMs: null,
    packetLossPercent: 0,
    connectionType: 'ethernet'
  });
  assert.deepEqual(recommendations.map((entry) => entry.id), ['dns-unavailable']);
  assert.equal(recommendations[0].subcategory, null);
});

test('reports unavailable stability probes instead of a healthy connection', () => {
  const recommendations = buildRecommendations({
    internetProbeAvailable: false,
    dnsLatencyMs: 12,
    loadedLatencyIncreaseMs: null,
    packetLossPercent: null,
    connectionType: 'ethernet'
  });
  assert.deepEqual(recommendations.map((entry) => entry.id), ['stability-unavailable']);
});

test('does not claim the gateway is stable when loss cannot be located', () => {
  const recommendations = buildRecommendations({
    internetProbeAvailable: true,
    dnsLatencyMs: 12,
    loadedLatencyIncreaseMs: null,
    packetLossPercent: 25,
    gateway: {
      available: false,
      medianMs: null,
      packetLossPercent: null
    },
    connectionType: 'ethernet'
  });
  assert.deepEqual(recommendations.map((entry) => entry.id), ['loss-location-unknown']);
});

test('continues with diagnostics when the speed provider is unavailable', async () => {
  const service = createExtendedNetworkTestService({
    diagnosticProvider: async () => healthyDiagnostics,
    speedProvider: async () => { throw new Error('offline'); },
    mtuProvider: async () => ({ available: false, reason: 'icmp-unavailable' })
  });
  const response = await service.start();
  assert.equal(response.ok, true);
  assert.equal(response.state.result.speedError, 'offline');
  assert.equal(response.state.result.gaming.score, 100);
  assert.equal(response.state.result.internetProbeReceivedCount, 20);
  assert.equal(response.state.result.internetProbeExpectedCount, 20);
  assert.equal(response.state.result.gatewayProbeReceivedCount, 10);
  assert.equal(response.state.result.dnsProbeReceivedCount, 1);
});

test('keeps a valid upload result when the download endpoint returns no payload', async () => {
  const result = await runSpeedTest({
    transfer: async (_url, { method = 'GET', bytes = 0 } = {}) => {
      if (method === 'POST') return { bps: 120_000_000, latencyMs: 8 };
      if (bytes === 0) return { bps: 0, latencyMs: 5 };
      return { bps: 0, latencyMs: 8 };
    }
  });

  assert.equal(result.downloadMbps, null);
  assert.equal(result.uploadMbps, 120);
  assert.match(result.speedError, /download measurement unavailable/i);
});

test('reports only bytes from successful speed samples', async () => {
  const result = await runSpeedTest({
    transfer: async (_url, { method = 'GET', bytes = 0 } = {}) => {
      if (method === 'POST') {
        return { bps: 80_000_000, latencyMs: 10, bytesTransferred: bytes };
      }
      if (bytes === 0) {
        return { bps: 0, latencyMs: 5, bytesTransferred: 0 };
      }
      if (bytes === 5_000_000) {
        throw new Error('simulated download failure');
      }
      return { bps: 100_000_000, latencyMs: 8, bytesTransferred: bytes };
    }
  });

  const successfulDownloadBytes = 100_000 + 1_000_000 + 15_000_000 + 15_000_000;
  const successfulUploadBytes = 100_000 + 1_000_000 + 4_000_000 + 4_000_000;
  assert.equal(result.transferredBytes, successfulDownloadBytes + successfulUploadBytes);
  assert.equal(result.downloadSampleCount, 4);
  assert.equal(result.uploadSampleCount, 4);
  assert.equal(result.loadedLatencySampleCount, 6);
});

test('normalizes a verified MTU recommendation', () => {
  assert.deepEqual(normalizeMtuResult({
    available: true,
    interfaceIndex: 12,
    adapterName: 'Ethernet',
    currentMtu: 1500,
    recommendedMtu: 1492,
    payloadBytes: 1464,
    target: '1.1.1.1',
    attempts: 18
  }), {
    available: true,
    reason: '',
    interfaceIndex: 12,
    adapterName: 'Ethernet',
    adapterDescription: '',
    currentMtu: 1500,
    recommendedMtu: 1492,
    payloadBytes: 1464,
    target: '1.1.1.1',
    attempts: 18,
    status: 'recommended',
    applied: false,
    canApply: true,
    canReset: false
  });
});

test('rejects out-of-range MTU results', () => {
  const result = normalizeMtuResult({ available: true, currentMtu: 1500, recommendedMtu: 9000 });
  assert.equal(result.available, false);
  assert.equal(result.canApply, false);
});

test('applies and resets the measured MTU while preserving the original value', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-mtu-test-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const appliedValues = [];
  const service = createExtendedNetworkTestService({
    mtuStatePath: path.join(tempRoot, 'mtu.json'),
    diagnosticProvider: async () => healthyDiagnostics,
    speedProvider: async () => ({ downloadMbps: 100, uploadMbps: 20, loadedLatencyMs: 25 }),
    mtuProvider: async () => ({
      available: true,
      interfaceIndex: 12,
      adapterName: 'Ethernet',
      adapterDescription: 'Test Ethernet Adapter',
      currentMtu: 1500,
      recommendedMtu: 1492,
      payloadBytes: 1464,
      target: '1.1.1.1'
    }),
    mtuCommandProvider: async () => {
      const currentMtu = appliedValues.length === 0 ? 1492 : 1500;
      appliedValues.push(currentMtu);
      return { interfaceIndex: 12, adapterName: 'Ethernet', previousMtu: currentMtu === 1492 ? 1500 : 1492, currentMtu };
    }
  });

  const tested = await service.start();
  assert.equal(tested.state.result.mtu.canApply, true);
  const applied = await service.applyMtu();
  assert.equal(applied.ok, true);
  assert.equal(applied.state.result.mtu.applied, true);
  assert.equal(applied.state.result.mtu.canReset, true);
  const reset = await service.resetMtu();
  assert.equal(reset.ok, true);
  assert.equal(reset.state.result.mtu.currentMtu, 1500);
  assert.equal(reset.state.result.mtu.canReset, false);
  assert.deepEqual(appliedValues, [1492, 1500]);
});
