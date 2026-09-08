const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getAdminState: () => ipcRenderer.invoke('app:get-admin-state'),
  requestAdminRelaunch: () => ipcRenderer.invoke('app:request-admin-relaunch'),
  getAdminAccessState: () => ipcRenderer.invoke('app:get-admin-access-state'),
  requestAdminAccess: (payload) => ipcRenderer.invoke('app:request-admin-access', payload),
  onAdminAccessStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:admin-access-state', listener);
    return () => ipcRenderer.removeListener('app:admin-access-state', listener);
  },
  minimizeWindow: () => ipcRenderer.invoke('app:window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('app:window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('app:window:close'),
  getOsLanguage: () => ipcRenderer.invoke('app:get-os-language'),
  getSystemUptime: () => ipcRenderer.invoke('app:get-system-uptime'),
  getSystemDetection: () => ipcRenderer.invoke('app:get-system-detection'),
  openExternalUrl: (payload) => ipcRenderer.invoke('app:open-external-url', payload),
  openMailUrl: (payload) => ipcRenderer.invoke('app:open-mail-url', payload),
  openPath: (payload) => ipcRenderer.invoke('app:open-path', payload),
  openThirdPartyLicenses: () => ipcRenderer.invoke('app:open-third-party-licenses'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
  getProcessAutomationState: () => ipcRenderer.invoke('process-automation:get-state'),
  updateProcessAutomationSettings: (payload) => ipcRenderer.invoke('process-automation:update-settings', payload),
  dismissProcessAlert: (payload) => ipcRenderer.invoke('process-automation:dismiss-alert', payload),
  excludeProcessAlert: (payload) => ipcRenderer.invoke('process-automation:exclude-process', payload),
  requestCloseProcess: (payload) => ipcRenderer.invoke('process-automation:request-close', payload),
  forceTerminateProcess: (payload) => ipcRenderer.invoke('process-automation:force-terminate', payload),
  clearProcessAutomationHistory: () => ipcRenderer.invoke('process-automation:clear-history'),
  onProcessAutomationUpdate: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('process-automation:update', listener);
    return () => ipcRenderer.removeListener('process-automation:update', listener);
  },
  getRuleAutomationState: () => ipcRenderer.invoke('rule-automation:get-state'),
  saveAutomationRule: (payload) => ipcRenderer.invoke('rule-automation:save-rule', payload),
  deleteAutomationRule: (payload) => ipcRenderer.invoke('rule-automation:delete-rule', payload),
  executeAutomationRuleAction: (payload) => ipcRenderer.invoke('rule-automation:execute', payload),
  approvePendingAdminRuleActions: () => ipcRenderer.invoke('rule-automation:approve-admin-pending'),
  completeAutomationRuleAction: (payload) => ipcRenderer.invoke('rule-automation:complete', payload),
  dismissAutomationRuleAction: (payload) => ipcRenderer.invoke('rule-automation:dismiss', payload),
  clearRuleAutomationHistory: () => ipcRenderer.invoke('rule-automation:clear-history'),
  onRuleAutomationUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('rule-automation:update', listener);
    return () => ipcRenderer.removeListener('rule-automation:update', listener);
  },
  getScheduledMaintenanceState: () => ipcRenderer.invoke('scheduled-maintenance:get-state'),
  updateScheduledMaintenance: (payload) => ipcRenderer.invoke('scheduled-maintenance:update', payload),
  runScheduledMaintenanceNow: () => ipcRenderer.invoke('scheduled-maintenance:run-now'),
  clearScheduledMaintenanceHistory: () => ipcRenderer.invoke('scheduled-maintenance:clear-history'),
  onScheduledMaintenanceUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scheduled-maintenance:update', listener);
    return () => ipcRenderer.removeListener('scheduled-maintenance:update', listener);
  },
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  chooseBackupLocation: () => ipcRenderer.invoke('settings:choose-backup-location'),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  getAppMetadata: () => ipcRenderer.invoke('settings:metadata'),
  openLogsFolder: () => ipcRenderer.invoke('settings:open-logs-folder'),
  clearAppCache: () => ipcRenderer.invoke('settings:clear-cache'),
  exportDiagnosticReport: () => ipcRenderer.invoke('settings:export-diagnostics'),
  exportTweakActionLogCsv: (payload) => ipcRenderer.invoke('tweak-actions:export-log-csv', payload),
  apiExecuteTweak: (payload) => ipcRenderer.invoke('api:tweaks:execute', payload),
  apiPreflightTweaks: (payload) => ipcRenderer.invoke('api:tweaks:preflight', payload),
  listInstalledApps: (payload) => ipcRenderer.invoke('apps:list', payload),
  listStartupApps: () => ipcRenderer.invoke('apps:startup:list'),
  setStartupEntryEnabled: (payload) => ipcRenderer.invoke('apps:startup:set-enabled', payload),
  setStartupEntryType: (payload) => ipcRenderer.invoke('apps:startup:set-type', payload),
  gameDetection: {
    scan: () => ipcRenderer.invoke('game-detection:scan'),
    getCurrent: () => ipcRenderer.invoke('game-detection:get-current')
  },
  getActiveGame: () => ipcRenderer.invoke('gamemode:active-game'),
  getGameModeState: () => ipcRenderer.invoke('gamemode:state'),
  applyGameModeSettings: (payload) => ipcRenderer.invoke('gamemode:apply-settings', payload),
  getGameSessionState: () => ipcRenderer.invoke('game-session:get-state'),
  startGameSession: (payload) => ipcRenderer.invoke('game-session:start', payload),
  stopGameSession: (payload) => ipcRenderer.invoke('game-session:stop', payload),
  retryPresentMonMonitoring: () => ipcRenderer.invoke('presentmon:retry'),
  setGameSessionAutoTracking: (payload) => ipcRenderer.invoke('game-session:set-auto-tracking', payload),
  listGameSessionReports: () => ipcRenderer.invoke('game-session:list-reports'),
  chooseGameExecutable: () => ipcRenderer.invoke('game-session:choose-executable'),
  exportGameSessionReport: (payload) => ipcRenderer.invoke('game-session:export-report', payload),
  openGameSessionReport: (payload) => ipcRenderer.invoke('game-session:open-report', payload),
  onGameSessionUpdate: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('game-session:update', listener);
    void ipcRenderer.invoke('game-session:subscribe');
    return () => {
      ipcRenderer.removeListener('game-session:update', listener);
      void ipcRenderer.invoke('game-session:unsubscribe');
    };
  },
  onPresentMonStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('presentmon:status', listener);
    return () => ipcRenderer.removeListener('presentmon:status', listener);
  },
  onPresentMonMetrics: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('presentmon:metrics', listener);
    return () => ipcRenderer.removeListener('presentmon:metrics', listener);
  },
  onPresentMonError: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('presentmon:error', listener);
    return () => ipcRenderer.removeListener('presentmon:error', listener);
  },
  uninstallInstalledApp: (payload) => ipcRenderer.invoke('apps:uninstall', payload),
  optimizeInstalledApp: (payload) => ipcRenderer.invoke('apps:optimize', payload),
  getAppOptimization: (payload) => ipcRenderer.invoke('apps:optimization:analyze', payload),
  confirmAppOptimizationClose: (payload) => ipcRenderer.invoke('apps:optimization:confirm-close', payload),
  cancelAppOptimization: (payload) => ipcRenderer.invoke('apps:optimization:cancel', payload),
  resetAppOptimizations: (payload) => ipcRenderer.invoke('apps:optimization:reset', payload),
  getAppOptimizationState: () => ipcRenderer.invoke('apps:optimization:get-state'),
  onAppOptimizationUpdate: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('apps:optimization:update', listener);
    return () => ipcRenderer.removeListener('apps:optimization:update', listener);
  },
  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: (payload) => ipcRenderer.invoke('backup:create', payload),
  renameBackup: (payload) => ipcRenderer.invoke('backup:rename', payload),
  deleteBackup: (payload) => ipcRenderer.invoke('backup:delete', payload),
  exportBackup: (payload) => ipcRenderer.invoke('backup:export', payload),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  restoreBackup: (payload) => ipcRenderer.invoke('backup:restore', payload),
  openBackupFolder: () => ipcRenderer.invoke('backup:open-folder'),
  cleanOldBackups: (payload) => ipcRenderer.invoke('backup:clean-old', payload),
  getBackupSettings: () => ipcRenderer.invoke('backup:settings:get'),
  updateBackupSettings: (payload) => ipcRenderer.invoke('backup:settings:update', payload),
  getTweakConfig: (payload) => ipcRenderer.invoke('get-tweak-config', payload),
  runTweak: (payload) => ipcRenderer.invoke('run-tweak', payload),
  apiCheckUpdate: () => ipcRenderer.invoke('api:update:check'),
  apiGetUpdateNotes: () => ipcRenderer.invoke('api:update:notes'),
  chooseProfileImage: () => ipcRenderer.invoke('profile:choose-image'),
  getLatestMetrics: () => ipcRenderer.invoke('metrics:get-latest'),
  subscribeMetrics: () => ipcRenderer.invoke('metrics:subscribe'),
  unsubscribeMetrics: () => ipcRenderer.invoke('metrics:unsubscribe'),
  getMonitoringSnapshot: () => ipcRenderer.invoke('monitoring:getSnapshot'),
  getAdvancedSensorMonitoringState: () => ipcRenderer.invoke('monitoring:getAdvancedSensorState'),
  setAdvancedSensorMonitoringEnabled: (payload) => ipcRenderer.invoke('monitoring:setAdvancedSensorsEnabled', payload),
  getExtendedNetworkTestState: () => ipcRenderer.invoke('network-test:get-state'),
  startExtendedNetworkTest: () => ipcRenderer.invoke('network-test:start'),
  cancelExtendedNetworkTest: () => ipcRenderer.invoke('network-test:cancel'),
  applyRecommendedMtu: () => ipcRenderer.invoke('network-test:mtu:apply'),
  resetMtu: () => ipcRenderer.invoke('network-test:mtu:reset'),
  onExtendedNetworkTestUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('network-test:update', listener);
    return () => ipcRenderer.removeListener('network-test:update', listener);
  },
  startMonitoring: () => ipcRenderer.invoke('monitoring:start'),
  stopMonitoring: () => ipcRenderer.invoke('monitoring:stop'),
  setMonitoringRefreshRate: (payload) => ipcRenderer.invoke('monitoring:setRefreshRate', payload),
  onMonitoringUpdate: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monitoring:update', listener);
    void ipcRenderer.invoke('monitoring:start');
    return () => {
      ipcRenderer.removeListener('monitoring:update', listener);
      void ipcRenderer.invoke('monitoring:stop');
    };
  },
  onMetricsUpdate: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('metrics:update', listener);
    void ipcRenderer.invoke('metrics:subscribe');
    return () => {
      ipcRenderer.removeListener('metrics:update', listener);
      void ipcRenderer.invoke('metrics:unsubscribe');
    };
  },
  runExampleTweak: () => ipcRenderer.invoke('tweaks:run-example'),
  listTweaks: (options = {}) => ipcRenderer.invoke('tweaks:list', options),
  reloadTweaks: () => ipcRenderer.invoke('tweaks:reload'),
  executeTweak: (payload) => ipcRenderer.invoke('tweaks:execute', payload),
  listScripts: () => ipcRenderer.invoke('scripts:list'),
});
