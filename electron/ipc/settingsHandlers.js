// Accessors preserve live main-process state.
function registerSettingsHandlers(runtime) {
  runtime.ipcMain.handle('settings:get', async () => ({
    ok: true,
    settings: runtime.settingsService.getSettings(),
    defaults: runtime.settingsService.getDefaults(),
    settingsPath: runtime.settingsService.getSettingsPath(),
    warning: runtime.settingsService.getLastLoadWarning()
  }));

  runtime.ipcMain.handle('settings:update', async (_event, payload = {}) => {
    try {
      const settings = runtime.settingsService.updateSettings(payload);
      runtime.applySettingsRuntimeEffects(settings);
      return { ok: true, settings };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to update settings.', ipcError);
      return { ok: false, ...ipcError, settings: runtime.settingsService.getSettings() };
    }
  });

  runtime.ipcMain.handle('settings:reset', async () => {
    try {
      const settings = runtime.settingsService.resetSettings();
      runtime.applySettingsRuntimeEffects(settings);
      return { ok: true, settings };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to reset settings.', ipcError);
      return { ok: false, ...ipcError, settings: runtime.settingsService.getSettings() };
    }
  });

  runtime.ipcMain.handle('settings:choose-backup-location', async () => {
    try {
      const currentPath = runtime.settingsService.getSettings()?.backupData?.backupLocation || runtime.app.getPath('documents');
      const result = await runtime.dialog.showOpenDialog({
        title: 'Choose Backup Location',
        defaultPath: currentPath,
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: true, canceled: true, settings: runtime.settingsService.getSettings() };
      }

      const settings = runtime.settingsService.updateSettings({
        backupData: { backupLocation: result.filePaths[0] }
      });
      runtime.applySettingsRuntimeEffects(settings);
      return { ok: true, canceled: false, settings };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to choose backup location.', ipcError);
      return { ok: false, ...ipcError, canceled: false, settings: runtime.settingsService.getSettings() };
    }
  });

  runtime.ipcMain.handle('profile:choose-image', async () => {
    try {
      const result = await runtime.dialog.showOpenDialog({
        title: 'Choose Profile Image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: true, canceled: true, avatarDataUrl: '' };
      }

      const filePath = result.filePaths[0];
      const stat = runtime.fs.statSync(filePath);
      if (stat.size > runtime.PROFILE_IMAGE_SOURCE_MAX_BYTES) {
        return {
          ok: false,
          code: 'PROFILE_IMAGE_TOO_LARGE',
          message: 'Profile image must be smaller than 6 MB.',
          avatarDataUrl: ''
        };
      }

      const buffer = runtime.resizeProfileImage(filePath);
      if (!buffer) {
        return {
          ok: false,
          code: 'PROFILE_IMAGE_INVALID',
          message: 'Profile image could not be read.',
          avatarDataUrl: ''
        };
      }

      if (buffer.length > runtime.PROFILE_IMAGE_UPLOAD_MAX_BYTES) {
        return {
          ok: false,
          code: 'PROFILE_IMAGE_TOO_LARGE',
          message: 'Profile image is too large after resizing. Please choose a smaller image.',
          avatarDataUrl: ''
        };
      }

      const data = buffer.toString('base64');
      return {
        ok: true,
        canceled: false,
        avatarDataUrl: `data:image/jpeg;base64,${data}`
      };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      return { ok: false, ...ipcError, avatarDataUrl: '' };
    }
  });

  runtime.ipcMain.handle('settings:export', async () => {
    try {
      const result = await runtime.dialog.showSaveDialog({
        title: 'Export Settings',
        defaultPath: runtime.path.join(runtime.app.getPath('documents'), 'nova-tweaks-settings.json'),
        showOverwriteConfirmation: true,
        filters: [{ name: 'Nova Tweaks Settings JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true, filePath: '' };
      }

      runtime.writePrivateExportFile(
        result.filePath,
        JSON.stringify(runtime.settingsService.createExportDocument(), null, 2)
      );
      return { ok: true, canceled: false, filePath: result.filePath };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to export settings.', ipcError);
      return { ok: false, ...ipcError, canceled: false, filePath: '' };
    }
  });

  runtime.ipcMain.handle('settings:import', async () => {
    try {
      const result = await runtime.dialog.showOpenDialog({
        title: 'Import Settings',
        properties: ['openFile'],
        filters: [{ name: 'Nova Tweaks Settings JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: true, canceled: true, settings: runtime.settingsService.getSettings() };
      }

      const document = JSON.parse(runtime.fs.readFileSync(result.filePaths[0], 'utf8'));
      const importedSettings = runtime.settingsService.validateImportDocument(document);
      const settings = runtime.settingsService.saveSettings(importedSettings);
      runtime.applySettingsRuntimeEffects(settings);
      return { ok: true, canceled: false, settings, filePath: result.filePaths[0] };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to import settings.', ipcError);
      return { ok: false, ...ipcError, canceled: false, settings: runtime.settingsService.getSettings() };
    }
  });

  runtime.ipcMain.handle('settings:metadata', async () => ({
    ok: true,
    metadata: {
      appName: runtime.app.getName(),
      appVersion: runtime.app.getVersion(),
      platform: process.platform,
      release: runtime.os.release(),
      arch: process.arch,
      logsPath: runtime.app.getPath('logs'),
      settingsPath: runtime.settingsService.getSettingsPath(),
      backupPath: runtime.backupManager?.getStoragePaths?.().backupsRoot || runtime.getBackupRootFromSettings()
    }
  }));

  runtime.ipcMain.handle('settings:open-logs-folder', async () => {
    try {
      const logsPath = runtime.app.getPath('logs');
      runtime.fs.mkdirSync(logsPath, { recursive: true });
      const openError = await runtime.shell.openPath(logsPath);
      if (openError) {
        return { ok: false, code: 'OPEN_LOGS_FOLDER_FAILED', message: openError, path: logsPath };
      }
      return { ok: true, path: logsPath };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      return { ok: false, ...ipcError, path: '' };
    }
  });

  runtime.ipcMain.handle('settings:clear-cache', async () => {
    try {
      const result = runtime.clearSafeCacheTargets();
      if (result.removedTargets === 0) {
        return {
          ok: false,
          code: 'NO_SAFE_CACHE_FOUND',
          message: 'No safe local cache folder is available to clear.',
          ...result
        };
      }
      return { ok: true, ...result };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to clear app cache.', ipcError);
      return { ok: false, ...ipcError, removedTargets: 0, removedBytes: 0 };
    }
  });

  runtime.ipcMain.handle('settings:export-diagnostics', async () => {
    try {
      const backupPaths = runtime.backupManager?.getStoragePaths?.() || {};
      const diagnosticReport = {
        schema: 'nova-tweaks-diagnostic-report',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        app: { name: runtime.app.getName(), version: runtime.app.getVersion() },
        system: {
          platform: process.platform,
          release: runtime.os.release(),
          arch: process.arch,
          uptimeSeconds: Math.max(0, Math.floor(runtime.os.uptime()))
        },
        paths: {
          logsPath: runtime.app.getPath('logs'),
          settingsPath: runtime.settingsService.getSettingsPath(),
          backupPath: backupPaths.backupsRoot || runtime.getBackupRootFromSettings()
        },
        settings: runtime.settingsService.getSettings(),
        status: {
          admin: runtime.isAdminSession,
          adminBroker: runtime.adminBrokerManager?.getState?.() || null,
          updateCheckCode: runtime.latestUpdateCheck?.code || ''
        },
        recentLogs: runtime.safeReadRecentLogLines()
      };

      const result = await runtime.dialog.showSaveDialog({
        title: 'Export Diagnostic Report',
        defaultPath: runtime.path.join(runtime.app.getPath('documents'), 'nova-tweaks-diagnostics.json'),
        showOverwriteConfirmation: true,
        filters: [{ name: 'Diagnostic JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true, filePath: '' };
      }

      runtime.writePrivateExportFile(
        result.filePath,
        JSON.stringify(runtime.redactDiagnosticValue(diagnosticReport), null, 2)
      );
      return { ok: true, canceled: false, filePath: result.filePath };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to export diagnostic report.', ipcError);
      return { ok: false, ...ipcError, canceled: false, filePath: '' };
    }
  });

  runtime.ipcMain.handle('tweak-actions:export-log-csv', async (_event, payload = {}) => {
    try {
      const result = await runtime.dialog.showSaveDialog({
        title: 'Export Tweak Action Log',
        defaultPath: runtime.path.join(runtime.app.getPath('documents'), 'nova-tweaks-action-log.csv'),
        showOverwriteConfirmation: true,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true, filePath: '' };
      }

      runtime.writePrivateExportFile(result.filePath, runtime.buildTweakActionLogCsv(payload?.rows));
      return { ok: true, canceled: false, filePath: result.filePath };
    } catch (error) {
      const ipcError = runtime.toIpcError(error);
      runtime.settingsLogger.error('Failed to export tweak action log.', ipcError);
      return { ok: false, ...ipcError, canceled: false, filePath: '' };
    }
  });

}
module.exports = { registerSettingsHandlers };
