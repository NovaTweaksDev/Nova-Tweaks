const fs = require('fs');
const path = require('path');
const { SERVICE_NAMES, validState } = require('./backgroundServiceControl');
const { minimizeBackgroundApps } = require('./backgroundApps');

const same = (a, b) => a && b && a.startType === b.startType && a.delayed === b.delayed && a.status === b.status;
const pending = (entry) => ['intent', 'changed', 'restoring', 'conflict'].includes(entry.phase);
async function mapThree(items, fn) {
  let next = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]; await fn(item); }
  }));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

function createBackgroundMinimizationService({ journalPath, control, executionGate, getGames = async () => [], minimizeApps = minimizeBackgroundApps, now = Date.now, logger }) {
  let busy = false;
  let ongoing = null;
  let shuttingDown = false;
  let recoveryRequired = false;
  let journal = null;
  let loadError = null;
  try {
    if (fs.existsSync(journalPath)) {
      journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      const phases = ['untouched', 'intent', 'changed', 'restoring', 'restored', 'skipped', 'conflict'];
      if (journal.version !== 1 || !['prepared', 'active', 'partial', 'restored'].includes(journal.phase) || !Array.isArray(journal.entries) || journal.entries.length > SERVICE_NAMES.length ||
        new Set(journal.entries.map((entry) => entry.name)).size !== journal.entries.length ||
        journal.entries.some((entry) => !SERVICE_NAMES.includes(entry.name) || !validState(entry.original) || !Array.isArray(entry.original.dependents) || !phases.includes(entry.phase) || (entry.expected && !validState(entry.expected)))) throw new Error('Invalid Game Mode recovery journal');
      recoveryRequired = journal.entries.some(pending);
    }
  } catch (error) { journal = null; loadError = error; recoveryRequired = true; }

  function save() {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    const temporary = journalPath + '.tmp';
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(journal, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, journalPath);
  }
  function getState() {
    return {
      phase: loadError || recoveryRequired ? 'recovery_required' : journal?.phase || 'idle',
      pendingRestore: recoveryRequired || Boolean(journal?.entries.some(pending)),
      hasSnapshot: Boolean(journal && journal.phase !== 'restored'),
      durationMs: journal?.durationMs || 0,
      entries: journal?.entries.map(({ name, phase, code }) => ({ name, phase, code: code || '' })) || [],
      apps: journal?.apps || []
    };
  }
  function exclusive(fn) {
    if (busy) return Promise.resolve({ ok: false, code: 'GAME_MODE_BACKGROUND_BUSY', state: getState() });
    busy = true;
    ongoing = (async () => {
      let token;
      try {
        if (loadError) throw Object.assign(new Error('Game Mode recovery journal cannot be read. Original service states must be recovered before continuing.'), { code: 'GAME_MODE_JOURNAL_INVALID' });
        token = executionGate?.beginRestore();
        return await fn();
      } catch (error) {
        logger?.warn?.('Game Mode background operation failed.', { code: error.code, message: error.message });
        return { ok: false, code: error.code || 'GAME_MODE_BACKGROUND_FAILED', message: error.message, state: getState() };
      } finally { if (token) executionGate.endRestore(token); busy = false; }
    })();
    return ongoing;
  }
  async function readStates() {
    const states = await control({ action: 'read' });
    if (!Array.isArray(states) || states.some((state) => !SERVICE_NAMES.includes(state.name) || !validState(state) || !Array.isArray(state.dependents)) || new Set(states.map((state) => state.name)).size !== states.length) throw new Error('Service snapshot is incomplete or unstable');
    return states;
  }
  async function restoreEntry(entry, actual) {
    if (!actual) { entry.phase = 'conflict'; entry.code = 'SERVICE_UNAVAILABLE'; save(); return; }
    if (same(actual, entry.original)) { entry.phase = 'restored'; entry.code = ''; save(); return; }
    // An interrupted write may have stopped the service before changing its
    // startup type. Only this narrow intermediate state is owned by Game Mode.
    const interrupted = ['intent', 'restoring'].includes(entry.phase) && actual.delayed === entry.original.delayed && actual.status === 'Stopped' && ['Disabled', entry.original.startType].includes(actual.startType);
    if (!same(actual, entry.expected) && !interrupted) {
      entry.phase = 'conflict'; entry.code = 'SERVICE_STATE_CONFLICT'; save(); return;
    }
    try {
      entry.phase = 'restoring'; save();
      const result = await control({ action: 'restore', name: entry.name, expected: actual, target: entry.original });
      entry.phase = result.ok && same(result.state, entry.original) ? 'restored' : result.code === 'SERVICE_STATE_CONFLICT' ? 'conflict' : 'restoring';
      entry.code = entry.phase === 'restored' ? '' : result.code || 'SERVICE_RESTORE_FAILED';
    } catch (error) { entry.code = error.code || 'SERVICE_RESTORE_FAILED'; }
    save();
  }

  function prepare() {
    if (shuttingDown) return Promise.resolve({ ok: false, code: 'GAME_MODE_SHUTTING_DOWN', state: getState() });
    return exclusive(async () => {
      if (recoveryRequired || journal?.entries.some(pending)) return { ok: false, code: 'GAME_MODE_RECOVERY_REQUIRED', state: getState() };
      const states = await readStates();
      journal = { version: 1, phase: 'prepared', startedAt: now(), entries: states.map((state) => ({ name: state.name, original: state, phase: 'untouched' })), apps: [] };
      save();
      return { ok: true, state: getState() };
    });
  }
  function apply() {
    if (shuttingDown) return Promise.resolve({ ok: false, code: 'GAME_MODE_SHUTTING_DOWN', state: getState() });
    return exclusive(async () => {
      if (recoveryRequired || journal?.phase !== 'prepared') return { ok: false, code: 'GAME_MODE_NOT_PREPARED', state: getState() };
      const startedAt = now();
      await mapThree(journal.entries, async (entry) => {
        if (entry.original.startType === 'Disabled' || entry.original.dependents.length) {
          entry.phase = 'skipped'; entry.code = entry.original.startType === 'Disabled' ? 'ALREADY_DISABLED' : 'SERVICE_DEPENDENTS_RUNNING'; save(); return;
        }
        entry.expected = { startType: 'Disabled', delayed: entry.original.delayed, status: 'Stopped' };
        entry.phase = 'intent'; save(); // durable intent before the first system write
        let result;
        try { result = await control({ action: 'disable', name: entry.name, expected: entry.original, target: entry.expected }); }
        catch (error) { result = { ok: false, code: error.code || 'SERVICE_CHANGE_FAILED' }; }
        if (result.ok && same(result.state, entry.expected)) { entry.phase = 'changed'; entry.code = ''; save(); return; }
        const failure = result.code || 'SERVICE_CHANGE_FAILED';
        if (failure === 'SERVICE_STATE_CONFLICT' || failure === 'SERVICE_DEPENDENTS_RUNNING') {
          entry.phase = 'skipped'; entry.code = failure; save(); return;
        }
        const actual = (await readStates()).find((state) => state.name === entry.name);
        await restoreEntry(entry, actual);
        // A successful rollback is still an unsuccessful minimization.
        entry.code = failure; save();
      });
      journal.phase = 'partial'; save();
      // Do not close apps when a service change failed or was refused.
      const failures = journal.entries.some((entry) => entry.code && entry.code !== 'ALREADY_DISABLED');
      if (!failures) {
        try {
          const games = await getGames();
          journal.apps = shuttingDown ? [{ name: 'apps', status: 'skipped', code: 'APP_CLOSURE_CANCELLED' }] : await minimizeApps({ games });
        }
        catch (error) { journal.apps = [{ name: 'apps', status: 'skipped', code: error.code || 'APP_SCAN_FAILED' }]; }
      }
      journal.phase = failures || journal.apps.some((item) => item.status !== 'closed') ? 'partial' : 'active';
      journal.durationMs = now() - startedAt;
      save();
      logger?.info?.('Game Mode background minimization completed.', { phase: journal.phase, durationMs: journal.durationMs });
      return { ok: journal.phase === 'active', code: journal.phase === 'active' ? undefined : 'GAME_MODE_BACKGROUND_PARTIAL', state: getState() };
    });
  }
  function restore() {
    return exclusive(async () => {
      if (!journal || journal.phase === 'restored') return { ok: true, state: getState() };
      const startedAt = now();
      const entries = journal.entries.filter(pending);
      if (entries.length) {
        const actual = await readStates();
        await mapThree(entries, (entry) => restoreEntry(entry, actual.find((state) => state.name === entry.name)));
      }
      recoveryRequired = journal.entries.some(pending);
      journal.phase = recoveryRequired ? 'partial' : 'restored';
      journal.durationMs = now() - startedAt;
      save();
      logger?.info?.('Game Mode background restoration completed.', { phase: journal.phase, durationMs: journal.durationMs });
      return { ok: !recoveryRequired, code: recoveryRequired ? 'GAME_MODE_RESTORE_INCOMPLETE' : undefined, state: getState() };
    });
  }
  return { prepare, apply, restore, getState, recover: restore, shutdown: async () => { shuttingDown = true; if (ongoing) await ongoing; return restore(); } };
}

module.exports = { createBackgroundMinimizationService };
