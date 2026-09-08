import { ExternalLink, Gpu, Cpu } from 'lucide-react';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import cpuImage from '../assets/hardware/cpu.png';
import gpuImage from '../assets/hardware/gpu.png';
import { matchHardwareCatalogEntry } from '../utils/hardwareCatalog';
import ModalShell from './ui/ModalShell';

const CPU_FIELDS = [
  ['architecture', 'architecture'],
  ['generation', 'generation'],
  ['socket', 'socket'],
  ['cores', 'cores'],
  ['threads', 'threads'],
  ['performanceCores', 'performanceCores'],
  ['efficiencyCores', 'efficiencyCores'],
  ['baseClockGhz', 'baseClock', 'GHz'],
  ['boostClockGhz', 'boostClock', 'GHz'],
  ['l3CacheMb', 'l3Cache', 'MB'],
  ['threeDVCache', 'threeDVCache', 'boolean'],
  ['threeDVCacheMb', 'threeDVCacheSize', 'MB'],
  ['processNode', 'processNode'],
  ['memorySupport', 'memorySupport'],
  ['maxOfficialMemorySpeed', 'memorySpeed'],
  ['pcieVersion', 'pcieVersion'],
  ['basePowerW', 'basePower', 'W'],
  ['maximumPowerW', 'maximumPower', 'W'],
  ['integratedGraphics', 'integratedGraphics'],
  ['unlockedMultiplier', 'unlockedMultiplier', 'boolean'],
  ['releaseYear', 'releaseYear'],
  ['gamingClass', 'gamingClass'],
  ['recommendedGpuClass', 'recommendedGpuClass'],
  ['recommendedResolution', 'recommendedResolution'],
  ['relativeGamingPerformance1080p', 'relativePerformance1080p'],
  ['performanceReference', 'performanceReference'],
  ['performanceBasis', 'performanceBasis']
];

const GPU_FIELDS = [
  ['architecture', 'architecture'],
  ['vramGb', 'vram', 'GB'],
  ['memoryType', 'memoryType'],
  ['memoryBusBits', 'memoryBus', 'bit'],
  ['typicalBoardPowerW', 'boardPower', 'W'],
  ['recommendedPsuW', 'recommendedPsu', 'W'],
  ['rayTracing', 'rayTracing'],
  ['upscalingSupport', 'upscalingSupport'],
  ['releaseYear', 'releaseYear'],
  ['gamingClass', 'gamingClass'],
  ['recommendedResolution', 'recommendedResolution'],
  ['relativeGamingPerformance1440p', 'relativePerformance1440p'],
  ['performanceReference', 'performanceReference'],
  ['performanceBasis', 'performanceBasis']
];

function hasDisplayValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatValue(value, format, t, locale) {
  if (format === 'boolean') {
    return value ? t('dashboard.systemDetection.details.yes') : t('dashboard.systemDetection.details.no');
  }

  if (typeof value === 'number') {
    const formatted = new Intl.NumberFormat(locale, {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value);
    return format ? `${formatted} ${format}` : formatted;
  }

  return String(value);
}

function HardwareSourceButton({ href, label, onOpenExternal }) {
  if (!href) {
    return null;
  }

  return (
    <button
      type="button"
      className="ui-btn ui-btn-secondary ui-btn-sm"
      onClick={() => onOpenExternal?.(href)}
    >
      <ExternalLink className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function buildSummaryItems(entry, isGpu, t, locale) {
  if (!entry) {
    return [];
  }

  if (isGpu) {
    return [
      {
        label: t('dashboard.systemDetection.details.fields.architecture'),
        value: entry.architecture
      },
      {
        label: t('dashboard.systemDetection.details.fields.vram'),
        value: [
          hasDisplayValue(entry.vramGb) ? formatValue(entry.vramGb, 'GB', t, locale) : '',
          entry.memoryType
        ].filter(Boolean).join(' \u00b7 ')
      },
      {
        label: t('dashboard.systemDetection.details.fields.gamingClass'),
        value: entry.gamingClass
      },
      {
        label: t('dashboard.systemDetection.details.fields.boardPower'),
        value: hasDisplayValue(entry.typicalBoardPowerW)
          ? formatValue(entry.typicalBoardPowerW, 'W', t, locale)
          : ''
      }
    ].filter((item) => hasDisplayValue(item.value));
  }

  return [
    {
      label: `${t('dashboard.systemDetection.details.fields.cores')} / ${t('dashboard.systemDetection.details.fields.threads')}`,
      value: hasDisplayValue(entry.cores) && hasDisplayValue(entry.threads)
        ? `${formatValue(entry.cores, '', t, locale)} / ${formatValue(entry.threads, '', t, locale)}`
        : ''
    },
    {
      label: t('dashboard.systemDetection.details.fields.architecture'),
      value: entry.architecture
    },
    {
      label: t('dashboard.systemDetection.details.fields.boostClock'),
      value: hasDisplayValue(entry.boostClockGhz)
        ? formatValue(entry.boostClockGhz, 'GHz', t, locale)
        : ''
    },
    {
      label: t('dashboard.systemDetection.details.fields.gamingClass'),
      value: entry.gamingClass
    }
  ].filter((item) => hasDisplayValue(item.value));
}

function HardwareDetailCard({ type, detectedName, entry, onOpenExternal }) {
  const { t, i18n } = useTranslation();
  const isGpu = type === 'gpu';
  const Icon = isGpu ? Gpu : Cpu;
  const fields = isGpu ? GPU_FIELDS : CPU_FIELDS;
  const image = isGpu ? gpuImage : cpuImage;
  const title = entry?.canonicalName || detectedName;
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const summaryItems = buildSummaryItems(entry, isGpu, t, locale);
  const summaryFieldKeys = isGpu
    ? new Set(['architecture', 'vramGb', 'memoryType', 'typicalBoardPowerW', 'gamingClass'])
    : new Set(['architecture', 'cores', 'threads', 'boostClockGhz', 'gamingClass']);
  const detailFields = fields.filter(([key]) => !summaryFieldKeys.has(key));

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
      <div className="grid min-w-0 border-b border-[var(--border-subtle)] md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="relative aspect-video overflow-hidden bg-[var(--surface)] md:aspect-auto md:min-h-full md:border-r md:border-[var(--border-subtle)]">
          <div className="absolute inset-3 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--border-subtle))] bg-black shadow-[0_12px_28px_rgba(0,0,0,0.28)]">
            <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/55" />
            <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/[0.04]" />
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-2.5 py-1.5 text-white shadow-lg backdrop-blur-sm">
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                {t(`dashboard.systemDetection.labels.${type}`)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center p-4 md:p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            {t('dashboard.systemDetection.details.detectedAs', { name: detectedName })}
          </p>
          <h4 className="mt-1 break-words text-xl font-semibold text-[var(--text-primary)]">{title}</h4>
          {summaryItems.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {summaryItems.map((item) => (
                <div key={item.label} className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{item.label}</p>
                  <p className="mt-0.5 truncate text-[12px] font-semibold text-[var(--text-primary)]" title={String(item.value)}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 p-4 md:p-5">
        {entry ? (
          <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {detailFields.map(([key, labelKey, format]) => {
                  const value = entry[key];
                  if (!hasDisplayValue(value)) {
                    return null;
                  }

                  return (
                    <div key={key} className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {t(`dashboard.systemDetection.details.fields.${labelKey}`)}
                      </p>
                      <p className="mt-1 break-words text-[13px] font-medium leading-5 text-[var(--text-primary)]">
                        {formatValue(value, format, t, locale)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {entry.overclockingNotes || entry.notes ? (
                <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {t('dashboard.systemDetection.details.notes')}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
                    {[entry.overclockingNotes, entry.notes].filter(Boolean).join(' \u00b7 ')}
                  </p>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <HardwareSourceButton
                  href={entry.specSource}
                  label={t('dashboard.systemDetection.details.specSource')}
                  onOpenExternal={onOpenExternal}
                />
                <HardwareSourceButton
                  href={entry.performanceSource}
                  label={t('dashboard.systemDetection.details.performanceSource')}
                  onOpenExternal={onOpenExternal}
                />
              </div>
          </>
        ) : (
          <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--warning)_38%,var(--border))] bg-[color:color-mix(in_srgb,var(--warning)_8%,var(--surface))] p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t('dashboard.systemDetection.details.noMatchTitle')}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              {t('dashboard.systemDetection.details.noMatchDescription')}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function HardwareDetailsModal({ open, onClose, systemDetection, catalogs, isCatalogLoading, onOpenExternal }) {
  const { t } = useTranslation();
  const gpuNames = useMemo(() => {
    const names = Array.isArray(systemDetection?.gpu?.all) && systemDetection.gpu.all.length
      ? systemDetection.gpu.all
      : [systemDetection?.gpu?.primary, ...(systemDetection?.gpu?.secondary || [])];
    return Array.from(new Set(names.filter(Boolean)));
  }, [systemDetection]);
  const cpuName = systemDetection?.cpu?.name || '';
  const cpuEntry = useMemo(
    () => matchHardwareCatalogEntry(cpuName, catalogs?.cpu, 'cpu'),
    [cpuName, catalogs]
  );
  const gpuDetails = useMemo(
    () => gpuNames.map((name) => ({
      name,
      entry: matchHardwareCatalogEntry(name, catalogs?.gpu, 'gpu')
    })),
    [gpuNames, catalogs]
  );
  const hasDetectedHardware = Boolean(cpuName || gpuNames.length);

  return createPortal(
    <ModalShell
      open={open}
      onClose={onClose}
      size="xl"
      title={t('dashboard.systemDetection.details.title')}
      description={t('dashboard.systemDetection.details.description')}
      closeLabel={t('common.close', { defaultValue: 'Close' })}
      contentClassName="space-y-4"
    >
      {isCatalogLoading ? (
        <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t('dashboard.systemDetection.details.refreshingCatalog')}
        </p>
      ) : null}

      {cpuName ? (
        <HardwareDetailCard
          type="cpu"
          detectedName={cpuName}
          entry={cpuEntry}
          onOpenExternal={onOpenExternal}
        />
      ) : null}

      {gpuDetails.map(({ name, entry }) => (
        <HardwareDetailCard
          key={name}
          type="gpu"
          detectedName={name}
          entry={entry}
          onOpenExternal={onOpenExternal}
        />
      ))}

      {!hasDetectedHardware ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5 text-sm text-[var(--text-secondary)]">
          {t('dashboard.systemDetection.details.noHardware')}
        </div>
      ) : null}
    </ModalShell>,
    document.body
  );
}

export default HardwareDetailsModal;
