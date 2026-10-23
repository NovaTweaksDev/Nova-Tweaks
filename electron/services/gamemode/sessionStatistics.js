const fs = require('fs');
const path = require('path');

const LIVE_SAMPLE_LIMIT = 4096;
const LIVE_UPDATE_INTERVAL_MS = 5000;
const BLOCK_VALUES = 8192;
const MERGE_FAN_IN = 16;
const METRICS = ['fps', 'frametime', 'cpu', 'gpu', 'gpuTemp', 'ramMB', 'vramMB', 'latency', 'packetLoss'];

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function averageLowestSorted(values, percent) {
  if (!values.length) return null;
  const count = Math.min(values.length, Math.max(1, Math.ceil(values.length * percent / 100)));
  let sum = 0;
  for (let index = 0; index < count; index += 1) sum += values[index];
  return sum / count;
}

function percentileSorted(values, percent) {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percent / 100) - 1))];
}

// Fixed buffers and a fixed merge fan-in bound memory and open files even for very long captures.
async function mergeRuns(inputs, output) {
  const readers = [];
  let destination;
  try {
    for (const input of inputs) {
      const file = await fs.promises.open(input, 'r');
      const reader = { file, buffer: Buffer.alloc(BLOCK_VALUES * 8), offset: 0, length: 0, value: null };
      readers.push(reader);
      await refill(reader);
    }
    destination = await fs.promises.open(output, 'wx', 0o600);
    const buffer = Buffer.alloc(BLOCK_VALUES * 8);
    let used = 0;
    while (true) {
      let smallest = null;
      for (const reader of readers) {
        if (reader.value !== null && (!smallest || reader.value < smallest.value)) smallest = reader;
      }
      if (!smallest) break;
      buffer.writeDoubleLE(smallest.value, used);
      used += 8;
      smallest.offset += 8;
      if (smallest.offset >= smallest.length) await refill(smallest);
      else smallest.value = smallest.buffer.readDoubleLE(smallest.offset);
      if (used === buffer.length) {
        await writeAll(destination, buffer);
        used = 0;
      }
    }
    if (used) await writeAll(destination, buffer.subarray(0, used));
  } finally {
    await Promise.allSettled(readers.map((reader) => reader.file.close()));
    await destination?.close();
  }
}

async function refill(reader) {
  const bytesRead = await readBlock(reader.file, reader.buffer);
  if (bytesRead % 8) throw new Error('Truncated session statistics file.');
  reader.offset = 0;
  reader.length = bytesRead;
  reader.value = bytesRead ? reader.buffer.readDoubleLE(0) : null;
}

async function writeAll(file, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, null);
    if (!bytesWritten) throw new Error('Unable to write session statistics.');
    offset += bytesWritten;
  }
}

async function readBlock(file, buffer, length = buffer.length, position = null) {
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position === null ? null : position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return offset;
}

async function readValue(file, index) {
  const buffer = Buffer.alloc(8);
  const bytesRead = await readBlock(file, buffer, 8, index * 8);
  if (bytesRead !== 8) throw new Error('Truncated session statistics file.');
  return buffer.readDoubleLE(0);
}

function createSessionStatistics({ captureRoot, nowProvider = () => Date.now() }) {
  captureRoot = path.resolve(captureRoot);
  const aggregates = Object.fromEntries(METRICS.map((key) => [key, { count: 0, sum: 0, max: null, last: null }]));
  const windows = { fps: [], frametime: [] };
  const positions = { fps: 0, frametime: 0 };
  let directory = null;
  let descriptor = null;
  let used = 0;
  let failure = null;
  let dirty = false;
  let updatedAt = null;
  let distribution = { onePercentLow: null, pointOnePercentLow: null, p95FrametimeMs: null, p99FrametimeMs: null, stutterCount: 0 };
  const pending = Buffer.alloc(BLOCK_VALUES * 16);

  function add(key, value) {
    const number = numeric(value);
    if (number === null) return;
    const entry = aggregates[key];
    entry.count += 1;
    entry.sum += number;
    entry.max = entry.max === null ? number : Math.max(entry.max, number);
    entry.last = number;
  }

  function mean(key) {
    const entry = aggregates[key];
    return entry.count ? entry.sum / entry.count : null;
  }

  function flush() {
    let offset = 0;
    while (offset < used) {
      const written = fs.writeSync(descriptor, pending, offset, used - offset);
      if (!written) throw new Error('Unable to write session statistics.');
      offset += written;
    }
    used = 0;
  }

  function addFrame(fps, frametime) {
    fps = numeric(fps);
    frametime = numeric(frametime);
    if (fps === null && frametime === null) return;
    for (const [key, value] of [['fps', fps], ['frametime', frametime]]) {
      if (value === null) continue;
      add(key, value);
      windows[key][positions[key]] = value;
      positions[key] = (positions[key] + 1) % LIVE_SAMPLE_LIMIT;
    }
    dirty = true;
    if (failure) return;
    try {
      if (descriptor === null) {
        directory = fs.mkdtempSync(path.join(captureRoot, '.nova-session-stats-'));
        descriptor = fs.openSync(path.join(directory, 'frames.bin'), 'wx', 0o600);
      }
      pending.writeDoubleLE(fps ?? NaN, used);
      pending.writeDoubleLE(frametime ?? NaN, used + 8);
      used += 16;
      if (used === pending.length) flush();
    } catch (error) {
      failure = error;
    }
  }

  function liveDistribution() {
    const now = nowProvider();
    if (dirty && (updatedAt === null || now - updatedAt >= LIVE_UPDATE_INTERVAL_MS)) {
      const fps = windows.fps.slice().sort((left, right) => left - right);
      const frametime = windows.frametime.slice().sort((left, right) => left - right);
      distribution = {
        onePercentLow: averageLowestSorted(fps, 1), pointOnePercentLow: averageLowestSorted(fps, 0.1),
        p95FrametimeMs: percentileSorted(frametime, 95), p99FrametimeMs: percentileSorted(frametime, 99),
        stutterCount: frametime.filter((value) => value >= Math.max(50, (mean('frametime') || 0) * 2)).length
      };
      dirty = false;
      updatedAt = now;
    }
    return distribution;
  }

  async function finalize() {
    if (failure) throw failure;
    if (!directory) return distribution;
    flush();
    fs.closeSync(descriptor);
    descriptor = null;
    const input = await fs.promises.open(path.join(directory, 'frames.bin'), 'r');
    let runs = 0;
    const runPath = (key, pass, index) => path.join(directory, `${key}-${pass}-${index}.bin`);
    try {
      const buffer = Buffer.alloc(BLOCK_VALUES * 16);
      while (true) {
        const bytesRead = await readBlock(input, buffer);
        if (!bytesRead) break;
        if (bytesRead % 16) throw new Error('Truncated session frame data.');
        for (const [key, column] of [['fps', 0], ['frametime', 8]]) {
          const values = [];
          for (let offset = column; offset < bytesRead; offset += 16) {
            const value = buffer.readDoubleLE(offset);
            if (Number.isFinite(value)) values.push(value);
          }
          values.sort((left, right) => left - right);
          const sorted = Buffer.alloc(values.length * 8);
          values.forEach((value, index) => sorted.writeDoubleLE(value, index * 8));
          await fs.promises.writeFile(runPath(key, 0, runs), sorted, { flag: 'wx', mode: 0o600 });
        }
        runs += 1;
      }
    } finally {
      await input.close();
    }
    let pass = 0;
    while (runs > 1) {
      const nextRuns = Math.ceil(runs / MERGE_FAN_IN);
      for (let group = 0; group < nextRuns; group += 1) {
        for (const key of ['fps', 'frametime']) {
          const inputs = [];
          for (let index = group * MERGE_FAN_IN; index < Math.min(runs, (group + 1) * MERGE_FAN_IN); index += 1) inputs.push(runPath(key, pass, index));
          await mergeRuns(inputs, runPath(key, pass + 1, group));
          await Promise.all(inputs.map((file) => fs.promises.unlink(file)));
        }
      }
      runs = nextRuns;
      pass += 1;
    }
    const result = { ...distribution };
    for (const key of ['fps', 'frametime']) {
      const count = aggregates[key].count;
      if (!count) continue;
      const file = await fs.promises.open(runPath(key, pass, 0), 'r');
      try {
        if ((await file.stat()).size !== count * 8) throw new Error('Incomplete session statistics.');
        if (key === 'fps') {
          const lowCount = Math.max(1, Math.ceil(count / 100));
          const lowerCount = Math.max(1, Math.ceil(count / 1000));
          let sum = 0;
          let lowerSum = 0;
          const buffer = Buffer.alloc(BLOCK_VALUES * 8);
          for (let offset = 0; offset < lowCount;) {
            const length = Math.min(BLOCK_VALUES, lowCount - offset) * 8;
            const bytesRead = await readBlock(file, buffer, length, offset * 8);
            if (bytesRead !== length) throw new Error('Incomplete low FPS statistics.');
            for (let index = 0; index < length / 8; index += 1) {
              const value = buffer.readDoubleLE(index * 8);
              sum += value;
              if (offset + index < lowerCount) lowerSum += value;
            }
            offset += length / 8;
          }
          result.onePercentLow = sum / lowCount;
          result.pointOnePercentLow = lowerSum / lowerCount;
        } else {
          result.p95FrametimeMs = await readValue(file, Math.ceil(count * 0.95) - 1);
          result.p99FrametimeMs = await readValue(file, Math.ceil(count * 0.99) - 1);
          const threshold = Math.max(50, (mean('frametime') || 0) * 2);
          let left = 0;
          let right = count;
          while (left < right) {
            const middle = Math.floor((left + right) / 2);
            if (await readValue(file, middle) < threshold) left = middle + 1;
            else right = middle;
          }
          result.stutterCount = count - left;
        }
      } finally {
        await file.close();
      }
    }
    return result;
  }

  function dispose() {
    if (descriptor !== null) { fs.closeSync(descriptor); descriptor = null; }
    if (directory) {
      const root = path.resolve(captureRoot);
      if (path.dirname(directory) !== root || !path.basename(directory).startsWith('.nova-session-stats-')) throw new Error('Unexpected statistics directory.');
      fs.rmSync(directory, { recursive: true, force: true });
      directory = null;
    }
  }

  return { add, addFrame, mean, aggregates, liveDistribution, finalize, dispose,
    getFailure: () => failure,
    invalidate: (error) => { failure ||= error; },
    ownsDirectory: (candidate) => directory === path.resolve(candidate)
  };
}

module.exports = { createSessionStatistics, averageLowestSorted, percentileSorted, LIVE_SAMPLE_LIMIT, LIVE_UPDATE_INTERVAL_MS };
