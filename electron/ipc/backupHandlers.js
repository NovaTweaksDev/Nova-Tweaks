// Accessors preserve live main-process state.
function registerBackupHandlers(runtime) {
  runtime.ipcMain.handle('backup:list', async () => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.listBackups())
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to list backups.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  runtime.ipcMain.handle('backup:create', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.createBackup(payload.type === 'beforeApply' && payload.engine !== 'windows' ? {
          ...payload,
          snapshot: {
            ...payload.snapshot,
            tweakStates: await runtime.captureAutomaticTweakSnapshot(
              (payload.snapshot?.tweakStates?.data || []).map((entry) => {
                const tweak = runtime.backendTweakCatalog.getConfigById(String(entry.id));
                if (!tweak || runtime.isBlockedSecurityTweakId(tweak.id)) {
                  throw new Error(`Cannot capture unavailable tweak: ${entry.id}`);
                }
                return tweak;
              }), runtime.tweakRunner, { strict: true }
            )
          }
        } : payload, {
          createWindowsProvider: String(payload?.engine || '').trim().toLowerCase() === 'windows' && !runtime.isAdminSession
            ? (name) => runtime.adminBrokerManager.execute(
                'systemRestore.create',
                { name },
                { reason: 'system-restore-point', timeoutMs: 120000 }
              )
            : null
        }))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to create backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  runtime.ipcMain.handle('backup:rename', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.renameBackup(payload))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to rename backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  runtime.ipcMain.handle('backup:delete', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.deleteBackup(payload))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to delete backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  runtime.ipcMain.handle('backup:export', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        filePath: '',
        canceled: false
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.exportBackup(payload))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to export backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        filePath: '',
        canceled: false
      };
    }
  });

  runtime.ipcMain.handle('backup:import', async () => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.importBackup())
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to import backup.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  runtime.ipcMain.handle('backup:restore', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        backup: null,
        restorePlan: null
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.restoreBackup(payload, {
          restoreWindowsProvider: (sequenceNumber) => (
            runtime.isAdminSession
              ? runtime.backupManager.restoreWindowsRestorePoint(sequenceNumber)
              : runtime.adminBrokerManager.execute(
                  'systemRestore.restore',
                  { sequenceNumber },
                  { reason: 'system-restore', timeoutMs: 120000 }
                )
          )
        }))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to prepare backup restore.', ipcError);
      return {
        ok: false,
        ...ipcError,
        backup: null,
        restorePlan: null
      };
    }
  });

  runtime.ipcMain.handle('backup:open-folder', async () => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {}
      };
    }

    try {
      const { backupsRoot } = runtime.backupManager.getStoragePaths();
      runtime.fs.mkdirSync(backupsRoot, { recursive: true });
      const openError = await runtime.shell.openPath(backupsRoot);
      if (openError) {
        return {
          ok: false,
          code: 'OPEN_BACKUP_FOLDER_FAILED',
          message: openError
        };
      }

      return {
        ok: true,
        path: backupsRoot
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to open backup folder.', ipcError);
      return {
        ok: false,
        ...ipcError
      };
    }
  });

  runtime.ipcMain.handle('backup:clean-old', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        deletedCount: 0,
        backups: [],
        windowsRestorePoints: []
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.cleanOldBackups(payload))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to clean old backups.', ipcError);
      return {
        ok: false,
        ...ipcError,
        deletedCount: 0,
        backups: [],
        windowsRestorePoints: []
      };
    }
  });

  runtime.ipcMain.handle('backup:settings:get', async () => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        settings: null
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.getBackupSettings())
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to load backup settings.', ipcError);
      return {
        ok: false,
        ...ipcError,
        settings: null
      };
    }
  });

  runtime.ipcMain.handle('backup:settings:update', async (_event, payload = {}) => {
    if (!runtime.backupManager) {
      return {
        ok: false,
        code: 'BACKUPS_NOT_READY',
        message: 'Backup manager is not initialized.',
        details: {},
        settings: null
      };
    }

    try {
      return {
        ok: true,
        ...(await runtime.backupManager.updateBackupSettings(payload))
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.backupsLogger.error('Failed to update backup settings.', ipcError);
      return {
        ok: false,
        ...ipcError,
        settings: null
      };
    }
  });

}
module.exports = { registerBackupHandlers };
