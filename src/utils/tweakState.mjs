const runtimeFields = ['currentState', 'status', 'checked', 'stateCheckStatus', 'stateCheckError',
  'selectedOption', 'currentValue', 'selectedResolution', 'currentResolution', 'lastConfirmedState'];

export function isTweakStateBlocked(tweak) {
  return tweak?.stateCheckStatus === 'pending' || tweak?.stateCheckStatus === 'failed';
}

export function takeAdminStateRetryTargets(tweaks, adminReady, attemptedIds) {
  if (!adminReady) {
    attemptedIds.clear();
    return [];
  }
  return tweaks.filter((tweak) => {
    const id = String(tweak?.id || '');
    if (!id || tweak.stateCheckStatus !== 'failed' || attemptedIds.has(id)) return false;
    if (!['ADMIN_REQUIRED', 'ADMIN_BROKER_APPROVAL_REQUIRED'].includes(tweak.stateCheckError?.code)) return false;
    attemptedIds.add(id);
    return true;
  });
}

export function mergeTweakState(incoming, previous, includeState) {
  if (!includeState && previous) {
    const merged = { ...incoming };
    for (const key of runtimeFields) if (Object.hasOwn(previous, key)) merged[key] = previous[key];
    return merged;
  }
  const type = String(incoming.containerType || incoming.container_type || '').toLowerCase();
  const unsupported = ['one_shot_action', 'fix'].includes(type) || incoming.supportsStatusDetection === false || incoming.supports_status_detection === false;
  const checkStatus = incoming.stateCheckStatus || (incoming.checked === true ? 'verified' : unsupported ? 'unsupported' : includeState ? 'failed' : 'pending');
  let lastConfirmedState = previous?.lastConfirmedState || null;
  const confirmed = incoming.checked === true ? incoming : previous?.checked === true ? previous : null;
  if (confirmed && ['enabled', 'disabled'].includes(confirmed.currentState)) {
    lastConfirmedState = Object.fromEntries(['currentState', 'selectedOption', 'currentValue', 'selectedResolution', 'currentResolution']
      .map((key) => [key, confirmed[key] ?? null]));
  }
  if (checkStatus === 'failed' || checkStatus === 'pending') {
    return { ...incoming, currentState: null, status: 'unknown', checked: false,
      selectedOption: '', currentValue: null, selectedResolution: '', currentResolution: '',
      stateCheckStatus: checkStatus, lastConfirmedState,
      stateCheckError: incoming.stateCheckError || (checkStatus === 'failed' ? { code: 'TWEAK_STATE_UNAVAILABLE' } : null) };
  }
  return { ...incoming, stateCheckStatus: checkStatus, lastConfirmedState, stateCheckError: null };
}
