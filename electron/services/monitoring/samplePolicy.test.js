const test = require('node:test');
const assert = require('node:assert/strict');
const { readMeasurement, isNewMeasurement, networkMeasurementTime } = require('./samplePolicy');

test('measurement admission uses source time, including the exact 15 second boundary', () => {
  const now = 100000;
  for (const timestamp of [undefined, null, 0, NaN, Infinity, '100000', now + 1, now - 15001]) {
    assert.equal(readMeasurement({ timestamp }, now), null);
  }
  assert.deepEqual(readMeasurement({ timestamp: now - 15000 }, now), { measuredAt: 85000, sampleId: null });
  assert.equal(readMeasurement({ sampleKind: 'measurement', timestamp: now }, now), null);
  for (const sampleKind of ['heartbeat', 'status']) {
    assert.equal(readMeasurement({ sampleKind, measuredAt: now, timestamp: now }, now), null);
  }
  assert.equal(readMeasurement({ monitoring: 'offline', timestamp: now }, now), null);
});

test('duplicates and backwards measurements cannot advance a consumer', () => {
  const previous = { measuredAt: 100000, sampleId: 4 };
  assert.equal(isNewMeasurement(previous, previous), false);
  assert.equal(isNewMeasurement({ measuredAt: 99999, sampleId: 5 }, previous), false);
  assert.equal(isNewMeasurement({ measuredAt: 100001, sampleId: 3 }, previous), false);
  assert.equal(isNewMeasurement({ measuredAt: 100001, sampleId: 5 }, previous), true);
  assert.equal(isNewMeasurement({ measuredAt: 100000, sampleId: null }, previous), false);
});

test('network tests require their own fresh source timestamp', () => {
  const now = 100000;
  assert.equal(networkMeasurementTime({ lastChecked: new Date(now - 15000).toISOString() }, now), 85000);
  for (const lastChecked of [undefined, 'invalid', now + 1, now - 15001]) {
    assert.equal(networkMeasurementTime({ lastChecked }, now), null);
  }
  assert.equal(networkMeasurementTime({ status: 'unavailable', lastChecked: now }, now), null);
});
