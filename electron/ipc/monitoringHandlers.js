// Accessors preserve live main-process state.
function registerMonitoringHandlers(runtime) {
  runtime.ipcMain.handle('metrics:get-latest', async () => {
    if (!runtime.monitoringManager) {
      return {
        ok: false,
        code: 'METRICS_NOT_READY',
        message: 'Metrics service is not initialized.',
        metrics: null
      };
    }

    return {
      ok: true,
      metrics: runtime.monitoringManager.getLatest()
    };
  });

  runtime.ipcMain.handle('metrics:subscribe', async (event) => {
    if (!runtime.monitoringManager) {
      return {
        ok: false,
        code: 'METRICS_NOT_READY',
        message: 'Metrics service is not initialized.',
        metrics: null
      };
    }

    runtime.metricsSubscriberIds.add(event.sender.id);
    const latestMetrics = runtime.monitoringManager.getLatest();
    if (latestMetrics) {
      event.sender.send('metrics:update', latestMetrics);
    }

    try {
      await runtime.syncMonitoringSubscriptionState();
      return {
        ok: true,
        metrics: latestMetrics
      };
    } catch (error) {
      runtime.metricsSubscriberIds.delete(event.sender.id);
      const ipcError = runtime.toIpcError(error);
      runtime.metricsLogger.error('Failed to subscribe to metrics updates.', ipcError);
      return {
        ok: false,
        ...ipcError,
        metrics: null
      };
    }
  });

  runtime.ipcMain.handle('metrics:unsubscribe', async (event) => {
    runtime.metricsSubscriberIds.delete(event.sender.id);
    await runtime.syncMonitoringSubscriptionState();
    return {
      ok: true
    };
  });

  runtime.ipcMain.handle('network-test:get-state', async () => ({
    ok: Boolean(runtime.extendedNetworkTestService),
    state: runtime.extendedNetworkTestService?.getState?.() || null
  }));

  runtime.ipcMain.handle('network-test:start', async () => (
    runtime.extendedNetworkTestService?.start?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  runtime.ipcMain.handle('network-test:cancel', async () => (
    runtime.extendedNetworkTestService?.cancel?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  runtime.ipcMain.handle('network-test:mtu:apply', async () => (
    runtime.extendedNetworkTestService?.applyMtu?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  runtime.ipcMain.handle('network-test:mtu:reset', async () => (
    runtime.extendedNetworkTestService?.resetMtu?.() ||
    { ok: false, code: 'NETWORK_TEST_NOT_READY', message: 'Network test service is unavailable.' }
  ));

  runtime.ipcMain.handle('monitoring:getSnapshot', async () => {
    if (!runtime.monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        snapshot: null
      };
    }

    const latestMetrics = runtime.monitoringManager.getLatest();
    return {
      ok: true,
      snapshot: latestMetrics?.overview || null
    };
  });

  runtime.ipcMain.handle('monitoring:getAdvancedSensorState', async () => ({
    ok: true,
    enabled: runtime.advancedSensorMonitoringEnabled
  }));

  runtime.ipcMain.handle('monitoring:setAdvancedSensorsEnabled', async (event, payload = {}) => {
    if (!runtime.monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        enabled: runtime.advancedSensorMonitoringEnabled,
        settings: runtime.settingsService?.getSettings?.() || null
      };
    }

    const enabled = payload?.enabled === true;
    if (!enabled) {
      try {
        runtime.advancedSensorMonitoringEnabled = false;
        const shutdownResult = await runtime.monitoringManager.shutdown({
          ensureProcessStopped: true
        });
        const settings = runtime.settingsService.updateSettings({
          monitoring: {
            advancedSensorsEnabled: false
          }
        });
        return {
          ok: shutdownResult.sidecarStopped,
          code: shutdownResult.sidecarStopped ? undefined : 'LHM_PROCESS_STILL_RUNNING',
          message: shutdownResult.sidecarStopped
            ? ''
            : 'LibreHardwareMonitor is still running. Stop it in Task Manager if needed.',
          enabled: false,
          settings,
          sidecarStopped: shutdownResult.sidecarStopped
        };
      } catch (error) {
        const ipcError = runtime.toIpcError(error);
        runtime.metricsLogger.error('Failed to disable advanced sensor monitoring.', ipcError);
        return {
          ok: false,
          ...ipcError,
          enabled: false,
          settings: runtime.settingsService.getSettings()
        };
      }
    }

    runtime.metricsSubscriberIds.add(event.sender.id);
    runtime.advancedSensorMonitoringEnabled = true;
    try {
      const started = await runtime.monitoringManager.start();
      if (!started) {
        const activationError = new Error(
          runtime.monitoringManager.getLatest()?.message || 'LibreHardwareMonitor could not be started.'
        );
        activationError.code = 'ADVANCED_SENSOR_MONITORING_UNAVAILABLE';
        throw activationError;
      }
      const settings = runtime.settingsService.updateSettings({
        monitoring: {
          advancedSensorsEnabled: true
        }
      });
      return {
        ok: true,
        enabled: true,
        settings
      };
    } catch (error) {
      runtime.advancedSensorMonitoringEnabled = false;
      runtime.metricsSubscriberIds.delete(event.sender.id);
      await runtime.monitoringManager.shutdown({ ensureProcessStopped: true });
      const ipcError = runtime.toIpcError(error);
      runtime.metricsLogger.error('Failed to enable advanced sensor monitoring.', ipcError);
      return {
        ok: false,
        ...ipcError,
        enabled: false,
        settings: runtime.settingsService.getSettings()
      };
    }
  });

  runtime.ipcMain.handle('monitoring:start', async (event) => {
    if (!runtime.monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        snapshot: null
      };
    }

    runtime.metricsSubscriberIds.add(event.sender.id);
    try {
      await runtime.syncMonitoringSubscriptionState();
      const latestMetrics = runtime.monitoringManager.getLatest();
      if (latestMetrics?.overview) {
        event.sender.send('monitoring:update', latestMetrics.overview);
      }
      return {
        ok: true,
        snapshot: latestMetrics?.overview || null
      };
    } catch (error) {
      runtime.metricsSubscriberIds.delete(event.sender.id);
      const ipcError = runtime.toIpcError(error);
      runtime.metricsLogger.error('Failed to start monitoring updates.', ipcError);
      return {
        ok: false,
        ...ipcError,
        snapshot: null
      };
    }
  });

  runtime.ipcMain.handle('monitoring:stop', async (event) => {
    runtime.metricsSubscriberIds.delete(event.sender.id);
    await runtime.syncMonitoringSubscriptionState();
    return {
      ok: true
    };
  });

  runtime.ipcMain.handle('monitoring:setRefreshRate', async (_event, payload = {}) => {
    if (!runtime.monitoringManager) {
      return {
        ok: false,
        code: 'MONITORING_NOT_READY',
        message: 'Monitoring service is not initialized.',
        refreshRateMs: null
      };
    }

    const refreshRateMs = runtime.monitoringManager.setRefreshRate(payload?.refreshRateMs);
    return {
      ok: true,
      refreshRateMs
    };
  });

}
module.exports = { registerMonitoringHandlers };
