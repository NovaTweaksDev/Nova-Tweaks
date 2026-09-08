function normalizeContainerType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'oneshotselection' || normalized === 'one_shot' || normalized === 'one_shot_selections') {
    return 'one_shot_selection';
  }

  if (normalized === 'oneshotaction' || normalized === 'one_shot_actions') {
    return 'one_shot_action';
  }

  if (normalized === 'fixes') {
    return 'fix';
  }

  return normalized;
}

const STATELESS_TWEAK_CONTAINER_TYPES = new Set(['one_shot_action', 'fix']);

function requiresTweakStateCheck(tweak) {
  const containerType = normalizeContainerType(
    tweak?.containerType || tweak?.container_type
  );

  if (STATELESS_TWEAK_CONTAINER_TYPES.has(containerType)) {
    return false;
  }

  if (containerType === 'one_shot_selection') {
    return Boolean(
      tweak?.supportsStatusDetection ??
      tweak?.supports_status_detection
    );
  }

  return true;
}

module.exports = {
  requiresTweakStateCheck
};
