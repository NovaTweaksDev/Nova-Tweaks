function normalizeRiskLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return '';
}

function normalizeContainerType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'powerplan' || normalized === 'power_plans') {
    return 'power_plan';
  }

  if (normalized === 'timerresolution' || normalized === 'timer_resolutions') {
    return 'timer_resolution';
  }

  if (normalized === 'oneshotselection' || normalized === 'one_shot' || normalized === 'one_shot_selections') {
    return 'one_shot_selection';
  }

  if (normalized === 'oneshotaction' || normalized === 'one_shot_action' || normalized === 'one_shot_actions') {
    return 'one_shot_action';
  }

  if (normalized === 'fix' || normalized === 'fixes') {
    return 'fix';
  }

  if (normalized === 'normal' || normalized === 'normaltweak' || normalized === 'normal_tweaks') {
    return 'normal_tweak';
  }

  return normalized || 'normal_tweak';
}

function normalizeBulletpoints(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text ? { icon: '', text } : null;
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const text = typeof entry.text === 'string'
        ? entry.text.trim()
        : typeof entry.label === 'string'
          ? entry.label.trim()
          : typeof entry.title === 'string'
            ? entry.title.trim()
            : '';
      if (!text) {
        return null;
      }

      const icon = typeof entry.icon === 'string' ? entry.icon.trim().toLowerCase() : '';
      return {
        icon,
        text
      };
    })
    .filter(Boolean);
}

function normalizeCompactDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatusLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const active = typeof value.active === 'string' ? value.active.trim() : '';
  const inactive = typeof value.inactive === 'string' ? value.inactive.trim() : '';
  if (!active && !inactive) {
    return null;
  }

  return {
    ...(active ? { active } : {}),
    ...(inactive ? { inactive } : {})
  };
}

function normalizeCtaLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const defaultLabel = typeof value.default === 'string' ? value.default.trim() : '';
  const active = typeof value.active === 'string' ? value.active.trim() : '';
  if (!defaultLabel && !active) {
    return null;
  }

  return {
    ...(defaultLabel ? { default: defaultLabel } : {}),
    ...(active ? { active } : {})
  };
}

function normalizeUiConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const variant = typeof value.variant === 'string' ? value.variant.trim().toLowerCase() : '';
  const size = typeof value.size === 'string' ? value.size.trim().toLowerCase() : '';
  const showProfileBadgeSource = value.showProfileBadge ?? value.show_profile_badge;
  const showTargetSystemSource = value.showTargetSystem ?? value.show_target_system;
  const showTradeoffsSource = value.showTradeoffs ?? value.show_tradeoffs;
  const showBulletpointsSource = value.showBulletpoints ?? value.show_bulletpoints;
  const maxMetricsSource = value.maxMetrics ?? value.max_metrics;
  const maxMetricsNumber = Number(maxMetricsSource);
  const maxMetrics = Number.isFinite(maxMetricsNumber) && maxMetricsNumber > 0
    ? Math.max(1, Math.trunc(maxMetricsNumber))
    : null;

  const normalized = {
    ...(variant ? { variant } : {}),
    ...(size ? { size } : {}),
    ...(typeof showProfileBadgeSource === 'boolean' ? { showProfileBadge: showProfileBadgeSource } : {}),
    ...(typeof showTargetSystemSource === 'boolean' ? { showTargetSystem: showTargetSystemSource } : {}),
    ...(typeof showTradeoffsSource === 'boolean' ? { showTradeoffs: showTradeoffsSource } : {}),
    ...(typeof showBulletpointsSource === 'boolean' ? { showBulletpoints: showBulletpointsSource } : {}),
    ...(maxMetrics ? { maxMetrics } : {})
  };

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeMetricDirection(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'positive' || normalized === 'negative' || normalized === 'neutral') {
    return normalized;
  }
  return '';
}

function normalizeMetrics(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const label = typeof entry.label === 'string'
        ? entry.label.trim()
        : typeof entry.text === 'string'
          ? entry.text.trim()
          : '';
      if (!label) {
        return null;
      }

      const maxSource = Number(entry.max);
      const max = Number.isFinite(maxSource) && maxSource > 0 ? Math.min(5, Math.max(1, Math.trunc(maxSource))) : 5;
      const valueSource = Number(entry.value);
      const rawValue = Number.isFinite(valueSource) ? Math.trunc(valueSource) : 0;
      const boundedValue = Math.max(0, Math.min(max, rawValue));

      return {
        icon: typeof entry.icon === 'string' ? entry.icon.trim().toLowerCase() : '',
        label,
        value: boundedValue,
        max,
        direction: normalizeMetricDirection(entry.direction)
      };
    })
    .filter(Boolean);
}

function normalizeSelections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        const label = String(entry).trim();
        return label ? { label, value: label } : null;
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const label = String(entry.label || entry.name || entry.value || entry.id || '').trim();
      const optionValue = String(entry.value || entry.id || label).trim();
      if (!label || !optionValue) {
        return null;
      }

      return {
        ...entry,
        label,
        value: optionValue
      };
    })
    .filter(Boolean);
}

function normalizeRangeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const minimum = Number(value.min ?? value.minimum);
  const maximum = Number(value.max ?? value.maximum);
  const step = Number(value.step);
  const recommendedValue = Number(value.recommendedValue ?? value.recommended_value);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return null;
  }

  return {
    parameter: typeof value.parameter === 'string' && value.parameter.trim() ? value.parameter.trim() : 'Value',
    min: minimum,
    max: maximum,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    unit: typeof value.unit === 'string' ? value.unit.trim() : '',
    recommendedValue: Number.isFinite(recommendedValue)
      ? Math.min(maximum, Math.max(minimum, recommendedValue))
      : minimum + ((maximum - minimum) / 2)
  };
}

function normalizeSelectedOption(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeResolutionValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().replace(',', '.');
  return normalized || '';
}

module.exports = { normalizeRiskLevel, normalizeContainerType, normalizeBulletpoints, normalizeCompactDescription, normalizeStatusLabels, normalizeCtaLabels, normalizeUiConfig, normalizeMetrics, normalizeSelections, normalizeRangeConfig, normalizeSelectedOption, normalizeResolutionValue };
