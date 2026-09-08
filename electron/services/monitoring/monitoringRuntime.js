const fs = require('fs');
const path = require('path');
const {
  EXPECTED_CRITICAL_RUNTIME_SHA256,
  assertMonitoringRuntimeIntegrity
} = require('./monitoringIntegrity');

const LHM_EXECUTABLE = path.join('patched', 'LibreHardwareMonitor.exe');
const MARKER_FILE = '.nova-msix-runtime.json';

function hasRequiredRuntimeFiles(directory) {
  return Boolean(directory)
    && fs.existsSync(path.join(directory, LHM_EXECUTABLE));
}

function hasCompleteRuntime(directory, expectedRuntimeSha256) {
  if (!hasRequiredRuntimeFiles(directory) || !fs.existsSync(path.join(directory, MARKER_FILE))) {
    return false;
  }

  try {
    assertMonitoringRuntimeIntegrity(directory, expectedRuntimeSha256);
    return true;
  } catch (_error) {
    return false;
  }
}

function findPackagedRuntimeRoot(resourcesPath) {
  const candidates = [
    path.join(resourcesPath, 'resources', 'monitoring', 'LibreHardwareMonitor'),
    path.join(resourcesPath, 'monitoring', 'LibreHardwareMonitor')
  ];

  return candidates.find(hasRequiredRuntimeFiles) || null;
}

function prepareMsixLhmRuntime({
  app,
  logger,
  resourcesPath = process.resourcesPath || '',
  isWindowsStore = process.windowsStore === true,
  expectedRuntimeSha256 = EXPECTED_CRITICAL_RUNTIME_SHA256
} = {}) {
  if (!isWindowsStore) {
    return null;
  }

  const sourceDirectory = findPackagedRuntimeRoot(resourcesPath);
  if (!sourceDirectory) {
    throw new Error('Packaged LibreHardwareMonitor runtime is incomplete.');
  }
  assertMonitoringRuntimeIntegrity(sourceDirectory, expectedRuntimeSha256);

  const rawVersion = typeof app?.getVersion === 'function' ? app.getVersion() : 'unknown';
  const version = String(rawVersion || 'unknown').replace(/[^0-9A-Za-z._-]/g, '_');
  const runtimeParent = path.join(app.getPath('userData'), 'msix-runtime', version, 'monitoring');
  const destinationDirectory = path.join(runtimeParent, 'LibreHardwareMonitor');

  if (hasCompleteRuntime(destinationDirectory, expectedRuntimeSha256)) {
    return destinationDirectory;
  }

  fs.mkdirSync(runtimeParent, { recursive: true });
  const temporaryDirectory = path.join(
    runtimeParent,
    `.LibreHardwareMonitor.tmp-${process.pid}-${Date.now()}`
  );
  const staleDirectory = path.join(
    runtimeParent,
    `.LibreHardwareMonitor.stale-${process.pid}-${Date.now()}`
  );

  try {
    fs.cpSync(sourceDirectory, temporaryDirectory, { recursive: true, force: true });
    if (!hasRequiredRuntimeFiles(temporaryDirectory)) {
      throw new Error('Copied LibreHardwareMonitor runtime is incomplete.');
    }
    assertMonitoringRuntimeIntegrity(temporaryDirectory, expectedRuntimeSha256);

    fs.writeFileSync(
      path.join(temporaryDirectory, MARKER_FILE),
      `${JSON.stringify({
        version,
        criticalRuntimeSha256: expectedRuntimeSha256
      }, null, 2)}\n`,
      'utf8'
    );

    if (
      fs.existsSync(destinationDirectory)
      && !hasCompleteRuntime(destinationDirectory, expectedRuntimeSha256)
    ) {
      fs.renameSync(destinationDirectory, staleDirectory);
    }
    try {
      fs.renameSync(temporaryDirectory, destinationDirectory);
    } catch (error) {
      if (!hasCompleteRuntime(destinationDirectory, expectedRuntimeSha256)) {
        throw error;
      }
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    fs.rmSync(staleDirectory, { recursive: true, force: true });
  }

  if (!hasCompleteRuntime(destinationDirectory, expectedRuntimeSha256)) {
    throw new Error('LibreHardwareMonitor MSIX runtime could not be prepared.');
  }

  logger?.info?.('Prepared writable LibreHardwareMonitor runtime for MSIX.', {
    destinationDirectory,
    version
  });
  return destinationDirectory;
}

module.exports = {
  prepareMsixLhmRuntime
};
