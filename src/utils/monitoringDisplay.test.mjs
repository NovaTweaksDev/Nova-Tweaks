import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAppendMonitoringSample } from './monitoringDisplay.mjs';

test('chart admission rejects heartbeats, status, stale and duplicate measurements', () => {
  const now = 100000;
  const sample = { sampleKind: 'measurement', sampleId: 2, measuredAt: now };
  assert.equal(shouldAppendMonitoringSample(sample, null, now), true);
  assert.equal(shouldAppendMonitoringSample(sample, sample, now), false);
  for (const sampleKind of ['heartbeat', 'status']) {
    assert.equal(shouldAppendMonitoringSample({ ...sample, sampleKind }, null, now), false);
  }
  for (const timestamp of [undefined, null, now + 1, now - 15001]) {
    assert.equal(shouldAppendMonitoringSample({ timestamp }, null, now), false);
  }
  assert.equal(shouldAppendMonitoringSample({ timestamp: now - 15000 }, null, now), true);
  assert.equal(shouldAppendMonitoringSample({ ...sample, measuredAt: now - 1, sampleId: 3 }, sample, now), false);
  assert.equal(shouldAppendMonitoringSample({ ...sample, measuredAt: now + 20000, sampleId: 3 }, sample, now + 20000), true);
});
