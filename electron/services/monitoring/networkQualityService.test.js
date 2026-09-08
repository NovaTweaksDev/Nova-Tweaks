const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkQualityService, normalizeMeasurement } = require('./networkQualityService');

test('keeps measured ICMP packet loss including a real zero percent result', async () => {
  const service = createNetworkQualityService({
    platform: 'win32',
    measureProvider: async () => ({
      adapterName: 'Ethernet',
      target: '1.1.1.1',
      gatewayTarget: '192.168.1.1',
      latencyMs: 14,
      gatewayLatencyMs: 1,
      packetLossPercent: 0,
      sent: 4,
      received: 4,
      status: 'ok',
      method: 'icmp'
    })
  });

  const quality = await service.refreshNow();

  assert.equal(quality.latencyMs, 14);
  assert.equal(quality.packetLossPercent, 0);
  assert.equal(quality.sent, 4);
  assert.equal(quality.received, 4);
  assert.equal(quality.status, 'ok');
  assert.equal(quality.method, 'icmp');
});

test('does not publish packet loss when TCP is only a latency fallback', () => {
  const quality = normalizeMeasurement({
    target: '1.1.1.1',
    latencyMs: 18,
    packetLossPercent: 0,
    sent: 4,
    received: 0,
    status: 'blocked',
    method: 'tcp-fallback'
  }, '1.1.1.1', '2026-05-27T12:00:00.000Z');

  assert.equal(quality.latencyMs, 18);
  assert.equal(quality.packetLossPercent, null);
  assert.equal(quality.status, 'blocked');
  assert.equal(quality.method, 'tcp-fallback');
});

test('returns cached quality while a five second refresh interval has not elapsed', async () => {
  let currentTime = 1000;
  let measurements = 0;
  const service = createNetworkQualityService({
    platform: 'win32',
    intervalMs: 5000,
    nowProvider: () => currentTime,
    measureProvider: async () => {
      measurements += 1;
      return {
        target: '1.1.1.1',
        latencyMs: 10,
        packetLossPercent: 0,
        sent: 4,
        received: 4,
        status: 'ok',
        method: 'icmp'
      };
    }
  });

  await service.refreshNow();
  currentTime = 4000;
  service.getLatest();
  await Promise.resolve();

  assert.equal(measurements, 1);
  assert.equal(service.getLatest().latencyMs, 10);
});
