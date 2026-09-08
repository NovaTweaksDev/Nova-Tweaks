import { joinClasses } from './classNames';

const RANGE_THUMB_RADIUS_REM = 0.5;
const RANGE_HORIZONTAL_PADDING_REM = 0.125;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
}

function MetricSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  recommended,
  recommendedLabel = '',
  ariaLabel = '',
  onChange,
  className = ''
}) {
  const normalized = clamp(value, min, max);
  const recommendedValue = recommended === undefined ? null : clamp(recommended, min, max);
  const recommendedRatio = recommendedValue === null || max === min ? 0 : (recommendedValue - min) / (max - min);
  const markerTrackInset = RANGE_THUMB_RADIUS_REM + RANGE_HORIZONTAL_PADDING_REM;
  const markerOffset = markerTrackInset * (1 - (2 * recommendedRatio));
  const recommendedPosition = `calc(${recommendedRatio * 100}% + ${markerOffset}rem)`;

  return (
    <div className={joinClasses('grid gap-2', className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-3">
        <div className="relative flex h-10 items-center px-0.5">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={normalized}
            aria-label={ariaLabel}
            onChange={(event) => onChange?.(Number(event.target.value))}
            className="automation-range w-full"
          />
          {recommendedValue !== null ? (
            <span
              className="pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_16%,transparent)]"
              style={{ left: recommendedPosition }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        <label className="flex h-10 items-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 focus-within:border-[var(--accent)]">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={normalized}
            aria-label={ariaLabel}
            onChange={(event) => onChange?.(clamp(event.target.value, min, max))}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--text-primary)] outline-none"
          />
          {unit ? <span className="ml-1 text-xs text-[var(--text-muted)]">{unit}</span> : null}
        </label>
      </div>
      {recommendedValue !== null ? (
        <button
          type="button"
          onClick={() => onChange?.(recommendedValue)}
          className="w-fit text-[0.68rem] font-medium text-[var(--success)] transition hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:underline"
        >
          {recommendedLabel}: {recommendedValue}{unit}
        </button>
      ) : null}
    </div>
  );
}

export default MetricSlider;
