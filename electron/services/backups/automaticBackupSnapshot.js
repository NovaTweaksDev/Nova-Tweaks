const { requiresTweakStateCheck } = require('../tweaks/tweakStatePolicy');

async function captureAutomaticTweakSnapshot(tweaks, tweakRunner, { strict = false } = {}) {
  const data = [];
  const failures = [];
  for (const tweak of tweaks.filter(requiresTweakStateCheck)) {
    try {
      const state = await tweakRunner.getCurrentState({ tweakId: tweak.id });
      if (state?.checked === false || !['enabled', 'disabled'].includes(state?.currentState)) {
        throw new Error('The current state could not be verified.');
      }
      data.push({
        id: String(tweak.id),
        name: String(tweak.name || tweak.id),
        containerType: String(state.containerType || tweak.containerType || tweak.container_type || ''),
        currentState: state.currentState,
        status: state.currentState,
        selectedOption: state.selectedOption || '',
        selectedResolution: state.selectedResolution || '',
        currentValue: state.currentValue ?? null,
        requiresAdmin: Boolean(state.requiresAdmin ?? tweak.requiresAdmin),
        rebootRequired: Boolean(state.rebootRequired ?? tweak.rebootRequired)
      });
    } catch (error) {
      const message = `${tweak.name || tweak.id}: ${error?.message || 'State capture failed.'}`;
      if (strict) throw Object.assign(new Error(message), { code: 'BACKUP_STATE_UNAVAILABLE' });
      failures.push(message);
    }
  }
  return {
    capturedAt: new Date().toISOString(),
    captureStatus: failures.length ? (data.length ? 'partial' : 'unavailable') : (data.length ? 'complete' : 'unavailable'),
    itemCount: data.length,
    summary: failures.length ? `Some tweak states could not be captured: ${failures.join('; ')}` : 'Verified tweak states and selected values.',
    data
  };
}

module.exports = { captureAutomaticTweakSnapshot };
