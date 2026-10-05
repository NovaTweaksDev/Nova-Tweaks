export function useAppSettingsActions({ createDefaultAppSettings, setAppSettings, normalizeProfileSettings, i18n, resolveThemeMode, setTheme, setSettingsError, t, appSettings, startGlobalOperation, setSettingsLoading, finishGlobalOperation }) {
  function applyLoadedSettings(settings) {
    const nextSettings = settings && typeof settings === 'object' ? settings : createDefaultAppSettings();
    setAppSettings({
      ...createDefaultAppSettings(),
      ...nextSettings,
      userProfile: normalizeProfileSettings(nextSettings.userProfile)
    });

    const language = String(nextSettings?.preferences?.language || '').trim();
    if (language && i18n.language?.split('-')?.[0] !== language) {
      void i18n.changeLanguage(language);
    }

    const resolvedTheme = resolveThemeMode(nextSettings?.preferences?.theme || 'dark');
    setTheme(resolvedTheme);
  }

  async function loadAppSettings(options = {}) {
    const notify = Boolean(options.notify);
    if (!window.desktopApi?.getSettings) {
      setSettingsError(t('settingsPanel.messages.settingsUnavailable'));
      return { ok: false, settings: appSettings };
    }

    const operationId = notify
      ? startGlobalOperation('settings:reload', i18n.t('interfaceText.reload_settings_035e3'), t('tweaks.running', { defaultValue: 'Action is still running...' }))
      : '';
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const result = await window.desktopApi.getSettings();
      if (result?.ok && result.settings) {
        applyLoadedSettings(result.settings);
        if (result.warning?.message) {
          setSettingsError(result.warning.message);
        }
        if (notify) {
          finishGlobalOperation(operationId, "success", t('settingsPanel.messages.settingsReloaded'));
        }
        return { ok: true, settings: result.settings };
      }

      const message = result?.message || t('settingsPanel.messages.settingsLoadFailed');
      setSettingsError(message);
      if (notify) finishGlobalOperation(operationId, "error", message);
      return { ok: false, settings: appSettings };
    } catch (error) {
      const message = error?.message || t('settingsPanel.messages.settingsLoadFailed');
      setSettingsError(message);
      if (notify) finishGlobalOperation(operationId, "error", message);
      return { ok: false, settings: appSettings };
    } finally {
      setSettingsLoading(false);
    }
  }

  async function updateAppSettings(patch) {
    if (!window.desktopApi?.updateSettings) {
      return { ok: false, message: t('settingsPanel.messages.settingsUnavailable') };
    }

    const result = await window.desktopApi.updateSettings(patch);
    if (result?.ok && result.settings) {
      applyLoadedSettings(result.settings);
      setSettingsError('');
    }
    return result;
  }

  async function resetAppSettings() {
    if (!window.desktopApi?.resetSettings) {
      return { ok: false, message: t('settingsPanel.messages.settingsUnavailable') };
    }
    const result = await window.desktopApi.resetSettings();
    if (result?.ok && result.settings) {
      applyLoadedSettings(result.settings);
      setSettingsError('');
    }
    return result;
  }

  async function chooseBackupLocation() {
    if (!window.desktopApi?.chooseBackupLocation) {
      return { ok: false, message: t('settingsPanel.messages.backupPickerUnavailable') };
    }
    const result = await window.desktopApi.chooseBackupLocation();
    if (result?.ok && result.settings) {
      applyLoadedSettings(result.settings);
    }
    return result;
  }

  return { applyLoadedSettings, loadAppSettings, updateAppSettings, resetAppSettings, chooseBackupLocation };
}
