const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createDisplayProfileProvider } = require('./displayProfileProvider');
const { displayEqual } = require('./displayProfileService');

// Explicit opt-in: these tests temporarily change supported NVIDIA scaling,
// protected by the independent native recovery guard. Normal npm test is read-only.
const enabled = process.platform === 'win32' && process.env.NOVA_DISPLAY_HARDWARE_TEST === '1';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test('native confirmed guard disarms completely before normal shutdown without restoring', { skip: !enabled }, async (t) => {
  const provider = createDisplayProfileProvider(); const display = (await provider.list())[0];
  if (!display) return t.skip('No active display.');
  const original = await provider.capture(display.id);
  let restored = false;
  const guard = await provider.watch(original, { confirmed: true, onRestore: () => { restored = true; } });
  await guard.disarmAndWait();
  assert.equal(restored, false);
  assert.equal(displayEqual(await provider.capture(display.id), original), true);
});

function alternate(original, scaling = original.scaling === 2 ? 1 : 2) {
  const result = structuredClone(original);
  // Version-1 layout is statically asserted by the native helper.
  result.scaling = scaling;
  const bytes = Buffer.from(result.token, 'hex'); bytes.writeInt32LE(result.scaling, 96);
  result.token = bytes.toString('hex'); return result;
}
test('native snapshots discard legacy range data and merge only vibrance without changing displays', {skip: !enabled}, async(t)=>{
 const provider=createDisplayProfileProvider();const display=(await provider.list()).find(d=>d.capabilities.vibrance);
 if(!display)return t.skip('No readable Digital Vibrance.');
 const original=await provider.capture(display.id,{vibrance:true});const partial=await provider.capture(display.id);
 const bytes=Buffer.from(partial.token,'hex');bytes.writeUInt32LE(1,108);bytes.fill(9,132,156);
 const merged=await provider.merge({...partial,token:bytes.toString('hex')},original);
 assert.equal(displayEqual(merged,original),true);assert.equal('colorRange' in merged,false);
 const clean=Buffer.from(merged.token,'hex');assert.equal(clean.readUInt32LE(108),0);assert.equal(clean.subarray(132,156).every(v=>v===0),true);
 assert.equal(displayEqual(await provider.capture(display.id,{vibrance:true}),original),true);
});

test('native display profiles: scaling round trip, timeout and owner crash', { skip: !enabled, timeout: 60000 }, async (t) => {
  const provider = createDisplayProfileProvider();
  const displays = await provider.list();
  const display = displays.find((entry) => entry.capabilities.nvidiaScaling);
  if (!display) return t.skip('No supported NVIDIA display connected.');
  const original = await provider.capture(display.id);
  const target = alternate(original);
  const baseline = await Promise.all(displays.map((entry) => provider.capture(entry.id)));
  await provider.validate(original); await provider.validate(target);
  const validated = await Promise.all(displays.map((entry) => provider.capture(entry.id)));
  assert.equal(validated.every((entry, index) => displayEqual(entry, baseline[index])), true, 'Preflight must not change any display settings.');
  let guard;
  try {
    guard = await provider.watch(original);
    await provider.apply(target);
    let actual = await provider.capture(display.id);
    assert.equal(actual.scaling, target.scaling);
    guard.expect(actual); guard.confirm();
    await provider.apply(original); guard.disarm(); guard = null;
    assert.equal(displayEqual(await provider.capture(display.id), original), true);
    t.diagnostic('NVIDIA scaling applied and restored on real hardware.');

    guard = await provider.watch(original);
    try {
      for (const scaling of [5, 2, 6, 1]) {
        const next = alternate(original, scaling);
        await provider.validate(next);
        await provider.apply(next);
        const actual = await provider.capture(display.id);
        if ([1, 2].includes(scaling)) assert.equal(actual.scaling, scaling, 'Full-screen scaling must be read back exactly.');
        else t.diagnostic(`Aspect ratio request ${scaling}: driver readback ${actual.scaling}; aspect ratio switching remains blocked in the service.`);
        guard.expect(actual); guard.confirm();
      }
    } finally { await provider.apply(original); guard.disarm(); guard = null; }
    assert.equal(displayEqual(await provider.capture(display.id), original), true);
    t.diagnostic('Full-screen applied after aspect ratio requests, original state restored.');

    if (display.capabilities.vibrance) {
      const options = { vibrance: true };
      const colors = await provider.capture(display.id, options);
      const changed = structuredClone(colors); const bytes = Buffer.from(changed.token, 'hex');
      if (options.vibrance) {
        const raw = bytes.readInt32LE(116), maximum = bytes.readInt32LE(124);
        bytes.writeInt32LE(raw === maximum ? raw - 1 : raw + 1, 116);
      }
      changed.token = bytes.toString('hex');
      guard = await provider.watch(colors);
      try {
        await provider.apply(changed);
        const actual = await provider.capture(display.id, options);
        if (options.vibrance) assert.notEqual(actual.nativeState.vibrance, colors.nativeState.vibrance);
        guard.expect(actual); guard.confirm();
      } finally { await provider.apply(colors); guard.disarm(); guard = null; }
      assert.equal(displayEqual(await provider.capture(display.id, options), colors), true);
      t.diagnostic('Digital Vibrance changed and restored.');
    }

    let finishRecovery, failRecovery;
    const recovered = new Promise((resolve, reject) => { finishRecovery = resolve; failRecovery = reject; });
    guard = await provider.watch(original, { onRestore: finishRecovery, onFailure: failRecovery });
    await provider.apply(target);
    await recovered; guard = null;
    assert.equal(displayEqual(await provider.capture(display.id), original), true);
    t.diagnostic('Unconfirmed settings restored after the native 15-second deadline.');

    const providerModule = path.join(__dirname, 'displayProfileProvider.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-native-crash-'));
    const errorFile = path.join(root, 'guard-errors.txt');
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = `
      const {createDisplayProfileProvider}=require(process.argv[1]);
      (async()=>{
        const p=createDisplayProfileProvider({watchErrorPath:process.argv[4]});
        const original=JSON.parse(process.argv[2]), target=JSON.parse(process.argv[3]);
        const guard=await p.watch(original);
        await p.apply(target);
        const actual=await p.capture(original.id);
        guard.expect(actual); guard.confirm();
        process.stdout.write('ready\\n');
        setInterval(()=>{},1000);
      })().catch(error=>{console.error(error.message);process.exitCode=1;});
    `;
    const owner = spawn(process.execPath, ['-e', source, providerModule, JSON.stringify(original), JSON.stringify(target), errorFile], { windowsHide: true });
    let diagnostics = '';
    owner.stderr.on('data', (chunk) => { diagnostics += chunk; });
    try {
      await new Promise((resolve, reject) => {
        let text = '';
        owner.stdout.on('data', (chunk) => { text += chunk; if (text.includes('ready\n')) resolve(); });
        owner.on('error', reject); owner.on('exit', () => reject(new Error(diagnostics || 'Owner exited before setup.')));
      });
      owner.kill();
      let restored = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await wait(150);
        if (displayEqual(await provider.capture(display.id), original)) { restored = true; break; }
      }
      assert.equal(restored, true, `Native guard must survive its owner: ${fs.existsSync(errorFile) ? fs.readFileSync(errorFile, 'utf8') : diagnostics}`);
      t.diagnostic('Original display state restored after forced owner-process termination.');
    } finally { owner.kill(); }
    const after = await Promise.all(displays.map((entry) => provider.capture(entry.id)));
    for (let index = 0; index < after.length; index += 1) {
      if (!displayEqual(after[index], baseline[index])) {
        const summary = (entry) => ({ ...entry, token: undefined });
        t.diagnostic(JSON.stringify({ before: summary(baseline[index]), after: summary(after[index]) }));
      }
    }
    assert.equal(after.every((entry, index) => displayEqual(entry, baseline[index])), true, 'Other monitors must remain unchanged.');
  } finally {
    await provider.apply(original);
    guard?.disarm();
  }
});
