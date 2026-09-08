function normalizeContainerType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'timerresolution' || normalized === 'timer_resolutions') {
    return 'timer_resolution';
  }
  if (normalized === 'oneshotselection' || normalized === 'one_shot' || normalized === 'one_shot_selections') {
    return 'one_shot_selection';
  }
  if (normalized === 'oneshotaction' || normalized === 'one_shot_actions') {
    return 'one_shot_action';
  }
  if (normalized === 'powerplan' || normalized === 'power_plans') {
    return 'power_plan';
  }
  if (normalized === 'rangeselection' || normalized === 'range_selections') {
    return 'range_selection';
  }

  return normalized;
}

function selectionValue(entry) {
  if (typeof entry === 'string' || typeof entry === 'number') {
    return String(entry).trim();
  }
  return String(entry?.value || entry?.label || '').trim();
}

function getRecommendedSelection(config) {
  const explicit = String(
    config?.recommendedSelection ||
    config?.recommended_selection ||
    ''
  ).trim();
  if (explicit) {
    return explicit;
  }

  const selections = Array.isArray(config?.selections) ? config.selections : [];
  const recommended = selections.find((entry) => entry?.recommended === true);
  return selectionValue(recommended || selections[0]);
}

function buildAutomaticTweakParams(config, action) {
  const containerType = normalizeContainerType(
    config?.containerType || config?.container_type
  );
  const configuredTarget = String(action?.tweakTargetValue || '').trim();

  if (containerType === 'timer_resolution') {
    const resolution = configuredTarget || getRecommendedSelection(config) || '0.5';
    return resolution ? { Resolution: resolution } : null;
  }

  if (containerType === 'one_shot_selection') {
    const selectedOption = configuredTarget || getRecommendedSelection(config);
    return selectedOption ? { Selection: selectedOption } : null;
  }

  if (containerType === 'range_selection') {
    const range = config?.range && typeof config.range === 'object' ? config.range : {};
    const parameter = String(range.parameter || 'Value').trim() || 'Value';
    const rawValue = configuredTarget || (range.recommendedValue ?? range.recommended_value);
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;
    const value = Number(rawValue);
    return Number.isFinite(value) ? { [parameter]: value } : null;
  }

  return {};
}

function buildAutomaticTweakState(tweakId, result, params) {
  const selectedResolution = String(
    result?.selectedResolution ??
    result?.selected_resolution ??
    params?.Resolution ??
    ''
  ).trim();
  const currentResolution = String(
    result?.currentResolution ??
    result?.current_resolution ??
    selectedResolution
  ).trim();
  const selectedOption = String(
    result?.selectedOption ??
    result?.selected_option ??
    params?.Selection ??
    ''
  ).trim();
  const rawCurrentValue = result?.currentValue ?? result?.current_value ?? params?.Value;
  const currentValue = rawCurrentValue === '' || rawCurrentValue === null || rawCurrentValue === undefined
    ? null
    : Number(rawCurrentValue);
  const currentState = String(result?.currentState || result?.status || 'enabled').trim().toLowerCase() === 'enabled'
    ? 'enabled'
    : 'disabled';

  return {
    tweakId: String(tweakId),
    currentState,
    status: currentState,
    selectedResolution,
    currentResolution,
    selectedOption,
    currentValue: Number.isFinite(currentValue) ? currentValue : null
  };
}

async function executeAutomaticTweakRuleAction({
  execution,
  tweakRunner,
  tweakCatalog,
  createBackup,
  logger,
  allowAdminPrompt = false,
  isAdminAccessReady = () => false
}) {
  const action = execution?.action || {};
  if (action.type !== 'runTweak' || !action.tweakId || !tweakRunner || !tweakCatalog) {
    return { handled: false };
  }

  const localConfig = tweakCatalog.getConfigById?.(String(action.tweakId));
  if (!localConfig) {
    return { handled: true, ok: false, code: 'AUTOMATIC_TWEAK_UNAVAILABLE', message: `The rule tweak is unavailable: ${action.tweakId}.` };
  }

  const localContainerType = normalizeContainerType(
    localConfig.containerType || localConfig.container_type
  );
  const confirmationBypassed = action.bypassConfirmation === true;
  if (localContainerType !== 'timer_resolution' && !confirmationBypassed && !isAdminAccessReady()) {
    return { handled: false };
  }

  try {
    const config = await tweakRunner.getConfig(String(action.tweakId));
    const containerType = normalizeContainerType(
      config?.containerType || config?.container_type || localContainerType
    );
    if (containerType !== localContainerType) {
      return {
        handled: true,
        ok: false,
        code: 'AUTOMATIC_TWEAK_CONTAINER_MISMATCH',
        message: 'The tweak type no longer matches the locally approved automation contract.'
      };
    }

    const params = buildAutomaticTweakParams(config, action);
    if (!params) {
      return {
        handled: true,
        ok: false,
        code: 'AUTOMATIC_TWEAK_TARGET_REQUIRED',
        message: 'The automatic rule is missing a valid tweak value.'
      };
    }

    const requirements = await tweakRunner.getExecutionRequirements?.({
      tweakId: String(action.tweakId),
      targetState: 'enabled',
      params
    });
    if (requirements?.requiresAdmin && !allowAdminPrompt && !isAdminAccessReady()) {
      return {
        handled: true,
        ok: false,
        pendingAdmin: true,
        code: 'ADMIN_BROKER_APPROVAL_REQUIRED',
        message: 'Administrator approval is required before this automatic rule can run.'
      };
    }

    if (typeof createBackup === 'function') {
      const backup = await createBackup(config);
      if (backup?.ok === false) {
        return {
          handled: true,
          ok: false,
          code: backup.code || 'BACKUP_CREATE_FAILED',
          message: backup.message || 'The safety backup could not be created.'
        };
      }
    }

    logger?.info?.('Executing automatic rule tweak.', {
      executionId: execution.id,
      ruleId: execution.ruleId,
      tweakId: action.tweakId,
      containerType,
      confirmationBypassed
    });

    const result = await tweakRunner.runTweak({
      tweakId: String(action.tweakId),
      targetState: 'enabled',
      params,
      timeoutMs: 60000,
      executionContext: {
        allowPrompt: allowAdminPrompt,
        source: 'rule',
        reason: 'automatic-rule'
      }
    });
    if (result?.ok === false) {
      return {
        handled: true,
        ok: false,
        code: result.code || 'AUTOMATIC_TWEAK_FAILED',
        message: result.message || result.stderr || 'Automatic tweak execution failed.'
      };
    }

    const target = Object.values(params)[0];
    return {
      handled: true,
      ok: true,
      tweakState: buildAutomaticTweakState(action.tweakId, result, params),
      message: target === undefined
        ? 'Tweak applied automatically.'
        : `Tweak applied automatically: ${target}.`
    };
  } catch (error) {
    if (error?.code === 'TIMER_RESOLUTION_NOT_EFFECTIVE') {
      return {
        handled: true,
        ok: false,
        code: 'TIMER_RESOLUTION_NOT_EFFECTIVE',
        message: error?.message || 'Windows did not keep the requested timer resolution active.',
        tweakState: {
          tweakId: String(action.tweakId),
          currentState: 'disabled',
          status: 'disabled',
          selectedResolution: '',
          currentResolution: String(error?.details?.currentResolution || '').trim(),
          selectedOption: '',
          currentValue: null
        }
      };
    }
    if (error?.code === 'ADMIN_BROKER_CANCELLED') {
      return {
        handled: true,
        ok: false,
        pendingAdmin: true,
        code: 'ADMIN_BROKER_CANCELLED',
        message: 'Administrator approval was cancelled. The rule will remain pending until it expires.'
      };
    }
    if (error?.code === 'ADMIN_BROKER_APPROVAL_REQUIRED' || error?.code === 'ADMIN_REQUIRED') {
      return {
        handled: true,
        ok: false,
        pendingAdmin: true,
        code: 'ADMIN_BROKER_APPROVAL_REQUIRED',
        message: 'Administrator approval is required before this automatic rule can run.'
      };
    }
    return {
      handled: true,
      ok: false,
      code: error?.code || 'AUTOMATIC_TWEAK_FAILED',
      message: error?.message || 'Automatic tweak execution failed.'
    };
  }
}

module.exports = {
  buildAutomaticTweakParams,
  buildAutomaticTweakState,
  executeAutomaticTweakRuleAction,
  normalizeContainerType
};
