const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildPresentMonArgs,
  findPresentMonExecutableInDirectory,
  findPresentMonLegacyExecutableInDirectory,
  isTransientCaptureFileError,
  parsePresentMonCsv,
  resolvePresentMonExecutablePath,
  resolvePresentMonLegacyExecutablePath
} = require('./presentMonCaptureService');

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-presentmon-'));
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

test('parses PresentMon frametime rows into real FPS samples', () => {
  const csv = [
    'Application,ProcessID,TimeInSeconds,MsBetweenPresents',
    'Game.exe,4242,1.00,16.6667',
    'Game.exe,4242,1.02,8.3333'
  ].join('\n');

  const result = parsePresentMonCsv(csv);

  assert.equal(result.samples.length, 2);
  assert.equal(result.samples[0].processId, 4242);
  assert.equal(Math.round(result.samples[0].fps), 60);
  assert.equal(Math.round(result.samples[1].fps), 120);
  assert.equal(result.samples[0].frametimeMs, 16.6667);
});

test('parses PresentMon 2.x simulation frametime rows into real FPS samples', () => {
  const csv = [
    'Application,ProcessID,CPUStartTime,MsBetweenSimulationStart',
    'Game.exe,4242,12.50,10',
    'Game.exe,4242,12.52,20'
  ].join('\n');

  const result = parsePresentMonCsv(csv);

  assert.equal(result.samples.length, 2);
  assert.equal(result.samples[0].captureTimeSeconds, 12.5);
  assert.equal(result.samples[0].fps, 100);
  assert.equal(result.samples[1].fps, 50);
});

test('prefers displayed present duration when PresentMon also reports NA simulation duration', () => {
  const csv = [
    [
      'Application',
      'ProcessID',
      'TimeInMs',
      'MsBetweenSimulationStart',
      'MsBetweenPresents',
      'MsBetweenDisplayChange'
    ].join(','),
    'FortniteClient-Win64-Shipping.exe,4352,74.9268,NA,33.999,25.0373',
    'FortniteClient-Win64-Shipping.exe,4352,108.5658,NA,16.6667,16.7000'
  ].join('\n');

  const result = parsePresentMonCsv(csv);

  assert.equal(result.samples.length, 2);
  assert.equal(Math.round(result.samples[0].fps), 29);
  assert.equal(Math.round(result.samples[1].fps), 60);
  assert.equal(result.samples[0].frametimeMs, 33.999);
});

test('does not invent capture samples when PresentMon has no frame columns', () => {
  const csv = [
    'Application,ProcessID,TimeInSeconds',
    'Game.exe,4242,1.00'
  ].join('\n');

  const result = parsePresentMonCsv(csv);

  assert.deepEqual(result.samples, []);
});

test('finds a bundled versioned PresentMon executable', () => withTempDirectory((directory) => {
  const executablePath = path.join(directory, 'PresentMon-2.4.1-x64.exe');
  fs.writeFileSync(executablePath, 'stub');

  assert.equal(findPresentMonExecutableInDirectory(directory), executablePath);
}));

test('finds the bundled legacy PresentMon fallback separately', () => withTempDirectory((directory) => {
  const modernPath = path.join(directory, 'PresentMon.exe');
  const legacyPath = path.join(directory, 'PresentMonLegacy.exe');
  fs.writeFileSync(modernPath, 'modern');
  fs.writeFileSync(legacyPath, 'legacy');

  assert.equal(findPresentMonExecutableInDirectory(directory), modernPath);
  assert.equal(findPresentMonLegacyExecutableInDirectory(directory), legacyPath);
}));

test('builds current PresentMon console arguments', () => {
  const args = buildPresentMonArgs({
    processId: 4242,
    outputCsvPath: 'C:\\capture\\game.csv',
    sessionName: 'Nova Tweaks Session!'
  });

  assert.deepEqual(args, [
    '--process_id',
    '4242',
    '--output_file',
    'C:\\capture\\game.csv',
    '--terminate_on_proc_exit',
    '--session_name',
    'Nova-Tweaks-Session',
    '--stop_existing_session'
  ]);
  assert.equal(args.includes('-no_csv_summary'), false);
});

test('builds legacy PresentMon console arguments', () => {
  const args = buildPresentMonArgs({
    processName: 'FortniteClient-Win64-Shipping.exe',
    outputCsvPath: 'C:\\capture\\game.csv',
    sessionName: 'Nova Tweaks Session!',
    flavor: 'legacy',
    targetMode: 'processName'
  });

  assert.deepEqual(args, [
    '-process_name',
    'FortniteClient-Win64-Shipping.exe',
    '-output_file',
    'C:\\capture\\game.csv',
    '-terminate_on_proc_exit',
    '-session_name',
    'Nova-Tweaks-Session',
    '-stop_existing_session',
    '-no_top',
    '-no_track_display'
  ]);
});

test('persists PresentMon stdout capture output for polling', async () => withTempDirectory(async (directory) => {
  let child = null;
  const service = require('./presentMonCaptureService').createPresentMonCaptureService({
    executablePath: path.join(directory, 'PresentMon.exe'),
    platform: 'win32',
    outputMode: 'stdout',
    spawn: () => {
      child = createFakeChildProcess();
      return child;
    }
  });
  const startStatus = await service.start({
    processId: 4242,
    sessionId: 'stdout-file',
    outputDirectory: directory
  });
  const csv = [
    'Application,ProcessID,TimeInSeconds,MsBetweenPresents',
    'Game.exe,4242,1.00,16.6667'
  ].join('\n') + '\n';

  child.stdout.emit('data', Buffer.from(csv, 'utf8'));

  const samples = service.readSamples();
  assert.equal(samples.length, 1);
  assert.equal(Math.round(samples[0].fps), 60);
  assert.equal(fs.readFileSync(startStatus.outputCsvPath, 'utf8'), csv);

  await service.stop();
}));

test('does not append PresentMon console text to file output captures', async () => withTempDirectory(async (directory) => {
  let child = null;
  const service = require('./presentMonCaptureService').createPresentMonCaptureService({
    executablePath: path.join(directory, 'PresentMon.exe'),
    platform: 'win32',
    spawn: () => {
      child = createFakeChildProcess();
      return child;
    }
  });
  const startStatus = await service.start({
    processId: 4242,
    sessionId: 'file-output',
    outputDirectory: directory
  });

  child.stdout.emit('data', Buffer.from('Started recording.\n', 'utf8'));

  assert.equal(fs.readFileSync(startStatus.outputCsvPath, 'utf8'), '');

  await service.stop();
}));

test('does not repeatedly restart CLI captures when the capture stays empty', async () => withTempDirectory(async (directory) => {
  const children = [];
  const spawnCalls = [];
  const service = require('./presentMonCaptureService').createPresentMonCaptureService({
    executablePath: path.join(directory, 'PresentMon.exe'),
    legacyExecutablePath: path.join(directory, 'PresentMonLegacy.exe'),
    platform: 'win32',
    spawn: (exe, args) => {
      const child = createFakeChildProcess();
      children.push(child);
      spawnCalls.push({ exe, args });
      return child;
    }
  });
  const startStatus = await service.start({
    processId: 4242,
    processName: 'Game.exe',
    sessionId: 'fallback',
    outputDirectory: directory
  });

  assert.deepEqual(service.readSamples(), []);

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].args[0], '--process_id');
  assert.equal(children[0].killed, false);
  assert.equal(startStatus.outputCsvPath, service.getStatus().outputCsvPath);

  await service.stop();
}));

test('treats locked capture files as transient read misses', async () => withTempDirectory(async (directory) => {
  const service = require('./presentMonCaptureService').createPresentMonCaptureService({
    executablePath: path.join(directory, 'PresentMon.exe'),
    platform: 'win32',
    spawn: () => createFakeChildProcess()
  });
  const startStatus = await service.start({
    processId: 4242,
    sessionId: 'locked-file',
    outputDirectory: directory
  });
  const csv = [
    'Application,ProcessID,TimeInSeconds,MsBetweenPresents',
    'Game.exe,4242,1.00,16.6667'
  ].join('\n') + '\n';
  fs.writeFileSync(startStatus.outputCsvPath, csv);

  const originalOpenSync = fs.openSync;
  let openAttempts = 0;
  try {
    fs.openSync = (...args) => {
      openAttempts += 1;
      if (openAttempts === 1) {
        const error = new Error('resource busy or locked');
        error.code = 'EBUSY';
        throw error;
      }
      return originalOpenSync(...args);
    };

    assert.deepEqual(service.readSamples(), []);
    assert.equal(service.getStatus().status, 'running');

    const samples = service.readSamples();
    assert.equal(samples.length, 1);
    assert.equal(Math.round(samples[0].fps), 60);
  } finally {
    fs.openSync = originalOpenSync;
    await service.stop();
  }
}));

test('parses a final capture line without trailing newline after stop', async () => withTempDirectory(async (directory) => {
  const service = require('./presentMonCaptureService').createPresentMonCaptureService({
    executablePath: path.join(directory, 'PresentMon.exe'),
    platform: 'win32',
    spawn: () => createFakeChildProcess()
  });
  const startStatus = await service.start({
    processId: 4242,
    sessionId: 'final-line',
    outputDirectory: directory
  });
  const csv = [
    'Application,ProcessID,TimeInSeconds,MsBetweenPresents',
    'Game.exe,4242,1.00,16.6667'
  ].join('\n');
  fs.writeFileSync(startStatus.outputCsvPath, csv);

  assert.deepEqual(service.readSamples(), []);

  await service.stop();
  const samples = service.readSamples();

  assert.equal(samples.length, 1);
  assert.equal(Math.round(samples[0].fps), 60);
}));

test('classifies Windows file sharing failures as transient capture read errors', () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    assert.equal(isTransientCaptureFileError({ code }), true);
  }
  assert.equal(isTransientCaptureFileError({ code: 'ENOENT' }), false);
});

test('prefers the packaged resources PresentMon sidecar', () => withTempDirectory((directory) => {
  const resourcesPath = path.join(directory, 'resources-root');
  const presentMonDirectory = path.join(resourcesPath, 'capture', 'PresentMon');
  fs.mkdirSync(presentMonDirectory, { recursive: true });
  const executablePath = path.join(presentMonDirectory, 'PresentMon.exe');
  fs.writeFileSync(executablePath, 'stub');

  const resolvedPath = resolvePresentMonExecutablePath({
    app: { getAppPath: () => path.join(directory, 'app') },
    resourcesPath,
    cwd: path.join(directory, 'cwd'),
    env: {}
  });

  assert.equal(resolvedPath, executablePath);
}));

test('prefers the packaged resources legacy PresentMon sidecar', () => withTempDirectory((directory) => {
  const resourcesPath = path.join(directory, 'resources-root');
  const presentMonDirectory = path.join(resourcesPath, 'capture', 'PresentMon');
  fs.mkdirSync(presentMonDirectory, { recursive: true });
  const executablePath = path.join(presentMonDirectory, 'PresentMonLegacy.exe');
  fs.writeFileSync(executablePath, 'stub');

  const resolvedPath = resolvePresentMonLegacyExecutablePath({
    app: { getAppPath: () => path.join(directory, 'app') },
    resourcesPath,
    cwd: path.join(directory, 'cwd'),
    env: {}
  });

  assert.equal(resolvedPath, executablePath);
}));
