const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createProcessSnapshotWorker } = require('./processSnapshotWorker');

function fixture(options = {}) {
  const children = [];
  const worker = createProcessSnapshotWorker({ script: 'initialization\n$items = @()\n$items | ConvertTo-Json',
    timeoutMs: 1000, ...options, spawnProcess: (_file, _args, settings) => {
      assert.equal(settings.windowsHide, true);
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.commands = []; child.killed = false;
      child.kill = () => { child.killed = true; };
      child.stdin.write = (text, callback) => {
        const encoded = text.match(/FromBase64String\('([^']+)'\)/)[1];
        const command = Buffer.from(encoded, 'base64').toString();
        const id = Number(command.match(/NOVA_SNAPSHOT:(\d+):/)[1]);
        child.commands.push({ command, id, callback });
      };
      children.push(child);
      return child;
    } });
  function reply(child, value = { ok: true, processes: [] }, id = child.commands.at(-1).id) {
    child.stdout.emit('data', Buffer.from(`NOVA_SNAPSHOT:${id}:${Buffer.from(JSON.stringify(value)).toString('base64')}\n`));
  }
  return { worker, children, reply };
}

test('successive snapshots reuse one worker and pending calls share one request', async (t) => {
  const f = fixture(); t.after(() => f.worker.stop());
  const first = f.worker.snapshot({ includeMetrics: false });
  assert.equal(f.worker.snapshot(), first);
  assert.match(f.children[0].commands[0].command, /\$includeMetrics = \$false/);
  f.reply(f.children[0], { ok: true, processes: [{ pid: 5 }] });
  assert.deepEqual(await first, [{ pid: 5 }]);
  const second = f.worker.snapshot({ includeMetrics: true });
  assert.match(f.children[0].commands[1].command, /\$includeMetrics = \$true/);
  f.reply(f.children[0]); await second;
  assert.equal(f.children.length, 1);
});

test('old responses and incidental output cannot complete a newer request', async (t) => {
  const f = fixture(); t.after(() => f.worker.stop());
  const first = f.worker.snapshot(); f.reply(f.children[0]); await first;
  const second = f.worker.snapshot();
  let finished = false; second.then(() => { finished = true; });
  f.children[0].stdout.emit('data', Buffer.from('unrelated output\n'));
  f.reply(f.children[0], { ok: true, processes: [{ pid: 99 }] }, 1);
  await new Promise(setImmediate); assert.equal(finished, false);
  f.reply(f.children[0], { ok: true, processes: [{ pid: 7 }] });
  assert.deepEqual(await second, [{ pid: 7 }]);
});

test('failed queries reject instead of reporting an empty process list, and restart next poll', async (t) => {
  const f = fixture(); t.after(() => f.worker.stop());
  const first = f.worker.snapshot();
  f.reply(f.children[0], { ok: false, message: 'Enumeration failed' });
  await assert.rejects(first, /Enumeration failed/);
  assert.equal(f.children[0].killed, true);
  const second = f.worker.snapshot();
  f.reply(f.children[1]); await second;
  assert.equal(f.children.length, 2);
});

test('timeouts and shutdown cancel pending reads without leaking a worker', async () => {
  const f = fixture({ timeoutMs: 10 });
  await assert.rejects(f.worker.snapshot(), /timed out/);
  assert.equal(f.children[0].killed, true);
  const second = f.worker.snapshot(); f.worker.stop();
  await assert.rejects(second, /stopped/);
  assert.equal(f.children[1].killed, true);
  const third = f.worker.snapshot();
  f.children[0].commands[0].callback(new Error('late old pipe error'));
  f.reply(f.children[2]); await third;
  assert.equal(f.children[2].killed, false);
  f.worker.stop();
});
