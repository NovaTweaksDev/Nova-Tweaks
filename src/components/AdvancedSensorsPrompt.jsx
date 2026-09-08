import { useEffect, useState } from 'react';
import { Settings2, ShieldAlert, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, PageSection } from './ui';

const ICON_PROPS = {
  size: 18,
  strokeWidth: 1.8
};

function AdvancedSensorsPrompt({ className = '', onOpenSettings }) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function loadState() {
      if (!window.desktopApi?.getAdvancedSensorMonitoringState) {
        setChecking(false);
        return;
      }

      try {
        const result = await window.desktopApi.getAdvancedSensorMonitoringState();
        if (!disposed) {
          setEnabled(Boolean(result?.ok && result.enabled));
        }
      } catch (_error) {
        // The prompt remains available so activation can surface a concrete error.
      } finally {
        if (!disposed) {
          setChecking(false);
        }
      }
    }

    void loadState();
    return () => {
      disposed = true;
    };
  }, []);

  if (checking || enabled) {
    return null;
  }

  return (
    <PageSection
      className={`flex flex-col gap-4 border-[color:color-mix(in_srgb,var(--warning)_36%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_7%,var(--surface)_93%)] p-4 sm:flex-row sm:items-center sm:justify-between ${className}`}
      surface="strong"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--warning)_32%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_12%,var(--surface-elevated)_88%)] text-[var(--warning)]">
          <Thermometer {...ICON_PROPS} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('advancedSensors.title')}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            {t('advancedSensors.description')}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-4 text-[var(--text-muted)]">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <span>{t('advancedSensors.uacExplanation')}</span>
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onOpenSettings}
        disabled={typeof onOpenSettings !== 'function'}
        className="shrink-0"
        leftIcon={<Settings2 className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        {t('advancedSensors.openSettings')}
      </Button>
    </PageSection>
  );
}

export default AdvancedSensorsPrompt;
