const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const TASK_IDS = new Set(['cleanup', 'app-cache', 'drive']);
const HISTORY_LIMIT = 30;
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CATCH_UP_WINDOW_MS = 6 * 60 * 60 * 1000;
const DEFER_MS = 15 * 60 * 1000;

function normalizeTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return match ? `${match[1]}:${match[2]}` : '03:00';
}

function normalizeSchedule(value = {}) {
  const frequency = value.frequency === 'daily' ? 'daily' : 'weekly';
  const day = Number(value.dayOfWeek);
  const tasks = Array.from(new Set(
    (Array.isArray(value.tasks) ? value.tasks : ['cleanup', 'app-cache', 'drive'])
      .map((entry) => String(entry || '').trim())
      .filter((entry) => TASK_IDS.has(entry))
  ));
  return {
    enabled: value.enabled === true,
    frequency,
    dayOfWeek: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0,
    time: normalizeTime(value.time),
    tasks
  };
}

function atScheduledTime(reference, time) {
  const [hours, minutes] = normalizeTime(time).split(':').map(Number);
  const result = new Date(reference);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function getNextOccurrence(scheduleInput, afterMs = Date.now()) {
  const schedule = normalizeSchedule(scheduleInput);
  const after = new Date(afterMs);
  const candidate = atScheduledTime(after, schedule.time);
  if (schedule.frequency === 'daily') {
    if (candidate.getTime() <= afterMs) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  let daysAhead = (schedule.dayOfWeek - candidate.getDay() + 7) % 7;
  if (daysAhead === 0 && candidate.getTime() <= afterMs) daysAhead = 7;
  candidate.setDate(candidate.getDate() + daysAhead);
  return candidate.getTime();
}

function getPreviousOccurrence(scheduleInput, beforeMs = Date.now()) {
  const schedule = normalizeSchedule(scheduleInput);
  const before = new Date(beforeMs);
  const candidate = atScheduledTime(before, schedule.time);
  if (schedule.frequency === 'daily') {
    if (candidate.getTime() > beforeMs) candidate.setDate(candidate.getDate() - 1);
    return candidate.getTime();
  }
  let daysBack = (candidate.getDay() - schedule.dayOfWeek + 7) % 7;
  if (daysBack === 0 && candidate.getTime() > beforeMs) daysBack = 7;
  candidate.setDate(candidate.getDate() - daysBack);
  return candidate.getTime();
}

function createScheduledMaintenanceService(options = {}) {
  const statePath = options.statePath || path.join(options.app?.getPath?.('userData') || process.cwd(), 'automation', 'scheduled-maintenance.json');
  const now = options.nowProvider || (() => Date.now());
  const executeTask = options.executeTask || (async () => ({ ok: false, code: 'TASK_UNAVAILABLE' }));
  const canRun = options.canRun || (() => ({ ok: true }));
  const onUpdate = options.onUpdate || (() => {});
  const onAdminRequired = options.onAdminRequired || (() => {});
  const logger = options.logger;
  const setIntervalProvider = options.setIntervalProvider || setInterval;
  const clearIntervalProvider = options.clearIntervalProvider || clearInterval;

  let schedule = normalizeSchedule();
  let history = [];
  let lastRunAt = 0;
  let deferredUntil = 0;
  let running = false;
  let currentTask = '';
  let progress = 0;
  let lastError = '';
  let blockedReason = '';
  let adminNoticeAt = 0;

  function persist() {
    const directory = path.dirname(statePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify({ schedule, history, lastRunAt, deferredUntil }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
    try {
      fs.renameSync(temporaryPath, statePath);
    } catch (_error) {
      fs.rmSync(statePath, { force: true });
      fs.renameSync(temporaryPath, statePath);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(statePath, 0o600);
    }
  }

  try {
    const stored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    schedule = normalizeSchedule(stored.schedule);
    history = Array.isArray(stored.history)
      ? stored.history
          .filter((entry) => now() - Number(entry?.completedAt || entry?.startedAt || 0) <= HISTORY_RETENTION_MS)
          .slice(0, HISTORY_LIMIT)
      : [];
    lastRunAt = Number(stored.lastRunAt) || 0;
    deferredUntil = Number(stored.deferredUntil) || 0;
  } catch (_error) {
    // First launch uses safe disabled defaults.
  }

  function getNextRunAt() {
    if (!schedule.enabled) return 0;
    if (deferredUntil > now()) return deferredUntil;
    return getNextOccurrence(schedule, now());
  }

  function getState() {
    return {
      schedule: { ...schedule, tasks: [...schedule.tasks] },
      running,
      currentTask,
      progress,
      nextRunAt: getNextRunAt(),
      lastRunAt,
      deferredUntil,
      lastError,
      blockedReason,
      history: history.map((entry) => ({
        ...entry,
        tasks: Array.isArray(entry.tasks) ? entry.tasks.map((task) => ({ ...task })) : []
      }))
    };
  }

  function emit() {
    const state = getState();
    onUpdate(state);
    return state;
  }

  function updateSchedule(patch = {}) {
    const previous = schedule;
    schedule = normalizeSchedule({ ...schedule, ...patch });
    if (
      (!previous.enabled && schedule.enabled) ||
      previous.frequency !== schedule.frequency ||
      previous.dayOfWeek !== schedule.dayOfWeek ||
      previous.time !== schedule.time
    ) {
      lastRunAt = now();
    }
    deferredUntil = 0;
    lastError = '';
    blockedReason = '';
    persist();
    return { ok: true, state: emit() };
  }

  async function run(source = 'manual') {
    if (running) return { ok: false, code: 'MAINTENANCE_RUNNING', state: getState() };
    if (!schedule.tasks.length) return { ok: false, code: 'MAINTENANCE_NO_TASKS', state: getState() };
    const readiness = await canRun({ source, schedule: { ...schedule } });
    if (readiness?.ok === false) {
      blockedReason = readiness.code === 'ADMIN_BROKER_APPROVAL_REQUIRED' ? 'awaitingAdmin' : '';
      if (blockedReason === 'awaitingAdmin' && !adminNoticeAt) {
        adminNoticeAt = now();
        onAdminRequired({ source, schedule: { ...schedule }, state: getState() });
      }
      if (source === 'scheduled') {
        deferredUntil = now() + DEFER_MS;
        persist();
        emit();
      }
      return {
        ok: false,
        code: readiness.code || 'MAINTENANCE_DEFERRED',
        message: readiness.message || 'Maintenance was deferred.',
        state: getState()
      };
    }

    running = true;
    currentTask = '';
    progress = 0;
    lastError = '';
    blockedReason = '';
    adminNoticeAt = 0;
    deferredUntil = 0;
    emit();
    const startedAt = now();
    const taskResults = [];
    for (let index = 0; index < schedule.tasks.length; index += 1) {
      const taskId = schedule.tasks[index];
      currentTask = taskId;
      progress = Math.round((index / schedule.tasks.length) * 100);
      emit();
      try {
        const result = await executeTask(taskId);
        taskResults.push({
          id: taskId,
          ok: result?.ok === true,
          code: result?.ok === true ? '' : String(result?.code || 'TASK_FAILED'),
          summary: result?.summary || null
        });
      } catch (error) {
        logger?.warn?.('Scheduled maintenance task failed.', { taskId, message: error?.message || 'Unknown error' });
        taskResults.push({ id: taskId, ok: false, code: error?.code || 'TASK_FAILED', summary: null });
      }
    }
    const successful = taskResults.filter((entry) => entry.ok).length;
    const failed = taskResults.length - successful;
    const completedAt = now();
    const status = failed === 0 ? 'success' : successful > 0 ? 'partial' : 'failed';
    history = [{
      id: randomUUID(),
      source,
      status,
      startedAt,
      completedAt,
      successful,
      failed,
      tasks: taskResults
    }, ...history].slice(0, HISTORY_LIMIT);
    lastRunAt = completedAt;
    running = false;
    currentTask = '';
    progress = 100;
    lastError = failed ? `${failed} maintenance task(s) failed.` : '';
    persist();
    const state = emit();
    return { ok: status !== 'failed', status, state };
  }

  async function tick() {
    if (!schedule.enabled || running || deferredUntil > now()) return;
    const previousOccurrence = getPreviousOccurrence(schedule, now());
    const due = lastRunAt < previousOccurrence && now() - previousOccurrence <= CATCH_UP_WINDOW_MS;
    if (due) await run('scheduled');
  }

  function clearHistory() {
    history = [];
    persist();
    return { ok: true, state: emit() };
  }

  const timer = setIntervalProvider(() => {
    void tick();
  }, 30000);
  timer?.unref?.();
  void tick();

  function destroy() {
    clearIntervalProvider(timer);
  }

  return { clearHistory, destroy, getState, runNow: () => run('manual'), tick, updateSchedule };
}

module.exports = {
  createScheduledMaintenanceService,
  getNextOccurrence,
  getPreviousOccurrence,
  normalizeSchedule
};
