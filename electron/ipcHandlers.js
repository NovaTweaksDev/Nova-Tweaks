function registerTweakExecutionIpcHandlers({ ipcMain, tweakRunner, logger, toIpcError, isAuthenticated }) {
  if (!ipcMain) {
    throw new Error('registerTweakExecutionIpcHandlers requires ipcMain.');
  }

  if (!tweakRunner) {
    throw new Error('registerTweakExecutionIpcHandlers requires tweakRunner.');
  }

  const mapError = typeof toIpcError === 'function'
    ? toIpcError
    : (error) => ({
        code: 'UNEXPECTED_ERROR',
        message: error?.message || 'Unexpected error',
        details: {}
      });

  function hasSession() {
    return typeof isAuthenticated === 'function' ? Boolean(isAuthenticated()) : true;
  }

  async function handleGetConfig(_event, payload = {}) {
    if (!hasSession()) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        config: null
      };
    }

    const tweakId = payload?.id;
    if (typeof tweakId === 'undefined' || tweakId === null || tweakId === '') {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Payload must include a valid tweak id.',
        details: {},
        config: null
      };
    }

    try {
      const config = await tweakRunner.getConfig(tweakId);
      return {
        ok: true,
        config
      };
    } catch (error) {
      const ipcError = mapError(error);
      logger?.error?.('Failed to load tweak config.', ipcError);
      return {
        ok: false,
        ...ipcError,
        config: null
      };
    }
  }

  async function handleRunTweak(_event, payload = {}) {
    if (!hasSession()) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        stdout: '',
        stderr: ''
      };
    }

    const tweakId = payload?.id;
    const targetState = typeof payload?.targetState === 'string' ? payload.targetState : 'enabled';
    const params = payload?.params && typeof payload.params === 'object' ? payload.params : {};
    const timeoutMs = Number.isFinite(payload?.timeoutMs) ? payload.timeoutMs : 60000;

    if (typeof tweakId === 'undefined' || tweakId === null || tweakId === '') {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Payload must include a valid tweak id.',
        details: {},
        stdout: '',
        stderr: ''
      };
    }

    try {
      return await tweakRunner.runTweak({
        tweakId,
        targetState,
        params,
        timeoutMs
      });
    } catch (error) {
      const ipcError = mapError(error);
      logger?.error?.('Failed to execute tweak.', ipcError);
      return {
        ok: false,
        ...ipcError,
        stdout: error?.details?.stdout || '',
        stderr: error?.details?.stderr || ''
      };
    }
  }

  async function handlePreflightTweaks(_event, payload = {}) {
    if (!hasSession()) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, entries: [] };
    }
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    if (!jobs.length || jobs.length > 100) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'A batch of 1 to 100 tweak jobs is required.', details: {}, entries: [] };
    }
    try {
      const entries = [];
      for (const job of jobs) {
        const tweakId = typeof job?.id === 'string' ? job.id.trim() : '';
        if (!tweakId || !job?.params || typeof job.params !== 'object' || Array.isArray(job.params)) {
          throw Object.assign(new Error('Every tweak job requires an id and object params.'), { code: 'INVALID_PAYLOAD' });
        }
        entries.push(await tweakRunner.getExecutionRequirements({
          tweakId,
          targetState: typeof job.targetState === 'string' ? job.targetState : 'enabled',
          params: job.params
        }));
      }
      return { ok: true, requiresAdmin: entries.some((entry) => entry.requiresAdmin), entries };
    } catch (error) {
      const ipcError = mapError(error);
      logger?.error?.('Failed to preflight tweak batch.', ipcError);
      return { ok: false, ...ipcError, entries: [] };
    }
  }

  ipcMain.handle('get-tweak-config', handleGetConfig);
  ipcMain.handle('run-tweak', handleRunTweak);

  // Backwards-compatible channels used by existing renderer code.
  ipcMain.handle('api:tweaks:get-config', handleGetConfig);
  ipcMain.handle('api:tweaks:execute', handleRunTweak);
  ipcMain.handle('api:tweaks:preflight', handlePreflightTweaks);
}

module.exports = {
  registerTweakExecutionIpcHandlers
};
