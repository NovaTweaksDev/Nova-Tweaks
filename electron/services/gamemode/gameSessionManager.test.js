const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameSessionManager, averageLowestPercent, percentile } = require('./gameSessionManager');

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-session-'));
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

test('calculates low FPS averages from the lowest real samples', () => {
  const fpsSamples = [144, 141, 138, 60, 120, 119, 118, 117, 116, 115];

  assert.equal(averageLowestPercent(fpsSamples, 10), 60);
  assert.equal(averageLowestPercent(fpsSamples, 20), 87.5);
});

test('calculates frametime percentiles deterministically', () => {
  const frametimes = [8, 9, 10, 11, 12, 20, 24, 30, 45, 60];

  assert.equal(percentile(frametimes, 95), 60);
  assert.equal(percentile(frametimes, 50), 12);
});

test('reads final PresentMon samples again after stopping capture', async () => withTempDirectory(async (directory) => {
  let stopped = false;
  let readCalls = 0;
  const captureService = {
    getAvailability: () => ({
      available: true,
      status: 'available',
      message: '',
      executablePath: 'PresentMon.exe'
    }),
    getStatus: () => ({
      status: stopped ? 'stopped' : 'running',
      message: '',
      executablePath: 'PresentMon.exe',
      outputCsvPath: path.join(directory, 'capture.csv'),
      running: !stopped
    }),
    start: async () => ({
      status: 'running',
      message: '',
      outputCsvPath: path.join(directory, 'capture.csv')
    }),
    stop: async () => {
      stopped = true;
      return captureService.getStatus();
    },
    readSamples: () => {
      readCalls += 1;
      return stopped
        ? [{ timestamp: Date.now(), fps: 120, frametimeMs: 8.3333 }]
        : [];
    }
  };
  const manager = createGameSessionManager({
    captureService,
    platform: 'win32',
    userDataPath: directory
  });

  await manager.startSession({
    game: {
      gameName: 'Test Game',
      processName: 'node.exe',
      processId: process.pid,
      executablePath: process.execPath
    }
  });
  const report = await manager.stopSession();

  assert.equal(readCalls, 2);
  assert.equal(report.metrics.currentFps, 120);
  assert.equal(report.metrics.avgFrametimeMs, 8.33);
}));
