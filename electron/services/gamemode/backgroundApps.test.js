const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesApp, selectBackgroundApps, minimizeBackgroundApps, closeApps, snapshotApps } = require('./backgroundApps');

const root = process.env.ProgramFiles || 'C:\\Program Files';
function browser(extra = {}) {
  return { name: 'chrome', executablePath: root + '\\Google\\Chrome\\Application\\chrome.exe', pid: 100, parentPid: 90, startTime: '2026-10-18T10:00:00.0000000Z', ownerSid: 'S-1-5-21-1001', currentSid: 'S-1-5-21-1001', ...extra };
}

test('matches fixed app identities only within known installation roots', { skip: !process.env.ProgramFiles }, () => {
  assert.equal(matchesApp(browser()), true);
  assert.equal(matchesApp(browser({ executablePath: 'C:\\Temp\\Google\\Chrome\\Application\\chrome.exe' })), false);
  assert.equal(matchesApp(browser({ executablePath: root + '\\Google\\Chrome\\Application\\not-chrome.exe' })), false);
  assert.equal(matchesApp(browser({ executablePath: root + '\\Google\\Chrome\\Application\\..\\chrome.exe' })), false);
});

test('protects detected games, launcher descendants, Nova and unverifiable owners', { skip: !process.env.ProgramFiles }, () => {
  const items = [browser(), browser({ pid: 101, parentPid: 100 }), browser({ pid: 102, ownerSid: 'other' }), browser({ pid: 103, startTime: '' })];
  const result = selectBackgroundApps(items, [{ pid: 100, executablePath: items[0].executablePath }]);
  assert.ok(result.every((item) => item.skipReason === 'PROTECTED_PROCESS'));
  const withLauncher = selectBackgroundApps([{ name: 'steam', pid: 90, parentPid: 1 }, ...items]);
  assert.ok(withLauncher.every((item) => item.skipReason === 'PROTECTED_PROCESS'));
  assert.equal(selectBackgroundApps([items[2]])[0].skipReason, 'PROCESS_OWNER_UNVERIFIED');
  assert.equal(selectBackgroundApps([items[3]])[0].skipReason, 'PROCESS_IDENTITY_MISSING');
  assert.equal(selectBackgroundApps([browser({ pid: process.pid })])[0].skipReason, 'PROTECTED_PROCESS');
});

test('Discord variants and their own child processes never become close candidates or partial failures', { skip: !process.env.ProgramFiles }, async () => {
  for (const name of ['Discord', 'DiscordCanary', 'DiscordPTB']) {
    const executablePath = root + `\\Discord\\app-1.0\\${name}.exe`;
    const parent = browser({ name, executablePath, pid: 500 });
    const child = browser({ name, executablePath, pid: 501, parentPid: 500 });
    assert.equal(matchesApp(parent), false);
    assert.equal(selectBackgroundApps([parent, child]).length, 0);
    const sent = [];
    const result = await minimizeBackgroundApps({
      snapshot: async () => [parent, child], close: async targets => { sent.push(...targets); return []; }
    });
    assert.deepEqual(sent, []);
    assert.deepEqual(result, []);
    const descendant = selectBackgroundApps([parent, browser({ parentPid: 500 })]);
    assert.equal(descendant[0].skipReason, 'PROTECTED_PROCESS', 'Discord descendants inherit protection');
  }
});

test('sends all eligible apps in one batch and preserves refused and protected outcomes', { skip: !process.env.ProgramFiles }, async () => {
  let calls = 0;
  const result = await minimizeBackgroundApps({
    snapshot: async () => [browser(), browser({ pid: 101, ownerSid: '' })],
    close: async (targets) => { calls++; assert.deepEqual(targets.map((item) => item.pid), [100]); return [{ pid: 100, name: 'chrome', status: 'skipped', code: 'APP_STILL_RUNNING' }]; }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.map((item) => item.code), ['PROCESS_OWNER_UNVERIFIED', 'APP_STILL_RUNNING']);
});

test('close batch revalidates PID start time, image and owner, with one shared five-second deadline', async () => {
  let calls = 0;
  await closeApps([browser(), browser({ pid: 101 })], async (script) => {
    calls++;
    assert.match(script, /\$identity\[1\] -eq \$item.startTime/);
    assert.match(script, /\$identity\[0\] -eq \$item.executablePath/);
    assert.match(script, /\$owner -eq \$sid -and \$owner -eq \$item.ownerSid/);
    assert.match(script, /CloseMainWindow\(\)/);
    assert.equal(script.match(/AddSeconds\(5\)/g).length, 1);
    assert.doesNotMatch(script, /Stop-Process|\.Kill\(|Start-Sleep -Seconds/);
    assert.match(script, /APP_STILL_RUNNING/);
    return [];
  });
  assert.equal(calls, 1);
  await closeApps([], () => assert.fail('Empty batch must not spawn PowerShell'));
});

test('snapshot reuses limited-access watcher identity and adds owner and parent information', async () => {
  await snapshotApps(async (script) => {
    assert.match(script, /QueryFullProcessImageName/);
    assert.match(script, /GetOwnerSid/);
    assert.match(script, /parentPid/);
    assert.match(script, /currentSid/);
    return [];
  });
});
