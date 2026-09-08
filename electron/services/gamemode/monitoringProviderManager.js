const { createPresentMonCliDiagnosticProvider } = require('./presentMonCliDiagnosticProvider');
const { createPresentMonServiceProvider } = require('./presentMonServiceProvider');

function normalizeProviderId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['cli', 'csv', 'diagnostic', 'presentmon-cli', 'presentmon-cli-diagnostic'].includes(normalized)) {
    return 'presentmon-cli-diagnostic';
  }
  return 'presentmon-service';
}

function createMonitoringProviderManager(options = {}) {
  const logger = options.logger;
  const env = options.env || process.env;
  const serviceProvider = options.serviceProvider || createPresentMonServiceProvider(options);
  const cliDiagnosticProvider = options.cliDiagnosticProvider || createPresentMonCliDiagnosticProvider(options);
  const selectedProviderId = normalizeProviderId(options.preferredProvider || env.NOVA_PRESENTMON_PROVIDER);
  const provider = selectedProviderId === 'presentmon-cli-diagnostic'
    ? cliDiagnosticProvider
    : serviceProvider;

  logger?.info?.('Selected PresentMon monitoring provider.', {
    selectedProvider: provider.providerId,
    serviceAvailability: serviceProvider.getAvailability(),
    cliDiagnosticAvailability: cliDiagnosticProvider.getAvailability(),
    cliDiagnosticNote: 'CLI CSV capture is diagnostic-only and is not used unless NOVA_PRESENTMON_PROVIDER=cli-diagnostic is set.'
  });

  function addManagerMetadata(payload = {}) {
    return {
      selectedProvider: provider.providerId,
      diagnosticFallbackProvider: cliDiagnosticProvider.providerId,
      cliDiagnosticEnabled: provider.providerId === cliDiagnosticProvider.providerId,
      ...payload
    };
  }

  return {
    providerId: provider.providerId,
    getAvailability() {
      return addManagerMetadata(provider.getAvailability());
    },
    getStatus() {
      return addManagerMetadata(provider.getStatus());
    },
    async start(payload = {}) {
      return addManagerMetadata(await provider.start(payload));
    },
    async stop() {
      return addManagerMetadata(await provider.stop());
    },
    readSamples() {
      return provider.readSamples();
    },
    readMetrics() {
      return addManagerMetadata(provider.readMetrics());
    }
  };
}

module.exports = {
  createMonitoringProviderManager,
  normalizeProviderId
};
