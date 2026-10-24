const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const copy = (value) => JSON.parse(JSON.stringify(value));
const identity = (processInfo) => `${Number(processInfo.pid)}:${processInfo.startTime}`;
const executableKey = (value) => String(value || '').trim().replace(/\//g, '\\').toLowerCase();
function failure(code, message) { return Object.assign(new Error(message), { code }); }
// Keep the v1 token layout compatible while removing retired range data, even
// from offline profiles and interrupted recovery journals. Native decode also strips it.
function withoutColorRange(value) {
  const snapshot = copy(value);
  delete snapshot.colorRange;
  if (snapshot.capabilities) delete snapshot.capabilities.colorRange;
  if (snapshot.nativeState) delete snapshot.nativeState.rangePolicy;
  if (/^[a-f0-9]{320}$/i.test(snapshot.token)) {
    const bytes = Buffer.from(snapshot.token, 'hex');
    if (bytes.readUInt32LE(0) === 0x4e445031 && bytes.readUInt32LE(4) === 160) {
      bytes.fill(0, 108, 112); bytes.fill(0, 132, 156);
      snapshot.token = bytes.toString('hex');
    }
  }
  return snapshot;
}
function validSnapshot(value) {
  const positive = (number) => Number.isSafeInteger(number) && number > 0;
  return value && typeof value.id === 'string' && value.id.length > 0 && typeof value.name === 'string' &&
    typeof value.fingerprint === 'string' && typeof value.token === 'string' && value.token.length <= 16384 &&
    positive(value.width) && positive(value.height) && positive(value.refresh?.numerator) && positive(value.refresh?.denominator) &&
    positive(value.signal?.width) && positive(value.signal?.height) && positive(value.signal?.numerator) && positive(value.signal?.denominator) &&
    Number.isInteger(value.scaling) && (value.vibrance === null || (Number.isInteger(value.vibrance) && value.vibrance >= 0 && value.vibrance <= 100)) &&
    typeof value.capabilities === 'object';
}
function displayEqual(a, b) {
  return ['id', 'width', 'height', 'scaling', 'vibrance'].every((key) => a[key] === b[key]) &&
    JSON.stringify(a.nativeState) === JSON.stringify(b.nativeState) &&
    a.refresh.numerator * b.refresh.denominator === b.refresh.numerator * a.refresh.denominator &&
    a.signal.width === b.signal.width && a.signal.height === b.signal.height &&
    a.signal.numerator * b.signal.denominator === b.signal.numerator * a.signal.denominator;
}
function createDisplayProfileService({ provider, root, onUpdate = () => {}, onDemandChange = () => {}, now = Date.now }) {
  const profilesPath = path.join(root, 'profiles.json');
  const journalPath = path.join(root, 'recovery.json');
  let profiles = [], transaction = null, guard = null, busy = false, lastError = null, displays = [];
  let suppressed = new Set(), lastProcesses = [], loadedWarning = null, pendingGuardRestore = null;
  const suppressedMisses = new Map();
  let missingGame = null;
  let operationFinished = Promise.resolve();
  let closing = false, shutdownFinished = null;
  function write(file, value) {
    fs.mkdirSync(root, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file);
  }
  function read(file) {
    if (!fs.existsSync(file)) return null;
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (value.version !== 1) throw new Error('Unsupported version'); return value; }
    catch { loadedWarning = 'DISPLAY_STORAGE_INVALID'; return null; }
  }
  const stored = read(profilesPath);
  if (stored) {
    if (Array.isArray(stored.profiles) && stored.profiles.length <= 30 && stored.profiles.every((profile) =>
      typeof profile.id === 'string' && typeof profile.name === 'string' && ['desktop', 'gaming'].includes(profile.kind) &&
      Number.isSafeInteger(profile.revision) && profile.revision > 0 && typeof profile.auto === 'boolean' &&
      typeof profile.executablePath === 'string' && validSnapshot(profile.snapshot)) &&
      new Set(stored.profiles.map((p) => p.id)).size === stored.profiles.length && stored.profiles.filter((p) => p.kind === 'desktop').length <= 1)
      profiles = stored.profiles.map((profile) => {
        const snapshot = withoutColorRange(profile.snapshot);
        const changed = JSON.stringify(snapshot) !== JSON.stringify(profile.snapshot);
        return { ...profile, snapshot, ...(changed ? { auto: false, tested: null } : {}) };
      });
    else loadedWarning = 'DISPLAY_STORAGE_INVALID';
  }
  const recovery = read(journalPath);
  if (recovery?.transaction) {
    if (validSnapshot(recovery.transaction.original) && validSnapshot(recovery.transaction.applied) &&
      (!recovery.transaction.returnTo || (typeof recovery.transaction.returnTo.profileId === 'string' &&
        validSnapshot(recovery.transaction.returnTo.snapshot) && recovery.transaction.returnTo.snapshot.id === recovery.transaction.original.id &&
        recovery.transaction.returnTo.snapshot.fingerprint === recovery.transaction.original.fingerprint)) &&
      typeof recovery.transaction.id === 'string' && typeof recovery.transaction.profileId === 'string')
      transaction = { ...recovery.transaction, original: withoutColorRange(recovery.transaction.original), applied: withoutColorRange(recovery.transaction.applied), status: 'recovery' };
    else loadedWarning = 'DISPLAY_STORAGE_INVALID';
  }
  if (stored && !loadedWarning && JSON.stringify(profiles) !== JSON.stringify(stored.profiles)) saveProfiles();
  if (transaction) {
    delete transaction.options;
    if (transaction.returnTo) transaction.returnTo.snapshot = withoutColorRange(transaction.returnTo.snapshot);
    if (transaction.game && !executableKey(transaction.game.executablePath)) transaction.game = null;
    saveJournal();
  }
  function state() { return copy({ profiles, transaction, busy, lastError, displays, warning: loadedWarning }); }
  function emit() { onUpdate(state()); if (!closing) onDemandChange(); }
  function saveProfiles() { write(profilesPath, { version: 1, profiles }); }
  function saveJournal() { write(journalPath, { version: 1, transaction }); }
  async function exclusive(action, duringShutdown = false) {
    if (closing && !duringShutdown) throw failure('DISPLAY_CLOSING', 'Nova is closing.');
    if (busy) throw failure('DISPLAY_BUSY', 'A display operation is already running.');
    let finish;
    operationFinished = new Promise((resolve) => { finish = resolve; });
    busy = true; lastError = null; emit();
    try { return await action(); }
    catch (error) { lastError = { code: error.code || 'DISPLAY_OPERATION_FAILED', message: error.message }; throw error; }
    finally {
      busy = false; finish(); emit();
      if (pendingGuardRestore) {
        const id = pendingGuardRestore; pendingGuardRestore = null;
        void verifyGuardRestore(id);
      }
    }
  }
  function optionsFor(snapshot) { return { vibrance: snapshot.vibrance !== null }; }
  function requireVerifiedScaling(...snapshots) {
    if (snapshots.some((snapshot) => [5, 6].includes(snapshot.scaling)))
      throw failure('DISPLAY_SCALING_UNVERIFIED', 'Aspect ratio scaling cannot currently be restored reliably. In NVIDIA Control Panel → Adjust desktop size and position, select Full-screen, then capture the setup again before switching.');
  }
  function findProfile(id) {
    const profile = profiles.find((entry) => entry.id === id);
    if (!profile) throw failure('PROFILE_NOT_FOUND', 'Display profile was not found.');
    return profile;
  }
  async function currentFor(snapshot) {
    const current = withoutColorRange(await provider.capture(snapshot.id, optionsFor(snapshot)));
    if (current.fingerprint !== snapshot.fingerprint) throw failure('DISPLAY_HARDWARE_CHANGED', 'The monitor or driver changed. Capture and test the profile again.');
    return current;
  }
  function clearTransaction() {
    guard?.disarm(); guard = null;
    // Commit the empty journal before dropping the in-memory recovery state.
    write(journalPath, { version: 1, transaction: null }); transaction = null;
  }
  async function verifyGuardRestore(id) {
    if (transaction?.id !== id) return;
    await exclusive(async () => {
      const restored = await currentFor(transaction.original);
      if (!displayEqual(restored, transaction.original)) throw failure('DISPLAY_RESTORE_MISMATCH', 'Recovery could not be verified.');
      clearTransaction();
    }).catch((error) => {
      if (transaction) { transaction.status = 'recovery'; saveJournal(); }
      lastError = { code: error.code || 'DISPLAY_RECOVERY_FAILED', message: error.message }; emit();
    });
  }
  async function startGuard(original, confirmed, id) {
    return provider.watch(original, {
      confirmed,
      onRestore: () => { if (transaction?.id !== id) return; if (busy) pendingGuardRestore = id; else void verifyGuardRestore(id); },
      onFailure: (error) => {
        if (transaction?.id !== id) return;
        transaction.status = 'recovery'; saveJournal();
        lastError = { code: 'DISPLAY_RECOVERY_FAILED', message: error.message }; emit();
      }
    });
  }
  async function restoreInternal({ force = false, automatic = false, resumeManual = false } = {}) {
    if (!transaction) return state();
    let current;
    try { current = await currentFor(transaction.original); }
    catch (error) {
      if (!force) throw error;
      current = withoutColorRange(await provider.capture(transaction.original.id, {}));
      if (current.fingerprint !== transaction.original.fingerprint) throw failure('DISPLAY_HARDWARE_CHANGED', 'The monitor or driver changed.');
    }
    if (!force && !displayEqual(current, transaction.applied || transaction.original) && !displayEqual(current, transaction.original)) {
      guard?.disarm(); guard = null;
      transaction.status = 'conflict'; saveJournal();
      throw failure('DISPLAY_EXTERNAL_CHANGE', 'Display settings changed outside Nova. Explicitly restore the saved previous state or keep the current state.');
    }
    const returnTo = resumeManual ? transaction.returnTo : null;
    const target = returnTo?.snapshot || transaction.original;
    await provider.validate(target);
    // The live mode may already match after a partial failure, while Windows'
    // saved boot mode still differs. Always persist the requested return state.
    await provider.apply(target);
    const restored = await currentFor(target);
    if (!displayEqual(restored, target)) throw failure('DISPLAY_RESTORE_MISMATCH', 'The previous display state could not be verified.');
    if (returnTo) {
      transaction.profileId = returnTo.profileId; transaction.applied = target;
      transaction.game = null; transaction.status = 'active'; transaction.deadline = null;
      delete transaction.returnTo;
      guard?.expect?.(target); saveJournal(); return state();
    }
    if (!automatic && transaction.game) suppressed.add(identity(transaction.game));
    clearTransaction(); return state();
  }
  async function restoreSafely(options) {
    try { return await restoreInternal(options); }
    catch (error) {
      if (transaction && transaction.status !== 'conflict') { transaction.status = 'recovery'; saveJournal(); }
      throw error;
    }
  }
  async function activateInternal(profileId, { automatic = false, game = null } = {}) {
    if (loadedWarning) throw failure(loadedWarning, 'Display profile storage needs to be repaired before switching.');
    const profile = findProfile(profileId);
    if (transaction && transaction.status !== 'active') throw failure('DISPLAY_RECOVERY_REQUIRED', 'Resolve the pending display recovery first.');
    if (transaction && transaction.original.id !== profile.snapshot.id) throw failure('DISPLAY_MONITOR_CONFLICT', 'Restore the active monitor before switching to another monitor.');
    if (transaction && !displayEqual(await currentFor(transaction.applied), transaction.applied))
      throw failure('DISPLAY_EXTERNAL_CHANGE', 'Display settings changed outside Nova. Restore or keep the current state first.');
    // Read all reliably restorable optional values. An omitted profile value means
    // keep this live value, never infer a default or copy it from another profile.
    const current = (await provider.list()).map(withoutColorRange).find((display) => display.id === profile.snapshot.id);
    if (!current || current.fingerprint !== profile.snapshot.fingerprint)
      throw failure('DISPLAY_HARDWARE_CHANGED', 'The saved monitor or driver is no longer available.');
    requireVerifiedScaling(current, profile.snapshot);
    const target = withoutColorRange(await provider.merge(profile.snapshot, current));
    // Preserve previously secured values; add a property's baseline only when
    // it becomes reliably readable. This also upgrades existing narrow journals.
    const original = transaction ? withoutColorRange(await provider.merge(transaction.original, current)) : current;
    if (target.vibrance !== null && original.vibrance === null)
      throw failure('DISPLAY_PROPERTY_UNRESTORABLE', 'Saved Digital Vibrance has no reliably restorable current value.');
    await provider.validate(target);
    await provider.validate(original);
    if (automatic && (profile.tested?.revision !== profile.revision || profile.tested?.fingerprint !== current.fingerprint))
      throw failure('DISPLAY_TEST_REQUIRED', 'The profile needs a confirmed manual test on this hardware.');
    // A confirmed manual setup is an idle baseline, not a running game. Resume
    // that setup after game exit while retaining the first durable return state.
    const returnTo = automatic && transaction && !transaction.game
      ? { profileId: transaction.profileId, snapshot: current } : null;
    const previousGuard = guard, previousId = transaction?.id;
    transaction = { id: randomUUID(), profileId, original, applied: target,
      status: automatic ? 'active' : 'confirming', deadline: automatic ? null : now() + 15000, game,
      ...(returnTo ? { returnTo } : {}) };
    saveJournal();
    try {
      // Keep the previous guard until its replacement is ready.
      guard = await startGuard(original, automatic, transaction.id); previousGuard?.disarm();
      await provider.apply(target);
      const applied = await currentFor(target);
      if (!displayEqual(applied, target)) throw failure('DISPLAY_APPLY_MISMATCH', 'The driver did not retain the captured profile.');
      if (transaction.status === 'recovery' || pendingGuardRestore) throw failure('DISPLAY_RECOVERY_FAILED', 'The recovery guard interrupted activation.');
      transaction.applied = applied; guard.expect?.(applied); saveJournal(); return state();
    } catch (error) {
      if (returnTo && guard === previousGuard) transaction.id = previousId;
      try { await restoreInternal({ force: true, automatic: true, resumeManual: automatic }); }
      catch (restoreError) { transaction.status = 'recovery'; saveJournal(); lastError = { code: restoreError.code || 'DISPLAY_RECOVERY_FAILED', message: restoreError.message }; }
      throw error;
    }
  }
  return {
    getState: state,
    needsProcessSnapshots: () => Boolean(transaction?.game) || profiles.some((profile) => profile.auto && profile.executablePath),
    refresh: () => exclusive(async () => { displays = (await provider.list()).map(withoutColorRange); return state(); }),
    capture: (payload = {}) => exclusive(async () => {
      if (loadedWarning) throw failure(loadedWarning, 'Review the damaged display profile storage before saving.');
      const name = String(payload.name || '').trim();
      if (!name || name.length > 80 || !['desktop', 'gaming'].includes(payload.kind) || typeof payload.monitorId !== 'string')
        throw failure('DISPLAY_PROFILE_INVALID', 'Choose a monitor and a profile name (maximum 80 characters).');
      if (transaction && transaction.status !== 'active') throw failure('DISPLAY_PROFILE_ACTIVE', 'Confirm the display settings or resolve the pending recovery before capturing another setup.');
      const existing = payload.id ? findProfile(payload.id) : payload.kind === 'desktop' ? profiles.find((p) => p.kind === 'desktop') : null;
      if (existing && transaction?.profileId === existing.id) throw failure('DISPLAY_PROFILE_ACTIVE', 'End the active display session before replacing its profile, or save a new gaming profile.');
      if (existing && existing.kind !== payload.kind) throw failure('DISPLAY_PROFILE_INVALID', 'Profile type cannot be changed.');
      if (!existing && profiles.length >= 30) throw failure('DISPLAY_PROFILE_LIMIT', 'Maximum number of display profiles reached.');
      const available = (await provider.list()).find((display) => display.id === payload.monitorId);
      if (!available) throw failure('DISPLAY_HARDWARE_CHANGED', 'The selected monitor is no longer available.');
      const snapshot = withoutColorRange(await provider.capture(payload.monitorId, { vibrance: available.vibrance !== null }));
      if (!validSnapshot(snapshot)) throw failure('DISPLAY_HELPER_PROTOCOL', 'The display helper returned an invalid snapshot.');
      const profile = { id: existing?.id || randomUUID(), kind: payload.kind, name, revision: (existing?.revision || 0) + 1,
        snapshot, auto: false, executablePath: existing?.executablePath || '', tested: null };
      profiles = profiles.filter((p) => p.id !== profile.id); profiles.push(profile); saveProfiles(); return state();
    }),
    remove: (id) => exclusive(async () => {
      findProfile(id); if (transaction?.profileId === id && transaction.status === 'confirming') throw failure('DISPLAY_PROFILE_ACTIVE', 'Confirm or revert the display test before deleting its profile.');
      profiles = profiles.filter((p) => p.id !== id); saveProfiles(); return state();
    }),
    configure: ({ id, name, executablePath, auto } = {}) => exclusive(async () => {
      const profile = findProfile(id);
      if (typeof name === 'string') { const trimmed = name.trim(); if (!trimmed || trimmed.length > 80) throw failure('DISPLAY_PROFILE_INVALID', 'Invalid profile name.'); profile.name = trimmed; }
      if (executablePath !== undefined) {
        if (typeof executablePath !== 'string' || (executablePath && (!path.win32.isAbsolute(executablePath) || path.win32.extname(executablePath).toLowerCase() !== '.exe')))
          throw failure('DISPLAY_EXECUTABLE_INVALID', 'Choose an absolute game executable path.');
        if (executableKey(profile.executablePath) !== executableKey(executablePath)) { profile.auto = false; profile.executablePath = executablePath; }
      }
      if (auto !== undefined) {
        if (typeof auto !== 'boolean' || (auto && (profile.kind !== 'gaming' || !profile.executablePath || profile.tested?.revision !== profile.revision || profile.tested?.fingerprint !== profile.snapshot.fingerprint)))
          throw failure('DISPLAY_TEST_REQUIRED', 'Choose a game and confirm a manual profile test first.');
        if (auto) requireVerifiedScaling(await currentFor(profile.snapshot), profile.snapshot);
        profile.auto = auto;
      }
      saveProfiles(); return state();
    }),
    validate: (id) => exclusive(async () => { const profile = findProfile(id); const current = await currentFor(profile.snapshot); requireVerifiedScaling(current, profile.snapshot); await provider.validate(profile.snapshot); return state(); }),
    activate: (id) => exclusive(() => {
      const profile = findProfile(id);
      const game = profile.executablePath && lastProcesses.find((p) => executableKey(p.executablePath) === executableKey(profile.executablePath));
      return activateInternal(id, { game: game || null });
    }),
    confirm: (id) => exclusive(async () => {
      if (!transaction || transaction.id !== id || transaction.status !== 'confirming' || now() >= transaction.deadline)
        throw failure('DISPLAY_CONFIRM_EXPIRED', 'The display confirmation expired.');
      const profile = findProfile(transaction.profileId);
      const current = await currentFor(transaction.applied);
      if (!transaction || transaction.id !== id || transaction.status !== 'confirming' || now() >= transaction.deadline || pendingGuardRestore)
        throw failure('DISPLAY_CONFIRM_EXPIRED', 'The display confirmation expired during verification.');
      if (!displayEqual(current, transaction.applied)) throw failure('DISPLAY_APPLY_MISMATCH', 'The applied profile changed before confirmation.');
      guard.confirm(); transaction.status = 'active'; transaction.deadline = null;
      profile.tested = { revision: profile.revision, fingerprint: current.fingerprint }; saveProfiles(); saveJournal(); return state();
    }),
    restore: (options) => exclusive(() => restoreSafely(options)),
    keepCurrent: () => exclusive(async () => {
      if (transaction?.status === 'confirming') throw failure('DISPLAY_CONFIRM_REQUIRED', 'Confirm or revert the display test first.');
      if (transaction?.game) suppressed.add(identity(transaction.game));
      clearTransaction(); return state();
    }),
    handleProcessSnapshot: async (processes, { unresolvedPids = [] } = {}) => {
      if (closing || !Array.isArray(processes)) return;
      lastProcesses = processes;
      const running = new Set(processes.map(identity));
      const byPid = new Map(processes.map((entry) => [Number(entry.pid), entry]));
      for (const pid of unresolvedPids) if (!byPid.has(pid)) byPid.set(pid, { pid, startTime: '' });
      suppressed = new Set([...suppressed].filter((key) => {
        const processInfo = byPid.get(Number(key.slice(0, key.indexOf(':'))));
        if (running.has(key) || (processInfo && !processInfo.startTime)) {
          suppressedMisses.delete(key); return true;
        }
        const misses = (suppressedMisses.get(key) || 0) + 1;
        if (processInfo?.startTime || misses >= 2) { suppressedMisses.delete(key); return false; }
        suppressedMisses.set(key, misses); return true;
      }));
      if (busy) return;
      if (transaction) {
        if (transaction.game && transaction.status === 'active') {
          const key = identity(transaction.game);
          const samePid = byPid.get(Number(transaction.game.pid));
          if (running.has(key) || (samePid && !samePid.startTime)) missingGame = null;
          else {
            const misses = missingGame?.key === key ? missingGame.count + 1 : 1;
            missingGame = { key, count: misses };
            // A reused PID with a different creation time proves exit. Otherwise
            // require two samples so a transient visibility gap cannot switch modes.
            if (!samePid?.startTime && misses < 2) return;
            missingGame = null;
            await exclusive(() => restoreSafely({ automatic: true, resumeManual: true })).catch(() => {});
          }
        }
        if (transaction?.game || (transaction && transaction.status !== 'active')) return;
      }
      missingGame = null;
      for (const profile of profiles) {
        if (!profile.auto || !profile.executablePath) continue;
        const game = lastProcesses.find((p) => Number.isSafeInteger(Number(p.pid)) && Number(p.pid) > 0 && p.startTime &&
          executableKey(p.executablePath) === executableKey(profile.executablePath) && !suppressed.has(identity(p)));
        if (!game) continue;
        await exclusive(() => activateInternal(profile.id, { automatic: true, game })).catch(() => { suppressed.add(identity(game)); });
        break;
      }
    },
    shutdown: () => {
      if (shutdownFinished) return shutdownFinished;
      closing = true;
      shutdownFinished = (async () => {
        if (busy) await operationFinished;
        await exclusive(async () => {
          const quittingGuard = guard;
          if (transaction?.status === 'confirming') {
            await restoreSafely({ automatic: true });
            await quittingGuard?.disarmAndWait();
          } else {
            await guard?.disarmAndWait(); guard = null;
            // Keep unresolved recovery/conflict journals for explicit review.
            if (transaction?.status === 'active') clearTransaction();
          }
        }, true).catch(() => {
          if (transaction && transaction.status !== 'conflict') { transaction.status = 'recovery'; saveJournal(); }
        });
      })();
      return shutdownFinished;
    }
  };
}
module.exports = { createDisplayProfileService, displayEqual };
