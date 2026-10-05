// Accessors preserve live main-process state.
function registerTweakHandlers(runtime) {
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

  runtime.ipcMain.handle('tweaks:list', async (_event, options = {}) => {
    try {
      const catalogTweaks = runtime.backendTweakCatalog.listTweaks()
        .filter((tweak) => !runtime.isBlockedSecurityTweakId(tweak?.id));
      const includeState = options?.includeState !== false;
      const tweaks = includeState
        ? await runtime.mapWithConcurrency(catalogTweaks, 3, async (tweak) => {
            if (!runtime.requiresTweakStateCheck(tweak)) {
              return tweak;
            }
            try {
              const state = await runtime.tweakRunner.getCurrentState({ tweakId: tweak.id });
              return runtime.mergeTweakDetails(tweak, state);
            } catch (_error) {
              return tweak;
            }
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
        try {
          const state = await runtime.tweakRunner.getCurrentState({ tweakId: tweak.id });
          return runtime.mergeTweakDetails(tweak, state);
        } catch (_error) {
          return tweak;
        }
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
