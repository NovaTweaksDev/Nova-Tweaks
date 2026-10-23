const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(listInstalledApps) {
  const snapshots = [];
  const context = { window: { desktopApi: { listInstalledApps } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'useAppManagementActions.js'), 'utf8').replace('export function', 'function'), context);
  const actions = context.useAppManagementActions({
    activeAppsLoadRequestRef: { current: 0 }, hasLoadedAppsRef: { current: false },
    didBootstrapRef: { current: false }, installedApps: [],
    setInstalledApps: (apps) => snapshots.push(apps),
    setAppsError() {}, setIsLoadingApps() {}, setIsLoadingAppDetails() {}, pushToast() {}, t: (key) => key
  });
  return { ...actions, snapshots };
}

test('cached details appear before inventory and remain available while full details are pending', async () => {
  const inventory = deferred();
  const details = deferred();
  const requests = [];
  const app = { id: 'example', sizeBytes: 1024, detailsLoaded: true };
  const f = fixture(async (options) => {
    requests.push(options);
    if (options.detailLevel === 'cached') return { ok: true, apps: [app] };
    return options.detailLevel === 'summary' ? inventory.promise : details.promise;
  });
  const loading = f.loadInstalledApps({ forceRefresh: true });
  await new Promise(setImmediate);
  assert.equal(f.snapshots[0][0].sizeBytes, 1024);
  assert.equal(requests.length, 2);
  inventory.resolve({ ok: true, apps: [app] });
  await new Promise(setImmediate);
  assert.equal(f.snapshots.at(-1)[0].sizeBytes, 1024);
  assert.equal(requests[2].forceRefresh, true);
  details.resolve({ ok: true, apps: [{ ...app, sizeBytes: 2048 }] });
  await loading;
  assert.equal(f.snapshots.at(-1)[0].sizeBytes, 2048);
});

test('failed inventory does not erase a restored cache', async () => {
  const f = fixture(async ({ detailLevel }) => detailLevel === 'cached'
    ? { ok: true, apps: [{ id: 'cached' }] } : { ok: false, code: 'UNAVAILABLE' });
  await f.loadInstalledApps();
  assert.equal(f.snapshots.at(-1)[0].id, 'cached');
});

test('cache IPC failure still permits a fresh inventory', async () => {
  const f = fixture(async ({ detailLevel }) => {
    if (detailLevel === 'cached') throw new Error('Cache unavailable');
    return { ok: true, apps: [{ id: 'fresh' }] };
  });
  await f.loadInstalledApps();
  assert.equal(f.snapshots.at(-1)[0].id, 'fresh');
});

test('a slow older request cannot overwrite the latest app list', async () => {
  const oldCache = deferred();
  let calls = 0;
  const f = fixture(async () => {
    calls += 1;
    if (calls === 1) return oldCache.promise;
    return { ok: true, apps: [{ id: 'latest' }] };
  });
  const old = f.loadInstalledApps();
  await f.loadInstalledApps();
  oldCache.resolve({ ok: true, apps: [{ id: 'obsolete' }] });
  await old;
  assert.equal(f.snapshots.at(-1)[0].id, 'latest');
});
