const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAppDetailsCache, appKey, MAX_AGE_MS } = require('./appDetailsCache');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-app-details-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let time = 1800000000000;
  let modified = 1;
  const options = { filePath: path.join(root, 'details.json'), now: () => time,
    stat: async () => ({ size: 10, mtimeMs: modified }) };
  const app = { id: 'test', inventoryKey: 'registry-test', source: 'win32', installScope: 'user',
    name: 'Example App', version: '1', installLocation: 'C:\\Example', iconPath: 'C:\\Example\\app.exe',
    executablePath: '', canUninstall: true, uninstallCommand: 'trusted-command' };
  const detail = { ...app, executablePath: app.iconPath, sizeBytes: 1024, sizeKnown: true,
    detailsLoaded: true, runtimeStatus: 'running', processId: 456, optimization: { status: 'optimized' },
    iconDataUrl: 'data:image/png;base64,AA==' };
  return { root, options, app, detail, cache: createAppDetailsCache(options),
    advance: (delta) => { time += delta; }, changeFile: () => { modified += 1; } };
}

test('a fresh manager restores static details without trusting persisted actions or process state', async (t) => {
  const f = await fixture(t);
  await f.cache.save([f.app], [f.detail]);
  const next = createAppDetailsCache(f.options);
  const cached = await next.cached();
  assert.equal(cached[0].sizeBytes, 1024);
  assert.equal(cached[0].canUninstall, false);
  assert.equal(cached[0].runtimeStatus, 'unknown');
  assert.equal(cached[0].processId, 0);
  assert.equal(cached[0].optimization, undefined);
  assert.equal((await next.prepare([f.app])).size, 1);
  const serialized = await fs.readFile(f.options.filePath, 'utf8');
  assert.doesNotMatch(serialized, /trusted-command|processId|optimization|runtimeStatus/);
});

test('metadata, file changes, expiry and explicit refresh selectively invalidate details', async (t) => {
  const f = await fixture(t);
  await f.cache.save([f.app], [f.detail]);
  for (const change of [{ version: '2' }, { installLocation: 'D:\\Example' }, { estimatedSize: 50 },
    { uninstallCommand: 'changed' }, { installScope: 'machine' }, { packageFullName: 'new-package' }]) {
    assert.equal((await f.cache.prepare([{ ...f.app, ...change }])).size, 0);
  }
  assert.equal((await f.cache.prepare([f.app], { forceRefresh: true })).size, 0);
  assert.equal((await f.cache.prepare([f.app], { refreshAppId: f.app.id })).size, 0);
  f.changeFile();
  assert.equal((await f.cache.prepare([f.app])).size, 0);
  await f.cache.save([f.app], [f.detail]);
  f.advance(MAX_AGE_MS - 1);
  assert.equal((await f.cache.prepare([f.app])).size, 1);
  f.advance(1);
  assert.equal((await f.cache.prepare([f.app])).size, 0);
});

test('new and removed apps reconcile only after a successful inventory and saved details', async (t) => {
  const f = await fixture(t);
  const second = { ...f.app, id: 'second', inventoryKey: 'registry-second' };
  await f.cache.save([f.app, second], [f.detail, { ...f.detail, ...second }]);
  const inventory = [second, { ...f.app, id: 'new', inventoryKey: 'new' }];
  assert.deepEqual([...(await f.cache.prepare(inventory)).keys()], [appKey(second)]);
  await f.cache.save(inventory, [{ ...f.detail, ...second }]);
  assert.deepEqual((await f.cache.cached()).map((app) => app.id), ['second']);
});

test('failed directory reads retain the last size and its original expiry', async (t) => {
  const f = await fixture(t);
  await f.cache.save([f.app], [f.detail]);
  const oldTime = (await f.cache.cached())[0].sizeUpdatedAt;
  f.advance(MAX_AGE_MS);
  const result = await f.cache.save([f.app], [{ ...f.detail, sizeBytes: 0, sizeKnown: false }]);
  assert.equal(result[0].sizeBytes, 1024);
  assert.equal(result[0].sizeUpdatedAt, oldTime);
  assert.equal(result[0].sizeCheckFailed, true);
  assert.equal((await f.cache.prepare([f.app])).size, 1, 'inaccessible folders are not retried on every request');
  f.advance(5 * 60 * 1000);
  assert.equal((await f.cache.prepare([f.app])).size, 0);
});

test('invalidating an app survives a restart and does not invalidate other apps', async (t) => {
  const f = await fixture(t);
  const second = { ...f.app, id: 'second', inventoryKey: 'registry-second' };
  await f.cache.save([f.app, second], [f.detail, { ...f.detail, ...second }]);
  await f.cache.invalidate(f.app.id);
  const reuse = await createAppDetailsCache(f.options).prepare([f.app, second]);
  assert.deepEqual([...reuse.keys()], [appKey(second)]);
});

test('corrupt, incompatible and future-dated caches are misses', async (t) => {
  const f = await fixture(t);
  for (const contents of ['{', '{"schemaVersion":2,"apps":[]}', '{"schemaVersion":1,"apps":[{}]}']) {
    await fs.writeFile(f.options.filePath, contents);
    assert.deepEqual(await createAppDetailsCache(f.options).cached(), []);
  }
  await f.cache.save([f.app], [f.detail]);
  const data = JSON.parse(await fs.readFile(f.options.filePath, 'utf8'));
  data.apps[0].app.detailsUpdatedAt = 9999999999999;
  await fs.writeFile(f.options.filePath, JSON.stringify(data));
  assert.deepEqual(await createAppDetailsCache(f.options).cached(), []);
});

test('cache write errors preserve results and leave no temporary output', async (t) => {
  const f = await fixture(t);
  const blocked = path.join(f.root, 'blocked');
  await fs.writeFile(blocked, 'file instead of directory');
  const cache = createAppDetailsCache({ ...f.options, filePath: path.join(blocked, 'details.json') });
  const result = await cache.save([f.app], [f.detail]);
  assert.equal(result[0].sizeBytes, 1024);
  assert.equal((await cache.cached()).length, 1);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['blocked']);
});

test('an action invalidation cannot be overwritten by an older detail scan', async (t) => {
  const f = await fixture(t);
  await f.cache.save([f.app], [f.detail]);
  const revision = f.cache.getRevision();
  await f.cache.invalidate(f.app.id);
  await f.cache.save([f.app], [f.detail], revision);
  assert.equal((await f.cache.prepare([f.app])).size, 0);
  await f.cache.save([f.app], [f.detail], f.cache.getRevision());
  assert.equal((await f.cache.prepare([f.app])).size, 1);
});
