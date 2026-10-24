const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDisplayProfileService, displayEqual } = require('./displayProfileService');
const { createProcessWatcherService } = require('../automation/processWatcherService');

const clone = (value) => structuredClone(value);
function snapshot(width = 1920, numerator = 240, denominator = 1) {
  return { id: 'monitor-a', name: 'Display A', fingerprint: 'monitor-a:driver-1', width, height: 1080,
    refresh: { numerator, denominator }, signal: { width: 1920, height: 1080, numerator: 240, denominator: 1 },
    scaling: 2, vibrance: null, token: `mode-${width}-${numerator}-${denominator}`, capabilities: { nvidiaScaling: true } };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-display-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let current = snapshot(); let guard, applyError, restoreError, validateError, time = 1000;
  const calls = [];
  const guards = [];
  const provider = {
    list: async () => [clone(current)],
    capture: async (id, options = {}) => {
      if (id !== current.id) throw new Error('Monitor missing');
      const captured = clone(current);
      if (!options.vibrance) { captured.vibrance = null; if (captured.nativeState) captured.nativeState.vibrance = -1; }
      return captured;
    },
    merge: async (base, fallback) => {
      const merged = clone(base);
      for (const key of ['vibrance']) {
        if (merged[key] === null && fallback[key] !== null) {
          merged[key] = fallback[key];
          const nativeKey = key;
          if (merged.nativeState) merged.nativeState[nativeKey] = fallback.nativeState[nativeKey];
        }
      }
      return merged;
    },
    validate: async (value) => { calls.push(['validate', value.width]); if (validateError) throw validateError; },
    apply: async (value) => {
      calls.push(['apply', value.width]);
      if (value.width !== 1920 && applyError) { current = clone(value); throw applyError; }
      if (value.width === 1920 && restoreError) throw restoreError;
      current = clone(value);
    },
    watch: async (original, options) => {
      const created = { original: clone(original), options, disarmed: false, stopped: false, confirmed: options.confirmed,
        expect: (value) => { created.expected = value; },
        confirm: () => { created.confirmed = true; }, disarm: () => { created.disarmed = true; } };
      created.disarmAndWait = async () => { created.disarmed = true; created.stopped = true; };
      guard = created; guards.push(created);
      return guard;
    }
  };
  const service = createDisplayProfileService({ provider, root, now: () => time, ...options });
  return { service, root, provider, calls, guards, get guard() { return guard; }, get current() { return clone(current); },
    setCurrent: (value) => { current = clone(value); }, setTime: (value) => { time = value; },
    failApply: () => { applyError = new Error('Partial apply'); }, failRestore: () => { restoreError = new Error('Restore failed'); },
    failValidate: () => { validateError = new Error('Unsupported mode'); } };
}
async function gaming(f, width = 1728, name = 'Stretch') {
  f.setCurrent(snapshot(width));
  await f.service.capture({ kind: 'gaming', name, monitorId: 'monitor-a' });
  const profile = f.service.getState().profiles.at(-1);
  f.setCurrent(snapshot()); return profile;
}
async function confirmed(f, id) {
  await f.service.activate(id);
  await f.service.confirm(f.service.getState().transaction.id);
}

test('captures exact fractional refresh rates and distinguishes desktop from output signal', async (t) => {
  const f = fixture(t); f.setCurrent(snapshot(1728, 239760, 1000));
  await f.service.capture({ kind: 'gaming', name: 'Fractional', monitorId: 'monitor-a' });
  const saved = f.service.getState().profiles[0].snapshot;
  assert.deepEqual(saved.refresh, { numerator: 239760, denominator: 1000 });
  assert.equal(saved.signal.width, 1920); assert.equal(saved.width, 1728);
  assert.equal(displayEqual(saved, { ...saved, refresh: { numerator: 23976, denominator: 100 } }), true);
});
test('blocks aspect ratio targets and return states before any display mutation', async (t) => {
  for (const scaling of [5, 6]) {
    const f = fixture(t);
    f.setCurrent({ ...snapshot(1728), scaling });
    await f.service.capture({ kind: 'gaming', name: 'Aspect', monitorId: 'monitor-a' });
    const aspect = f.service.getState().profiles[0];
    f.setCurrent(snapshot());
    await assert.rejects(f.service.activate(aspect.id), { code: 'DISPLAY_SCALING_UNVERIFIED' });
    await assert.rejects(f.service.validate(aspect.id), { code: 'DISPLAY_SCALING_UNVERIFIED' });
    const fullscreen = await gaming(f);
    f.setCurrent({ ...snapshot(), scaling });
    await assert.rejects(f.service.activate(fullscreen.id), { code: 'DISPLAY_SCALING_UNVERIFIED' });
    assert.equal(f.calls.some(([operation]) => operation === 'apply'), false);
    assert.equal(f.guard, undefined);
    assert.equal(f.service.getState().transaction, null);
  }
});
test('cannot enable automatic switching while the current return state uses aspect ratio', async (t) => {
  const f = fixture(t); const profile = await gaming(f);
  await confirmed(f, profile.id); await f.service.restore();
  await f.service.configure({ id: profile.id, executablePath: 'C:\\Games\\game.exe' });
  f.setCurrent({ ...snapshot(), scaling: 5 });
  await assert.rejects(f.service.configure({ id: profile.id, auto: true }), { code: 'DISPLAY_SCALING_UNVERIFIED' });
  assert.equal(f.service.getState().profiles[0].auto, false);
});
test('returns to the immediately previous state rather than the saved desktop profile', async (t) => {
  const f = fixture(t);
  await f.service.capture({ kind: 'desktop', name: 'Desktop', monitorId: 'monitor-a' });
  const profile = await gaming(f); f.setCurrent(snapshot(1920, 280));
  await confirmed(f, profile.id); await f.service.restore();
  assert.equal(f.current.refresh.numerator, 280);
  assert.equal(f.service.getState().profiles[0].snapshot.refresh.numerator, 240);
  assert.equal(f.service.getState().transaction, null); assert.equal(f.guard.disarmed, true);
});
test('automatically captures vibrance variants at identical resolutions during an active session', async (t) => {
  const f = fixture(t);
  f.setCurrent({ ...snapshot(1720), vibrance: 57 });
  await f.service.capture({ kind: 'gaming', name: '57', monitorId: 'monitor-a' });
  const first = f.service.getState().profiles[0];
  f.setCurrent({ ...snapshot(), vibrance: 50 }); await confirmed(f, first.id);
  const journal = fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8');
  f.setCurrent({ ...snapshot(1720), vibrance: 70 });
  await f.service.capture({ kind: 'gaming', name: '70', monitorId: 'monitor-a', vibrance: false, colorRange: true });
  assert.deepEqual(f.service.getState().profiles.map(p => [p.snapshot.width,p.snapshot.vibrance]), [[1720,57],[1720,70]]);
  assert.equal(fs.readFileSync(path.join(f.root,'recovery.json'),'utf8'),journal);
  assert.equal('colorRange' in f.service.getState().profiles[1].snapshot,false);
  await assert.rejects(f.service.restore(), { code: 'DISPLAY_EXTERNAL_CHANGE' });
  await f.service.restore({ force: true }); assert.equal(f.current.vibrance,50);
});

test('captures a new resolution during a confirmed session but blocks replacing its active profile', async (t) => {
  const f = fixture(t); const profile = await gaming(f);
  await confirmed(f, profile.id);
  const original = f.service.getState().transaction.original;
  f.setCurrent(snapshot(1720));
  await f.service.capture({ kind: 'gaming', name: '1720', monitorId: 'monitor-a' });
  assert.equal(f.service.getState().profiles.at(-1).snapshot.width, 1720);
  assert.deepEqual(f.service.getState().transaction.original, original);
  await assert.rejects(f.service.capture({ id: profile.id, kind: 'gaming', name: 'Replace', monitorId: 'monitor-a' }), { code: 'DISPLAY_PROFILE_ACTIVE' });
  await f.service.keepCurrent();
  await f.service.capture({ kind: 'desktop', name: 'Desktop 1720', monitorId: 'monitor-a' });
  assert.equal(f.service.getState().profiles.at(-1).snapshot.width, 1720);
});
test('deletes saved and active profiles while retaining the independent recovery snapshot', async (t) => {
  const f = fixture(t); const profile = await gaming(f); const other = await gaming(f, 1440, 'Other');
  await confirmed(f, profile.id);
  const journal = fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8');
  await f.service.remove(other.id); await f.service.remove(profile.id);
  assert.equal(f.service.getState().profiles.length, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8'), journal);
  assert.equal(f.guard.disarmed, false);
  assert.equal(createDisplayProfileService({ provider: f.provider, root: f.root }).getState().profiles.length, 0);
  await f.service.restore();
  assert.equal(f.current.width, 1920); assert.equal(f.service.getState().transaction, null);
});
test('capture and deletion of the tested profile wait for the confirmation decision', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await f.service.activate(profile.id);
  await assert.rejects(f.service.capture({ kind: 'gaming', name: 'Another', monitorId: 'monitor-a' }), { code: 'DISPLAY_PROFILE_ACTIVE' });
  await assert.rejects(f.service.remove(profile.id), { code: 'DISPLAY_PROFILE_ACTIVE' });
  await f.service.confirm(f.service.getState().transaction.id); await f.service.remove(profile.id);
  await f.service.restore(); assert.equal(f.current.width, 1920);
});
test('switching gaming profiles preserves the original recovery state', async (t) => {
  const f = fixture(t); const first = await gaming(f); const second = await gaming(f, 1440, 'Other');
  await confirmed(f, first.id); await confirmed(f, second.id); await f.service.restore();
  assert.equal(f.current.width, 1920);
});
test('switching vibrance profiles retains the original return value', async (t) => {
  const f=fixture(t);const desktop={...snapshot(),vibrance:50};
  const ids=[];
  for(const vibrance of [57,70]) { f.setCurrent({...desktop,vibrance}); await f.service.capture({kind:'gaming',name:String(vibrance),monitorId:'monitor-a'});ids.push(f.service.getState().profiles.at(-1).id); }
  f.setCurrent(desktop); await confirmed(f,ids[0]); const original=f.service.getState().transaction.original;
  await confirmed(f,ids[1]);assert.equal(f.current.vibrance,70);assert.deepEqual(f.service.getState().transaction.original,original);
  await f.service.restore();assert.deepEqual(f.current,desktop);
});

test('legacy profiles without vibrance retain the live value', async (t) => {
 const f=fixture(t); const p=await gaming(f); f.setCurrent({...snapshot(),vibrance:70});
 await confirmed(f,p.id);assert.equal(f.current.vibrance,70);await f.service.restore();assert.equal(f.current.vibrance,70);
});

test('failed switch restores original vibrance', async (t)=>{
 const f=fixture(t);f.setCurrent({...snapshot(1720),vibrance:70});await f.service.capture({kind:'gaming',name:'70',monitorId:'monitor-a'});
 f.setCurrent({...snapshot(),vibrance:50});f.failApply();await assert.rejects(f.service.activate(f.service.getState().profiles[0].id),/Partial apply/);
 assert.equal(f.current.vibrance,50);assert.equal(f.service.getState().transaction,null);
});

test('saved vibrance requires a reliably restorable live value',async(t)=>{
 const f=fixture(t);f.setCurrent({...snapshot(),vibrance:70});await f.service.capture({kind:'gaming',name:'70',monitorId:'monitor-a'});
 f.setCurrent(snapshot());await assert.rejects(f.service.activate(f.service.getState().profiles[0].id),{code:'DISPLAY_PROPERTY_UNRESTORABLE'});
 assert.equal(f.calls.some(([operation])=>operation==='apply'),false);
});

test('external vibrance changes remain conflicts',async(t)=>{
 const f=fixture(t);f.setCurrent({...snapshot(1720),vibrance:70});await f.service.capture({kind:'gaming',name:'70',monitorId:'monitor-a'});
 f.setCurrent({...snapshot(),vibrance:50});await confirmed(f,f.service.getState().profiles[0].id);
 f.setCurrent({...f.current,vibrance:60});await assert.rejects(f.service.restore(),{code:'DISPLAY_EXTERNAL_CHANGE'});
 assert.equal(f.current.vibrance,60);await f.service.restore({force:true});assert.equal(f.current.vibrance,50);
});

test('outside output range changes do not cause conflicts or enter apply and recovery snapshots', async (t) => {
  const f = fixture(t);
  f.setCurrent({ ...snapshot(1720), vibrance: 70, colorRange: 'Full' });
  await f.service.capture({ kind: 'gaming', name: '70', monitorId: 'monitor-a' });
  const apply = f.provider.apply;
  f.provider.apply = async (target) => {
    assert.equal('colorRange' in target, false);
    const range = f.current.colorRange;
    await apply(target);
    f.setCurrent({ ...f.current, colorRange: range });
  };
  f.setCurrent({ ...snapshot(), vibrance: 50, colorRange: 'Full' });
  await confirmed(f, f.service.getState().profiles[0].id);
  assert.equal('colorRange' in f.guard.original, false);
  f.setCurrent({ ...f.current, colorRange: 'Limited' });
  await f.service.restore();
  assert.equal(f.current.colorRange, 'Limited');
  assert.equal(f.current.vibrance, 50);
  assert.equal(f.service.getState().transaction, null);
});

test('validates before mutation and rejects changed hardware', async (t) => {
  const f = fixture(t); const profile = await gaming(f);
  f.failValidate(); await assert.rejects(f.service.activate(profile.id), /Unsupported mode/);
  assert.equal(f.calls.some(([operation]) => operation === 'apply'), false);
  assert.equal(f.service.getState().transaction, null);
  f.setCurrent({ ...snapshot(), fingerprint: 'new-driver' });
  await assert.rejects(f.service.activate(profile.id), { code: 'DISPLAY_HARDWARE_CHANGED' });
});
test('partial application restores the saved state and leaves no transaction', async (t) => {
  const f = fixture(t); const profile = await gaming(f); f.failApply();
  await assert.rejects(f.service.activate(profile.id), /Partial apply/);
  assert.equal(f.current.width, 1920); assert.equal(f.service.getState().transaction, null);
});

for (const [property, change] of [
  ['desktop resolution', (state) => { state.width = 1600; }],
  ['refresh rate', (state) => { state.refresh.numerator = 144; }],
  ['fractional refresh rate', (state) => { state.refresh = { numerator: 239760, denominator: 1000 }; }],
  ['output signal resolution', (state) => { state.signal.width = 1728; }],
  ['output signal refresh', (state) => { state.signal.numerator = 144; }],
  ['NVIDIA scaling', (state) => { state.scaling = 1; }],
  ['pixel clock', (state) => { state.nativeState.pixelRate = '584640001'; }],
  ['horizontal timing', (state) => { state.nativeState.totalWidth = 2200; }],
  ['vertical timing', (state) => { state.nativeState.totalHeight = 1161; }],
  ['Windows scaling', (state) => { state.nativeState.windowsScaling = 2; }],
  ['scanline ordering', (state) => { state.nativeState.scanline = 2; }]
]) {
  test(`driver success with incorrect ${property} is rejected and rolled back`, async (t) => {
    const f = fixture(t);
    const native = { pixelRate: '584640000', totalWidth: 2100, totalHeight: 1160,
      windowsScaling: 1, scanline: 1, vibrance: -1 };
    f.setCurrent({ ...snapshot(1728), nativeState: clone(native) });
    await f.service.capture({ kind: 'gaming', name: 'Exact driver mode', monitorId: 'monitor-a' });
    const profile = f.service.getState().profiles[0];
    const original = { ...snapshot(), nativeState: clone(native) };
    f.setCurrent(original);
    f.provider.apply = async (target) => {
      const actual = clone(target);
      if (target.width === 1728) change(actual);
      f.setCurrent(actual);
    };
    await assert.rejects(f.service.activate(profile.id), { code: 'DISPLAY_APPLY_MISMATCH' });
    assert.equal(displayEqual(f.current, original), true);
    assert.equal(f.service.getState().transaction, null);
    assert.equal(f.service.getState().profiles[0].tested, null);
  });
}

test('partial driver failure restores the saved boot mode even when the live mode already returned', async (t) => {
  const f = fixture(t); const profile = await gaming(f);
  let savedBootWidth = 1920;
  f.provider.apply = async (target) => {
    savedBootWidth = target.width;
    if (target.width === 1728) {
      f.setCurrent(snapshot());
      throw new Error('Driver returned to the live desktop after saving the target');
    }
    f.setCurrent(target);
  };
  await assert.rejects(f.service.activate(profile.id), /Driver returned/);
  assert.equal(savedBootWidth, 1920);
  assert.equal(f.current.width, 1920);
  assert.equal(f.service.getState().transaction, null);
});

test('explicit restoration persists the return mode even if the live display already matches', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  f.setCurrent(snapshot());
  const previousApplies = f.calls.filter(([operation]) => operation === 'apply').length;
  await f.service.restore();
  assert.equal(f.calls.filter(([operation]) => operation === 'apply').length, previousApplies + 1);
  assert.equal(f.calls.at(-1)[0], 'apply'); assert.equal(f.calls.at(-1)[1], 1920);
  assert.equal(f.service.getState().transaction, null);
});
test('legacy output range is removed from profiles, tokens and recovery without requiring a connected monitor',async(t)=>{
 const f=fixture(t);const p=await gaming(f);await confirmed(f,p.id);
 const bytes=Buffer.alloc(160);bytes.writeUInt32LE(0x4e445031,0);bytes.writeUInt32LE(160,4);bytes.writeUInt32LE(1,108);bytes.fill(9,132,156);
 const addRange=(s)=>({...s,colorRange:'Full',capabilities:{...s.capabilities,colorRange:true},nativeState:{rangePolicy:0},token:bytes.toString('hex')});
 const profilesFile=path.join(f.root,'profiles.json');const stored=JSON.parse(fs.readFileSync(profilesFile));stored.profiles[0].snapshot=addRange(stored.profiles[0].snapshot);stored.profiles[0].auto=true;fs.writeFileSync(profilesFile,JSON.stringify(stored));
 const journalFile=path.join(f.root,'recovery.json');const journal=JSON.parse(fs.readFileSync(journalFile));journal.transaction.original=addRange(journal.transaction.original);journal.transaction.applied=addRange(journal.transaction.applied);journal.transaction.options={colorRange:true};fs.writeFileSync(journalFile,JSON.stringify(journal));
 f.provider.list=async()=>[];const restarted=createDisplayProfileService({provider:f.provider,root:f.root});
 const state=restarted.getState();assert.equal(state.profiles[0].auto,false);assert.equal(state.profiles[0].tested,null);assert.equal(state.transaction.status,'recovery');
 for(const s of [state.profiles[0].snapshot,state.transaction.original,state.transaction.applied]) {assert.equal('colorRange' in s,false);assert.equal('rangePolicy' in s.nativeState,false);const token=Buffer.from(s.token,'hex');assert.equal(token.readUInt32LE(108),0);assert.equal(token.subarray(132,156).every(v=>v===0),true);}
 assert.equal(fs.readFileSync(profilesFile,'utf8').includes('colorRange'),false);assert.equal(fs.readFileSync(journalFile,'utf8').includes('colorRange'),false);
});

test('failed rollback retains a durable recovery journal', async (t) => {
  const f = fixture(t); const profile = await gaming(f); f.failApply(); f.failRestore();
  await assert.rejects(f.service.activate(profile.id));
  assert.equal(f.service.getState().transaction.status, 'recovery');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'recovery.json'))).transaction.original.width, 1920);
  const restarted = createDisplayProfileService({ provider: f.provider, root: f.root });
  assert.equal(restarted.getState().transaction.status, 'recovery');
});
test('confirmation deadline cannot be bypassed and guard recovery clears the journal', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await f.service.activate(profile.id);
  const id = f.service.getState().transaction.id;
  f.setTime(16000); await assert.rejects(f.service.confirm(id), { code: 'DISPLAY_CONFIRM_EXPIRED' });
  f.setCurrent(f.guard.original); f.guard.options.onRestore();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.service.getState().transaction, null);
});
test('external changes are preserved until explicit restoration', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  f.setCurrent(snapshot(1600));
  await assert.rejects(f.service.restore(), { code: 'DISPLAY_EXTERNAL_CHANGE' });
  assert.equal(f.current.width, 1600); assert.equal(f.guard.disarmed, true);
  await f.service.restore({ force: true }); assert.equal(f.current.width, 1920);
});
test('rejects concurrent display operations', async (t) => {
  const f = fixture(t); let release;
  f.provider.list = () => new Promise((resolve) => { release = resolve; });
  const refresh = f.service.refresh();
  await assert.rejects(f.service.refresh(), { code: 'DISPLAY_BUSY' });
  release([]); await refresh;
});
const game = (pid = 10, startTime = '2026-10-10T10:00:00.000Z', executablePath = 'C:\\Games\\game.exe') => ({ pid, startTime, executablePath });
async function automatic(f, profile) {
  await confirmed(f, profile.id); await f.service.restore();
  await f.service.configure({ id: profile.id, executablePath: 'C:\\Games\\game.exe', auto: true });
}
test('automatic profiles require a manual confirmation', async (t) => {
  const f = fixture(t); const profile = await gaming(f);
  await assert.rejects(f.service.configure({ id: profile.id, executablePath: 'C:\\Games\\game.exe', auto: true }), { code: 'DISPLAY_TEST_REQUIRED' });
});
test('profiles without an assigned executable never attach processes with unreadable paths', async (t) => {
  const f = fixture(t); const profile = await gaming(f);
  await f.service.handleProcessSnapshot([game(9, 'audio', '')]);
  await confirmed(f, profile.id);
  assert.equal(f.service.getState().transaction.game, null);
  await f.service.handleProcessSnapshot([]);
  assert.equal(f.current.width, 1728);
  assert.equal(f.service.getState().transaction.game, null);
});

async function manualBaseline(f, profile) {
  await automatic(f, profile);
  await f.service.capture({ kind: 'desktop', name: 'Desktop', monitorId: 'monitor-a' });
  const desktop = f.service.getState().profiles.at(-1);
  f.setCurrent(snapshot(1600));
  await confirmed(f, desktop.id);
  return desktop;
}

test('automatic gaming switches from a confirmed manual desktop and resumes it after exit', async (t) => {
  const f = fixture(t); const profile = await gaming(f); const desktop = await manualBaseline(f, profile);
  const original = f.service.getState().transaction.original;
  await f.service.handleProcessSnapshot([game(9, 'audio', ''), game()]);
  assert.equal(f.current.width, 1728);
  assert.equal(f.service.getState().transaction.game.pid, 10);
  assert.equal(f.service.getState().transaction.returnTo.snapshot.width, 1920);
  assert.deepEqual(f.service.getState().transaction.original, original);
  const restarted = createDisplayProfileService({ provider: f.provider, root: f.root });
  assert.equal(restarted.getState().transaction.returnTo.snapshot.width, 1920);
  await f.service.handleProcessSnapshot([]);
  assert.equal(f.current.width, 1728, 'one missing sample must not change the display');
  await f.service.handleProcessSnapshot([]);
  assert.equal(f.current.width, 1920);
  assert.equal(f.service.getState().transaction.profileId, desktop.id);
  assert.equal(f.service.getState().transaction.game, null);
  assert.equal(f.service.getState().transaction.returnTo, undefined);
  assert.deepEqual(f.service.getState().transaction.original, original);
  assert.equal(f.guard.expected.width, 1920);
  await f.service.restore(); assert.equal(f.current.width, 1600);
});

test('the existing watcher starts for profile demand and drives desktop to gaming to desktop without recording', async (t) => {
  let watcher, rawProcesses = [], handled = Promise.resolve();
  const f = fixture(t, { onDemandChange: () => watcher?.applySettings() });
  watcher = createProcessWatcherService({
    historyPath: path.join(f.root, 'history.json'),
    getSettings: () => ({ automation: { processDetection: { enabled: false } } }),
    hasAdditionalDemand: () => f.service.needsProcessSnapshots(),
    snapshotProvider: async () => rawProcesses,
    onSnapshot: (processes) => { handled = f.service.handleProcessSnapshot(processes); }
  });
  t.after(() => watcher.stop());
  watcher.applySettings(); assert.equal(watcher.getState().running, false);
  const profile = await gaming(f); await manualBaseline(f, profile);
  assert.equal(watcher.getState().running, true);
  await handled;
  rawProcesses = [{ ...game(), name: 'game' }];
  await watcher.pollOnce(); await handled;
  assert.equal(f.current.width, 1728);
  assert.equal(watcher.getState().currentAlerts.length, 0);
  rawProcesses = []; await watcher.pollOnce(); await handled;
  assert.equal(f.current.width, 1728);
  await watcher.pollOnce(); await handled;
  assert.equal(f.current.width, 1920);
  await f.service.configure({ id: profile.id, auto: false });
  assert.equal(watcher.getState().running, false);
});

test('automatic apply failure resumes the manual baseline and suppresses retries for the same game', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await manualBaseline(f, profile);
  f.failApply(); await f.service.handleProcessSnapshot([game()]);
  assert.equal(f.current.width, 1920);
  assert.equal(f.service.getState().transaction.original.width, 1600);
  assert.equal(f.service.getState().transaction.game, null);
  const calls = f.calls.length;
  await f.service.handleProcessSnapshot([game()]); assert.equal(f.calls.length, calls);
});

test('automatic guard startup failure retains the previous guard and journal identity', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await manualBaseline(f, profile);
  const previousGuard = f.guard, previousId = f.service.getState().transaction.id;
  f.provider.watch = async () => { throw new Error('Guard failed'); };
  await f.service.handleProcessSnapshot([game()]);
  assert.equal(f.current.width, 1920);
  assert.equal(f.guard, previousGuard); assert.equal(previousGuard.disarmed, false);
  assert.equal(f.service.getState().transaction.id, previousId);
  assert.equal(f.service.getState().transaction.original.width, 1600);
});

test('automatic profiles do not replace an unconfirmed or externally changed manual baseline', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.capture({ kind: 'desktop', name: 'Desktop', monitorId: 'monitor-a' });
  const desktop = f.service.getState().profiles.at(-1);
  await f.service.activate(desktop.id);
  await f.service.handleProcessSnapshot([game()]); assert.equal(f.current.width, 1920);
  await f.service.confirm(f.service.getState().transaction.id);
  f.setCurrent(snapshot(1440));
  await f.service.handleProcessSnapshot([game()]);
  assert.equal(f.current.width, 1440); assert.equal(f.service.getState().lastError.code, 'DISPLAY_EXTERNAL_CHANGE');
});

test('manual restoration during automatic gaming prevents reactivation until game exit', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await manualBaseline(f, profile);
  await f.service.handleProcessSnapshot([game()]); await f.service.restore();
  assert.equal(f.current.width, 1600);
  await f.service.handleProcessSnapshot([game()]); assert.equal(f.service.getState().transaction, null);
});

test('shutdown during automatic gaming keeps the applied setup', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await manualBaseline(f, profile);
  await f.service.handleProcessSnapshot([game()]); await f.service.shutdown();
  assert.equal(f.current.width, 1728); assert.equal(f.service.getState().transaction, null);
  assert.equal(f.guard.disarmed, true);
});

test('game start and exit work without a recording; launcher does not match', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  assert.equal(f.service.needsProcessSnapshots(), true);
  await f.service.handleProcessSnapshot([game(5, 'launcher', 'C:\\Games\\launcher.exe')]);
  assert.equal(f.service.getState().transaction, null);
  await f.service.handleProcessSnapshot([game()]); assert.equal(f.current.width, 1728);
  assert.equal(f.guard.confirmed, true);
  await f.service.handleProcessSnapshot([]); assert.equal(f.current.width, 1728);
  await f.service.handleProcessSnapshot([]); assert.equal(f.current.width, 1920);
});
test('manual restoration suppresses reactivation until that process exits', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.handleProcessSnapshot([game()]); await f.service.restore();
  await f.service.handleProcessSnapshot([game()]); assert.equal(f.service.getState().transaction, null);
  await f.service.handleProcessSnapshot([]);
  await f.service.handleProcessSnapshot([game(10, 'new-start')]); assert.equal(f.current.width, 1728);
});
test('PID reuse ends the original game session', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.handleProcessSnapshot([game()]);
  await f.service.handleProcessSnapshot([game(10, 'different-start', 'C:\\Other\\other.exe')]);
  assert.equal(f.current.width, 1920); assert.equal(f.service.getState().transaction, null);
});
test('a second game cannot displace an active profile', async (t) => {
  const f = fixture(t); const first = await gaming(f); const second = await gaming(f, 1440);
  await automatic(f, first); await confirmed(f, second.id); await f.service.restore();
  await f.service.configure({ id: second.id, executablePath: 'C:\\Games\\second.exe', auto: true });
  await f.service.handleProcessSnapshot([game()]);
  await f.service.handleProcessSnapshot([game(), game(20, 'second', 'C:\\Games\\second.exe')]);
  assert.equal(f.current.width, 1728);
});

test('stable gameplay and Alt-Tab perform no native display calls, writes or UI broadcasts', async (t) => {
  let broadcasts = 0;
  const f = fixture(t, { onUpdate: () => { broadcasts += 1; } });
  const profile = await gaming(f); await automatic(f, profile);
  await f.service.handleProcessSnapshot([game()]);
  const journalBefore = fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8');
  const modifiedBefore = fs.statSync(path.join(f.root, 'recovery.json')).mtimeMs;
  let nativeCalls = 0;
  for (const name of Object.keys(f.provider)) f.provider[name] = async () => { nativeCalls += 1; throw new Error('Unexpected native call during gameplay'); };
  broadcasts = 0;
  for (let index = 0; index < 1000; index++) {
    await f.service.handleProcessSnapshot([{ ...game(), mainWindowHandle: index % 2, foreground: Boolean(index % 2) }]);
  }
  await f.service.handleProcessSnapshot([]);
  await f.service.handleProcessSnapshot([game()]);
  assert.equal(nativeCalls, 0);
  assert.equal(broadcasts, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8'), journalBefore);
  assert.equal(fs.statSync(path.join(f.root, 'recovery.json')).mtimeMs, modifiedBefore);
  assert.equal(f.service.getState().transaction.status, 'active');
});

test('temporarily unreadable creation times do not restore or reactivate an active game', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.handleProcessSnapshot([game()]);
  const calls = f.calls.length;
  for (let index = 0; index < 10; index++) await f.service.handleProcessSnapshot([], { unresolvedPids: [10] });
  assert.equal(f.calls.length, calls);
  assert.equal(f.current.width, 1728);
  await f.service.handleProcessSnapshot([game()]);
  await f.service.handleProcessSnapshot([]);
  assert.equal(f.current.width, 1728);
  await f.service.handleProcessSnapshot([]);
  assert.equal(f.current.width, 1920);
});

test('a transient missing sample does not discard manual suppression and reapply a game profile', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.handleProcessSnapshot([game()]); await f.service.restore();
  const calls = f.calls.length;
  await f.service.handleProcessSnapshot([]);
  await f.service.handleProcessSnapshot([game()]);
  assert.equal(f.calls.length, calls);
  assert.equal(f.service.getState().transaction, null);
});
test('recapture invalidates the confirmed test and disables automation', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.capture({ id: profile.id, kind: 'gaming', name: 'Updated', monitorId: 'monitor-a' });
  const updated = f.service.getState().profiles[0];
  assert.equal(updated.auto, false); assert.equal(updated.tested, null);
});
test('driver change blocks automatic activation and does not retry every poll', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  f.setCurrent({ ...snapshot(), fingerprint: 'driver-2' });
  await f.service.handleProcessSnapshot([game()]);
  assert.equal(f.service.getState().transaction, null);
  assert.equal(f.service.getState().lastError.code, 'DISPLAY_HARDWARE_CHANGED');
  await f.service.handleProcessSnapshot([game()]); assert.equal(f.current.width, 1920);
});
test('shutdown keeps a confirmed manual profile and removes its recovery journal', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  await f.service.shutdown(); assert.equal(f.current.width, 1728);
  assert.equal(f.guard.disarmed, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'recovery.json'))).transaction, null);
  assert.equal(createDisplayProfileService({ provider: f.provider, root: f.root }).getState().transaction, null);
});

test('shutdown keeps normal resolution when the original session state was stretch', async (t) => {
  const f = fixture(t);
  await f.service.capture({ kind: 'desktop', name: 'Desktop', monitorId: 'monitor-a' });
  f.setCurrent(snapshot(1720)); await confirmed(f, f.service.getState().profiles[0].id);
  assert.equal(f.service.getState().transaction.original.width, 1720);
  await f.service.shutdown(); assert.equal(f.current.width, 1920);
});

test('repeated game exits followed by Nova exit leave no old guard able to restore stretch', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await manualBaseline(f, profile);
  for (let index = 0; index < 10; index++) {
    await f.service.handleProcessSnapshot([game()]);
    assert.equal(f.current.width, 1728);
    await f.service.handleProcessSnapshot([]); await f.service.handleProcessSnapshot([]);
    assert.equal(f.current.width, 1920);
    assert.ok(f.guards.slice(0, -1).every((value) => value.stopped), 'Replaced guards must have exited.');
  }
  await f.service.shutdown();
  for (const value of f.guards) {
    // Model owner-process death: a surviving guard would restore its old baseline.
    if (!value.stopped) f.setCurrent(value.original);
  }
  assert.equal(f.current.width, 1920);
  assert.ok(f.guards.every((value) => value.stopped));
  assert.equal(f.service.getState().transaction, null);
});

test('profile replacement waits for the previous native guard before changing resolution', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await manualBaseline(f, profile);
  const previous = f.guard; let release;
  previous.disarmAndWait = () => new Promise((resolve) => { release = () => { previous.stopped = true; resolve(); }; });
  const activating = f.service.handleProcessSnapshot([game()]);
  await new Promise(setImmediate);
  assert.equal(f.current.width, 1920);
  assert.equal(previous.disarmed, true);
  release(); await activating;
  assert.equal(f.current.width, 1728);
  await f.service.handleProcessSnapshot([]); await f.service.handleProcessSnapshot([]);
  await f.service.shutdown();
  assert.equal(f.current.width, 1920);
});

test('keeping current state preserves recovery when the native guard has not stopped', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  f.guard.disarmAndWait = async () => { throw new Error('Native guard is still running'); };
  await assert.rejects(f.service.keepCurrent(), /still running/);
  assert.ok(f.service.getState().transaction);
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.root, 'recovery.json'))).transaction);
});

test('shutdown waits for native disarm and blocks later activation and process snapshots', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await automatic(f, profile);
  await f.service.handleProcessSnapshot([game()]);
  let release;
  f.guard.disarmAndWait = () => new Promise((resolve) => { release = resolve; });
  const shutdown = f.service.shutdown();
  assert.equal(f.service.shutdown(), shutdown);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.service.getState().transaction.profileId, profile.id);
  await f.service.handleProcessSnapshot([]); assert.equal(f.current.width, 1728);
  await assert.rejects(f.service.activate(profile.id), { code: 'DISPLAY_CLOSING' });
  release(); await shutdown;
  assert.equal(f.service.getState().transaction, null); assert.equal(f.current.width, 1728);
});

test('shutdown reverts unconfirmed settings and waits for disarm', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await f.service.activate(profile.id);
  let waited = false;
  f.guard.disarmAndWait = async () => { waited = true; assert.equal(f.guard.disarmed, true); };
  await f.service.shutdown(); assert.equal(f.current.width, 1920);
  assert.equal(waited, true); assert.equal(f.service.getState().transaction, null);
});

test('shutdown leaves external settings unchanged and preserves unresolved recovery', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  f.setCurrent(snapshot(1440));
  await assert.rejects(f.service.restore(), { code: 'DISPLAY_EXTERNAL_CHANGE' });
  const journal = fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8');
  await f.service.shutdown(); assert.equal(f.current.width, 1440);
  assert.equal(fs.readFileSync(path.join(f.root, 'recovery.json'), 'utf8'), journal);
});

test('failed native disarm retains recovery instead of clearing the journal', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  f.guard.disarmAndWait = async () => { throw new Error('Guard did not stop'); };
  await assert.rejects(f.service.shutdown(), /Guard did not stop/); assert.equal(f.current.width, 1728);
  assert.equal(f.service.getState().transaction.status, 'recovery');
  assert.equal(createDisplayProfileService({ provider: f.provider, root: f.root }).getState().transaction.original.width, 1920);
});

test('corrupted storage blocks switching without overwriting the original file', async (t) => {
  const f = fixture(t); const file = path.join(f.root, 'profiles.json');
  fs.writeFileSync(file, '{broken');
  const restarted = createDisplayProfileService({ provider: f.provider, root: f.root });
  assert.equal(restarted.getState().warning, 'DISPLAY_STORAGE_INVALID');
  await assert.rejects(restarted.capture({ kind: 'desktop', name: 'Desktop', monitorId: 'monitor-a' }), { code: 'DISPLAY_STORAGE_INVALID' });
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('missing monitor leaves recovery pending instead of applying to another display', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await confirmed(f, profile.id);
  f.setCurrent({ ...snapshot(), id: 'different-monitor' });
  await assert.rejects(f.service.restore(), /Monitor missing/);
  assert.equal(f.service.getState().transaction.status, 'recovery');
});
test('confirmation cannot finish after its deadline elapsed during native verification', async (t) => {
  const f = fixture(t); const profile = await gaming(f); await f.service.activate(profile.id);
  const capture = f.provider.capture;
  f.provider.capture = async (...args) => { f.setTime(16000); return capture(...args); };
  await assert.rejects(f.service.confirm(f.service.getState().transaction.id), { code: 'DISPLAY_CONFIRM_EXPIRED' });
  assert.equal(f.service.getState().profiles[0].tested, null);
});
