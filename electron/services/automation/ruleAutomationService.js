const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_APPROVAL_TTL_MS = 5 * 60 * 1000;

function normalizeProcessMatchValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const basename = normalized.split(/[\\/]/).pop() || normalized;
  return basename.replace(/\.exe$/i, '');
}

function compare(actual, operator, expected) {
  if (actual === null || actual === undefined || actual === '') return false;
  if (operator === 'contains') return String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
  if (operator === 'equals') return String(actual || '').toLowerCase() === String(expected || '').toLowerCase();
  if (operator === 'is') return Boolean(actual) === Boolean(expected === '' || expected === true || expected === 1 || expected === 'true');
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === 'gt') return left > right;
  if (operator === 'lt') return left < right;
  if (operator === 'lte') return left <= right;
  return left >= right;
}

function processValue(processInfo, type) {
  if (type === 'processRunning') return processInfo.event !== 'stopped';
  if (type === 'processStarted') return processInfo.event === 'started';
  if (type === 'processStopped') return processInfo.event === 'stopped';
  if (type === 'processCpu') return processInfo.cpuPercent;
  if (type === 'processMemory') return processInfo.ramMB;
  if (type === 'processDisk') return processInfo.diskMBs;
  if (type === 'processNotResponding') return typeof processInfo.responding === 'boolean' ? !processInfo.responding : null;
  return null;
}

function systemValue(context, type) {
  if (context.metricsAt && Number(context.currentTime || Date.now()) - context.metricsAt > 15000 && !type.startsWith('game')) return null;
  const overview = context.metrics?.overview || {};
  const primaryGpu = overview.gpus?.[0] || {};
  const quality = overview.networkQuality || {};
  const values = {
    systemCpu: overview.cpu?.usagePercent ?? context.metrics?.cpuLoad,
    systemGpu: primaryGpu.usagePercent ?? context.metrics?.gpuLoad,
    systemMemory: overview.memory?.usagePercent,
    cpuTemperature: overview.cpu?.temperatureC ?? context.metrics?.cpuTemp,
    gpuTemperature: primaryGpu.temperatureC ?? context.metrics?.gpuTemp,
    networkLatency: quality.latencyMs,
    packetLoss: quality.packetLossPercent,
    gameRunning: Boolean(context.game?.activeGame || context.game?.sessionStatus === 'recording'),
    gameStarted: context.gameEvent === 'started',
    gameStopped: context.gameEvent === 'stopped'
  };
  return values[type];
}

function conditionMatches(condition, context, processInfo = null) {
  if (String(condition.type).startsWith('process')) {
    if (!processInfo) return false;
    const rawFilter = String(condition.text || '').trim().toLowerCase();
    const normalizedFilter = normalizeProcessMatchValue(condition.text);
    const textMatch = !rawFilter || [processInfo.name, processInfo.executablePath].some((value) => {
      const rawValue = String(value || '').toLowerCase();
      return rawValue.includes(rawFilter) ||
        (normalizedFilter && normalizeProcessMatchValue(value).includes(normalizedFilter));
    });
    if (!textMatch) return false;
    const booleanProcessCondition = ['processRunning', 'processStarted', 'processStopped', 'processNotResponding'].includes(condition.type);
    return compare(processValue(processInfo, condition.type), condition.operator, booleanProcessCondition ? true : condition.value);
  }
  if (condition.type.startsWith('game') && condition.text) {
    const game = condition.type === 'gameStopped' ? (context.stoppedGame || context.game) : context.game;
    const gameName = game?.activeGame?.gameName || game?.gameName || '';
    if (!String(gameName).toLowerCase().includes(condition.text.toLowerCase())) return false;
  }
  return compare(systemValue(context, condition.type), condition.operator, condition.type.startsWith('game') ? true : condition.value);
}

function evaluateRule(rule, context) {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (!conditions.length) return { matched: false, processInfo: null };
  const hasProcessConditions = conditions.some((entry) => String(entry.type).startsWith('process'));
  const hasProcessEdgeCondition = conditions.some((entry) => entry.type === 'processStarted' || entry.type === 'processStopped');
  const processCandidates = hasProcessEdgeCondition
    ? (rule.matchMode === 'any' ? [...(context.processEvents || []), ...(context.processes || [])] : (context.processEvents || []))
    : (context.processes || []);
  const candidates = hasProcessConditions ? (rule.matchMode === 'any' ? [...processCandidates, null] : processCandidates) : [null];
  for (const processInfo of candidates) {
    const matches = conditions.map((condition) => conditionMatches(condition, context, processInfo));
    if ((rule.matchMode === 'any' ? matches.some(Boolean) : matches.every(Boolean))) return { matched: true, processInfo };
  }
  return { matched: false, processInfo: null };
}

function createRuleAutomationService(options = {}) {
  const app = options.app;
  const getSettings = options.getSettings || (() => ({}));
  const onUpdate = options.onUpdate || (() => {});
  const closeProcess = options.closeProcess || (async () => ({ ok: false, code: 'PROCESS_ACTION_UNAVAILABLE' }));
  const executeAutomaticAction = options.executeAutomaticAction || (async () => ({ handled: false }));
  const onNotify = options.onNotify || (() => {});
  const onAdminRequired = options.onAdminRequired || (() => {});
  const statePath = options.statePath || path.join(app?.getPath?.('userData') || process.cwd(), 'automation', 'rule-state.json');
  const now = options.nowProvider || (() => Date.now());
  let context = { processes: [], processEvents: [], metrics: null, game: null, gameEvent: '' };
  let pending = [];
  let history = [];
  let previousGameRunning = false;
  let processSnapshotInitialized = false;
  let previousProcesses = new Map();
  const activeSince = new Map();
  const cooldownUntil = new Map();
  const automaticExecutionIds = new Set();
  const serviceSessionId = randomUUID();

  function persist() {
    const directory = path.dirname(statePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ pending, history }, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    try { fs.renameSync(temp, statePath); } catch (_error) { fs.rmSync(statePath, { force: true }); fs.renameSync(temp, statePath); }
    if (process.platform !== 'win32') {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(statePath, 0o600);
    }
  }
  try {
    const stored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    pending = Array.isArray(stored.pending) ? stored.pending : [];
    history = Array.isArray(stored.history) ? stored.history : [];
  } catch (_error) {}

  function rules() {
    return getSettings()?.automation?.rules || [];
  }

  function ruleFingerprint(rule) {
    return JSON.stringify({
      conditions: Array.isArray(rule?.conditions) ? rule.conditions : [],
      matchMode: rule?.matchMode || 'all',
      action: rule?.action || null
    });
  }
  function getState() {
    return { rules: rules().map((rule) => ({ ...rule })), pending: pending.map((entry) => ({ ...entry })), history: history.slice(0, 100).map((entry) => ({ ...entry })) };
  }
  function emit() { onUpdate(getState()); }
  function prune() {
    history = history.filter((entry) => now() - entry.createdAt <= RETENTION_MS).slice(0, 100);
  }
  function expire(executionId, message = 'The pending rule action expired.') {
    pending = pending.filter((entry) => entry.id !== executionId);
    history = history.map((entry) => entry.id === executionId ? {
      ...entry,
      status: 'expired',
      blockedReason: '',
      message,
      updatedAt: now()
    } : entry);
    persist();
    emit();
    return { handled: true, ok: false, code: 'AUTOMATIC_ACTION_EXPIRED', message, state: getState() };
  }

  function validatePendingExecution(execution) {
    const rule = rules().find((entry) => entry.id === execution.ruleId && entry.enabled);
    if (!rule || (execution.ruleFingerprint && execution.ruleFingerprint !== ruleFingerprint(rule))) {
      return { ok: false, message: 'The rule was removed, disabled, or changed.' };
    }
    if (now() > Number(execution.expiresAt || execution.createdAt + ADMIN_APPROVAL_TTL_MS)) {
      return { ok: false, message: 'The pending rule action expired.' };
    }
    const conditionTypes = (rule.conditions || []).map((entry) => entry.type);
    if (conditionTypes.includes('processStopped') || conditionTypes.includes('gameStopped')) {
      return { ok: true };
    }
    if (conditionTypes.includes('processStarted')) {
      const expectedIdentity = processIdentity(execution.processInfo);
      const stillRunning = (context.processes || []).some((entry) => processIdentity(entry) === expectedIdentity);
      return stillRunning ? { ok: true } : { ok: false, message: 'The process that triggered this rule is no longer running.' };
    }
    if (conditionTypes.includes('gameStarted')) {
      const gameRunning = Boolean(context.game?.activeGame || context.game?.sessionStatus === 'recording');
      return gameRunning ? { ok: true } : { ok: false, message: 'The game that triggered this rule is no longer running.' };
    }
    context.currentTime = now();
    return evaluateRule(rule, context).matched
      ? { ok: true }
      : { ok: false, message: 'The rule conditions no longer match.' };
  }

  function markAwaitingAdmin(execution, result) {
    const updatedAt = now();
    const current = pending.find((entry) => entry.id === execution.id) || execution;
    const alreadyGrouped = pending.some((entry) => (
      entry.id !== execution.id
      && entry.blockedReason === 'awaitingAdmin'
      && entry.sessionId === serviceSessionId
    ));
    const shouldNotify = !current.adminNoticeAt && !alreadyGrouped;
    const update = (entry) => entry.id === execution.id ? {
      ...entry,
      status: 'pending',
      blockedReason: 'awaitingAdmin',
      expiresAt: Number(entry.expiresAt || entry.createdAt + ADMIN_APPROVAL_TTL_MS),
      sessionId: serviceSessionId,
      adminNoticeAt: Number(entry.adminNoticeAt || updatedAt),
      message: result?.message || '',
      updatedAt
    } : entry;
    pending = pending.map(update);
    history = history.map(update);
    persist();
    emit();
    if (shouldNotify) {
      queueMicrotask(() => {
        const waiting = pending.filter((entry) => entry.blockedReason === 'awaitingAdmin' && entry.sessionId === serviceSessionId);
        if (waiting.length) onAdminRequired({ ...(waiting[0] || execution), pendingAdminCount: waiting.length });
      });
    }
    return { ...result, handled: true, pendingAdmin: true, state: getState() };
  }

  async function tryExecuteAutomatic(execution, executionOptions = {}) {
    if (!execution) {
      return { handled: false, state: getState() };
    }
    if (automaticExecutionIds.has(execution.id)) {
      return { handled: true, ok: true, code: 'AUTOMATIC_ACTION_IN_PROGRESS', state: getState() };
    }

    automaticExecutionIds.add(execution.id);
    try {
      if (executionOptions.revalidate === true) {
        const validation = validatePendingExecution(execution);
        if (!validation.ok) return expire(execution.id, validation.message);
      }
      const result = await executeAutomaticAction(execution, {
        allowAdminPrompt: executionOptions.allowAdminPrompt === true
      });
      if (!result?.handled) {
        return { handled: false, state: getState() };
      }
      if (result.pendingAdmin === true || result.code === 'ADMIN_BROKER_APPROVAL_REQUIRED') {
        return markAwaitingAdmin(execution, result);
      }
      const completed = complete(
        execution.id,
        result.ok === true,
        result.message || result.code || '',
        { automatic: true, tweakState: result.tweakState }
      );
      return { ...result, state: completed.state };
    } catch (error) {
      const completed = complete(
        execution.id,
        false,
        error?.message || 'Automatic rule action failed.',
        { automatic: true }
      );
      return {
        handled: true,
        ok: false,
        code: error?.code || 'AUTOMATIC_ACTION_FAILED',
        message: error?.message || 'Automatic rule action failed.',
        state: completed.state
      };
    } finally {
      automaticExecutionIds.delete(execution.id);
    }
  }
  function fire(rule, processInfo) {
    const createdAt = now();
      const execution = {
      id: randomUUID(), ruleId: rule.id, ruleName: rule.name, status: rule.action.type === 'notify' ? 'completed' : 'pending',
      action: { ...rule.action }, processInfo: processInfo ? { name: processInfo.name, pid: processInfo.pid, startTime: processInfo.startTime, executablePath: processInfo.executablePath } : null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ADMIN_APPROVAL_TTL_MS,
      sessionId: serviceSessionId,
      ruleFingerprint: ruleFingerprint(rule),
      blockedReason: ''
    };
    history = [execution, ...history];
    if (execution.action.type === 'notify') onNotify(execution);
    if (execution.status === 'pending') pending = [execution, ...pending].slice(0, 25);
    cooldownUntil.set(rule.id, createdAt + rule.cooldownMinutes * 60 * 1000);
    prune();
    persist();
    emit();
    if (execution.status === 'pending') {
      void tryExecuteAutomatic(execution);
    }
  }
  function evaluate() {
    const timestamp = now();
    context.currentTime = timestamp;
    for (const rule of rules().filter((entry) => entry.enabled)) {
      const result = evaluateRule(rule, context);
      if (!result.matched || Number(cooldownUntil.get(rule.id) || 0) > timestamp || pending.some((entry) => entry.ruleId === rule.id)) {
        activeSince.delete(rule.id);
        continue;
      }
      const since = activeSince.get(rule.id) ?? timestamp;
      activeSince.set(rule.id, since);
      const edgeTriggered = rule.conditions.some((condition) => (
        condition.type === 'gameStarted' ||
        condition.type === 'gameStopped' ||
        condition.type === 'processStarted' ||
        condition.type === 'processStopped'
      ));
      if (timestamp - since >= (edgeTriggered ? 0 : Number(rule.holdSeconds || 0) * 1000)) {
        fire(rule, result.processInfo);
        activeSince.delete(rule.id);
      }
    }
    context.gameEvent = '';
  }
  function processIdentity(processInfo) {
    const pid = Number(processInfo?.pid) || 0;
    const startTime = String(processInfo?.startTime || '').trim();
    const fallback = String(processInfo?.executablePath || processInfo?.name || '').trim().toLowerCase();
    return `${pid}:${startTime || fallback}`;
  }
  function handleProcessSnapshot(processes) {
    const current = Array.isArray(processes) ? processes : [];
    const currentMap = new Map(current.map((entry) => [processIdentity(entry), entry]));
    if (!processSnapshotInitialized) {
      processSnapshotInitialized = true;
      previousProcesses = currentMap;
      context.processes = current;
      context.processEvents = [];
      evaluate();
      return;
    }

    const started = current
      .filter((entry) => !previousProcesses.has(processIdentity(entry)))
      .map((entry) => ({ ...entry, event: 'started' }));
    const stopped = Array.from(previousProcesses.entries())
      .filter(([identity]) => !currentMap.has(identity))
      .map(([, entry]) => ({ ...entry, event: 'stopped' }));

    previousProcesses = currentMap;
    context.processes = current;
    context.processEvents = [...started, ...stopped];
    evaluate();
    context.processEvents = [];
  }
  function handleMetrics(metrics) { context.metrics = metrics; context.metricsAt = now(); evaluate(); }
  function handleGameState(game, event = '') {
    const running = Boolean(game?.activeGame || game?.sessionStatus === 'recording');
    context.stoppedGame = !running && previousGameRunning ? context.game : null;
    context.game = game;
    context.gameEvent = event || (running && !previousGameRunning ? 'started' : !running && previousGameRunning ? 'stopped' : '');
    previousGameRunning = running;
    evaluate();
  }
  async function execute(executionId) {
    const execution = pending.find((entry) => entry.id === executionId);
    if (!execution) return { ok: false, code: 'EXECUTION_NOT_FOUND', state: getState() };
    const automaticResult = await tryExecuteAutomatic(execution, { allowAdminPrompt: true, revalidate: true });
    if (automaticResult.handled) {
      return automaticResult;
    }
    if (execution.action.type === 'askClose') {
      const result = await closeProcess(execution.processInfo);
      if (!result?.ok) return { ...result, state: getState() };
      return complete(executionId, true, result.message || '');
    }
    return { ok: true, requiresRenderer: true, execution, state: getState() };
  }
  function complete(executionId, ok, message = '', metadata = {}) {
    const tweakState = metadata?.tweakState && typeof metadata.tweakState === 'object' && !Array.isArray(metadata.tweakState)
      ? { ...metadata.tweakState }
      : null;
    pending = pending.filter((entry) => entry.id !== executionId);
    history = history.map((entry) => entry.id === executionId ? {
      ...entry,
      status: ok ? 'completed' : 'failed',
      message,
      automatic: metadata.automatic === true,
      ...(tweakState ? { tweakState } : {}),
      updatedAt: now()
    } : entry);
    persist(); emit();
    if (metadata.automatic === true) {
      const execution = history.find((entry) => entry.id === executionId);
      if (execution) onNotify(execution);
    }
    return { ok: true, state: getState() };
  }
  function dismiss(executionId) {
    pending = pending.filter((entry) => entry.id !== executionId);
    history = history.map((entry) => entry.id === executionId ? { ...entry, status: 'dismissed', updatedAt: now() } : entry);
    persist(); emit();
    return { ok: true, state: getState() };
  }
  function resumePendingAutomaticActions(options = {}) {
    [...pending].sort((left, right) => left.createdAt - right.createdAt).forEach((execution) => {
      if (execution.blockedReason === 'awaitingAdmin' && execution.sessionId !== serviceSessionId) {
        expire(execution.id, 'The pending administrator action belongs to an earlier app session.');
        return;
      }
      void tryExecuteAutomatic(execution, {
        allowAdminPrompt: false,
        revalidate: execution.blockedReason === 'awaitingAdmin' || options.adminApproved === true
      });
    });
  }
  function clearHistory() { history = []; persist(); emit(); return { ok: true, state: getState() }; }
  return {
    getState,
    handleProcessSnapshot,
    handleMetrics,
    handleGameState,
    execute,
    complete,
    dismiss,
    clearHistory,
    resumePendingAutomaticActions,
    applySettings: emit
  };
}

module.exports = { compare, conditionMatches, createRuleAutomationService, evaluateRule, normalizeProcessMatchValue };
