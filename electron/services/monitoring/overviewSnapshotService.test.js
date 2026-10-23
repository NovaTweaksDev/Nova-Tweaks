const test = require('node:test');
const assert = require('node:assert/strict');
const { createOverviewSnapshotService } = require('./overviewSnapshotService');

const NETWORK_QUALITY = {
  adapterName: 'Ethernet',
  target: '1.1.1.1',
  gatewayTarget: '192.168.1.1',
  latencyMs: 12,
  gatewayLatencyMs: 1,
  packetLossPercent: 0,
  sent: 4,
  received: 4,
  status: 'ok',
  lastChecked: '2026-05-27T12:00:00.000Z',
  method: 'icmp'
};

function createLhmPayload() {
  return {
    Children: [
      {
        HardwareId: '/gpu-nvidia/0',
        Text: 'Graphics Adapter',
        Children: [
          { Text: 'GPU Core', Type: 'Load', RawValue: 24 },
          { Text: 'GPU Core', Type: 'Temperature', RawValue: 54 },
          { Text: 'GPU Memory Used', Type: 'SmallData', RawValue: 2048 },
          { Text: 'GPU Memory Total', Type: 'SmallData', RawValue: 8192 },
          { Text: 'GPU Fan 1', Type: 'Fan', RawValue: 0 }
        ]
      },
      {
        HardwareId: '/memory/dimm/0',
        Text: 'Memory Module',
        Children: [
          { Text: 'DIMM #1', Type: 'Temperature', RawValue: 38 },
          { Text: 'Warning Temperature', Type: 'Temperature', RawValue: 82 },
          { Text: 'tAA (CAS Latency Time)', Type: 'Timing', RawValue: 16.6 },
          { Text: 'tRCD (RAS to CAS Delay Time)', Type: 'Timing', RawValue: 16.6 },
          { Text: 'tRP (Row Precharge Delay Time)', Type: 'Timing', RawValue: 16.6 },
          { Text: 'tRAS (Active to Precharge Delay Time)', Type: 'Timing', RawValue: 32 }
        ]
      },
      {
        HardwareId: '/hdd/0',
        Text: 'Disk Alpha',
        Children: [
          { Text: 'Temperature', Type: 'Temperature', RawValue: 33 },
          { Text: 'Read Rate', Type: 'Throughput', RawValue: 1048576 }
        ]
      },
      {
        HardwareId: '/hdd/1',
        Text: 'Disk Beta',
        Children: [
          { Text: 'Temperature', Type: 'Temperature', RawValue: 44 },
          { Text: 'Write Rate', Type: 'Throughput', RawValue: 2097152 }
        ]
      }
    ]
  };
}

function createService(windowsSnapshotProvider) {
  return createOverviewSnapshotService({
    platform: 'win32',
    windowsTtlMs: 0,
    windowsSnapshotProvider,
    networkQualityService: {
      getLatest: () => NETWORK_QUALITY
    },
    systemDetectionService: {
      getSnapshot: async () => ({
        cpu: { name: 'Detected Processor' },
        gpu: { primary: 'Graphics Adapter', all: ['Graphics Adapter'] },
        ram: { totalBytes: 32 * (1024 ** 3), speedMTs: 6000, moduleCount: 2, type: 'DDR5' }
      })
    }
  });
}

test('normalizes live GPU, memory, cooling, storage and process measurements without inventing values', async () => {
  let queryCount = 0;
  const service = createService(async () => {
    queryCount += 1;
    return {
      processors: [{ cores: 8, logicalProcessors: 16 }],
      drives: [
        { driveLetter: 'C:', diskModel: 'Disk Alpha', capacityBytes: 1000, freeBytes: 400, healthStatus: 'Healthy' },
        { driveLetter: 'D:', diskModel: 'Disk Beta', capacityBytes: 2000, freeBytes: 500, healthStatus: 'Warning' }
      ],
      network: [],
      processes: [{
        name: 'application',
        pid: 12,
        cpuSeconds: queryCount === 1 ? 10 : 11,
        ramBytes: 1024 * 1024,
        ioReadBytes: queryCount === 1 ? 100 : 1048676,
        ioWriteBytes: queryCount === 1 ? 100 : 100,
        status: 'Running'
      }]
    };
  });
  const payload = createLhmPayload();
  const metrics = { monitoring: 'online', cpuLoad: 15, gpuLoad: 24, memoryUsedGB: 12 };

  await service.buildSnapshot({ rawLhmPayload: payload, metrics, refreshRateMs: 2000 });
  const snapshot = await service.buildSnapshot({ rawLhmPayload: payload, metrics, refreshRateMs: 2000 });

  assert.equal(snapshot.gpus[0].memoryUsedMB, 2048);
  assert.equal(snapshot.gpus[0].memoryTotalMB, 8192);
  assert.equal(snapshot.gpus[0].fanRpm, 0);
  assert.deepEqual(snapshot.memory.timingsNs, [16.6, 16.6, 16.6, 32]);
  assert.deepEqual(snapshot.cooling.temperatures.map((sensor) => sensor.name), ['GPU Core', 'DIMM #1', 'Temperature', 'Temperature']);
  assert.equal(snapshot.storage[0].temperatureC, 33);
  assert.equal(snapshot.storage[1].temperatureC, 44);
  assert.equal(snapshot.storage[0].readMBs, 1);
  assert.equal(snapshot.storage[1].writeMBs, 2);
  assert.notEqual(snapshot.processes[0].cpuPercent, null);
  assert.notEqual(snapshot.processes[0].diskMBs, null);
  assert.deepEqual(snapshot.networkQuality, NETWORK_QUALITY);
});

test('does not assign one storage device sensor values to unmatched drives', async () => {
  const service = createService(async () => ({
    drives: [
      { driveLetter: 'C:', capacityBytes: 1000, freeBytes: 400 },
      { driveLetter: 'D:', capacityBytes: 2000, freeBytes: 500 }
    ],
    network: [],
    processes: []
  }));

  const snapshot = await service.buildSnapshot({
    rawLhmPayload: createLhmPayload(),
    metrics: { monitoring: 'online' },
    refreshRateMs: 2000
  });

  assert.equal(snapshot.storage[0].temperatureC, null);
  assert.equal(snapshot.storage[1].temperatureC, null);
  assert.equal(snapshot.storage[0].healthStatus, 'Unknown');
});

test('shows network quality on the adapter selected by the active default route', async () => {
  const service = createService(async () => ({
    drives: [],
    processes: [],
    network: [
      { name: 'Wi-Fi', description: 'Wireless Adapter', status: 'Up', linkSpeed: 1000000000 },
      { name: 'Ethernet', description: 'Wired Adapter', status: 'Up', linkSpeed: 2500000000 }
    ]
  }));

  const snapshot = await service.buildSnapshot({
    rawLhmPayload: createLhmPayload(),
    metrics: { monitoring: 'online' },
    refreshRateMs: 2000
  });

  assert.equal(snapshot.network[0].interfaceName, 'Ethernet');
  assert.equal(snapshot.networkQuality.gatewayTarget, '192.168.1.1');
});


test('overview histories skip duplicate, heartbeat, status and stale data without zero samples', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const service = createService(async () => ({ network: [], processes: [] }));
  const timestamp = Date.now();
  const metrics = { sampleKind: 'measurement', sampleId: 1, measuredAt: timestamp, timestamp, cpuLoad: 30, memoryUsedGB: 4 };
  const build = (sample) => service.buildSnapshot({ metrics: sample, rawLhmPayload: createLhmPayload() });
  const first = await build(metrics);
  assert.equal(first.cpu.history.length, 1);
  for (const sample of [metrics, { ...metrics, sampleKind: 'heartbeat' },
    { sampleKind: 'status', monitoring: 'offline' }, { ...metrics, sampleId: 2, measuredAt: timestamp - 20000 }]) {
    const next = await build(sample);
    assert.deepEqual(next.cpu.history, first.cpu.history);
    assert.deepEqual(next.memory.history, first.memory.history);
  }
  t.mock.timers.tick(20000);
  const next = await build({ ...metrics, sampleId: 3, measuredAt: Date.now(), cpuLoad: 0 });
  assert.equal(next.cpu.history.length, 2);
  assert.equal(next.cpu.history.at(-1).value, 0);
});


test('overview enrichment that outlives freshness does not append a historical sample', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const service = createService(async () => {
    entered();
    await new Promise((resolve) => { release = resolve; });
    return {};
  });
  const pending = service.buildSnapshot({ metrics: { timestamp: Date.now(), cpuLoad: 90 } });
  await started;
  t.mock.timers.tick(15001);
  release();
  const snapshot = await pending;
  assert.equal(snapshot.timestamp, 100000);
  assert.deepEqual(snapshot.cpu.history, []);
});
