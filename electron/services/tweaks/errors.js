class TweakEngineError extends Error {
  constructor(message, code = 'TWEAK_ENGINE_ERROR', details = {}) {
    super(message);
    this.name = 'TweakEngineError';
    this.code = code;
    this.details = details;
  }
}

class TweakValidationError extends TweakEngineError {
  constructor(message, details = {}) {
    super(message, 'TWEAK_VALIDATION_ERROR', details);
    this.name = 'TweakValidationError';
  }
}

class TweakNotFoundError extends TweakEngineError {
  constructor(tweakId) {
    super(`Tweak not found: ${tweakId}`, 'TWEAK_NOT_FOUND', { tweakId });
    this.name = 'TweakNotFoundError';
  }
}

class TweakExecutionError extends TweakEngineError {
  constructor(message, details = {}) {
    super(message, 'TWEAK_EXECUTION_ERROR', details);
    this.name = 'TweakExecutionError';
  }
}

module.exports = {
  TweakEngineError,
  TweakValidationError,
  TweakNotFoundError,
  TweakExecutionError
};
