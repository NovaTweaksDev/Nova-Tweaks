const SHUTDOWN_TIMEOUT_MS = 30000;
const BROKER_SHUTDOWN_TIMEOUT_MS = 2000;

function createAppShutdownHandler({ app, logger, onBegin, getServices,
  timeoutMs = SHUTDOWN_TIMEOUT_MS, brokerTimeoutMs = BROKER_SHUTDOWN_TIMEOUT_MS }) {
  let shutdownPromise = null;
  let readyToQuit = false;

  async function finishTasks(tasks, budgetMs, phase) {
    const pending = new Set(tasks.map((task) => task.name));
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), budgetMs);
    });
    const completed = Promise.all(tasks.map(async ({ name, run }) => {
      try {
        await run();
      } catch (error) {
        logger?.warn?.('Application shutdown step failed.', { step: name, message: error?.message || String(error) });
      } finally {
        pending.delete(name);
      }
    })).then(() => true);
    try {
      if (!await Promise.race([completed, timeout])) {
        logger?.warn?.('Application shutdown timed out.', { phase, pendingSteps: [...pending], budgetMs });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return function beforeQuit(event) {
    if (readyToQuit) return;
    event.preventDefault();
    if (shutdownPromise) return shutdownPromise;

    // Assign the shared promise before callbacks can reenter Electron's quit handler.
    shutdownPromise = Promise.resolve().then(async () => {
      const services = getServices();
      const producers = [
        { name: 'process-watcher', run: () => services.processWatcherService?.stop?.() },
        { name: 'network-test', run: () => services.extendedNetworkTestService?.cancel?.() },
        { name: 'scheduled-maintenance', run: () => services.scheduledMaintenanceService?.destroy?.() }
      ];
      // These tasks begin synchronously in array order; all failures are observed independently.
      // Keep the broker available for display recovery and monitoring's privileged sidecar stop.
      try {
        await finishTasks([...producers,
          { name: 'game-mode-background', run: async () => {
            const result = await services.backgroundMinimizationService?.shutdown?.();
            if (result?.ok === false) throw new Error(result.code || 'Game Mode background restore incomplete');
          } },
          { name: 'display-profiles', run: () => services.displayProfileService?.shutdown?.() },
          { name: 'game-session', run: () => services.gameSessionManager?.stopSession?.({ reason: 'app-quit' }) },
          { name: 'monitoring', run: async () => {
            const result = await services.monitoringManager?.shutdown?.({ ensureProcessStopped: true });
            if (result?.sidecarStopped === false) throw new Error('The monitoring sidecar is still running.');
          } }
        ], Math.max(0, timeoutMs - brokerTimeoutMs), 'services');
      } finally {
        // Reserve a separate slice of the total budget so a stuck cleanup cannot skip the broker.
        await finishTasks([
          { name: 'admin-broker', run: () => services.adminBrokerManager?.shutdown?.() }
        ], Math.min(timeoutMs, brokerTimeoutMs), 'broker');
      }
    }).catch((error) => {
      logger?.warn?.('Application shutdown failed.', { message: error?.message || String(error) });
    }).finally(() => {
      readyToQuit = true;
      app.quit();
    });
    try {
      onBegin();
    } catch (error) {
      logger?.warn?.('Unable to prepare application shutdown.', { message: error?.message || String(error) });
    }
    return shutdownPromise;
  };
}

module.exports = { createAppShutdownHandler, SHUTDOWN_TIMEOUT_MS, BROKER_SHUTDOWN_TIMEOUT_MS };
