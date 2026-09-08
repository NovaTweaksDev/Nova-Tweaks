export function normalizeRiskLevel(tweak) {
  const value = String(tweak?.riskLevel || tweak?.risk_level || tweak?.risk || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(value) ? value : 'low';
}

export function getRiskLabel(riskLevel) {
  const normalized = String(riskLevel || '').trim().toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'medium') return 'Medium';
  return 'Low';
}

export function getRiskColorClass(riskLevel) {
  const normalized = String(riskLevel || '').trim().toLowerCase();
  if (normalized === 'high') return 'text-[var(--danger)]';
  if (normalized === 'medium') return 'text-[var(--warning)]';
  return 'text-[var(--success)]';
}

export function getRiskDotClass(riskLevel) {
  const normalized = String(riskLevel || '').trim().toLowerCase();
  if (normalized === 'high') return 'bg-[var(--danger)]';
  if (normalized === 'medium') return 'bg-[var(--warning)]';
  return 'bg-[var(--success)]';
}

export function normalizeTweakTags(tweak) {
  return Array.isArray(tweak?.tags)
    ? tweak.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
}

function normalizeMetadataBoolean(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) && value !== 0;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        continue;
      }

      if (['true', '1', 'yes', 'y', 'on', 'enabled', 'recommended', 'premium'].includes(normalized)) {
        return true;
      }

      if (['false', '0', 'no', 'n', 'off', 'disabled', 'optional', 'free'].includes(normalized)) {
        return false;
      }
    }
  }

  return false;
}

export function normalizeRecommended(tweak) {
  return normalizeMetadataBoolean(
    tweak?.recommended,
    tweak?.isRecommended,
    tweak?.is_recommended,
    tweak?.metadata?.recommended
  );
}

export function normalizePremium(tweak) {
  return normalizeMetadataBoolean(
    tweak?.premium,
    tweak?.isPremium,
    tweak?.is_premium,
    tweak?.requiresPremium,
    tweak?.requires_premium,
    tweak?.metadata?.premium
  );
}

export function normalizeRequiresAdmin(tweak) {
  return normalizeMetadataBoolean(
    tweak?.requiresAdmin,
    tweak?.requires_admin,
    tweak?.adminRequired,
    tweak?.admin_required,
    tweak?.metadata?.requiresAdmin,
    true
  );
}

export function normalizeRebootRequired(tweak) {
  return normalizeMetadataBoolean(
    tweak?.rebootRequired,
    tweak?.reboot_required,
    tweak?.requiresReboot,
    tweak?.requires_reboot,
    tweak?.metadata?.rebootRequired
  );
}

export function normalizeLanguageCode(language) {
  return String(language || 'en').trim().toLowerCase().split('-')[0] || 'en';
}

export function getLocalizedTweakDescription(tweak, language = 'en') {
  const languageCode = normalizeLanguageCode(language);
  const descriptions = tweak?.descriptionI18n || tweak?.description_i18n;

  if (descriptions && typeof descriptions === 'object' && !Array.isArray(descriptions)) {
    const localized = String(descriptions[languageCode] || descriptions.en || '').trim();
    if (localized) {
      return localized;
    }
  }

  return String(tweak?.description || '').trim();
}

export function normalizeImpactValue(tweak) {
  const explicitImpact = Number(tweak?.impact);
  if (Number.isFinite(explicitImpact)) {
    return Math.max(1, Math.min(5, Math.trunc(explicitImpact)));
  }

  const level = String(tweak?.impactLevel || tweak?.impact_level || '').trim().toLowerCase();
  if (level === 'high') return 4;
  if (level === 'medium') return 3;
  if (level === 'low') return 2;

  const metrics = Array.isArray(tweak?.metrics) ? tweak.metrics : [];
  const metricValues = metrics
    .map((metric) => Number(metric?.value))
    .filter((value) => Number.isFinite(value));
  if (metricValues.length) {
    const average = metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length;
    return Math.max(1, Math.min(5, Math.round(average)));
  }

  return 2;
}

export function normalizeSelectionOptions(tweak) {
  const rawOptions = Array.isArray(tweak?.options)
    ? tweak.options
    : Array.isArray(tweak?.selections)
      ? tweak.selections
      : [];
  const actionType = getActionType(tweak);
  const resolvedRawOptions = rawOptions.length || actionType !== 'timer_resolution'
    ? rawOptions
    : ['0.5', '1.0'];
  const recommendedSelection = String(tweak?.recommendedSelection || tweak?.recommended_selection || '').trim();

  return resolvedRawOptions
    .map((option) => {
      if (typeof option === 'string' || typeof option === 'number') {
        const label = String(option).trim();
        return {
          label,
          value: label,
          recommended: recommendedSelection ? label === recommendedSelection : false
        };
      }

      const label = String(option?.label || option?.name || option?.value || '').trim();
      const value = String(option?.value || option?.id || label).trim();
      return {
        ...option,
        label,
        value,
        recommended: normalizeMetadataBoolean(option?.recommended, option?.isRecommended, option?.is_recommended) ||
          (recommendedSelection ? value === recommendedSelection || label === recommendedSelection : false)
      };
    })
    .filter((option) => option.label && option.value);
}

export function normalizeRangeConfig(tweak) {
  const source =
    tweak?.range && typeof tweak.range === 'object' && !Array.isArray(tweak.range)
      ? tweak.range
      : tweak?.rangeConfig && typeof tweak.rangeConfig === 'object' && !Array.isArray(tweak.rangeConfig)
        ? tweak.rangeConfig
        : tweak?.range_config && typeof tweak.range_config === 'object' && !Array.isArray(tweak.range_config)
          ? tweak.range_config
          : {};
  const minimum = Number(source.min ?? source.minimum);
  const maximum = Number(source.max ?? source.maximum);
  const step = Number(source.step);
  const recommendedValue = Number(source.recommendedValue ?? source.recommended_value);
  const safeMinimum = Number.isFinite(minimum) ? minimum : 0;
  const safeMaximum = Number.isFinite(maximum) && maximum > safeMinimum ? maximum : 100;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const fallbackRecommended = safeMinimum + ((safeMaximum - safeMinimum) / 2);

  return {
    parameter: String(source.parameter || 'Value').trim() || 'Value',
    min: safeMinimum,
    max: safeMaximum,
    step: safeStep,
    unit: String(source.unit || '').trim(),
    recommendedValue: Number.isFinite(recommendedValue)
      ? Math.min(safeMaximum, Math.max(safeMinimum, recommendedValue))
      : fallbackRecommended
  };
}

function normalizeOptionalRangeValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeLastUpdated(tweak) {
  const rawValue = [
    tweak?.lastUpdated,
    tweak?.last_updated,
    tweak?.updatedAt,
    tweak?.updated_at,
    tweak?.metadata?.lastUpdated,
    tweak?.metadata?.last_updated,
    tweak?.ai?.lastUpdated,
    tweak?.ai?.last_updated
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && value.toLowerCase() !== 'unknown');

  return rawValue || 'Unknown';
}

export function formatLastUpdatedLabel(value, now = Date.now()) {
  const rawValue = String(value || '').trim();
  if (!rawValue || rawValue.toLowerCase() === 'unknown') {
    return 'Unknown';
  }

  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
    ? `${rawValue}T00:00:00`
    : rawValue;
  const timestamp = new Date(normalizedDate).getTime();

  if (!Number.isFinite(timestamp)) {
    return rawValue;
  }

  const elapsedMs = Number(now || Date.now()) - timestamp;
  const elapsedDays = Math.floor(elapsedMs / 86400000);

  if (elapsedDays < 0) {
    return rawValue;
  }

  if (elapsedDays === 0) {
    return 'Today';
  }

  if (elapsedDays === 1) {
    return '1 day ago';
  }

  if (elapsedDays < 30) {
    return `${elapsedDays} days ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function getContainerType(tweak) {
  const normalized = String(tweak?.containerType || tweak?.container_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'oneshotaction' || normalized === 'one_shot' || normalized === 'one_shot_actions') {
    return 'one_shot_action';
  }

  if (normalized === 'oneshotselection' || normalized === 'one_shot_selection' || normalized === 'one_shot_selections') {
    return 'selection';
  }

  if (normalized === 'powerplan' || normalized === 'power_plan' || normalized === 'timer_resolution' || normalized === 'timerresolution') {
    return 'selection';
  }

  if (normalized === 'rangeselection' || normalized === 'range_selection' || normalized === 'range_selections') {
    return 'range';
  }

  if (normalized === 'fix') {
    return 'one_shot_action';
  }

  return normalized || 'normal_tweak';
}

export function getActionType(tweak) {
  const normalized = String(tweak?.actionType || tweak?.action_type || tweak?.containerType || tweak?.container_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'powerplan' || normalized === 'power_plan' || normalized === 'power_plans') {
    return 'power_plan';
  }

  if (normalized === 'timerresolution' || normalized === 'timer_resolution' || normalized === 'timer_resolutions') {
    return 'timer_resolution';
  }

  if (normalized === 'oneshotselection' || normalized === 'one_shot_selection' || normalized === 'one_shot_selections') {
    return 'one_shot_selection';
  }

  if (normalized === 'rangeselection' || normalized === 'range_selection' || normalized === 'range_selections') {
    return 'range_selection';
  }

  if (normalized === 'oneshotaction' || normalized === 'one_shot_action' || normalized === 'one_shot_actions' || normalized === 'fix') {
    return 'one_shot_action';
  }

  return 'normal_tweak';
}

export function getTweakStatusLabel(tweak) {
  if (tweak?.rebootPending || tweak?.rebootRequiredPending) {
    return 'Reboot required';
  }

  const type = getContainerType(tweak);
  if (type === 'one_shot_action') {
    return 'Ready';
  }

  if (type === 'selection') {
    const selected =
      String(tweak?.selectedOption || tweak?.selected_option || '').trim() ||
      String(tweak?.selectedResolution || tweak?.selected_resolution || tweak?.currentResolution || tweak?.current_resolution || '').trim();
    return selected || normalizeStatusDisplayText(tweak?.status || tweak?.currentState || 'Not selected');
  }

  if (type === 'range') {
    const value = normalizeOptionalRangeValue(tweak?.currentValue ?? tweak?.current_value);
    if (value !== null) {
      const { unit } = normalizeRangeConfig(tweak);
      return `${value}${unit}`;
    }
    return normalizeStatusDisplayText(tweak?.status || tweak?.currentState || 'Not available');
  }

  const state = String(tweak?.currentState || tweak?.status || '').trim().toLowerCase();
  return state === 'enabled' ? 'Enabled' : 'Disabled';
}

export function normalizeStatusDisplayText(value) {
  const rebootNormalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (rebootNormalized === 'reboot_required' || rebootNormalized === 'restart_required') return 'Reboot required';

  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'enabled') return 'Enabled';
  if (normalized === 'disabled') return 'Disabled';
  if (normalized === 'ready') return 'Ready';
  if (normalized === 'not selected' || normalized === 'not_selected') return 'Not selected';
  return String(value || '').trim() || 'Unknown';
}

export function getStatusTone(tweak) {
  if (tweak?.rebootPending || tweak?.rebootRequiredPending) {
    return 'warning';
  }

  const type = getContainerType(tweak);
  if (type === 'one_shot_action') {
    return 'ready';
  }

  const state = String(tweak?.currentState || tweak?.status || '').trim().toLowerCase();
  if (state === 'enabled') return 'enabled';
  if (state === 'disabled') return 'disabled';
  return 'neutral';
}

export function getStatusTextClass(tone) {
  if (tone === 'warning') return 'text-[var(--warning)]';
  if (tone === 'enabled') return 'text-[var(--success)]';
  if (tone === 'ready') return 'text-[var(--text-muted)]';
  if (tone === 'disabled') return 'text-[var(--text-muted)]';
  return 'text-[var(--text-muted)]';
}

export function getImpactValue(tweak) {
  return normalizeImpactValue(tweak);
}
