const { createPresentMonCaptureService } = require('./presentMonCaptureService');

function withProviderMetadata(payload = {}) {
  return {
    provider: 'presentmon-cli-diagnostic',
    ...payload
  };
}

function createPresentMonCliDiagnosticProvider(options = {}) {
  const service = createPresentMonCaptureService(options);
  const logger = options.logger;

  return {
    providerId: 'presentmon-cli-diagnostic',
    getAvailability() {
      return withProviderMetadata(service.getAvailability());
    },
    getStatus() {
      return withProviderMetadata(service.getStatus());
    },
    async start(payload = {}) {
      logger?.warn?.('Starting PresentMon CLI diagnostic provider. This path is for diagnostics only and is not the default live FPS monitor.', {
        targetProcessId: payload?.processId,
        targetProcessName: payload?.processName || payload?.exeName
      });
      return withProviderMetadata(await service.start(payload));
    },
    async stop() {
      return withProviderMetadata(await service.stop());
    },
    readSamples() {
      return service.readSamples().map((sample) => ({
        ...sample,
        source: sample.source || 'presentmon-cli-diagnostic'
      }));
    },
    readMetrics() {
      return withProviderMetadata(service.readMetrics());
    }
  };
}

module.exports = {
  createPresentMonCliDiagnosticProvider
};
