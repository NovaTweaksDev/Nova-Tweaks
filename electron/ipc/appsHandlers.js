// Accessors preserve live main-process state.
function registerAppsHandlers(runtime) {
  runtime.ipcMain.handle('apps:list', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        apps: []
      };
    }

    if (!runtime.appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        apps: []
      };
    }

    const detailLevel = payload?.detailLevel === 'summary' ? 'summary' : 'full';
    const startedAt = Date.now();
    try {
      const apps = await runtime.appsManager.listInstalledApps({ detailLevel });
      runtime.warnIfSlow(runtime.appsLogger, 'apps:list', startedAt, runtime.IPC_SLOW_CALL_THRESHOLD_MS, {
        detailLevel,
        appCount: apps.length
      });
      return {
        ok: true,
        detailLevel,
        apps
      };
    } catch (error) {
      runtime.warnIfSlow(runtime.appsLogger, 'apps:list', startedAt, runtime.IPC_SLOW_CALL_THRESHOLD_MS, {
        detailLevel,
        failed: true
      });
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to list installed apps.', ipcError);
      return {
        ok: false,
        ...ipcError,
        apps: []
      };
    }
  });

  runtime.ipcMain.handle('apps:startup:list', async () => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        entries: []
      };
    }

    if (!runtime.appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        entries: []
      };
    }

    const startedAt = Date.now();
    try {
      const entries = await runtime.appsManager.listStartupApps();
      runtime.warnIfSlow(runtime.appsLogger, 'apps:startup:list', startedAt, runtime.IPC_SLOW_CALL_THRESHOLD_MS, {
        entryCount: entries.length
      });
      return {
        ok: true,
        entries
      };
    } catch (error) {
      runtime.warnIfSlow(runtime.appsLogger, 'apps:startup:list', startedAt, runtime.IPC_SLOW_CALL_THRESHOLD_MS, {
        failed: true
      });
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to list startup entries.', ipcError);
      return {
        ok: false,
        ...ipcError,
        entries: []
      };
    }
  });

  runtime.ipcMain.handle('apps:startup:set-enabled', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!runtime.appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const entryId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!entryId || typeof payload?.enabled !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid startup entry id and enabled flag are required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await runtime.appsManager.setStartupEntryEnabled({
        entryId,
        enabled: payload.enabled
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      if (error?.code === 'ADMIN_REQUIRED' && !runtime.isAdminSession && error?.details?.startupScope === 'machine') {
        try {
          const result = await runtime.adminBrokerManager.execute(
            'startup.setEnabled',
            { entryId, enabled: payload.enabled, expectedScope: 'machine' },
            { reason: 'startup-entry', timeoutMs: 60000 }
          );
          return { ok: true, result };
        } catch (brokerError) {
          error = brokerError;
        }
      } else if (error?.code === 'ADMIN_REQUIRED' && !runtime.isAdminSession) {
        error.code = 'ADMIN_BROKER_USER_SCOPE_UNSUPPORTED';
        error.message = 'This protected per-user startup entry cannot be changed through administrator credentials for another account.';
      }
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to update startup entry state.', {
        ...ipcError,
        entryId,
        enabled: payload.enabled
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  runtime.ipcMain.handle('apps:startup:set-type', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!runtime.appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const entryId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const startupType = typeof payload?.startupType === 'string' ? payload.startupType.trim() : '';
    if (!entryId || !startupType) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid startup entry id and startupType are required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await runtime.appsManager.setStartupEntryType({
        entryId,
        startupType
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to change startup entry type.', {
        ...ipcError,
        entryId,
        startupType
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  runtime.ipcMain.handle('apps:uninstall', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!runtime.appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const appId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!appId) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid app id is required.',
        details: {},
        result: null
      };
    }

    try {
      const installedApps = await runtime.appsManager.listInstalledApps({ detailLevel: 'summary' });
      const targetApp = installedApps.find((entry) => entry.id === appId);
      const requiresBroker = !runtime.isAdminSession && targetApp?.source === 'win32' && targetApp.installScope === 'machine';
      const result = requiresBroker
        ? await runtime.adminBrokerManager.execute('apps.uninstall', { appId, expectedScope: 'machine' }, { reason: 'app-uninstall', timeoutMs: 300000 })
        : await runtime.appsManager.uninstallApp({ appId });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to uninstall app.', {
        ...ipcError,
        appId
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  runtime.ipcMain.handle('apps:optimize', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: {},
        result: null
      };
    }

    if (!runtime.appsManager) {
      return {
        ok: false,
        code: 'APPS_NOT_READY',
        message: 'Apps manager is not initialized.',
        details: {},
        result: null
      };
    }

    const appId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!appId) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'A valid app id is required.',
        details: {},
        result: null
      };
    }

    try {
      const result = await runtime.appsManager.optimizeApp({
        appId,
        actionIds: Array.isArray(payload?.actionIds) ? payload.actionIds : null
      });
      return {
        ok: true,
        result
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to optimize app.', {
        ...ipcError,
        appId
      });
      return {
        ok: false,
        ...ipcError,
        result: null
      };
    }
  });

  runtime.ipcMain.handle('apps:optimization:analyze', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    if (!runtime.appsManager) {
      return { ok: false, code: 'APPS_NOT_READY', message: 'Apps manager is not initialized.', details: {}, result: null };
    }
    const appId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!appId) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'A valid app id is required.', details: {}, result: null };
    }
    try {
      return {
        ok: true,
        result: await runtime.appsManager.analyzeAppOptimization({
          appId,
          includeCacheSize: payload?.includeCacheSize !== false
        })
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.appsLogger.error('Failed to analyze app optimization.', { ...ipcError, appId });
      return { ok: false, ...ipcError, result: null };
    }
  });

  runtime.ipcMain.handle('apps:optimization:confirm-close', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    try {
      return { ok: true, result: await runtime.appsManager.confirmAppOptimizationClose(payload) };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      return { ok: false, ...ipcError, result: null };
    }
  });

  runtime.ipcMain.handle('apps:optimization:cancel', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    try {
      return { ok: true, result: runtime.appsManager.cancelAppOptimization(payload) };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      return { ok: false, ...ipcError, result: null };
    }
  });

  runtime.ipcMain.handle('apps:optimization:reset', async (_event, payload = {}) => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    try {
      return { ok: true, result: await runtime.appsManager.resetAppOptimizations({ appId: payload?.id }) };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      return { ok: false, ...ipcError, result: null };
    }
  });

  runtime.ipcMain.handle('apps:optimization:get-state', async () => {
    const session = { authenticated: true };
    if (!session.authenticated) {
      return { ok: false, code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, result: null };
    }
    return {
      ok: true,
      result: runtime.appsManager?.getAppOptimizationState?.() || null
    };
  });

}
module.exports = { registerAppsHandlers };
