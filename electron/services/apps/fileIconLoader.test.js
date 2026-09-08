const test = require('node:test');
const assert = require('node:assert/strict');
const { createFileIconLoader } = require('./fileIconLoader');
const icon = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,test' };

test('shares concurrent icon requests and caches successes across scans', async () => {
  let calls = 0;
  const load = createFileIconLoader(async () => { calls++; return icon; });
  const results = await Promise.all([load('C:/App.exe'), load('c:/app.exe')]);
  assert.deepEqual(results, [icon.toDataURL(), icon.toDataURL()]);
  assert.equal(await load('C:/App.exe'), icon.toDataURL());
  assert.equal(calls, 1);
});

test('a stalled icon does not hold up a scan and late results remain usable', async () => {
  let finish;
  const load = createFileIconLoader(() => new Promise((resolve) => { finish = resolve; }), 10);
  assert.equal(await load('slow.exe'), '');
  finish(icon);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await load('slow.exe'), icon.toDataURL());
});

test('failed extraction can be retried', async () => {
  let calls = 0;
  const load = createFileIconLoader(async () => { if (++calls === 1) throw new Error('missing'); return icon; });
  assert.equal(await load('app.exe'), '');
  assert.equal(await load('app.exe'), icon.toDataURL());
});
