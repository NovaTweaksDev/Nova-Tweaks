import i18n from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AppWindow,
  Archive,
  BookOpen,
  CalendarClock,
  Database,
  Download,
  FileDown,
  FolderOpen,
  Gauge,
  HardDrive,
  Info,
  Languages,
  LayoutDashboard,
  Laptop,
  Monitor,
  Moon,
  ShieldAlert,
  Palette,
  RotateCcw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Thermometer,
  Trash2,
  Upload
} from 'lucide-react';
import ContactSupportCard, { DISCORD_URL, SUPPORT_EMAIL } from './settings/ContactSupportCard';
import DocumentationModal from './settings/DocumentationModal';
import {
  SettingsActionRow,
  SettingsRow,
  SettingsSection,
  SettingsSelectRow,
  SettingsToggleRow
} from './settings/SettingsRows';
import { Button, LoadingIndicator, ModalShell, PageHeader, PageShell, StatusPill } from './ui';

function BritishFlag({ className = '', ...props }) {
  return (
    <svg viewBox="0 0 24 16" className={className} {...props}>
      <rect width="24" height="16" rx="1.5" fill="#21468B" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#FFF" strokeWidth="4" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#AE1C28" strokeWidth="1.7" />
      <path d="M12 0v16M0 8h24" stroke="#FFF" strokeWidth="5" />
      <path d="M12 0v16M0 8h24" stroke="#AE1C28" strokeWidth="2.7" />
    </svg>
  );
}

function GermanFlag({ className = '', ...props }) {
  return (
    <svg viewBox="0 0 24 16" className={className} {...props}>
      <rect width="24" height="16" rx="1.5" fill="#000" />
      <path d="M0 5.33h24v5.34H0z" fill="#DD0000" />
      <path d="M0 10.67h24V16H0z" fill="#FFCE00" />
    </svg>
  );
}

function FrenchFlag({ className = '', ...props }) {
  return (
    <svg viewBox="0 0 24 16" className={className} {...props}>
      <rect width="24" height="16" rx="1.5" fill="#FFF" />
      <path d="M0 0h8v16H0z" fill="#0055A4" />
      <path d="M16 0h8v16h-8z" fill="#EF4135" />
      <rect x=".4" y=".4" width="23.2" height="15.2" rx="1.2" fill="none" stroke="rgba(0,0,0,.22)" strokeWidth=".8" />
    </svg>
  );
}

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English', icon: BritishFlag, iconClassName: 'h-4 w-6' },
  { value: 'de', label: 'Deutsch', icon: GermanFlag, iconClassName: 'h-4 w-6' },
  { value: 'fr', label: 'Français', icon: FrenchFlag, iconClassName: 'h-4 w-6' }
];

const ACCENT_OPTIONS = [
  { value: '#EC4899', label: 'Nova Pink' },
  { value: '#3B82F6', label: 'Azure' },
  { value: '#6366F1', label: 'Violet' },
  { value: '#FFB24B', label: 'Amber' },
  { value: '#F43F5E', label: 'Rose' }
];

const DEFAULT_BACKUP_SCHEDULE = {
  automaticBackupsEnabled: false,
  frequencyDays: 7,
  cleanOlderThanDays: 30,
  maxStorageBytes: 0
};

function getNested(settings, section, key, fallback) {
  const value = settings?.[section]?.[key];
  return value === undefined || value === null ? fallback : value;
}

function buildPatch(section, key, value) {
  return {
    [section]: {
      [key]: value
    }
  };
}

function formatBytes(bytes) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 B';
  if (numeric < 1024) return `${numeric} B`;
  if (numeric < 1024 * 1024) return `${Math.round(numeric / 1024)} KB`;
  return `${(numeric / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeBackupSchedule(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const frequencyDays = Number.parseInt(String(source.frequencyDays ?? DEFAULT_BACKUP_SCHEDULE.frequencyDays), 10);
  const cleanOlderThanDays = Number.parseInt(String(source.cleanOlderThanDays ?? DEFAULT_BACKUP_SCHEDULE.cleanOlderThanDays), 10);
  const maxStorageBytes = Number.parseInt(String(source.maxStorageBytes ?? DEFAULT_BACKUP_SCHEDULE.maxStorageBytes), 10);

  return {
    automaticBackupsEnabled: source.automaticBackupsEnabled === true,
    frequencyDays: Number.isInteger(frequencyDays) && frequencyDays > 0 ? frequencyDays : DEFAULT_BACKUP_SCHEDULE.frequencyDays,
    cleanOlderThanDays: Number.isInteger(cleanOlderThanDays) && cleanOlderThanDays > 0 ? cleanOlderThanDays : DEFAULT_BACKUP_SCHEDULE.cleanOlderThanDays,
    maxStorageBytes: Number.isInteger(maxStorageBytes) && maxStorageBytes > 0 ? maxStorageBytes : 0
  };
}

function SettingsPanel({
  settings,
  metadata,
  loading = false,
  error = '',
  onUpdateSettings,
  onSetAdvancedSensorMonitoring,
  onRefreshSettings,
  onExportSettings,
  onImportSettings,
  onResetSettings,
  onChooseBackupLocation,
  onExportDiagnostics,
  onExportTweakActionLogs,
  onOpenLogsFolder,
  onClearCache,
  onNotify,
  onOperationStatus
}) {
  const { t } = useTranslation();
  const [documentationOpen, setDocumentationOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [backupSchedule, setBackupSchedule] = useState(DEFAULT_BACKUP_SCHEDULE);

  const backupLocation = getNested(settings, 'backupData', 'backupLocation', '');
  const appVersion = metadata?.appVersion || t('tweakDetails.unknown');
  const themeOptions = [
    { value: 'dark', label: t('theme.dark'), icon: Moon },
    { value: 'light', label: t('theme.light'), icon: Sun },
    { value: 'system', label: t('theme.system'), icon: Laptop }
  ];

  const backupAvailable = useMemo(() => {
    return Boolean(window.desktopApi?.createBackup && backupLocation);
  }, [backupLocation]);

  useEffect(() => {
    let mounted = true;
    if (!window.desktopApi?.getBackupSettings) {
      return () => {
        mounted = false;
      };
    }

    window.desktopApi.getBackupSettings()
      .then((result) => {
        if (mounted && result?.ok && result.settings) {
          setBackupSchedule(normalizeBackupSchedule(result.settings));
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  function getActionLabel(actionId) {
    if (String(actionId).startsWith('backupSchedule.')) return i18n.t('interfaceText.save_backup_schedule_d8fae');
    if (actionId === 'backupLocation') return i18n.t('interfaceText.choose_backup_folder_00012');
    if (actionId === 'exportSettings') return i18n.t('interfaceText.export_settings_d18ef');
    if (actionId === 'importSettings') return i18n.t('interfaceText.import_settings_a0434');
    if (actionId === 'clearCache') return i18n.t('interfaceText.clear_cache_22bc1');
    if (actionId === 'diagnostics') return i18n.t('interfaceText.export_diagnostics_3e5cd');
    if (actionId === 'tweakLogs') return i18n.t('interfaceText.export_tweak_action_log_44a40');
    if (actionId === 'logs') return i18n.t('interfaceText.open_logs_folder_2362a');
    if (actionId === 'thirdPartyLicenses') return i18n.t('interfaceText.open_third_party_licenses_93fc1');
    if (actionId === 'reset') return i18n.t('interfaceText.reset_settings_9ba8d');
    return i18n.t('interfaceText.save_settings_913ab');
  }

  async function runAction(actionId, action, successMessage = '') {
    if (busyAction) return null;
    setBusyAction(actionId);
    const operationId = `settings:${actionId}`;
    onOperationStatus?.({
      id: operationId,
      status: 'running',
      label: getActionLabel(actionId),
      message: t('tweaks.running', { defaultValue: 'Action is still running...' })
    });
    try {
      const result = await action();
      if (result?.ok === false) {
        onOperationStatus?.({
          id: operationId,
          status: 'error',
          message: result.message || t('settingsPanel.messages.actionFailed')
        });
      } else if (!result?.canceled && successMessage) {
        onOperationStatus?.({
          id: operationId,
          status: 'success',
          message: successMessage
        });
      } else if (result?.canceled) {
        onOperationStatus?.({
          id: operationId,
          status: 'idle'
        });
      } else {
        onOperationStatus?.({
          id: operationId,
          status: 'success',
          message: t('common.success', { defaultValue: 'Successful' })
        });
      }
      return result;
    } catch (actionError) {
      onOperationStatus?.({
        id: operationId,
        status: 'error',
        message: actionError?.message || t('settingsPanel.messages.actionFailed')
      });
      return { ok: false, message: actionError?.message || t('settingsPanel.messages.actionFailed') };
    } finally {
      setBusyAction('');
    }
  }

  function update(section, key, value) {
    return runAction(
      `${section}.${key}`,
      () => onUpdateSettings?.(buildPatch(section, key, value)),
      t('settingsPanel.messages.settingsSaved')
    );
  }

  function updateAdvancedSensorMonitoring(value) {
    return runAction(
      'monitoring.advancedSensorsEnabled',
      () => onSetAdvancedSensorMonitoring?.(value),
      value
        ? t('settingsPanel.monitoring.enabledMessage')
        : t('settingsPanel.monitoring.disabledMessage')
    );
  }

  function updateBackupSchedule(key, value) {
    const nextSchedule = normalizeBackupSchedule({
      ...backupSchedule,
      [key]: value
    });
    setBackupSchedule(nextSchedule);

    return runAction(
      `backupSchedule.${key}`,
      async () => {
        if (!window.desktopApi?.updateBackupSettings) {
          return { ok: false, message: t('settingsPanel.messages.actionFailed') };
        }
        const result = await window.desktopApi.updateBackupSettings(nextSchedule);
        if (result?.ok && result.settings) {
          setBackupSchedule(normalizeBackupSchedule(result.settings));
        }
        return result;
      },
      t('settingsPanel.messages.settingsSaved')
    );
  }

  async function copyValue(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      onNotify?.(t('settingsPanel.messages.copied', { label: label || t('settingsPanel.messages.value') }), "success");
    } catch (_error) {
      onNotify?.(t('settingsPanel.messages.clipboardUnavailable'), "error");
    }
  }

  return (
    <PageShell className={`settings-shell ${getNested(settings, 'preferences', 'compactMode', false) ? 'settings-compact' : ''}`}>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        status={<StatusPill tone={loading ? 'accent' : error ? 'danger' : 'accent'}>{loading ? <LoadingIndicator label={t('settingsPanel.status.loading')} compact className="border-0 bg-transparent p-0" /> : error ? t('settingsPanel.status.error') : t('settingsPanel.status.persistent')}</StatusPill>}
        actions={(
          <Button type="button" variant="secondary" size="sm" onClick={onRefreshSettings} leftIcon={<RotateCcw className="h-3.5 w-3.5" />}>
            {t('settingsPanel.actions.reload')}
          </Button>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--danger)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_8%,var(--surface)_92%)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <SettingsSection icon={SlidersHorizontal} title={t('settingsPanel.sections.preferencesTitle')} description={t('settingsPanel.sections.preferencesDescription')}>
            <SettingsSelectRow
              icon={Languages}
              title={t('language.label')}
              description={t('settingsPanel.preferences.languageDescription')}
              value={getNested(settings, 'preferences', 'language', 'en')}
              options={LANGUAGE_OPTIONS}
              onChange={(value) => update('preferences', 'language', value)}
              disabled={loading}
              status={busyAction === 'preferences.language' ? 'loading' : ''}
            />
            <SettingsSelectRow
              icon={Monitor}
              title={t('settingsPanel.preferences.themeTitle')}
              description={t('settingsPanel.preferences.themeDescription')}
              value={getNested(settings, 'preferences', 'theme', 'dark')}
              options={themeOptions}
              onChange={(value) => update('preferences', 'theme', value)}
              disabled={loading}
              status={busyAction === 'preferences.theme' ? 'loading' : ''}
            />
            <SettingsRow icon={Palette} title={t('settingsPanel.preferences.accentTitle')} description={t('settingsPanel.preferences.accentDescription')}>
              <div className="flex flex-wrap justify-end gap-2">
                {ACCENT_OPTIONS.map((option) => {
                  const active = getNested(settings, 'preferences', 'accentColor', '#EC4899') === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => update('preferences', 'accentColor', option.value)}
                      disabled={loading}
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={active}
                      className={`h-8 w-8 rounded-lg border transition focus:outline-none focus:shadow-[var(--ui-focus-ring)] ${
                        active ? 'border-white shadow-[0_0_0_2px_var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]'
                      }`}
                      style={{ background: option.value }}
                    />
                  );
                })}
              </div>
            </SettingsRow>
            <SettingsToggleRow
              icon={LayoutDashboard}
              title={t('settingsPanel.preferences.compactTitle')}
              description={t('settingsPanel.preferences.compactDescription')}
              value={getNested(settings, 'preferences', 'compactMode', false)}
              onChange={(value) => update('preferences', 'compactMode', value)}
              disabled={loading}
              status={busyAction === 'preferences.compactMode' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={Activity}
              title={t('settingsPanel.preferences.motionTitle')}
              description={t('settingsPanel.preferences.motionDescription')}
              value={getNested(settings, 'preferences', 'reducedMotion', false)}
              onChange={(value) => update('preferences', 'reducedMotion', value)}
              disabled={loading}
              status={busyAction === 'preferences.reducedMotion' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={SlidersHorizontal}
              title={t('settingsPanel.preferences.mascotAnimationTitle')}
              description={t('settingsPanel.preferences.mascotAnimationDescription')}
              descriptionClassName="whitespace-nowrap"
              value={getNested(settings, 'preferences', 'mascotAnimationEnabled', false)}
              onChange={(value) => update('preferences', 'mascotAnimationEnabled', value)}
              disabled={loading}
              status={busyAction === 'preferences.mascotAnimationEnabled' ? 'loading' : ''}
            />
          </SettingsSection>

          <SettingsSection icon={AppWindow} title={t('settingsPanel.sections.startupTitle')} description={t('settingsPanel.sections.startupDescription')}>
            <SettingsToggleRow
              icon={AppWindow}
              title={t('settingsPanel.startup.startWithWindowsTitle')}
              description={t('settingsPanel.startup.startWithWindowsDescription')}
              value={getNested(settings, 'startupWindow', 'startWithWindows', false)}
              onChange={(value) => update('startupWindow', 'startWithWindows', value)}
              disabled={loading}
              status={busyAction === 'startupWindow.startWithWindows' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={Gauge}
              title={t('settingsPanel.startup.startMinimizedTitle')}
              description={t('settingsPanel.startup.startMinimizedDescription')}
              value={getNested(settings, 'startupWindow', 'startMinimized', false)}
              onChange={(value) => update('startupWindow', 'startMinimized', value)}
              disabled={loading}
              status={busyAction === 'startupWindow.startMinimized' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={AppWindow}
              title={t('settingsPanel.startup.minimizeToTrayTitle')}
              description={t('settingsPanel.startup.minimizeToTrayDescription')}
              value={getNested(settings, 'startupWindow', 'minimizeToTray', false)}
              onChange={(value) => update('startupWindow', 'minimizeToTray', value)}
              disabled={loading}
              status={busyAction === 'startupWindow.minimizeToTray' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={AppWindow}
              title={t('settingsPanel.startup.closeToTrayTitle')}
              description={t('settingsPanel.startup.closeToTrayDescription')}
              value={getNested(settings, 'startupWindow', 'closeToTray', false)}
              onChange={(value) => update('startupWindow', 'closeToTray', value)}
              disabled={loading}
              status={busyAction === 'startupWindow.closeToTray' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={LayoutDashboard}
              title={t('settingsPanel.startup.rememberLastTabTitle')}
              description={t('settingsPanel.startup.rememberLastTabDescription')}
              value={getNested(settings, 'startupWindow', 'rememberLastTab', false)}
              onChange={(value) => update('startupWindow', 'rememberLastTab', value)}
              disabled={loading}
              status={busyAction === 'startupWindow.rememberLastTab' ? 'loading' : ''}
            />
          </SettingsSection>

          <SettingsSection
            icon={Thermometer}
            title={t('settingsPanel.sections.monitoringTitle')}
            description={t('settingsPanel.sections.monitoringDescription')}
          >
            <SettingsToggleRow
              icon={Thermometer}
              title={t('settingsPanel.monitoring.advancedSensorsTitle')}
              description={t('settingsPanel.monitoring.advancedSensorsDescription')}
              value={getNested(settings, 'monitoring', 'advancedSensorsEnabled', false)}
              onChange={updateAdvancedSensorMonitoring}
              disabled={loading || typeof onSetAdvancedSensorMonitoring !== 'function'}
              reason={typeof onSetAdvancedSensorMonitoring !== 'function' ? t('advancedSensors.unavailable') : ''}
              status={busyAction === 'monitoring.advancedSensorsEnabled' ? 'loading' : ''}
            />
            <SettingsRow
              icon={ShieldAlert}
              title={t('settingsPanel.monitoring.uacTitle')}
              description={t('settingsPanel.monitoring.uacDescription')}
            >
              <StatusPill tone="warning">{t('settingsPanel.monitoring.localOnly')}</StatusPill>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection icon={ShieldAlert} title={t('settingsPanel.sections.safetyTitle')} description={t('settingsPanel.sections.safetyDescription')}>
            <SettingsToggleRow icon={ShieldAlert} title={t('settingsPanel.safety.confirmCriticalTitle')} description={t('settingsPanel.safety.confirmCriticalDescription')} value={getNested(settings, 'safety', 'confirmCriticalTweaks', true)} onChange={(value) => update('safety', 'confirmCriticalTweaks', value)} disabled={loading} status={busyAction === 'safety.confirmCriticalTweaks' ? 'loading' : ''} />
            <SettingsToggleRow icon={RotateCcw} title={t('settingsPanel.safety.restartWarningTitle')} description={t('settingsPanel.safety.restartWarningDescription')} value={getNested(settings, 'safety', 'warnBeforeRestartRequiredTweaks', true)} onChange={(value) => update('safety', 'warnBeforeRestartRequiredTweaks', value)} disabled={loading} status={busyAction === 'safety.warnBeforeRestartRequiredTweaks' ? 'loading' : ''} />
            <SettingsToggleRow icon={Info} title={t('settingsPanel.safety.riskLabelsTitle')} description={t('settingsPanel.safety.riskLabelsDescription')} value={getNested(settings, 'safety', 'showRiskLabels', true)} onChange={(value) => update('safety', 'showRiskLabels', value)} disabled={loading} status={busyAction === 'safety.showRiskLabels' ? 'loading' : ''} />
            <SettingsToggleRow icon={Info} title={t('settingsPanel.safety.compatibilityTitle')} description={t('settingsPanel.safety.compatibilityDescription')} value={getNested(settings, 'safety', 'showCompatibilityWarnings', true)} onChange={(value) => update('safety', 'showCompatibilityWarnings', value)} disabled={loading} status={busyAction === 'safety.showCompatibilityWarnings' ? 'loading' : ''} />
          </SettingsSection>

          <SettingsSection icon={Database} title={t('settingsPanel.sections.backupTitle')} description={t('settingsPanel.sections.backupDescription')}>
            <SettingsToggleRow
              icon={Archive}
              title={t('settingsPanel.backup.beforeApplyTitle')}
              description={t('settingsPanel.backup.beforeApplyDescription')}
              value={getNested(settings, 'backupData', 'backupBeforeApplyingTweaks', false)}
              onChange={(value) => update('backupData', 'backupBeforeApplyingTweaks', value)}
              disabled={loading || !backupAvailable}
              reason={!backupAvailable ? t('settingsPanel.backup.unavailable') : ''}
              status={busyAction === 'backupData.backupBeforeApplyingTweaks' ? 'loading' : ''}
            />
            <SettingsToggleRow
              icon={CalendarClock}
              title={t('settingsPanel.backup.automaticTitle', { defaultValue: 'Automatic backups' })}
              description={t('settingsPanel.backup.automaticDescription', { defaultValue: 'Keep Nova backup scheduling enabled for recurring local configuration snapshots.' })}
              value={backupSchedule.automaticBackupsEnabled}
              onChange={(value) => updateBackupSchedule('automaticBackupsEnabled', value)}
              disabled={loading || !window.desktopApi?.updateBackupSettings}
              reason={!window.desktopApi?.updateBackupSettings ? t('settingsPanel.backup.unavailable') : ''}
              status={busyAction === 'backupSchedule.automaticBackupsEnabled' ? 'loading' : ''}
            />
            <SettingsActionRow icon={FolderOpen} title={t('settingsPanel.backup.locationTitle')} description={backupLocation || t('settingsPanel.backup.locationFallback')} label={t('settingsPanel.actions.chooseFolder')} onClick={() => runAction('backupLocation', onChooseBackupLocation, t('settingsPanel.messages.backupLocationUpdated'))} loading={busyAction === 'backupLocation'} disabled={loading} leftIcon={<FolderOpen className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={Download} title={t('settingsPanel.backup.exportTitle')} description={t('settingsPanel.backup.exportDescription')} label={t('settingsPanel.actions.export')} onClick={() => runAction('exportSettings', onExportSettings, t('settingsPanel.messages.settingsExported'))} loading={busyAction === 'exportSettings'} disabled={loading} leftIcon={<Download className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={Upload} title={t('settingsPanel.backup.importTitle')} description={t('settingsPanel.backup.importDescription')} label={t('settingsPanel.actions.import')} onClick={() => runAction('importSettings', onImportSettings, t('settingsPanel.messages.settingsImported'))} loading={busyAction === 'importSettings'} disabled={loading} leftIcon={<Upload className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={RotateCcw} title={t('settingsPanel.backup.resetTitle')} description={t('settingsPanel.backup.resetDescription')} label={t('settingsPanel.actions.reset')} variant="danger" onClick={() => setResetOpen(true)} disabled={loading} leftIcon={<RotateCcw className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={Trash2} title={t('settingsPanel.backup.cacheTitle')} description={t('settingsPanel.backup.cacheDescription')} label={t('settingsPanel.actions.clearCache')} onClick={() => runAction('clearCache', async () => {
              const result = await onClearCache?.();
              if (result?.ok) onNotify?.(t('settingsPanel.messages.cacheCleared', { size: formatBytes(result.removedBytes) }), "success");
              return result;
            })} loading={busyAction === 'clearCache'} disabled={loading} leftIcon={<Trash2 className="h-3.5 w-3.5" />} />
          </SettingsSection>
        </div>

        <aside className="space-y-5">
          <SettingsSection icon={ShieldCheck} title={t('settingsPanel.sections.privacyTitle')} description={t('settingsPanel.sections.privacyDescription')}>
            <SettingsRow
              icon={Database}
              title={t('settingsPanel.privacy.localOnlyTitle', { defaultValue: 'Local operation' })}
              description={t('settingsPanel.privacy.localOnlyDescription', { defaultValue: 'No account is required. Settings, backups and activity logs stay on this device.' })}
            >
              <StatusPill tone="accent">
                {t('settingsPanel.privacy.localOnlyStatus', { defaultValue: 'Local only' })}
              </StatusPill>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection icon={HardDrive} title={t('settingsPanel.sections.diagnosticsTitle')} description={t('settingsPanel.sections.diagnosticsDescription')}>
            <SettingsActionRow icon={BookOpen} title={t('settingsPanel.diagnostics.documentationTitle')} description={t('settingsPanel.diagnostics.documentationDescription')} label={t('settingsPanel.actions.openGuide')} onClick={() => setDocumentationOpen(true)} leftIcon={<BookOpen className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={FileDown} title={t('settingsPanel.diagnostics.exportTitle')} description={t('settingsPanel.diagnostics.exportDescription')} label={t('settingsPanel.actions.export')} onClick={() => runAction('diagnostics', onExportDiagnostics, t('settingsPanel.messages.diagnosticExported'))} loading={busyAction === 'diagnostics'} leftIcon={<FileDown className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={FileDown} title={t('settingsPanel.diagnostics.tweakLogTitle', { defaultValue: 'Tweak action log' })} description={t('settingsPanel.diagnostics.tweakLogDescription', { defaultValue: 'Exports applied, failed, blocked and cancelled tweak actions as CSV.' })} label={t('settingsPanel.actions.exportCsv', { defaultValue: 'Export CSV' })} onClick={() => runAction('tweakLogs', onExportTweakActionLogs, t('settingsPanel.messages.tweakLogsExported', { defaultValue: 'Tweak action log exported.' }))} loading={busyAction === 'tweakLogs'} leftIcon={<FileDown className="h-3.5 w-3.5" />} />
            <SettingsActionRow icon={FolderOpen} title={t('settingsPanel.diagnostics.logsTitle')} description={metadata?.logsPath || t('settingsPanel.diagnostics.logsFallback')} label={t('settingsPanel.actions.open')} onClick={() => runAction('logs', onOpenLogsFolder)} loading={busyAction === 'logs'} leftIcon={<FolderOpen className="h-3.5 w-3.5" />} />
            <SettingsRow icon={Info} title={t('settingsPanel.diagnostics.versionTitle')} description={t('settingsPanel.diagnostics.versionDescription')}>
              <div className="text-right">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{appVersion}</p>
                <p className="text-xs text-[var(--text-muted)]">{t('settingsPanel.privacy.localOnlyStatus', { defaultValue: 'Local only' })}</p>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            icon={Scale}
            title={t('settingsPanel.sections.legalTitle')}
            description={t('settingsPanel.sections.legalDescription')}
          >
            <SettingsRow
              icon={Thermometer}
              title={t('settingsPanel.legal.libreHardwareMonitorTitle')}
              description={t('settingsPanel.legal.libreHardwareMonitorDescription')}
            >
              <StatusPill tone="accent">MPL 2.0</StatusPill>
            </SettingsRow>
            <SettingsRow
              icon={Gauge}
              title={t('settingsPanel.legal.presentMonTitle')}
              description={t('settingsPanel.legal.presentMonDescription')}
            >
              <StatusPill tone="accent">MIT</StatusPill>
            </SettingsRow>

            <SettingsActionRow
              icon={BookOpen}
              title={t('settingsPanel.legal.licensesTitle')}
              description={t('settingsPanel.legal.licensesDescription')}
              label={t('settingsPanel.actions.openLicenses')}
              onClick={() => runAction('thirdPartyLicenses', () => window.desktopApi?.openThirdPartyLicenses
                ? window.desktopApi.openThirdPartyLicenses()
                : { ok: false, message: t('settingsPanel.messages.licensesUnavailable') })}
              loading={busyAction === 'thirdPartyLicenses'}
              leftIcon={<BookOpen className="h-3.5 w-3.5" />}
            />
          </SettingsSection>

          <ContactSupportCard
            onOpenDiscord={() => runAction('discord', () => window.desktopApi?.openExternalUrl
              ? window.desktopApi.openExternalUrl({ url: DISCORD_URL })
              : { ok: false, message: t('settingsPanel.messages.externalUnavailable') })}
            onOpenEmail={() => runAction('email', () => window.desktopApi?.openMailUrl
              ? window.desktopApi.openMailUrl({ url: `mailto:${SUPPORT_EMAIL}` })
              : { ok: false, message: t('settingsPanel.messages.emailUnavailable') })}
            onCopy={copyValue}
          />
        </aside>
      </div>

      <DocumentationModal open={documentationOpen} onClose={() => setDocumentationOpen(false)} />

      <ModalShell
        open={resetOpen}
        title={t('settingsPanel.reset.title')}
        description={t('settingsPanel.reset.description')}
        onClose={() => {
          if (!busyAction) setResetOpen(false);
        }}
        closeDisabled={Boolean(busyAction)}
        closeOnBackdrop={!busyAction}
        closeOnEscape={!busyAction}
        footer={(
          <>
            <Button variant="secondary" size="sm" disabled={Boolean(busyAction)} onClick={() => setResetOpen(false)}>
              {t('settingsPanel.actions.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busyAction === 'reset'}
              onClick={async () => {
                const result = await runAction('reset', onResetSettings, t('settingsPanel.messages.resetSuccess'));
                if (result?.ok) setResetOpen(false);
              }}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              {t('settingsPanel.actions.resetSettings')}
            </Button>
          </>
        )}
      >
        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_22%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_8%,var(--surface)_92%)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
          {t('settingsPanel.reset.body')}
        </div>
      </ModalShell>
    </PageShell>
  );
}

export default SettingsPanel;
