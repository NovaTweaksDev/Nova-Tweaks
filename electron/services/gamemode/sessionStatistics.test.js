const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStatistics, LIVE_SAMPLE_LIMIT } = require('./sessionStatistics');
const { averageLowestPercent, percentile } = require('./gameSessionManager');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-statistics-'));
  const statistics = createSessionStatistics({ captureRoot: root, ...options });
  t.after(() => { statistics.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  return { statistics, root };
}

test('200,000 sensor values retain exact running means and maxima without sample arrays', (t) => {
  const { statistics } = fixture(t);
  for (let index = 0; index < 200000; index += 1) statistics.add('cpu', index);
  assert.equal(statistics.mean('cpu'), 99999.5);
  assert.deepEqual(statistics.aggregates.cpu, { count: 200000, sum: 19999900000, max: 199999, last: 199999 });
  assert.equal(statistics.mean('gpu'), null);
  statistics.add('gpu', 0);
  for (const value of [null, undefined, '', NaN, Infinity]) statistics.add('gpu', value);
  assert.equal(statistics.mean('gpu'), 0);
  assert.equal(statistics.aggregates.gpu.max, 0);
  assert.equal(statistics.aggregates.gpu.count, 1);
});

test('live distribution refresh is throttled and its sample window is bounded', async (t) => {
  let now = 0;
  const { statistics } = fixture(t, { nowProvider: () => now });
  statistics.addFrame(100, 10);
  const first = statistics.liveDistribution();
  statistics.addFrame(1, 100);
  now = 4999;
  assert.equal(statistics.liveDistribution(), first);
  now = 5000;
  assert.equal(statistics.liveDistribution().onePercentLow, 1);
  for (let index = 0; index < LIVE_SAMPLE_LIMIT; index += 1) statistics.addFrame(200, 5);
  now = 10000;
  assert.equal(statistics.liveDistribution().onePercentLow, 200);
  assert.equal(statistics.liveDistribution().p99FrametimeMs, 5);
  assert.equal(statistics.liveDistribution().stutterCount, 0);
  const final = await statistics.finalize();
  assert.equal(final.onePercentLow, (1 + 100 + 39 * 200) / 41);
  assert.equal(final.stutterCount, 1);
});

test('exact final statistics include 200,000 frames across multiple bounded merge passes', async (t) => {
  const { statistics, root } = fixture(t);
  const fps = [];
  const frametime = [];
  for (let index = 0; index < 200000; index += 1) {
    const fpsValue = index % 17 ? (index * 97) % 144 : null;
    const frametimeValue = index % 19 ? (index * 43) % 1000 / 10 : null;
    statistics.addFrame(fpsValue, frametimeValue);
    if (fpsValue !== null) fps.push(fpsValue);
    if (frametimeValue !== null) frametime.push(frametimeValue);
  }
  let eventLoopAdvanced = false;
  setImmediate(() => { eventLoopAdvanced = true; });
  const result = await statistics.finalize();
  assert.equal(eventLoopAdvanced, true);
  assert.equal(result.onePercentLow, averageLowestPercent(fps, 1));
  assert.equal(result.pointOnePercentLow, averageLowestPercent(fps, 0.1));
  assert.equal(result.p95FrametimeMs, percentile(frametime, 95));
  assert.equal(result.p99FrametimeMs, percentile(frametime, 99));
  const threshold = Math.max(50, statistics.mean('frametime') * 2);
  assert.equal(result.stutterCount, frametime.filter((value) => value >= threshold).length);
  statistics.dispose();
  assert.deepEqual(fs.readdirSync(root), []);
});

test('empty capture creates no temporary files and real zeros remain valid', async (t) => {
  const { statistics, root } = fixture(t);
  statistics.addFrame(null, NaN);
  assert.equal((await statistics.finalize()).onePercentLow, null);
  assert.deepEqual(fs.readdirSync(root), []);
  statistics.addFrame(0, 0);
  const result = await statistics.finalize();
  assert.equal(result.onePercentLow, 0);
  assert.equal(result.p95FrametimeMs, 0);
  assert.equal(result.stutterCount, 0);
});

test('spool failures preserve aggregates and reject exact statistics rather than claiming success', async (t) => {
  const { statistics } = fixture(t, { captureRoot: path.join(os.tmpdir(), 'nova-missing-parent', 'missing') });
  statistics.addFrame(100, 10);
  assert.equal(statistics.mean('fps'), 100);
  assert.equal(statistics.aggregates.frametime.max, 10);
  await assert.rejects(statistics.finalize(), { code: 'ENOENT' });
});

test('truncated frame storage is rejected and temporary files are removable after failure', async (t) => {
  const { statistics, root } = fixture(t);
  for (let index = 0; index < 8192; index += 1) statistics.addFrame(60, 16);
  const directory = path.join(root, fs.readdirSync(root)[0]);
  fs.truncateSync(path.join(directory, 'frames.bin'), 8);
  await assert.rejects(statistics.finalize(), /Truncated/);
  statistics.dispose();
  assert.deepEqual(fs.readdirSync(root), []);
});
