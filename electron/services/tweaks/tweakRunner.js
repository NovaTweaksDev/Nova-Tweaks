const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  verifySignedPayloadWithKeyring
} = require('../security/artifactVerifier');
const {
  getTweakPublicKeys
} = require('../security/signingConfig');
const { isBlockedSecurityTweakId } = require('./blockedSecurityTweaks');
const {
  KNOWN_ACTIONS,
  RemoteTweakArtifactCacheError,
  createRemoteTweakArtifactCache
} = require('./remoteTweakArtifactCache');

class TweakRunnerError extends Error {
  constructor(message, code = 'TWEAK_RUNNER_ERROR', details = {}) {
    super(message);
    this.name = 'TweakRunnerError';
    this.code = code;
    this.details = details;
  }
}

const VALID_EXECUTION_ACTIONS = ['apply', 'detect', 'restore'];
const ARTIFACT_ACTION_BY_EXECUTION_ACTION = {
  apply: 'On',
  detect: 'Check',
  restore: 'Off'
};

function normalizeTargetState(targetState) {
  return String(targetState || '').toLowerCase() === 'disabled' ? 'disabled' : 'enabled';
}

function normalizeBooleanState(value) {
  return String(value || '').toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
}

function sanitizeScriptOutput(value) {
  return String(value || '').replace(/\u0000/g, '').trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeExecutionAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const args = Array.isArray(value.args)
    ? value.args.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
    : [];
  const sourceSuccessExitCodes = Array.isArray(value.success_exit_codes)
    ? value.success_exit_codes
    : Array.isArray(value.successExitCodes)
      ? value.successExitCodes
      : [];
  const successExitCodes = sourceSuccessExitCodes
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry));
  const sourceAllowedParams = Array.isArray(value.allowed_params)
    ? value.allowed_params
    : Array.isArray(value.allowedParams)
      ? value.allowedParams
      : [];
  const allowedParams = sourceAllowedParams
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);

  const expectedOutputSource =
    value.expected_output && typeof value.expected_output === 'object' && !Array.isArray(value.expected_output)
      ? value.expected_output
      : value.expectedOutput && typeof value.expectedOutput === 'object' && !Array.isArray(value.expectedOutput)
        ? value.expectedOutput
        : null;

  const requiresAdmin =
    typeof value.requires_admin === 'boolean'
      ? value.requires_admin
      : typeof value.requiresAdmin === 'boolean'
        ? value.requiresAdmin
        : false;

  const expectedOutput = expectedOutputSource
    ? {
        enabled: typeof expectedOutputSource.enabled === 'string' ? expectedOutputSource.enabled.trim() : '',
        disabled: typeof expectedOutputSource.disabled === 'string' ? expectedOutputSource.disabled.trim() : '',
        unknown: typeof expectedOutputSource.unknown === 'string' ? expectedOutputSource.unknown.trim() : ''
      }
    : null;

  return {
    args,
    successExitCodes,
    requiresAdmin,
    allowedParams,
    expectedOutput
  };
}

function normalizeExecutionConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const actions = {};
  for (const action of VALID_EXECUTION_ACTIONS) {
    const normalized = normalizeExecutionAction(value.actions?.[action]);
    if (normalized) {
      actions[action] = normalized;
    }
  }

  return {
    type: typeof value.type === 'string' ? value.type.trim().toLowerCase() : '',
    script: typeof value.script === 'string' ? value.script.trim() : '',
    requiresAdmin:
      typeof value.requires_admin === 'boolean'
        ? value.requires_admin
        : typeof value.requiresAdmin === 'boolean'
          ? value.requiresAdmin
          : false,
    timeoutMs: Number.isFinite(Number(value.timeout_ms ?? value.timeoutMs))
      ? Number(value.timeout_ms ?? value.timeoutMs)
      : 0,
    supportsStatusDetection: Boolean(value.supports_status_detection ?? value.supportsStatusDetection),
    scriptExists: typeof value.script_exists === 'boolean' ? value.script_exists : undefined,
    actions
  };
}

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

function normalizeTradeoffs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizeTargetSystem(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      label: '',
      icon: 'gauge',
      accent: ''
    };
  }

  const accent = String(value.accent || '')
    .trim()
    .toLowerCase();

  return {
    label: typeof value.label === 'string' ? value.label.trim() : '',
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim().toLowerCase() : 'gauge',
    accent
  };
}

function normalizeUseCase(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function normalizeRangeValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
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

function normalizeFallbackApplied(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeRecommendedSelection(value, selections = []) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }

  return selections.some((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      return String(entry).trim() === normalized;
    }
    return String(entry?.value || entry?.label || '').trim() === normalized;
  }) ? normalized : '';
}

function buildTweakPresentation(configResult, extra = {}) {
  return {
    description: configResult.description,
    descriptionI18n: configResult.descriptionI18n,
    description_i18n: configResult.description_i18n,
    compactDescription: configResult.compactDescription,
    risk: configResult.risk,
    containerType: configResult.containerType,
    ui: configResult.ui,
    statusLabels: configResult.statusLabels,
    ctaLabels: configResult.ctaLabels,
    metrics: configResult.metrics,
    bulletpoints: configResult.bulletpoints,
    requiresAdmin: configResult.requiresAdmin,
    rebootRequired: configResult.rebootRequired,
    profile: configResult.profile,
    targetSystem: configResult.targetSystem,
    useCase: configResult.useCase,
    supportsStatusDetection: configResult.supportsStatusDetection,
    tradeoffs: configResult.tradeoffs,
    selections: configResult.selections,
    range: configResult.range,
    selectedOption: configResult.selectedOption,
    currentValue: configResult.currentValue,
    selectedResolution: configResult.selectedResolution,
    currentResolution: configResult.currentResolution,
    recommendedSelection: configResult.recommendedSelection,
    recommended: configResult.recommended,
    impact: configResult.impact,
    impactLevel: configResult.impactLevel,
    lastUpdated: configResult.lastUpdated,
    last_updated: configResult.last_updated,
    technicalDetails: configResult.technicalDetails,
    technicalChanges: configResult.technicalChanges,
    technical_changes: configResult.technicalChanges,
    warnings: configResult.warnings,
    compatibility: configResult.compatibility,
    applicability: configResult.applicability,
    changes: configResult.changes,
    advancedInfo: configResult.advancedInfo,
    ai: configResult.ai,
    script: configResult.script,
    execution: configResult.execution,
    ...extra
  };
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    return {
      id: '',
      name: '',
      description: '',
      descriptionI18n: null,
      description_i18n: null,
      compactDescription: '',
      risk: '',
      containerType: 'normal_tweak',
      ui: null,
      statusLabels: null,
      ctaLabels: null,
      metrics: [],
      bulletpoints: [],
      profile: {
        label: '',
        icon: 'gauge',
        accent: ''
      },
      targetSystem: [],
      useCase: '',
      supportsStatusDetection: false,
      tradeoffs: [],
      selections: [],
      range: null,
      selectedOption: '',
      currentValue: null,
      selectedResolution: '',
      currentResolution: '',
      recommendedSelection: '',
      applyScript: '',
      revertScript: '',
      requiresAdmin: false,
      rebootRequired: false,
      recommended: false,
      impact: 2,
      impactLevel: 'low',
      lastUpdated: '',
      last_updated: '',
      technicalDetails: '',
      technicalChanges: null,
      warnings: [],
      compatibility: null,
      applicability: null,
      changes: [],
      advancedInfo: null,
      ai: null,
      execution: null
    };
  }

  const selections = normalizeSelections(config.selections);

  return {
    id: typeof config.id === 'string' ? config.id.trim() : '',
    name: typeof config.name === 'string' ? config.name : '',
    description:
      typeof config.description === 'string'
        ? config.description
        : typeof config.Description === 'string'
          ? config.Description
          : typeof config.desc === 'string'
            ? config.desc
            : '',
    descriptionI18n: config.description_i18n && typeof config.description_i18n === 'object' && !Array.isArray(config.description_i18n)
      ? config.description_i18n
      : config.descriptionI18n && typeof config.descriptionI18n === 'object' && !Array.isArray(config.descriptionI18n)
        ? config.descriptionI18n
        : null,
    description_i18n: config.description_i18n && typeof config.description_i18n === 'object' && !Array.isArray(config.description_i18n)
      ? config.description_i18n
      : config.descriptionI18n && typeof config.descriptionI18n === 'object' && !Array.isArray(config.descriptionI18n)
        ? config.descriptionI18n
        : null,
    compactDescription: normalizeCompactDescription(config.compactDescription || config.compact_description),
    risk: normalizeRiskLevel(config.risk || config.risk_level || config.riskLevel),
    containerType: normalizeContainerType(config.container_type || config.containerType),
    ui: normalizeUiConfig(config.ui),
    statusLabels: normalizeStatusLabels(config.statusLabels || config.status_labels),
    ctaLabels: normalizeCtaLabels(config.ctaLabels || config.cta_labels),
    metrics: normalizeMetrics(config.metrics),
    bulletpoints: normalizeBulletpoints(config.bulletpoints),
    profile: normalizeProfile(config.profile),
    targetSystem: normalizeTargetSystem(config.target_system || config.targetSystem),
    useCase: normalizeUseCase(config.use_case || config.useCase),
    supportsStatusDetection: Boolean(
      config.supports_status_detection ??
      config.supportsStatusDetection ??
      config.execution?.supports_status_detection ??
      config.execution?.supportsStatusDetection
    ),
    tradeoffs: normalizeTradeoffs(config.tradeoffs),
    selections,
    range: normalizeRangeConfig(config.range || config.range_config),
    selectedOption: normalizeSelectedOption(config.selectedOption || config.selected_option),
    currentValue: normalizeRangeValue(config.currentValue ?? config.current_value),
    selectedResolution: normalizeResolutionValue(config.selectedResolution || config.selected_resolution),
    currentResolution: normalizeResolutionValue(config.currentResolution || config.current_resolution),
    recommendedSelection: normalizeRecommendedSelection(
      config.recommendedSelection || config.recommended_selection,
      selections
    ),
    applyScript: typeof config.apply_script === 'string'
      ? config.apply_script
      : typeof config.applyScript === 'string'
        ? config.applyScript
        : typeof config.script === 'string'
          ? config.script
          : '',
    script: typeof config.script === 'string' ? config.script : '',
    revertScript: typeof config.revert_script === 'string'
      ? config.revert_script
      : typeof config.revertScript === 'string'
        ? config.revertScript
        : typeof config.undo_script === 'string'
          ? config.undo_script
          : typeof config.undoScript === 'string'
            ? config.undoScript
            : '',
    checkScript: typeof config.check_script === 'string'
      ? config.check_script
      : typeof config.checkScript === 'string'
        ? config.checkScript
        : '',
    requiresAdmin: Boolean(config.requires_admin ?? config.requiresAdmin),
    rebootRequired: Boolean(config.reboot_required ?? config.rebootRequired),
    recommended: typeof config.recommended === 'boolean' ? config.recommended : false,
    impact: Number.isFinite(Number(config.impact)) ? Math.max(1, Math.min(5, Math.trunc(Number(config.impact)))) : 2,
    impactLevel: typeof config.impact_level === 'string'
      ? config.impact_level
      : typeof config.impactLevel === 'string'
        ? config.impactLevel
        : '',
    lastUpdated: [
      config.last_updated,
      config.lastUpdated
    ].map((value) => String(value || '').trim()).find(Boolean) || '',
    last_updated: [
      config.last_updated,
      config.lastUpdated
    ].map((value) => String(value || '').trim()).find(Boolean) || '',
    technicalDetails: typeof config.technical_details === 'string'
      ? config.technical_details
      : typeof config.technicalDetails === 'string'
        ? config.technicalDetails
        : '',
    technicalChanges: config.technical_changes && typeof config.technical_changes === 'object' ? config.technical_changes : null,
    warnings: Array.isArray(config.warnings) ? config.warnings : [],
    compatibility: config.compatibility && typeof config.compatibility === 'object' ? config.compatibility : null,
    applicability: config.applicability && typeof config.applicability === 'object' ? config.applicability : null,
    changes: Array.isArray(config.changes) ? config.changes : Array.isArray(config?.ai?.changes) ? config.ai.changes : [],
    advancedInfo: config.advanced_info && typeof config.advanced_info === 'object'
      ? config.advanced_info
      : config.advancedInfo && typeof config.advancedInfo === 'object'
        ? config.advancedInfo
        : null,
    ai: config.ai && typeof config.ai === 'object' ? config.ai : null,
    execution: normalizeExecutionConfig(config.execution)
  };
}

function createTweakRunner({
  novaApi,
  remoteScriptRunner,
  remoteScriptsPath,
  logger,
  isAdminProvider,
  tweakCatalog,
  privilegedExecutor,
  getAppVersion = () => '',
  localOnly = false,
  allowUnsignedDevelopmentArtifacts = false,
  isPackaged = false,
  waitProvider = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  timerVerificationDelayMs = 2500
}) {
  if (!novaApi && !localOnly) {
    throw new Error('Tweak runner requires novaApi.');
  }

  if (!tweakCatalog) {
    throw new Error('Tweak runner requires tweakCatalog.');
  }

  const absoluteRemoteScriptsPath = remoteScriptsPath ? path.resolve(remoteScriptsPath) : '';
  const developmentUnsignedArtifactsAllowed = (Boolean(allowUnsignedDevelopmentArtifacts) || Boolean(localOnly)) && !isPackaged;
  const remoteArtifactCache = absoluteRemoteScriptsPath
    ? createRemoteTweakArtifactCache({
        cacheRoot: absoluteRemoteScriptsPath,
        getAppVersion,
        verifySignature: ({ payload, signature }) => {
          if (developmentUnsignedArtifactsAllowed) {
            return true;
          }
          return verifySignedPayloadWithKeyring({
            payload,
            signature,
            publicKeys: getTweakPublicKeys(),
            keyId: payload?.keyId
          }).verified;
        }
      })
    : null;

  function assertTweakIsAllowed(tweakId) {
    const normalizedId = String(tweakId || '').trim();
    if (isBlockedSecurityTweakId(normalizedId)) {
      throw new TweakRunnerError(
        'This security tweak has been removed from this desktop build.',
        'TWEAK_BLOCKED_BY_SECURITY_POLICY',
        { tweakId: normalizedId }
      );
    }
  }

  function getLocalConfigOrNull(tweakId) {
    const normalizedId = String(tweakId || '').trim();
    if (!normalizedId) {
      return null;
    }

    try {
      return tweakCatalog.getConfigById(normalizedId);
    } catch (error) {
      if (error?.code === 'TWEAK_NOT_FOUND' && typeof tweakCatalog.reload === 'function') {
        try {
          tweakCatalog.reload();
          return tweakCatalog.getConfigById(normalizedId);
        } catch (reloadError) {
          if (reloadError?.code !== 'TWEAK_NOT_FOUND') {
            logger?.warn?.('Local tweak catalog reload failed.', {
              tweakId: normalizedId,
              code: reloadError?.code || '',
              message: reloadError?.message || ''
            });
          }
        }
      } else {
        logger?.warn?.('Local tweak catalog lookup failed.', {
          tweakId: normalizedId,
          code: error?.code || '',
          message: error?.message || ''
        });
      }
    }

    return null;
  }

  async function getConfig(tweakId) {
    const normalizedId = String(tweakId || '').trim();
    assertTweakIsAllowed(normalizedId);
    const localConfig = getLocalConfigOrNull(normalizedId);
    if (localOnly) {
      if (!localConfig) {
        throw new TweakRunnerError('Bundled tweak config not found.', 'TWEAK_NOT_FOUND', { tweakId: normalizedId });
      }
      return normalizeConfig(localConfig);
    }
    let rawConfig = localConfig;

    try {
      rawConfig = await novaApi.getTweakConfig(normalizedId);
    } catch (error) {
      if (!localConfig) {
        try {
          const cachedArtifact = remoteArtifactCache?.getLatestValidArtifact(normalizedId);
          if (!cachedArtifact) {
            throw error;
          }
          rawConfig = buildOfflineConfigFromArtifact(cachedArtifact);
        } catch (_cacheError) {
          throw new TweakRunnerError(
            error?.message || 'Tweak config not found.',
            error?.code || 'TWEAK_NOT_FOUND',
            error?.details || { tweakId: normalizedId }
          );
        }
      } else {
        rawConfig = localConfig;
      }
    }

    const config = normalizeConfig({
      ...(localConfig || {}),
      ...(rawConfig || {}),
      range: rawConfig?.range || rawConfig?.range_config || localConfig?.range || localConfig?.range_config || null,
      execution: rawConfig?.execution || localConfig?.execution || null
    });
    return config;
  }

  function buildOfflineConfigFromArtifact(artifact) {
    const parameterNames = artifact.allowedParameters.map((entry) => entry.name);
    const buildAction = (state, requiresAdmin) => {
      const allowedParams = state === 'Check'
        ? []
        : state === 'Off'
          ? parameterNames.filter((name) => name !== 'Value')
          : parameterNames;
      return {
      args: ['-State', state, '-Silent'],
      success_exit_codes: [0],
      requires_admin: requiresAdmin,
      ...(allowedParams.length ? { allowed_params: allowedParams } : {})
      };
    };
    return {
      id: artifact.tweakId,
      script: artifact.scriptFileName,
      requires_admin: artifact.requiresAdmin,
      reboot_required: artifact.requiresReboot,
      execution: {
        type: 'powershell',
        script: artifact.scriptFileName,
        requires_admin: artifact.requiresAdmin,
        timeout_ms: 30000,
        supports_status_detection: artifact.allowedActions.includes('Check'),
        actions: {
          apply: buildAction('On', artifact.requiresAdmin),
          detect: buildAction('Check', false),
          restore: buildAction('Off', artifact.requiresAdmin)
        }
      }
    };
  }

  function toTweakRunnerError(error) {
    if (error instanceof TweakRunnerError) {
      return error;
    }
    if (error instanceof RemoteTweakArtifactCacheError) {
      return new TweakRunnerError(error.message, error.code, error.details);
    }
    return new TweakRunnerError(error?.message || 'Remote tweak artifact processing failed.', error?.code || 'REMOTE_TWEAK_ARTIFACT_ERROR', error?.details || {});
  }

  function normalizedParamNames(actionConfig) {
    return [...new Set((Array.isArray(actionConfig?.allowedParams) ? actionConfig.allowedParams : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean))].sort();
  }

  function sameStringSet(left, right) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }

  function sameRangeContract(left, right) {
    return Boolean(
      left &&
      right &&
      left.parameter === right.parameter &&
      left.min === right.min &&
      left.max === right.max &&
      left.step === right.step
    );
  }

  function validateLocalSafetyBoundary(config, localConfig, normalizedAction) {
    const remoteAction = config?.execution?.actions?.[normalizedAction];
    if (!remoteAction) {
      throw new TweakRunnerError('Remote tweak execution action is missing.', 'REMOTE_TWEAK_ACTION_MISSING', { tweakId: config?.id || '', action: normalizedAction });
    }
    if (!localConfig) {
      return remoteAction;
    }

    const localNormalized = normalizeConfig(localConfig);
    const localAction = localNormalized?.execution?.actions?.[normalizedAction];
    if (!localAction) {
      throw new TweakRunnerError('Local tweak action is missing.', 'REMOTE_TWEAK_LOCAL_ACTION_MISSING', { tweakId: config?.id || '', action: normalizedAction });
    }
    if (localNormalized.requiresAdmin && !config.requiresAdmin) {
      throw new TweakRunnerError('Remote tweak config weakens the local administrator requirement.', 'REMOTE_TWEAK_SECURITY_BOUNDARY_VIOLATION', { tweakId: config.id, field: 'requiresAdmin' });
    }
    if (localNormalized.rebootRequired && !config.rebootRequired) {
      throw new TweakRunnerError('Remote tweak config weakens the local reboot requirement.', 'REMOTE_TWEAK_SECURITY_BOUNDARY_VIOLATION', { tweakId: config.id, field: 'requiresReboot' });
    }
    if (!sameStringSet(normalizedParamNames(remoteAction), normalizedParamNames(localAction))) {
      throw new TweakRunnerError('Remote tweak config changes locally supported parameters.', 'REMOTE_TWEAK_SECURITY_BOUNDARY_VIOLATION', { tweakId: config.id, field: 'allowedParams', action: normalizedAction });
    }
    if (
      normalizedAction === 'apply' &&
      localNormalized.containerType === 'range_selection' &&
      (
        config.containerType !== 'range_selection' ||
        !sameRangeContract(config.range, localNormalized.range)
      )
    ) {
      throw new TweakRunnerError('Remote tweak config changes the local range contract.', 'REMOTE_TWEAK_SECURITY_BOUNDARY_VIOLATION', {
        tweakId: config.id,
        field: 'range'
      });
    }
    return localAction;
  }

  function validateRequestedParams(requestedParams, actionConfig, artifact) {
    const source = isPlainObject(requestedParams) ? requestedParams : {};
    const allowedNames = new Set(normalizedParamNames(actionConfig));
    const definitions = new Map((Array.isArray(artifact.allowedParameters) ? artifact.allowedParameters : []).map((definition) => [definition.name, definition]));

    for (const key of Object.keys(source)) {
      if (!allowedNames.has(key) || !definitions.has(key)) {
        throw new TweakRunnerError('Remote tweak received an unsupported parameter.', 'REMOTE_TWEAK_UNKNOWN_PARAMETER', { tweakId: artifact.tweakId, parameter: key });
      }
    }

    const validated = {};
    for (const name of allowedNames) {
      const definition = definitions.get(name);
      if (!definition) {
        throw new TweakRunnerError('Remote tweak parameter is not described by the signed artifact.', 'REMOTE_TWEAK_PARAMETER_SCHEMA_MISSING', { tweakId: artifact.tweakId, parameter: name });
      }
      const hasValue = Object.prototype.hasOwnProperty.call(source, name);
      if (!hasValue) {
        if (definition.required) {
          throw new TweakRunnerError('Remote tweak requires a parameter value.', 'REMOTE_TWEAK_REQUIRED_PARAMETER_MISSING', { tweakId: artifact.tweakId, parameter: name });
        }
        continue;
      }
      const value = source[name];
      if (typeof value !== definition.type) {
        throw new TweakRunnerError('Remote tweak parameter type is invalid.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { tweakId: artifact.tweakId, parameter: name });
      }
      if (definition.type === 'string' && definition.maxLength && value.length > definition.maxLength) {
        throw new TweakRunnerError('Remote tweak parameter is too long.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { tweakId: artifact.tweakId, parameter: name });
      }
      if (definition.type === 'number' && (!Number.isFinite(value) || (definition.minimum !== undefined && value < definition.minimum) || (definition.maximum !== undefined && value > definition.maximum))) {
        throw new TweakRunnerError('Remote tweak parameter is outside its allowed range.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { tweakId: artifact.tweakId, parameter: name });
      }
      if (Array.isArray(definition.allowedValues) && definition.allowedValues.length && !definition.allowedValues.includes(value)) {
        throw new TweakRunnerError('Remote tweak parameter value is not allowed.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', { tweakId: artifact.tweakId, parameter: name });
      }
      validated[name] = value;
    }
    return validated;
  }

  function buildArtifactInput(config, scriptPayload) {
    return {
      tweakId: config.id,
      artifactVersion: scriptPayload?.artifactVersion,
      scriptFileName: scriptPayload?.script,
      sha256: scriptPayload?.hash,
      allowedActions: scriptPayload?.allowedActions,
      allowedParameters: scriptPayload?.allowedParameters,
      requiresAdmin: scriptPayload?.requiresAdmin,
      requiresReboot: scriptPayload?.requiresReboot,
      minimumAppVersion: scriptPayload?.minimumAppVersion,
      expiresAt: scriptPayload?.expiresAt,
      revoked: scriptPayload?.revoked,
      keyId: scriptPayload?.keyId || scriptPayload?.signedPayload?.keyId,
      signature: scriptPayload?.signature,
      signedPayload: scriptPayload?.signedPayload,
      content: scriptPayload?.content,
      signatureStatus: developmentUnsignedArtifactsAllowed ? 'development-unsigned' : 'verified'
    };
  }

  function assertRemoteSignatureIsAvailable(artifact) {
    if (developmentUnsignedArtifactsAllowed) {
      return;
    }
    if (!getTweakPublicKeys().length) {
      throw new TweakRunnerError('Remote tweak signature verification requires a configured public key.', 'REMOTE_TWEAK_SIGNATURE_KEY_MISSING', { tweakId: artifact.tweakId });
    }
    if (!artifact.signature) {
      throw new TweakRunnerError('Remote tweak script signature is missing.', 'REMOTE_TWEAK_SCRIPT_SIGNATURE_MISSING', { tweakId: artifact.tweakId, artifactVersion: artifact.artifactVersion });
    }
  }

  async function resolveRemoteExecutionPlan(config, action, requestedParams = {}) {
    if (!remoteScriptRunner || typeof novaApi.getTweakScript !== 'function') {
      throw new TweakRunnerError(
        'This tweak is visible in the server catalog, but remote script execution is not available in this desktop build.',
        'TWEAK_NOT_INSTALLED_LOCALLY',
        {
          tweakId: config?.id || '',
          name: config?.name || '',
          script: config?.execution?.script || config?.script || '',
          expectedConfigFile: `${config?.id || ''}.json`
        }
      );
    }

    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!VALID_EXECUTION_ACTIONS.includes(normalizedAction)) {
      throw new TweakRunnerError('Remote tweak execution action is invalid.', 'REMOTE_TWEAK_INVALID_ACTION', { tweakId: config?.id || '', action: normalizedAction });
    }
    assertTweakIsAllowed(config?.id || '');
    const localConfig = getLocalConfigOrNull(config?.id || '');
    const actionConfig = validateLocalSafetyBoundary(config, localConfig, normalizedAction);
    if (!localConfig && normalizedParamNames(actionConfig).some((name) => !['Selection', 'Resolution', 'Value'].includes(name))) {
      throw new TweakRunnerError('Remote tweak introduces a parameter that is not supported by this desktop build.', 'REMOTE_TWEAK_PARAMETER_UNSUPPORTED', {
        tweakId: config?.id || '',
        parameters: normalizedParamNames(actionConfig)
      });
    }
    const artifactAction = ARTIFACT_ACTION_BY_EXECUTION_ACTION[normalizedAction];
    if (!KNOWN_ACTIONS.includes(artifactAction)) {
      throw new TweakRunnerError('Remote tweak action is unsupported.', 'REMOTE_TWEAK_INVALID_ACTION', { tweakId: config?.id || '', action: normalizedAction });
    }

    let scriptPayload;
    let artifact;
    try {
      scriptPayload = await novaApi.getTweakScript(config.id);
    } catch (error) {
      try {
        artifact = remoteArtifactCache.getLatestValidArtifact(config.id, { action: artifactAction });
        logger?.warn?.('Using a verified cached remote tweak artifact after script download failed.', {
          tweakId: config.id,
          artifactVersion: artifact.artifactVersion,
          code: error?.code || ''
        });
      } catch (_cacheError) {
        throw toTweakRunnerError(error?.code ? error : new TweakRunnerError(
          'The server did not provide the PowerShell script and no valid cached artifact is available.',
          'REMOTE_TWEAK_SCRIPT_UNAVAILABLE',
          { tweakId: config?.id || '', code: error?.code || '', message: error?.message || '' }
        ));
      }
    }
    if (scriptPayload) {
      try {
        const input = buildArtifactInput(config, scriptPayload);
        assertRemoteSignatureIsAvailable(input);
        novaApi.assertTweakArtifactTrusted?.(input);
        if (input.revoked) {
          remoteArtifactCache.markArtifactRevoked(input);
          throw new TweakRunnerError('Remote tweak artifact is revoked.', 'REMOTE_TWEAK_ARTIFACT_REVOKED', {
            tweakId: input.tweakId,
            artifactVersion: input.artifactVersion
          });
        }
        artifact = await remoteArtifactCache.storeArtifact(input);
      } catch (error) {
        throw toTweakRunnerError(error);
      }
    }
    novaApi.assertTweakArtifactTrusted?.(artifact);
    try {
      artifact = remoteArtifactCache.validateForExecution(artifact.tweakId, artifact.artifactVersion, artifactAction);
    } catch (error) {
      throw toTweakRunnerError(error);
    }
    const params = validateRequestedParams(requestedParams, actionConfig, artifact);
    if (config.containerType === 'range_selection' && normalizedAction === 'apply') {
      const range = config.range;
      const parameterName = range?.parameter || 'Value';
      const value = params[parameterName];
      const stepOffset = range && Number.isFinite(value)
        ? (value - range.min) / range.step
        : Number.NaN;
      const isStepAligned = Number.isFinite(stepOffset) && Math.abs(stepOffset - Math.round(stepOffset)) < 1e-8;
      if (!range || !Number.isFinite(value) || value < range.min || value > range.max || !isStepAligned) {
        throw new TweakRunnerError('Range tweak requires a valid numeric value.', 'REMOTE_TWEAK_INVALID_PARAMETER_VALUE', {
          tweakId: config.id,
          parameter: parameterName
        });
      }
    }

    return {
      tweakId: config.id,
      action: normalizedAction,
      type: config?.execution?.type || 'powershell',
      artifactAction,
      artifactVersion: artifact.artifactVersion,
      script: artifact.scriptFileName,
      scriptRelativePath: artifact.scriptRelativePath,
      timeoutMs: Number.isFinite(Number(config?.execution?.timeoutMs)) && Number(config.execution.timeoutMs) > 0
        ? Number(config.execution.timeoutMs)
        : 30000,
      requiresAdmin: normalizedAction === 'detect'
        ? Boolean(actionConfig.requiresAdmin)
        : Boolean(artifact.requiresAdmin || actionConfig.requiresAdmin || config?.execution?.requiresAdmin),
      params: {
        State: artifactAction,
        Silent: true,
        ...params
      },
      verifyBeforeRun: () => remoteArtifactCache.validateForExecution(artifact.tweakId, artifact.artifactVersion, artifactAction),
      runner: remoteScriptRunner,
      artifact
    };
  }

  async function resolveExecutablePlan({ configResult, action, params = {} }) {
    if (localOnly) {
      const execution = tweakCatalog.resolveExecution(configResult.id, action, params);
      tweakCatalog.assertExecutionIntegrity?.(execution);
      return {
        ...execution,
        artifactAction: ARTIFACT_ACTION_BY_EXECUTION_ACTION[action],
        runner: remoteScriptRunner,
        verifyBeforeRun: null,
        artifact: null,
        requiresReboot: Boolean(configResult.rebootRequired),
        source: 'bundled'
      };
    }
    return resolveRemoteExecutionPlan(configResult, action, params);
  }

  function parseScriptStateFromStdout(stdout) {
    const normalizedStdout = sanitizeScriptOutput(stdout);
    if (!normalizedStdout) {
      return {
        state: null,
        status: '',
        message: '',
        details: {},
        code: '',
        selectedOption: '',
        currentValue: null,
        selectedResolution: '',
        currentResolution: '',
        fallbackApplied: false,
        requestedResolution: ''
      };
    }

    const lines = normalizedStdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      try {
        const parsed = JSON.parse(line);
        const status = String(parsed?.status || '').toLowerCase();
        if (status === 'enabled' || status === 'disabled' || status === 'error') {
          const parsedDetails = parsed?.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
            ? parsed.details
            : {};
          return {
            state: status === 'enabled' || status === 'disabled' ? normalizeBooleanState(status) : null,
            status,
            message: typeof parsed?.message === 'string' ? parsed.message.trim() : '',
            details: parsedDetails,
            code: typeof parsedDetails?.code === 'string' ? parsedDetails.code.trim() : '',
            selectedOption: normalizeSelectedOption(
              parsed?.details?.selectedOption ||
              parsed?.details?.selected_option ||
              parsed?.selectedOption ||
              parsed?.selected_option
            ),
            currentValue: normalizeRangeValue(
              parsed?.details?.currentValue ??
              parsed?.details?.current_value ??
              parsed?.currentValue ??
              parsed?.current_value
            ),
            selectedResolution: normalizeResolutionValue(
              parsed?.details?.selectedResolution ||
              parsed?.details?.selected_resolution ||
              parsed?.selectedResolution ||
              parsed?.selected_resolution
            ),
            currentResolution: normalizeResolutionValue(
              parsed?.details?.currentResolution ||
              parsed?.details?.current_resolution ||
              parsed?.currentResolution ||
              parsed?.current_resolution
            ),
            fallbackApplied: normalizeFallbackApplied(
              parsed?.details?.fallbackApplied ??
              parsed?.details?.fallback_applied ??
              parsed?.fallbackApplied ??
              parsed?.fallback_applied
            ),
            requestedResolution: normalizeResolutionValue(
              parsed?.details?.requestedResolution ||
              parsed?.details?.requested_resolution ||
              parsed?.requestedResolution ||
              parsed?.requested_resolution
            )
          };
        }
      } catch (_error) {
        // Continue scanning for plain-text status output.
      }
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const lowered = lines[index].toLowerCase();
      if (lowered === 'enabled' || lowered.endsWith(' enabled')) {
        return {
          state: 'enabled',
          status: 'enabled',
          message: '',
          details: {},
          code: '',
          selectedOption: '',
          currentValue: null,
          selectedResolution: '',
          currentResolution: '',
          fallbackApplied: false,
          requestedResolution: ''
        };
      }
      if (lowered === 'disabled' || lowered.endsWith(' disabled')) {
        return {
          state: 'disabled',
          status: 'disabled',
          message: '',
          details: {},
          code: '',
          selectedOption: '',
          currentValue: null,
          selectedResolution: '',
          currentResolution: '',
          fallbackApplied: false,
          requestedResolution: ''
        };
      }
    }

    return {
      state: null,
      status: '',
      message: '',
      details: {},
      code: '',
      selectedOption: '',
      currentValue: null,
      selectedResolution: '',
      currentResolution: '',
      fallbackApplied: false,
      requestedResolution: ''
    };
  }

  async function getCurrentState({ tweakId }) {
    if (typeof tweakId === 'undefined' || tweakId === null || tweakId === '') {
      throw new TweakRunnerError('Payload must include a valid tweak id.', 'INVALID_TWEAK_ID', { tweakId });
    }

    const configResult = await getConfig(tweakId);

    const supportsStatusDetection = Boolean(configResult.supportsStatusDetection);

    if (!supportsStatusDetection) {
      return buildTweakPresentation(configResult, {
        currentState: 'disabled',
        status: 'disabled',
        checked: false,
        selectedOption: '',
        currentValue: configResult.currentValue,
        selectedResolution: '',
        currentResolution: ''
      });
    }

    try {
      const executionPlan = await resolveExecutablePlan({
        configResult,
        action: 'detect'
      });
      if (executionPlan.requiresAdmin && typeof isAdminProvider === 'function' && !isAdminProvider() && typeof privilegedExecutor !== 'function') {
        return buildTweakPresentation(configResult, {
          currentState: 'disabled',
          status: 'disabled',
          checked: false,
          selectedOption: '',
          currentValue: configResult.currentValue,
          selectedResolution: '',
          currentResolution: ''
        });
      }

      const check = await (executionPlan.requiresAdmin && typeof isAdminProvider === 'function' && !isAdminProvider()
        ? privilegedExecutor('tweak.execute', buildPrivilegedTweakPayload(executionPlan), {
            allowPrompt: false, reason: 'state-detection', timeoutMs: executionPlan.timeoutMs
          })
        : executionPlan.runner.runScript({
        scriptName: executionPlan.scriptRelativePath,
        includeMode: false,
        params: executionPlan.params,
        timeoutMs: executionPlan.timeoutMs,
        verifyBeforeRun: executionPlan.verifyBeforeRun
      })).then((result) => ({
        result,
        parsedOutput: parseScriptStateFromStdout(result?.stdout)
      }));
      if (!['enabled', 'disabled'].includes(check?.parsedOutput?.state)) {
        throw new TweakRunnerError('State detection did not return a valid tweak state.', 'TWEAK_STATE_UNAVAILABLE');
      }
      const state = normalizeBooleanState(check.parsedOutput.state);
      const selectedOption = normalizeSelectedOption(check?.parsedOutput?.selectedOption);
      const currentValue = normalizeRangeValue(check?.parsedOutput?.currentValue);
      const selectedResolution = normalizeResolutionValue(check?.parsedOutput?.selectedResolution);
      const currentResolution =
        normalizeResolutionValue(check?.parsedOutput?.currentResolution) ||
        selectedResolution;
      return buildTweakPresentation(configResult, {
        currentState: state,
        status: state,
        checked: true,
        checkScript: executionPlan.scriptRelativePath,
        checkStdout: check.result?.stdout || '',
        selectedOption,
        currentValue,
        selectedResolution,
        currentResolution
      });
    } catch (error) {
      logger?.warn?.('Check script failed. Falling back to disabled state.', {
        tweakId: String(tweakId),
        checkScript: configResult?.execution?.script || configResult?.script || '',
        message: error?.message || 'check failed'
      });

      const rangeUnavailable = configResult.containerType === 'range_selection';
      return buildTweakPresentation(configResult, {
        currentState: 'disabled',
        status: rangeUnavailable ? 'unavailable' : 'disabled',
        checked: false,
        checkScript: configResult?.execution?.script || configResult?.script || '',
        selectedOption: '',
        currentValue: rangeUnavailable ? null : configResult.currentValue,
        unavailable: rangeUnavailable,
        selectedResolution: '',
        currentResolution: ''
      });
    }
  }

  function buildPrivilegedTweakPayload(executionPlan) {
    const scriptPath = path.resolve(absoluteRemoteScriptsPath, executionPlan.scriptRelativePath);
    if (!absoluteRemoteScriptsPath || !scriptPath.startsWith(`${absoluteRemoteScriptsPath}${path.sep}`)) {
      throw new TweakRunnerError('Resolved privileged tweak path is invalid.', 'SCRIPT_PATH_VIOLATION', {
        scriptName: executionPlan.scriptRelativePath
      });
    }
    const content = fs.readFileSync(scriptPath, 'utf8');
    let artifact = executionPlan.artifact;
    if (executionPlan.source === 'bundled') {
      const allowedParameters = Object.entries(executionPlan.params || {})
        .filter(([name]) => name !== 'State' && name !== 'Silent')
        .map(([name, value]) => ({
          name,
          type: typeof value,
          required: true
        }));
      const signedPayload = {
        kind: 'nova-tweak-artifact',
        schemaVersion: 1,
        tweakId: executionPlan.tweakId,
        artifactVersion: `bundled-${String(getAppVersion() || 'dev').replace(/[^A-Za-z0-9._-]/g, '-')}`,
        scriptFileName: path.basename(executionPlan.scriptRelativePath),
        sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
        allowedActions: [executionPlan.artifactAction],
        allowedParameters,
        requiresAdmin: Boolean(executionPlan.requiresAdmin),
        requiresReboot: Boolean(executionPlan.requiresReboot),
        minimumAppVersion: '',
        expiresAt: '',
        revoked: false
      };
      artifact = {
        ...signedPayload,
        signature: '',
        signedPayload,
        content
      };
    }
    return {
      action: executionPlan.artifactAction,
      params: executionPlan.params,
      artifact: {
        ...artifact,
        content
      },
      trustMode: executionPlan.source === 'bundled' ? 'bundled-integrity' : 'signed-remote',
      signingManifest: novaApi?.getSigningManifest?.() || null,
      allowUnsignedDevelopment: developmentUnsignedArtifactsAllowed
    };
  }

  async function getExecutionRequirements({ tweakId, targetState = 'enabled', params = {} }) {
    if (typeof tweakId === 'undefined' || tweakId === null || tweakId === '') {
      throw new TweakRunnerError('Payload must include a valid tweak id.', 'INVALID_TWEAK_ID', { tweakId });
    }
    const configResult = await getConfig(tweakId);
    const nextState = normalizeTargetState(targetState);
    const actionName = nextState === 'enabled' ? 'apply' : 'restore';
    const executionPlan = await resolveExecutablePlan({ configResult, action: actionName, params });
    return { requiresAdmin: executionPlan.requiresAdmin, tweakId: String(tweakId), targetState: nextState };
  }

  async function runTweak({ tweakId, targetState = 'enabled', params = {}, timeoutMs = 60000, executionContext = {} }) {
    if (typeof tweakId === 'undefined' || tweakId === null || tweakId === '') {
      throw new TweakRunnerError('Payload must include a valid tweak id.', 'INVALID_TWEAK_ID', { tweakId });
    }

    const configResult = await getConfig(tweakId);
    const nextState = normalizeTargetState(targetState);
    const actionName = nextState === 'enabled' ? 'apply' : 'restore';
    const executionPlan = await resolveExecutablePlan({
      configResult,
      action: actionName,
      params
    });

    logger?.info?.('Executing tweak script.', {
      tweakId: String(tweakId),
      targetState: nextState,
      scriptName: executionPlan.scriptRelativePath,
      scriptSource: executionPlan.source || 'server',
      requiresAdmin: executionPlan.requiresAdmin
    });

    let scriptResult;
    let verifiedTimerOutput = null;
    try {
      if (executionPlan.requiresAdmin && typeof isAdminProvider === 'function' && !isAdminProvider()) {
        if (typeof privilegedExecutor !== 'function') {
          throw new TweakRunnerError('This tweak requires administrator privileges.', 'ADMIN_REQUIRED', {
            tweakId,
            scriptName: executionPlan.scriptRelativePath
          });
        }
        scriptResult = await privilegedExecutor(
          'tweak.execute',
          buildPrivilegedTweakPayload(executionPlan),
          {
            allowPrompt: executionContext.allowPrompt !== false,
            reason: executionContext.reason || executionContext.source || 'tweak',
            timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : executionPlan.timeoutMs
          }
        );
      } else {
        scriptResult = await executionPlan.runner.runScript({
          scriptName: executionPlan.scriptRelativePath,
          includeMode: false,
          params: executionPlan.params,
          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : executionPlan.timeoutMs,
          verifyBeforeRun: executionPlan.verifyBeforeRun
        });
      }

      if (configResult.containerType === 'timer_resolution' && nextState === 'enabled') {
        await waitProvider(Math.max(0, Number(timerVerificationDelayMs) || 0));
        const verificationPlan = await resolveExecutablePlan({
          configResult,
          action: 'detect'
        });
        const verificationResult = await verificationPlan.runner.runScript({
          scriptName: verificationPlan.scriptRelativePath,
          includeMode: false,
          params: verificationPlan.params,
          timeoutMs: verificationPlan.timeoutMs,
          verifyBeforeRun: verificationPlan.verifyBeforeRun
        });
        verifiedTimerOutput = parseScriptStateFromStdout(verificationResult?.stdout);
        const requestedResolution = Number(normalizeResolutionValue(params?.Resolution));
        const currentResolution = Number(normalizeResolutionValue(verifiedTimerOutput?.currentResolution));
        const resolutionIsEffective = (
          verifiedTimerOutput?.state === 'enabled'
          && Number.isFinite(requestedResolution)
          && requestedResolution > 0
          && Number.isFinite(currentResolution)
          && currentResolution > 0
          && currentResolution <= requestedResolution + 0.0001
        );
        if (!resolutionIsEffective) {
          throw new TweakRunnerError(
            'Windows did not keep the requested timer resolution active.',
            'TIMER_RESOLUTION_NOT_EFFECTIVE',
            {
              requestedResolution: normalizeResolutionValue(params?.Resolution),
              currentResolution: normalizeResolutionValue(verifiedTimerOutput?.currentResolution),
              selectedResolution: normalizeResolutionValue(verifiedTimerOutput?.selectedResolution),
              stdout: verificationResult?.stdout || '',
              stderr: verificationResult?.stderr || ''
            }
          );
        }
      }
    } catch (error) {
      const stdout = sanitizeScriptOutput(error?.details?.stdout || '');
      const stderr = sanitizeScriptOutput(error?.details?.stderr || '');
      const parsedOutput = parseScriptStateFromStdout(stdout || stderr);
      const parsedMessage = typeof parsedOutput?.message === 'string' ? parsedOutput.message.trim() : '';
      const parsedCode = typeof parsedOutput?.code === 'string' ? parsedOutput.code.trim() : '';
      const details = {
        ...(error?.details && typeof error.details === 'object' ? error.details : {}),
        stdout,
        stderr,
        ...(parsedOutput ? { parsed: parsedOutput } : {})
      };

      throw new TweakRunnerError(
        parsedMessage || error?.message || 'Script execution failed.',
        parsedCode || error?.code || 'SCRIPT_EXECUTION_FAILED',
        details
      );
    }

    const parsedOutput = verifiedTimerOutput || parseScriptStateFromStdout(scriptResult?.stdout);
    const selectedFromOutput = normalizeSelectedOption(parsedOutput?.selectedOption);
    const selectedFromParams = normalizeSelectedOption(params?.Selection);
    const selectedOption = selectedFromOutput || selectedFromParams;
    const currentValueFromOutput = normalizeRangeValue(parsedOutput?.currentValue);
    const currentValueFromParams = normalizeRangeValue(params?.Value);
    const currentValue = currentValueFromOutput ?? currentValueFromParams ?? configResult.currentValue;
    const selectedResolutionFromOutput = normalizeResolutionValue(parsedOutput?.selectedResolution);
    const selectedResolutionFromParams = normalizeResolutionValue(params?.Resolution);
    const selectedResolution = selectedResolutionFromOutput || selectedResolutionFromParams;
    const currentResolution =
      normalizeResolutionValue(parsedOutput?.currentResolution) ||
      selectedResolution ||
      normalizeResolutionValue(configResult.currentResolution);
    const resolvedState = parsedOutput?.state ? normalizeBooleanState(parsedOutput.state) : nextState;
    const isStatelessExecution = configResult.containerType === 'one_shot_action' || configResult.containerType === 'fix';

    return {
      ok: true,
      tweakId: String(tweakId),
      targetState: nextState,
      ...(!isStatelessExecution
        ? {
            currentState: resolvedState,
            status: resolvedState
          }
        : {}),
      message: parsedOutput?.message || '',
      parsedDetails: parsedOutput?.details && typeof parsedOutput.details === 'object' ? parsedOutput.details : {},
      script: executionPlan.scriptRelativePath,
      ...buildTweakPresentation(configResult),
      selectedOption,
      currentValue,
      selectedResolution,
      currentResolution,
      ...scriptResult,
      stdout: sanitizeScriptOutput(scriptResult?.stdout || ''),
      stderr: sanitizeScriptOutput(scriptResult?.stderr || '')
    };
  }

  return {
    getConfig,
    getCurrentState,
    getExecutionRequirements,
    runTweak
  };
}

module.exports = {
  createTweakRunner,
  TweakRunnerError
};
