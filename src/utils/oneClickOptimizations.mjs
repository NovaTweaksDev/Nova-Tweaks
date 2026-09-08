export const ONE_CLICK_OPTIMIZATIONS = Object.freeze({
  cleanup: Object.freeze({
    id: 'cleanup',
    category: 'General',
    subcategory: 'Cleanup'
  }),
  network: Object.freeze({
    id: 'network',
    category: 'Network',
    subcategory: null
  }),
  cpu: Object.freeze({
    id: 'cpu',
    category: 'Hardware',
    subcategory: 'CPU'
  }),
  storage: Object.freeze({
    id: 'storage',
    category: 'Hardware',
    subcategory: 'Storage'
  })
});

function isRecommended(tweak) {
  const value = tweak?.recommended ?? tweak?.isRecommended ?? tweak?.is_recommended;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

export function getOneClickOptimizationForTab(category, subcategory) {
  if (category === 'Network') {
    return ONE_CLICK_OPTIMIZATIONS.network;
  }

  return Object.values(ONE_CLICK_OPTIMIZATIONS).find((definition) => (
    definition.subcategory &&
    definition.category === category &&
    definition.subcategory === subcategory
  )) || null;
}

export function getOneClickOptimizationTargets(tweaks, optimizationId) {
  const definition = ONE_CLICK_OPTIMIZATIONS[optimizationId];
  if (!definition) return [];

  return (Array.isArray(tweaks) ? tweaks : []).filter((tweak) => {
    if (!isRecommended(tweak) || tweak?.category !== definition.category) {
      return false;
    }

    return !definition.subcategory || tweak?.subcategory === definition.subcategory;
  });
}

export function isOneClickRepeatableAction(tweak) {
  const containerType = String(tweak?.containerType || tweak?.container_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return [
    'one_shot_action',
    'oneshotaction',
    'fix',
    'one_shot_selection',
    'oneshotselection',
    'range_selection',
    'rangeselection'
  ].includes(containerType);
}

export function partitionOneClickOptimizationTargets(tweaks, optimizationId) {
  const targets = getOneClickOptimizationTargets(tweaks, optimizationId);
  const runnable = [];
  const alreadyApplied = [];

  for (const tweak of targets) {
    const state = String(tweak?.currentState || tweak?.status || '').trim().toLowerCase();
    if (state === 'enabled' && !isOneClickRepeatableAction(tweak)) {
      alreadyApplied.push(tweak);
    } else {
      runnable.push(tweak);
    }
  }

  return { targets, runnable, alreadyApplied };
}
