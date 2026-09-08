const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildHelperArgs,
  createPresentMonServiceProvider,
  resolvePresentMonHelperPath,
  resolvePresentMonToolsPath
} = require('./presentMonServiceProvider');

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-presentmon-service-'));
  try {
    const result = callback(directory);
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        fs.rmSync(directory, { recursive: true, force: true });
      });
    }
    fs.rmSync(directory, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function createFakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 0, null);
  };
  return child;
}

test('builds the helper contract arguments with a target pid', () => {
  assert.deepEqual(buildHelperArgs({
    processId: 20252,
    processName: 'FortniteClient-Win64-Shipping.exe',
    pollMs: 500,
    presentMonPath: 'C:\\Nova\\tools\\presentmon'
  }), [
    '--target-pid',
    '20252',
    '--poll-ms',
    '500',
    '--presentmon-path',
    'C:\\Nova\\tools\\presentmon'
  ]);
});

test('resolves helper and PresentMon Service/API paths from the bundled tools layout', () => withTempDirectory((directory) => {
  const helperDirectory = path.join(directory, 'resources', 'tools', 'nova-presentmon-helper');
  const presentMonDirectory = path.join(directory, 'resources', 'tools', 'presentmon');
  fs.mkdirSync(helperDirectory, { recursive: true });
  fs.mkdirSync(presentMonDirectory, { recursive: true });
  const helperPath = path.join(helperDirectory, 'NovaPresentMonHelper.exe');
  fs.writeFileSync(helperPath, 'helper');
  fs.writeFileSync(path.join(presentMonDirectory, 'PresentMonAPI2Loader.dll'), 'api');
  fs.writeFileSync(path.join(presentMonDirectory, 'Intel-PresentMon.dll'), 'middleware');

  const options = {
    cwd: directory,
    resourcesPath: '',
    app: { getAppPath: () => directory },
    env: {}
  };

  assert.equal(resolvePresentMonHelperPath(options), helperPath);
  assert.equal(resolvePresentMonToolsPath(options), presentMonDirectory);
}));

test('ingests JSON Lines metrics without inventing unavailable FPS', async () => withTempDirectory(async (directory) => {
  const helperPath = path.join(directory, 'NovaPresentMonHelper.exe');
  const presentMonPath = path.join(directory, 'presentmon');
  fs.mkdirSync(presentMonPath, { recursive: true });
  fs.writeFileSync(helperPath, 'helper');
  fs.writeFileSync(path.join(presentMonPath, 'PresentMonAPI2Loader.dll'), 'api');
  fs.writeFileSync(path.join(presentMonPath, 'Intel-PresentMon.dll'), 'middleware');

  let child = null;
  const events = [];
  const provider = createPresentMonServiceProvider({
    helperPath,
    presentMonPath,
    platform: 'win32',
    onEvent: (event) => events.push(event),
    spawn: () => {
      child = createFakeChildProcess();
      return child;
    }
  });

  const startStatus = await provider.start({
    processId: 20252,
    processName: 'FortniteClient-Win64-Shipping.exe'
  });

  assert.equal(startStatus.status, 'starting');

  child.stdout.emit('data', Buffer.from([
    '{"type":"status","status":"connected"}',
    '{"type":"metrics","pid":20252,"processName":"FortniteClient-Win64-Shipping.exe","fps":121.6,"frameTimeMs":8.22}',
    '{"type":"metrics","pid":20252,"processName":"FortniteClient-Win64-Shipping.exe"}'
  ].join('\n') + '\n', 'utf8'));

  const samples = provider.readSamples();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].fps, 121.6);
  assert.equal(samples[0].frametimeMs, 8.22);
  assert.equal(events.some((event) => event.type === 'metrics' && event.fps === 121.6), true);

  await provider.stop();
}));
