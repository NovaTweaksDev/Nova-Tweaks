const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVICE_NAMES, validateRequest, createBackgroundServiceControl } = require('./backgroundServiceControl');

const original = { startType: 'Automatic', delayed: true, status: 'Running' };
const target = { startType: 'Disabled', delayed: true, status: 'Stopped' };

test('all requested Windows services can be disabled and restored through the same broker validation', () => {
  const requested = ['DPS', 'wisvc', 'SysMain', 'WSearch', 'Spooler', 'lfsvc', 'TabletInputService', 'RemoteRegistry', 'RetailDemo', 'SCardSvr', 'bthserv'];
  for (const name of requested) {
    assert.ok(SERVICE_NAMES.includes(name));
    assert.equal(validateRequest({ action: 'disable', name, expected: original, target }).name, name);
    assert.deepEqual(validateRequest({ action: 'restore', name, expected: target, target: original }).target, original);
  }
  assert.equal(new Set(SERVICE_NAMES.map(name => name.toLowerCase())).size, SERVICE_NAMES.length);
});
test('broker service operations reject arbitrary names, scripts, states and commands', () => {
  for (const payload of [
    { action: 'read', names: ['WinDefend'] },
    { action: 'execute', command: 'whoami' },
    { action: 'disable', name: 'WinDefend', expected: original, target },
    { action: 'disable', name: 'WSearch; Stop-Process', expected: original, target },
    { action: 'disable', name: 'WSearch', expected: original, target: original },
    { action: 'restore', name: 'WSearch', expected: original, target: { ...target, startType: 'Boot' } }
  ]) assert.throws(() => validateRequest(payload));
  assert.equal(validateRequest({ action: 'disable', name: 'WSearch', expected: original, target }).name, 'WSearch');
});

test('fixed command validates expected state, refuses running dependents and never uses force', async () => {
  const run = createBackgroundServiceControl({ execute: (_file, args, options, callback) => {
    const script = args.at(-1);
    assert.match(script, /Same-State \$current \$request.expected/);
    assert.match(script, /SERVICE_DEPENDENTS_RUNNING/);
    assert.match(script, /WaitForStatus/);
    assert.doesNotMatch(script, /Stop-Service[^\n]*-Force/);
    assert.equal(options.windowsHide, true);
    callback(null, JSON.stringify({ ok: true, state: target }));
  } });
  assert.equal((await run({ action: 'disable', name: 'WSearch', expected: original, target })).ok, true);
  await assert.rejects(run({ action: 'read', script: 'bad' }), { code: 'ADMIN_BROKER_INVALID_PAYLOAD' });
});
