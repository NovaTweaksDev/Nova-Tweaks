const test = require('node:test');
const assert = require('node:assert/strict');
const { createOverviewSnapshotService, collectWindowsSnapshot } = require('./overviewSnapshotService');

test('optional hardware timeout preserves live counters and identifies only the failed details', async () => {
  let calls = 0;
  const live = { drives: [{ driveLetter: 'C:' }], network: [{ name: 'Ethernet' }], processes: [{ pid: 10, cpuSeconds: 1 }], errors: [] };
  const snapshot = await collectWindowsSnapshot(async () => {
    calls += 1;
    if (calls === 2) throw new Error('Hardware timeout');
    return live;
  });
  assert.deepEqual(snapshot.processes, live.processes);
  assert.deepEqual(snapshot.network, live.network);
  assert.deepEqual(snapshot.drives, live.drives);
  assert.deepEqual(snapshot.errors, ['Windows hardware details are temporarily unavailable.']);
  assert.ok(snapshot.sampledAt > 0);
});

test('independent hardware results enrich only the matching volume and a live query failure still rejects', async () => {
  let calls = 0;
  const snapshot = await collectWindowsSnapshot(async () => ++calls === 1
    ? { drives: [{ driveLetter: 'C:' }, { driveLetter: 'D:' }], processes: [] }
    : { processors: [{ cores: 8 }], storageByLetter: { 'C:': { model: 'Disk Alpha', healthStatus: 'Healthy' } } });
  assert.equal(snapshot.drives[0].diskModel, 'Disk Alpha');
  assert.equal(snapshot.drives[1].diskModel, undefined);
  assert.equal(snapshot.processors[0].cores, 8);
  assert.deepEqual(snapshot.errors, []);
  calls = 0;
  await assert.rejects(collectWindowsSnapshot(async () => {
    if (++calls === 1) throw new Error('Live query failed');
    return {};
  }), /Live query failed/);
});

test('selected refresh interval updates live counters without waiting for the hardware TTL', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let queries = 0;
  const service = createService(async () => { queries += 1; return { processes: [] }; }, { windowsTtlMs: 30000 });
  await service.buildSnapshot({ refreshRateMs: 1000 });
  t.mock.timers.tick(999);
  await service.buildSnapshot({ refreshRateMs: 1000 }); assert.equal(queries, 1);
  t.mock.timers.tick(2);
  await service.buildSnapshot({ refreshRateMs: 1000 }); assert.equal(queries, 2);
});

test('cached process counters retain their last computed activity instead of producing a false zero', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let queries = 0;
  const service = createService(async () => ({ processes: [{ pid: 10, startTime: 'first', cpuSeconds: ++queries * 10 }] }), { windowsTtlMs: 30000 });
  await service.buildSnapshot({}); t.mock.timers.tick(30001);
  const measured = await service.buildSnapshot({});
  assert.ok(measured.processes[0].cpuPercent > 0);
  t.mock.timers.tick(1000);
  const cached = await service.buildSnapshot({});
  assert.equal(queries, 2);
  assert.deepEqual(cached.processes, measured.processes);
});

test('process ID reuse and denied CPU counters do not invent activity', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let current = { pid: 10, startTime: 'first', cpuSeconds: 1 };
  const service = createService(async () => ({ processes: [{ ...current }] }));
  await service.buildSnapshot({}); t.mock.timers.tick(2000);
  current = { pid: 10, startTime: 'second', cpuSeconds: 10000 };
  const reused = await service.buildSnapshot({});
  assert.equal(reused.processes[0].cpuPercent, null);
  t.mock.timers.tick(2000); current.cpuSeconds = null;
  const denied = await service.buildSnapshot({});
  assert.equal(denied.processes[0].cpuPercent, null);
});

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

function createService(windowsSnapshotProvider, options = {}) {
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
    },
    ...options
  });
}

test('volume fallback survives sampler timeout, shares in-flight reads and retries after the existing TTL', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let queries = 0, volumes = 0, recover = false;
  const service = createService(async () => {
    queries += 1;
    if (!recover) throw new Error('Windows sampler timed out');
    return { drives: [{ driveLetter: 'C:', capacityBytes: 2048, freeBytes: 1024, diskModel: 'Disk Alpha' }] };
  }, {
    windowsTtlMs: 30000,
    windowsVolumesProvider: async () => {
      volumes += 1;
      return [{ driveLetter: 'C:', capacityBytes: 2048, freeBytes: 0, fileSystem: 'NTFS' },
        { driveLetter: 'E:', capacityBytes: null, freeBytes: null, type: 'Removable' }];
    }
  });
  const build = () => service.buildSnapshot({ metrics: { monitoring: 'online' } });
  const snapshots = await Promise.all([build(), build()]);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.storage.length, 2);
    assert.equal(snapshot.storage[0].usagePercent, 100, 'Actual zero free bytes must be retained.');
    assert.equal(snapshot.storage[0].healthStatus, 'Unknown');
    assert.equal(snapshot.storage[0].temperatureC, null);
    assert.equal(snapshot.storage[1].capacityGB, null, 'Unreadable media is not zero capacity.');
    assert.ok(snapshot.system.errors.includes('Windows live counters are unavailable.'));
  }
  assert.equal(queries, 1); assert.equal(volumes, 1);
  const cached = await build();
  assert.equal(queries, 1); assert.equal(volumes, 1);
  assert.ok(cached.system.errors.includes('Windows live counters are unavailable.'));
  recover = true; t.mock.timers.tick(30001);
  const recovered = await build();
  assert.equal(queries, 2); assert.equal(volumes, 1);
  assert.equal(recovered.storage[0].diskModel, 'Disk Alpha');
  assert.equal(recovered.system.errors.includes('Windows live counters are unavailable.'), false);
});

test('failed volume fallback preserves previously verified storage', async () => {
  let fail = false;
  const service = createService(async () => {
    if (fail) throw new Error('Windows timeout');
    return { drives: [{ driveLetter: 'C:', capacityBytes: 2048, freeBytes: 1024 }] };
  }, { windowsVolumesProvider: async () => { throw new Error('Volume query failed'); } });
  const first = await service.buildSnapshot({}); fail = true;
  const failed = await service.buildSnapshot({});
  assert.deepEqual(failed.storage, first.storage);
  assert.ok(failed.system.errors.includes('Windows live counters are unavailable.'));
});

test('initial failures are throttled and do not invent storage devices', async () => {
  let queries = 0, volumes = 0;
  const service = createService(async () => { queries += 1; throw new Error('Windows timeout'); }, {
    windowsTtlMs: 30000,
    windowsVolumesProvider: async () => { volumes += 1; throw new Error('Volume query failed'); }
  });
  const first = await service.buildSnapshot({});
  const second = await service.buildSnapshot({});
  assert.deepEqual(first.storage, []); assert.deepEqual(second.storage, []);
  assert.equal(queries, 1); assert.equal(volumes, 1);
  assert.ok(second.system.errors.includes('Windows live counters are unavailable.'));
});

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
