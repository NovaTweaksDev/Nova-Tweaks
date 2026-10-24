const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDisplayProfileProvider } = require('./displayProfileProvider');

async function fixture() {
  const child = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const commands = [];
  child.stdin.write = (command) => { commands.push(command); return true; };
  child.stdin.end = () => assert.fail('Closing stdin can trigger recovery before disarm is read.');
  child.kill = () => assert.fail('A running recovery guard must not be killed during these tests.');
  const provider = createDisplayProfileProvider({ spawnProcess: () => child });
  const pending = provider.watch({ id: 'monitor', token: 'saved-state' }, { confirmed: true });
  child.stdout.emit('data', Buffer.from('{"ready":true}\n'));
  return { guard: await pending, child, commands };
}

test('disarm keeps stdin open and waits for helper close, including repeated callers', async () => {
  const f = await fixture();
  f.guard.expect({ token: 'desktop' });
  const stopping = f.guard.disarmAndWait();
  assert.equal(f.guard.disarmAndWait(), stopping);
  f.guard.disarm();
  assert.deepEqual(f.commands, ['expected desktop\n', 'disarm\n']);
  let stopped = false; stopping.then(() => { stopped = true; });
  f.child.emit('exit', 0);
  await new Promise(setImmediate);
  assert.equal(stopped, false, 'Exit alone does not guarantee stdout was drained.');
  f.child.emit('close', 0);
  await stopping;
});

test('a helper that restored instead of disarming is not accepted as a clean stop', async () => {
  const f = await fixture();
  const stopping = f.guard.disarmAndWait();
  f.child.stdout.emit('data', Buffer.from('{"restored":true}\n'));
  f.child.emit('exit', 0); f.child.emit('close', 0);
  await assert.rejects(stopping, /did not disarm cleanly/);
});

test('verified native recovery can be reaped without sending commands to an exited helper', async () => {
  const f = await fixture();
  f.child.stdout.emit('data', Buffer.from('{"restored":true}\n'));
  f.child.emit('exit', 0); f.child.emit('close', 0);
  await f.guard.disarmAndWait({ allowRestore: true });
  assert.deepEqual(f.commands, []);
});

test('nonzero helper exit fails disarm even when no recovery event was received', async () => {
  const f = await fixture();
  const stopping = f.guard.disarmAndWait();
  f.child.stderr.emit('data', Buffer.from('Native guard failure'));
  f.child.emit('exit', 1); f.child.emit('close', 1);
  await assert.rejects(stopping, /Native guard failure/);
});
