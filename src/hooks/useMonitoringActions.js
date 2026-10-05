export function useMonitoringActions({ t, applyLoadedSettings, setSettingsError }) {
  async function setAdvancedSensorMonitoring(enabled) {
    if (!window.desktopApi?.setAdvancedSensorMonitoringEnabled) {
      return { ok: false, message: t('advancedSensors.unavailable') };
    }

    const result = await window.desktopApi.setAdvancedSensorMonitoringEnabled({
      enabled: Boolean(enabled)
    });
    if (result?.settings) {
      applyLoadedSettings(result.settings);
    }
    if (result?.ok) {
      setSettingsError('');
    }
    if (result?.code === 'LHM_PROCESS_STILL_RUNNING') {
      return {
        ...result,
        message: t('settingsPanel.monitoring.stopFailedMessage')
      };
    }
    return result;
  }

  return { setAdvancedSensorMonitoring };
}
