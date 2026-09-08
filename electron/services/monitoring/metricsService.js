const { parseMonitoringSensors } = require('./metricsParser');

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampPercentOrNull(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return null;
  }
  return Math.max(0, Math.min(100, numeric));
}

function nonNegativeOrNull(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return null;
  }
  return Math.max(0, numeric);
}

function temperatureOrNull(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null || numeric <= 0 || numeric > 150) {
    return null;
  }
  return numeric;
}

function createMetricsService(options = {}) {
  const logger = options.logger;

  function normalize(rawLhmPayload) {
    try {
      const parsed = parseMonitoringSensors(rawLhmPayload);
      const memoryUsedGB = nonNegativeOrNull(parsed.memoryUsedGB);
      const networkIn = nonNegativeOrNull(parsed.networkIn);
      const networkOut = nonNegativeOrNull(parsed.networkOut);

      return {
        cpuLoad: clampPercentOrNull(parsed.cpuLoad),
        gpuLoad: clampPercentOrNull(parsed.gpuLoad),
        memoryUsedGB,
        networkIn,
        networkOut,
        // Backward compatibility for existing renderer wiring.
        memoryUsage: memoryUsedGB,
        cpuTemp: temperatureOrNull(parsed.cpuTemp),
        gpuTemp: temperatureOrNull(parsed.gpuTemp)
      };
    } catch (error) {
      logger?.error?.('Failed to normalize LHM metrics payload.', {
        message: error.message
      });

      return {
        cpuLoad: null,
        gpuLoad: null,
        memoryUsedGB: null,
        networkIn: null,
        networkOut: null,
        memoryUsage: null,
        cpuTemp: null,
        gpuTemp: null
      };
    }
  }

  return {
    normalize
  };
}

module.exports = {
  createMetricsService
};
