const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAppsManager } = require('./appsManager');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'installed');
  await fs.mkdir(installRoot);
  await fs.writeFile(path.join(installRoot, 'app.exe'), 'test fixture');
  let inventory = [{ id: 'example', inventoryKey: 'registry-example', name: 'Example Test App',
    source: 'win32', version: '1', installLocation: installRoot, executablePath: '', iconPath: '', canUninstall: true }];
  let running = true;
  let fail = false;
  const scans = [];
  const options = { appDetailsCachePath: path.join(root, 'cache', 'details.json'),
    executePowerShellJson: async (script) => {
      if (fail) throw new Error('Inventory unavailable');
      const full = script.includes('$includeDetails = $true');
      const encoded = script.match(/FromBase64String\('([^']+)'\)/)[1];
      const reuse = new Map(JSON.parse(Buffer.from(encoded, 'base64').toString()).map(({ key, value }) => [key, value]));
      scans.push({ full, reused: reuse.size });
      if (!full) return inventory;
      assert.match(script, /\$includeDetails = \$scanDetails -and \$null -eq \$cached/);
      assert.match(script, /if \(\$scanDetails -and \$processQuerySucceeded\)/);
      return inventory.map((app) => ({ ...app, sizeBytes: reuse.get(app.inventoryKey)?.sizeBytes ?? 500,
        executablePath: path.join(installRoot, 'app.exe'), sizeKnown: true, detailsLoaded: true,
        runtimeStatus: running ? 'running' : 'stopped', processActive: running, processId: running ? 123 : 0 }));
    } };
  return { options, scans, setInventory: (apps) => { inventory = apps; },
    stop: () => { running = false; }, fail: () => { fail = true; } };
}

test('restart reuses details, refreshes process state and forces only explicitly requested refreshes', async (t) => {
  const f = await fixture(t);
  const first = createAppsManager(f.options);
  await first.listInstalledApps({ detailLevel: 'full' });
  f.stop();
  const next = createAppsManager(f.options);
  const before = f.scans.length;
  const cached = await next.listInstalledApps({ detailLevel: 'cached' });
  assert.equal(f.scans.length, before, 'cache display does not start PowerShell');
  assert.equal(cached[0].runtimeStatus, 'unknown');
  const warm = await next.listInstalledApps({ detailLevel: 'full' });
  assert.equal(f.scans.at(-1).reused, 1);
  assert.equal(warm[0].runtimeStatus, 'stopped');
  assert.equal(warm[0].processId, 0);
  await next.listInstalledApps({ detailLevel: 'full', forceRefresh: true });
  assert.equal(f.scans.at(-1).reused, 0);
});

test('concurrent requests deduplicate and failed inventory leaves persisted apps intact', async (t) => {
  const f = await fixture(t);
  const manager = createAppsManager(f.options);
  await Promise.all([manager.listInstalledApps(), manager.listInstalledApps()]);
  assert.equal(f.scans.filter((scan) => scan.full).length, 1);
  await Promise.all([manager.listInstalledApps(), manager.listInstalledApps({ forceRefresh: true })]);
  assert.deepEqual(f.scans.filter((scan) => scan.full).map((scan) => scan.reused), [0, 1, 0]);
  f.fail();
  await assert.rejects(manager.listInstalledApps(), /Inventory unavailable/);
  assert.equal((await createAppsManager(f.options).listInstalledApps({ detailLevel: 'cached' })).length, 1);
});
