const crypto = require('node:crypto');
const { createRestoreJournal } = require('./restoreJournal');
const TWEAK_SCOPES = new Set(['tweakStates', 'powerPlans', 'timerProfiles', 'bootBcd', 'registryChanges', 'serviceTweaks']);
const TERMINAL = new Set(['completed', 'failed', 'interrupted']);
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function matchesTweakState(state, step) {
  if (state.checked !== true) throw fail('RESTORE_STATE_UNAVAILABLE', `State unavailable for ${step.target.id}.`);
  const target = step.target;
  return step.containerType === 'range_selection' ? state.currentValue === target.currentValue :
    step.containerType === 'one_shot_selection' ? state.selectedOption === target.selectedOption :
    step.containerType === 'timer_resolution' && target.targetState === 'enabled' ?
      state.currentState === 'enabled' && String(state.currentResolution || state.selectedResolution) === target.selectedResolution :
      state.currentState === target.targetState;
}
function matchesSettings(current, target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return JSON.stringify(current) === JSON.stringify(target);
  return Boolean(current && typeof current === 'object') && Object.entries(target).every(([key, value]) => matchesSettings(current[key], value));
}
function errorData(error) { return { code: error.code || 'RESTORE_FAILED', message: error.message || 'Restore failed.' }; }

function collectSteps(plan) {
  if (plan.origin !== 'nova' || !Array.isArray(plan.scope) || !plan.scope.length) throw fail('INVALID_RESTORE_PLAN', 'Invalid restore plan.');
  const entries = new Map();
  const settings = [];
  for (const scope of plan.scope) {
    const section = plan.snapshot?.[scope];
    if (!section || !['complete', 'partial'].includes(section.captureStatus)) throw fail('INCOMPLETE_RESTORE_SNAPSHOT', 'Restore requires captured scope data.');
    if (scope === 'appSettings') {
      const data = section.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('INVALID_RESTORE_SETTINGS', 'Invalid settings snapshot.');
      const patch = { ...(data.settings || {}), preferences: { ...(data.settings?.preferences || {}) } };
      if (['dark', 'light'].includes(data.theme)) patch.preferences.theme = data.theme;
      const language = String(data.language || '').toLowerCase().split('-')[0];
      if (['en', 'de', 'fr'].includes(language)) patch.preferences.language = language;
      settings.push({ kind: 'settings', scopes: [scope], patch, status: 'pending' });
      continue;
    }
    if (!TWEAK_SCOPES.has(scope) || !Array.isArray(section.data)) throw fail('INVALID_RESTORE_SCOPE', 'Unsupported restore scope.');
    for (const entry of section.data) {
      if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || !['enabled', 'disabled'].includes(entry.currentState)) {
        throw fail('INVALID_RESTORE_ENTRY', 'Restore entry has no verified target state.');
      }
      const target = {
        id: entry.id.trim(), targetState: entry.currentState,
        selectedOption: entry.selectedOption || '', selectedResolution: entry.selectedResolution || '',
        currentValue: entry.currentValue ?? null
      };
      const existing = entries.get(target.id);
      if (existing && hash(existing.target) !== hash(target)) throw fail('CONFLICTING_RESTORE_TARGET', 'Backup contains conflicting target states.');
      if (existing) existing.scopes.push(scope);
      else entries.set(target.id, { kind: 'tweak', target, scopes: [scope], status: 'pending' });
    }
  }
  return [...settings, ...entries.values()];
}

/** Main-process orchestration; tokens never cross IPC. */
function createRestoreService({ backupManager, tweakRunner, settingsService, executionGate, journalDirectory,
  journal = createRestoreJournal(journalDirectory), ensureAdmin = async () => ({ ok: true }),
  onUpdate = () => {}, onSettings = () => {}, logger }) {
  let active = null;
  const jobs = new Map();
  const ready = (async () => {
    for (const job of await journal.list()) {
      if (job.version !== 1 || !/^[a-f0-9-]{36}$/.test(job.id) || typeof job.backupId !== 'string' || !Array.isArray(job.scope) || !Array.isArray(job.steps) || job.steps.some((step) => !['settings', 'tweak'].includes(step.kind) || !Array.isArray(step.scopes) || !['pending', 'started', 'completed', 'failed'].includes(step.status))) throw fail('RESTORE_JOURNAL_INVALID', 'Unsupported restore journal.');
      if (!TERMINAL.has(job.status)) {
        job.status = 'interrupted';
        await journal.write(job);
      }
      jobs.set(job.id, job);
    }
  })();
  // Preserve initialization failure for callers without an unhandled rejection at startup.
  ready.catch((error) => logger?.error?.('Restore journal initialization failed.', errorData(error)));
  function view(job) {
    const partialScopes = job.partialScopes || [];
    const appliedScopes = job.scope.filter((scope) => !partialScopes.includes(scope) && job.steps.filter((step) => step.scopes.includes(scope))
      .every((step) => step.status === 'completed'));
    const errors = job.error ? [job.error] : job.status === 'completed' ? partialScopes.map((scope) => ({
      code: 'RESTORE_SCOPE_INCOMPLETE', message: `Only the captured entries were restored for ${scope}.`
    })) : [];
    return {
      id: job.id, backupId: job.backupId, status: job.status, revision: job.revision || 0,
      current: job.steps.filter((step) => step.status === 'completed').length,
      total: job.steps.length, currentTweakId: job.steps.find((step) => step.status === 'started')?.target?.id || '',
      steps: job.steps.map((step) => ({ id: step.target?.id || 'appSettings', status: step.status, error: step.error, changed: Boolean(step.changed), requiresRestart: Boolean(step.requiresRestart) })),
      ok: job.status === 'completed' && partialScopes.length === 0, partial: errors.length > 0 && job.steps.some((step) => step.status === 'completed'),
      appliedScopes, errorCount: errors.length, errors, requiresRestart: Boolean(job.requiresRestart), adminRequired: Boolean(job.requiresAdmin)
    };
  }
  async function save(job) {
    job.updatedAt = new Date().toISOString();
    job.revision = (job.revision || 0) + 1;
    await journal.write(job);
    try { onUpdate(view(job)); } catch (error) { logger?.warn?.('Restore notification failed.', errorData(error)); }
  }
  async function prepare(payload) {
    const { restorePlan: plan } = await backupManager.restoreBackup({ id: payload.id, scope: payload.scope });
    const steps = collectSteps(plan);
    let requiresAdmin = Boolean(plan.adminRequired);
    for (const step of steps) {
      if (step.kind !== 'tweak') continue;
      const config = await tweakRunner.getConfig(step.target.id);
      const type = config.containerType;
      step.containerType = type;
      step.executionHash = hash({ execution: config.execution, containerType: type, range: config.range, selections: config.selections });
      step.requiresRestart = Boolean(config.rebootRequired || step.scopes.includes('bootBcd'));
      if (type === 'fix' || type === 'one_shot_action' || (type === 'power_plan' && step.target.targetState === 'disabled')) {
        step.passive = true;
        continue;
      }
      step.params = {};
      if (type === 'timer_resolution' && step.target.targetState === 'enabled') {
        if (!step.target.selectedResolution) throw fail('RESTORE_TARGET_MISSING', 'Timer resolution is missing.');
        step.params.Resolution = step.target.selectedResolution;
      } else if (type === 'one_shot_selection') {
        if (!step.target.selectedOption) throw fail('RESTORE_TARGET_MISSING', 'Selected option is missing.');
        step.params.Selection = step.target.selectedOption;
      } else if (type === 'range_selection') {
        if (!Number.isFinite(step.target.currentValue)) throw fail('RESTORE_TARGET_MISSING', 'Range value is missing.');
        step.params.Value = step.target.currentValue;
      }
      const requirements = await tweakRunner.getExecutionRequirements({ tweakId: step.target.id, targetState: step.target.targetState, params: step.params });
      step.executionHash = hash({ configuration: step.executionHash, fingerprint: requirements.executionFingerprint });
      step.executionFingerprint = requirements.executionFingerprint;
      requiresAdmin ||= requirements.requiresAdmin;
    }
    const rank = (step) => step.kind === 'settings' ? 0 : step.containerType === 'power_plan' ? 3 :
      step.containerType === 'timer_resolution' ? 4 : step.containerType === 'one_shot_selection' ? 5 :
      step.containerType === 'range_selection' ? 6 : step.target.targetState === 'disabled' ? 1 : 2;
    steps.sort((a, b) => rank(a) - rank(b));
    if (steps.filter((step) => step.containerType === 'power_plan' && !step.passive).length > 1) {
      throw fail('CONFLICTING_RESTORE_TARGET', 'Multiple active power plans in backup.');
    }
    return { plan, steps, requiresAdmin, backupHash: plan.backupHash || hash({ scope: plan.scope, snapshot: plan.snapshot }) };
  }
  async function execute(job, token) {
    try {
      if (job.requiresAdmin) {
        const access = await ensureAdmin();
        if (!access?.ok) throw fail(access?.code || 'ADMIN_BROKER_CANCELLED', access?.message || 'Administrator access cancelled.');
      }
      job.status = 'running';
      await save(job);
      for (const step of job.steps) {
        if (step.status === 'completed') continue;
        if (step.passive) { step.status = 'completed'; await save(job); continue; }
        if (step.kind === 'settings' && settingsService.getSettings && matchesSettings(settingsService.getSettings(), step.patch)) {
          step.status = 'completed'; await save(job); continue;
        }
        if (step.kind === 'tweak') {
          const state = await tweakRunner.getCurrentState({ tweakId: step.target.id });
          const matches = matchesTweakState(state, step);
          if (matches) { step.status = 'completed'; await save(job); continue; }
        }
        step.status = 'started';
        await save(job);
        if (step.kind === 'settings') {
          const settings = settingsService.updateSettings(step.patch);
          onSettings(settings);
        } else {
          const result = await tweakRunner.runTweak({ tweakId: step.target.id, targetState: step.target.targetState,
            params: step.params, executionContext: { restoreToken: token, expectedFingerprint: step.executionFingerprint, allowPrompt: false, reason: 'backup-restore' } });
          if (!result?.ok) throw fail(result?.code || 'RESTORE_STEP_FAILED', result?.message || 'Tweak restore failed.');
          step.changed = true;
          job.requiresRestart ||= step.requiresRestart;
          const verified = await tweakRunner.getCurrentState({ tweakId: step.target.id });
          if (!matchesTweakState(verified, step)) throw fail('RESTORE_VERIFICATION_FAILED', `Target state was not reached for ${step.target.id}.`);
        }
        step.status = 'completed';
        await save(job);
      }
      job.status = 'completed';
      await save(job);
    } catch (error) {
      job.status = 'failed';
      job.error = errorData(error);
      const step = job.steps.find((entry) => entry.status === 'started');
      if (step) { step.status = 'failed'; step.error = job.error; }
      try { await save(job); }
      catch (writeError) { logger?.error?.('Restore journal write failed; execution stopped.', errorData(writeError)); }
    } finally { executionGate.endRestore(token); active = null; }
  }
  async function start(payload, resumeId) {
    await ready;
    if (active) throw fail('SYSTEM_OPERATION_BUSY', 'A restore is already running.');
    const token = executionGate.beginRestore();
    active = token;
    try {
      const old = resumeId ? jobs.get(resumeId) : null;
      if (resumeId && (!old || !['failed', 'interrupted'].includes(old.status))) throw fail('INVALID_RESTORE_RESUME', 'Restore cannot be resumed.');
      const input = old ? { id: old.backupId, scope: old.scope } : payload;
      const prepared = await prepare(input);
      if (old && (old.backupHash !== prepared.backupHash || hash(old.steps.map(({ kind, target, executionHash, patch, scopes }) => ({ kind, target, executionHash, patch, scopes }))) !==
        hash(prepared.steps.map(({ kind, target, executionHash, patch, scopes }) => ({ kind, target, executionHash, patch, scopes }))))) {
        throw fail('RESTORE_SOURCE_CHANGED', 'Backup or execution configuration changed.');
      }
      const job = old || { version: 1, id: crypto.randomUUID(), backupId: input.id, scope: prepared.plan.scope,
        backupHash: prepared.backupHash, steps: prepared.steps, createdAt: new Date().toISOString() };
      // On explicit resume re-detect completed tweaks too: state may have changed after interruption.
      if (old) {
        job.steps = prepared.steps.map((step, index) => ({ ...step,
          changed: old.steps[index].changed === true, status: 'pending'
        }));
      }
      job.status = 'prepared';
      delete job.error;
      job.requiresAdmin = prepared.requiresAdmin;
      job.partialScopes = prepared.plan.scope.filter((scope) => prepared.plan.snapshot[scope].captureStatus === 'partial');
      await save(job);
      jobs.set(job.id, job);
      void execute(job, token);
      return { ok: true, job: view(job) };
    } catch (error) { executionGate.endRestore(token); active = null; throw error; }
  }
  return {
    start: (payload) => start(payload), resume: (id) => start(null, id),
    async status(id) { await ready; const job = jobs.get(id); if (!job) throw fail('RESTORE_NOT_FOUND', 'Restore not found.'); return view(job); },
    async list() { await ready; return [...jobs.values()].map(view); }
  };
}
module.exports = { createRestoreService, collectSteps };
