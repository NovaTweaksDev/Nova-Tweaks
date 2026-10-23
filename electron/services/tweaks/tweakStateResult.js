function failedTweakState(error) {
  return {
    currentState: null,
    status: 'unknown',
    checked: false,
    stateCheckStatus: 'failed',
    stateCheckError: {
      code: error?.code || 'TWEAK_STATE_UNAVAILABLE',
      message: error?.message || 'The current state could not be verified.'
    },
    selectedOption: '', currentValue: null, selectedResolution: '', currentResolution: ''
  };
}

module.exports = { failedTweakState };
