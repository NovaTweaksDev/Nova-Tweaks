const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const { PROTOCOL_VERSION, createLineDecoder, encodeMessage } = require('./adminBrokerProtocol');
const { quoteWindowsArgument } = require('./adminBrokerManager');

if (process.argv.includes('--nova-admin-broker-worker')) {
  const sessionIndex = process.argv.indexOf('--broker-session');
  const sessionId = String(process.argv[sessionIndex + 1] || '');
  const pipeIndex = process.argv.indexOf('--broker-pipe');
  const pipeName = String(process.argv[pipeIndex + 1] || '');
  const transport = pipeName ? net.connect(pipeName) : null;
  const sendHello = () => transport.write(encodeMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION, sessionId, pid: process.pid }));
  if (transport) transport.once('connect', sendHello);
  transport?.on('data', createLineDecoder((message) => {
    if (message?.type === 'shutdown') process.exit(0);
  }, () => process.exit(2)));
} else {
  async function createHostFixture(t) {
    const hostPath = path.resolve(__dirname, '..', '..', '..', 'tools', 'nova-admin-broker', 'bin', 'NovaAdminBrokerHost.exe');
    const pipeName = `\\\\.\\pipe\\nova-admin-host-test-${process.pid}-${crypto.randomUUID()}`;
    const sessionId = crypto.randomUUID();
    let child = null;
    let client = null;
    const connectionListeners = new Set();
    const server = net.createServer((socket) => {
      client = socket;
      for (const listener of connectionListeners) listener(socket);
    });
    t.after(() => {
      client?.destroy();
      server.close();
      child?.kill();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipeName, resolve);
    });
    return {
      hostPath,
      pipeName,
      sessionId,
      setChild(value) { child = value; },
      getClient() { return client; },
      onConnection(listener) { connectionListeners.add(listener); }
    };
  }

  test('native broker host rejects a foreign or differently signed parent', async (t) => {
    const fixture = await createHostFixture(t);

    const child = spawn(fixture.hostPath, [
      '--pipe', fixture.pipeName,
      '--parent-pid', String(process.pid),
      '--worker', process.execPath,
      '--app-path', __filename,
      '--session', fixture.sessionId
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    fixture.setChild(child);
    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(exitCode, 13);
    assert.equal(fixture.getClient(), null);
  });

  test('native broker host permits the unsigned local-test worker only with the explicit flag', async (t) => {
    const fixture = await createHostFixture(t);
    const hello = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Timed out waiting for local-test broker handshake.')), 5000);
      fixture.onConnection((client) => {
        client.on('data', createLineDecoder((message) => {
          if (message?.type !== 'hello') return;
          clearTimeout(deadline);
          resolve(message);
        }, reject));
      });
    });
    const child = spawn(fixture.hostPath, [
      '--pipe', fixture.pipeName,
      '--parent-pid', String(process.pid),
      '--worker', process.execPath,
      '--app-path', __filename,
      '--session', fixture.sessionId,
      '--allow-unsigned-local-test'
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    fixture.setChild(child);

    const message = await hello;
    assert.equal(message.protocolVersion, PROTOCOL_VERSION);
    assert.equal(message.sessionId, fixture.sessionId);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    fixture.getClient().write(encodeMessage({ type: 'shutdown', protocolVersion: PROTOCOL_VERSION }));
    const exitCode = await exited;
    assert.equal(exitCode, 0);
  });

  test('PowerShell launcher preserves the installed worker path with spaces', async (t) => {
    const fixture = await createHostFixture(t);
    const launchArguments = [
      '--pipe', fixture.pipeName,
      '--parent-pid', String(process.pid),
      '--worker', process.execPath,
      '--app-path', __filename,
      '--session', fixture.sessionId,
      '--allow-unsigned-local-test'
    ].map(quoteWindowsArgument).join(' ');
    const encodedArguments = Buffer.from(launchArguments, 'utf8').toString('base64');
    const command = [
      `$arguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedArguments}'))`,
      `$process = Start-Process -FilePath '${fixture.hostPath.replace(/'/g, "''")}' -ArgumentList $arguments -WindowStyle Hidden -PassThru`,
      '$process.Id'
    ].join('; ');
    const launched = new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        timeout: 5000
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const hello = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Timed out waiting for PowerShell broker handshake.')), 5000);
      fixture.onConnection((client) => {
        client.on('data', createLineDecoder((message) => {
          if (message?.type !== 'hello') return;
          clearTimeout(deadline);
          resolve(message);
        }, reject));
      });
    });

    await launched;
    const message = await hello;
    assert.equal(message.sessionId, fixture.sessionId);
    fixture.getClient().write(encodeMessage({ type: 'shutdown', protocolVersion: PROTOCOL_VERSION }));
  });
}
