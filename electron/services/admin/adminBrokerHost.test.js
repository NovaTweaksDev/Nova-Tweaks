const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { PROTOCOL_VERSION, createLineDecoder, encodeMessage } = require('./adminBrokerProtocol');

if (process.argv.includes('--nova-admin-broker-worker')) {
  const sessionIndex = process.argv.indexOf('--broker-session');
  const sessionId = String(process.argv[sessionIndex + 1] || '');
  process.stdout.write(encodeMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION, sessionId, pid: process.pid }));
  process.stdin.on('data', createLineDecoder((message) => {
    if (message?.type === 'shutdown') process.exit(0);
  }, () => process.exit(2)));
} else {
  test('native broker host rejects a foreign or differently signed parent', async (t) => {
    const hostPath = path.resolve(__dirname, '..', '..', '..', 'tools', 'nova-admin-broker', 'bin', 'NovaAdminBrokerHost.exe');
    const pipeName = `\\\\.\\pipe\\nova-admin-host-test-${process.pid}-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();
    let child = null;
    let client = null;
    const server = net.createServer((socket) => { client = socket; });
    t.after(() => {
      client?.destroy();
      server.close();
      child?.kill();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipeName, resolve);
    });

    child = spawn(hostPath, [
      '--pipe', pipeName,
      '--parent-pid', String(process.pid),
      '--worker', process.execPath,
      '--app-path', __filename,
      '--session', sessionId
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(exitCode, 13);
    assert.equal(client, null);
  });
}
