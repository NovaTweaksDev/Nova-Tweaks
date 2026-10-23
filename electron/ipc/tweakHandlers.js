const { failedTweakState } = require('../services/tweaks/tweakStateResult');
// Accessors preserve live main-process state.
function registerTweakHandlers(runtime) {
  const pendingChecks = new Map();
  function checkState(tweak) {
    const id = String(tweak.id);
    if (pendingChecks.has(id)) return pendingChecks.get(id);
    const promise = (async () => {
      try {
        return runtime.mergeTweakDetails(tweak, await runtime.tweakRunner.getCurrentState({ tweakId: id }));
      } catch (error) {
        return runtime.mergeTweakDetails(tweak, failedTweakState(error));
      }
    })();
    pendingChecks.set(id, promise);
    void promise.finally(() => pendingChecks.delete(id)).catch(() => {});
    return promise;
  }

  runtime.ipcMain.handle('tweaks:check-state', async (_event, payload = {}) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id || runtime.isBlockedSecurityTweakId(id)) return { ok: false, code: 'INVALID_TWEAK_ID' };
    const tweak = runtime.backendTweakCatalog.listTweaks().find((entry) => String(entry.id) === id);
    if (!tweak) return { ok: false, code: 'INVALID_TWEAK_ID' };
    if (!runtime.requiresTweakStateCheck(tweak)) return { ok: false, code: 'TWEAK_STATE_UNSUPPORTED' };
    return { ok: true, tweak: await checkState(tweak) };
  });
  runtime.ipcMain.handle('scripts:list', async () => {
    try {
      return {
        ok: true,
        scripts: runtime.scriptRunner.listScripts()
          .filter((scriptName) => !runtime.isBlockedSecurityTweakScriptName(scriptName))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.logger.error('Failed to list scripts.', ipcError);
      return {
        ok: false,
        ...ipcError,
        scripts: []
      };
    }
  });

  runtime.ipcMain.handle('scripts:run', async (_event, payload = {}) => {
    return {
      ok: false,
      code: 'DIRECT_SCRIPT_IPC_DISABLED',
      message: 'Direct script execution is disabled. Use a catalog-backed remote tweak action instead.',
      details: {},
      stdout: '',
      stderr: ''
    };
  });

  runtime.ipcMain.handle('tweaks:list', async (event, options = {}) => {
    try {
      const requestedIds = Array.isArray(options?.ids)
        ? new Set(options.ids.filter((id) => typeof id === 'string').map((id) => id.trim()))
        : null;
      const catalogTweaks = runtime.backendTweakCatalog.listTweaks()
        .filter((tweak) => !runtime.isBlockedSecurityTweakId(tweak?.id))
        .filter((tweak) => !requestedIds || requestedIds.has(String(tweak.id)));
      const includeState = options?.includeState !== false;
      const requestId = typeof options?.stateRequestId === 'string' ? options.stateRequestId.slice(0, 128) : '';
      const tweaks = includeState
        ? await runtime.mapWithConcurrency(catalogTweaks, 3, async (tweak) => {
            if (!runtime.requiresTweakStateCheck(tweak)) {
              return tweak;
            }
            const result = await checkState(tweak);
            if (requestId && !event.sender.isDestroyed()) {
              event.sender.send('tweaks:state-updated', { requestId, tweak: result });
            }
            return result;
          })
        : catalogTweaks;

      return {
        ok: true,
        tweaks
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.logger.error('Failed to list tweaks.', ipcError);
      return {
        ok: false,
        ...ipcError,
        tweaks: []
      };
    }
  });

  runtime.ipcMain.handle('tweaks:reload', async () => {
    try {
      runtime.backendTweakCatalog.reload();
      const catalogTweaks = runtime.backendTweakCatalog.listTweaks()
        .filter((tweak) => !runtime.isBlockedSecurityTweakId(tweak?.id));
      const tweaks = await runtime.mapWithConcurrency(catalogTweaks, 3, async (tweak) => {
        if (!runtime.requiresTweakStateCheck(tweak)) {
          return tweak;
        }
        return checkState(tweak);
      });
      return {
        ok: true,
        tweaks
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.logger.error('Failed to reload tweaks.', ipcError);
      return {
        ok: false,
        ...ipcError,
        tweaks: []
      };
    }
  });

  runtime.ipcMain.handle('tweaks:execute', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        stdout: '',
        stderr: ''
      };
    }

    const tweakId = typeof payload.id === 'string' ? payload.id : '';
    const targetState = typeof payload.targetState === 'string' ? payload.targetState : 'enabled';
    const params = payload.params && typeof payload.params === 'object' ? payload.params : {};
    const timeoutMs = payload.timeoutMs;

    if (!tweakId) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Payload must include a valid tweak id.',
        details: {}
      };
    }

    try {
      return await runtime.tweakRunner.runTweak({ tweakId, targetState, params, timeoutMs });
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      return {
        ok: false,
        ...ipcError,
        stdout: error?.details?.stdout || '',
        stderr: error?.details?.stderr || ''
      };
    }
  });

  runtime.ipcMain.handle('tweaks:run-example', async () => {
    return {
      ok: false,
      code: 'DIRECT_SCRIPT_IPC_DISABLED',
      message: 'Example script execution is disabled. Use a catalog-backed remote tweak action instead.',
      details: {},
      stdout: '',
      stderr: ''
    };
  });}
module.exports = { registerTweakHandlers };
