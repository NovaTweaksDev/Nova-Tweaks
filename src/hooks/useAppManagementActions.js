export function useAppManagementActions({ activeAppsLoadRequestRef, setAppsError, setInstalledApps, setIsLoadingApps, setIsLoadingAppDetails, didBootstrapRef, pushToast, t, hasLoadedAppsRef, installedApps, setStartupEntriesError, setStartupEntries, setIsLoadingStartupEntries, hasLoadedStartupEntriesRef }) {
  async function loadInstalledApps(options = {}) {
    const notify = Boolean(options.notify);
    const requestId = activeAppsLoadRequestRef.current + 1;
    activeAppsLoadRequestRef.current = requestId;

    if (!window.desktopApi?.listInstalledApps) {
      setAppsError('API_NOT_AVAILABLE');
      setInstalledApps([]);
      setIsLoadingApps(false);
      setIsLoadingAppDetails(false);
      if (notify || didBootstrapRef.current) {
        pushToast(t('errors.apiUnavailable'), "error");
      }
      return { ok: false, apps: [] };
    }

    setIsLoadingApps(true);
    setIsLoadingAppDetails(false);
    setAppsError('');

    try {
      const summaryResult = await window.desktopApi.listInstalledApps({ detailLevel: 'summary' });
      if (activeAppsLoadRequestRef.current !== requestId) {
        return { ok: false, apps: [] };
      }

      if (!summaryResult?.ok) {
        setInstalledApps([]);
        setAppsError(summaryResult?.code || 'LOAD_FAILED');
        if (notify || didBootstrapRef.current) {
          pushToast(`${t('apps.loadError')} (${summaryResult?.code || 'LOAD_FAILED'})`, "error");
        }
        return { ok: false, apps: [] };
      }

      const summaryApps = Array.isArray(summaryResult.apps) ? summaryResult.apps : [];
      setInstalledApps(summaryApps);
      hasLoadedAppsRef.current = true;
      setIsLoadingApps(false);
      setIsLoadingAppDetails(true);

      const detailResult = await window.desktopApi.listInstalledApps({ detailLevel: 'full' });
      if (activeAppsLoadRequestRef.current !== requestId) {
        return { ok: false, apps: [] };
      }

      if (detailResult?.ok) {
        const detailedApps = Array.isArray(detailResult.apps) ? detailResult.apps : [];
        setInstalledApps(detailedApps);
        if (notify) {
          pushToast(t('toasts.appsReloaded', { count: detailedApps.length }), 'info');
        }
        return { ok: true, apps: detailedApps };
      }

      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.detailsLoadError')} (${detailResult?.code || 'LOAD_FAILED'})`, "error");
      }
      return { ok: true, apps: summaryApps, detailsLoaded: false };
    } catch (_error) {
      if (activeAppsLoadRequestRef.current !== requestId) {
        return { ok: false, apps: [] };
      }

      if (!hasLoadedAppsRef.current) {
        setInstalledApps([]);
        setAppsError('LOAD_FAILED');
        if (notify || didBootstrapRef.current) {
          pushToast(`${t('apps.loadError')} (LOAD_FAILED)`, "error");
        }
        return { ok: false, apps: [] };
      }

      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.detailsLoadError')} (LOAD_FAILED)`, "error");
      }
    } finally {
      if (activeAppsLoadRequestRef.current === requestId) {
        setIsLoadingApps(false);
        setIsLoadingAppDetails(false);
      }
    }

    return { ok: true, apps: installedApps, detailsLoaded: false };
  }

  async function loadStartupEntries(options = {}) {
    const notify = Boolean(options.notify);

    if (!window.desktopApi?.listStartupApps) {
      setStartupEntriesError('API_NOT_AVAILABLE');
      setStartupEntries([]);
      setIsLoadingStartupEntries(false);
      if (notify || didBootstrapRef.current) {
        pushToast(t('errors.apiUnavailable'), "error");
      }
      return { ok: false, entries: [] };
    }

    setIsLoadingStartupEntries(true);
    setStartupEntriesError('');

    try {
      const result = await window.desktopApi.listStartupApps();
      if (result?.ok) {
        const incomingEntries = Array.isArray(result.entries) ? result.entries : [];
        setStartupEntries(incomingEntries);
        hasLoadedStartupEntriesRef.current = true;
        if (notify) {
          pushToast(t('toasts.startupReloaded', { count: incomingEntries.length }), 'info');
        }
        return { ok: true, entries: incomingEntries };
      }

      setStartupEntries([]);
      setStartupEntriesError(result?.code || 'LOAD_FAILED');
      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.startup.loadError')} (${result?.code || 'LOAD_FAILED'})`, "error");
      }
    } catch (_error) {
      setStartupEntries([]);
      setStartupEntriesError('LOAD_FAILED');
      if (notify || didBootstrapRef.current) {
        pushToast(`${t('apps.startup.loadError')} (LOAD_FAILED)`, "error");
      }
    } finally {
      setIsLoadingStartupEntries(false);
    }

    return { ok: false, entries: [] };
  }

  return { loadInstalledApps, loadStartupEntries };
}
