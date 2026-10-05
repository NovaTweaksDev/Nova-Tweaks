export function useTweakCatalogActions({ tweakReloadBlockedUntilRef, pushToast, t, activeTweaksLoadRequestRef, stateRefreshCounterRef, setIsRefreshingTweakStates, setIsLoadingTweaks, setTweaksError, setTweaks, didBootstrapRef, getStoredRebootPendingIds, normalizeTweakForUi, mergeTweakRuntimeState, hasLoadedTweaksRef, hasLoadedTweakStatesRef, getTweakRateLimitDelay, setTweakReloadBlockedUntil, activeTweaksRefreshPromiseRef, requiresRendererTweakStateCheck, setCheckingStateTweakIds, activeStateRefreshRunRef }) {
  async function loadTweaks(options = {}) {
    const notify = Boolean(options.notify);
    const includeState = Boolean(options.includeState);
    const background = Boolean(options.background);
    const isBackgroundStateRefresh = background && includeState;
    const cooldownRemainingMs = tweakReloadBlockedUntilRef.current - Date.now();

    if (cooldownRemainingMs > 0) {
      if (notify) {
        pushToast(t('errors.tweakReloadRateLimited', {
          seconds: Math.max(1, Math.ceil(cooldownRemainingMs / 1000))
        }), 'warning');
      }
      return {
        ok: false,
        code: 'API_RATE_LIMITED',
        details: { retryAfterMs: cooldownRemainingMs },
        tweaks: []
      };
    }

    const requestId = !background ? activeTweaksLoadRequestRef.current + 1 : activeTweaksLoadRequestRef.current;

    if (!background) {
      activeTweaksLoadRequestRef.current = requestId;
    }

    if (isBackgroundStateRefresh) {
      stateRefreshCounterRef.current += 1;
      setIsRefreshingTweakStates(true);
    }

    if (!background) {
      setIsLoadingTweaks(true);
      setTweaksError('');
    }

    const listTweaks = window.desktopApi?.listTweaks;

    if (!listTweaks) {
      setTweaksError('API_NOT_AVAILABLE');
      if (!background) {
        setTweaks([]);
        setIsLoadingTweaks(false);
      }
      if (!background && (notify || didBootstrapRef.current)) {
        pushToast(t('errors.apiUnavailable'), "error");
      }
      return { ok: false, tweaks: [] };
    }

    try {
      const result = await listTweaks({ includeState });
      if (result?.ok) {
        const incomingTweaks = Array.isArray(result.tweaks) ? result.tweaks : [];
        if (!background && activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }

        const rebootPendingSet = new Set(getStoredRebootPendingIds().map((id) => String(id)));
        const normalizedTweaks = incomingTweaks.map((tweak) => {
          const normalized = normalizeTweakForUi({ ...tweak, premium: false });
          return {
            ...normalized,
            rebootPending: rebootPendingSet.has(String(normalized.id))
          };
        });
        setTweaks((previous) => {
          const previousById = new Map(previous.map((item) => [String(item.id), item]));
          return normalizedTweaks.map((tweak) =>
            mergeTweakRuntimeState(tweak, previousById.get(String(tweak.id)), includeState)
          );
        });
        hasLoadedTweaksRef.current = true;
        if (includeState) {
          hasLoadedTweakStatesRef.current = true;
        }

        if (!background && notify) {
          pushToast(t('toasts.tweaksReloaded', { count: incomingTweaks.length }), 'info');
        }
        return { ok: true, tweaks: incomingTweaks };
      }

      const rateLimitDelay = getTweakRateLimitDelay(result);
      const rateLimited = rateLimitDelay > 0;
      if (rateLimited) {
        const blockedUntil = Date.now() + rateLimitDelay;
        tweakReloadBlockedUntilRef.current = blockedUntil;
        setTweakReloadBlockedUntil(blockedUntil);
      }

      if (!background) {
        if (activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }
        setTweaksError(result?.code || 'LOAD_FAILED');
        if (!rateLimited) {
          setTweaks([]);
        }
      }
      if (!background && (notify || didBootstrapRef.current)) {
        if (rateLimited) {
          pushToast(t('errors.tweakReloadRateLimited', {
            seconds: Math.max(1, Math.ceil(rateLimitDelay / 1000))
          }), 'warning');
        } else {
          pushToast(`${t('errors.failedToLoadTweaksApi')} (${result?.code || 'LOAD_FAILED'})`, "error");
        }
      }
    } catch (_error) {
      if (!background) {
        if (activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }
        setTweaksError('LOAD_FAILED');
        setTweaks([]);
      }
      if (!background && (notify || didBootstrapRef.current)) {
        pushToast(`${t('errors.failedToLoadTweaksApi')} (LOAD_FAILED)`, "error");
      }
    } finally {
      if (isBackgroundStateRefresh) {
        stateRefreshCounterRef.current = Math.max(0, stateRefreshCounterRef.current - 1);
        if (stateRefreshCounterRef.current === 0) {
          setIsRefreshingTweakStates(false);
        }
      }
      if (!background) {
        if (activeTweaksLoadRequestRef.current === requestId) {
          setIsLoadingTweaks(false);
        }
      }
    }

    return { ok: false, tweaks: [] };
  }

  async function refreshTweaksTwoPhase(options = {}) {
    if (activeTweaksRefreshPromiseRef.current) {
      return activeTweaksRefreshPromiseRef.current;
    }

    const notify = Boolean(options.notify);
    const refreshStates = options.refreshStates !== false;
    const refreshPromise = (async () => {
      const quickLoad = await loadTweaks({ notify, includeState: false });
      const tweakIds = Array.isArray(quickLoad?.tweaks)
        ? quickLoad.tweaks
            .filter(requiresRendererTweakStateCheck)
            .map((tweak) => String(tweak?.id || ''))
            .filter(Boolean)
        : [];

      if (!quickLoad?.ok || !refreshStates || !tweakIds.length) {
        if (!tweakIds.length) {
          setCheckingStateTweakIds([]);
        }
        return quickLoad;
      }

      const runId = activeStateRefreshRunRef.current + 1;
      activeStateRefreshRunRef.current = runId;
      hasLoadedTweakStatesRef.current = false;
      setCheckingStateTweakIds(tweakIds);

      void (async () => {
        try {
          await loadTweaks({ notify: false, includeState: true, background: true });
        } finally {
          if (activeStateRefreshRunRef.current === runId) {
            setCheckingStateTweakIds([]);
          }
        }
      })();

      return quickLoad;
    })();

    activeTweaksRefreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (activeTweaksRefreshPromiseRef.current === refreshPromise) {
        activeTweaksRefreshPromiseRef.current = null;
      }
    }
  }

  return { loadTweaks, refreshTweaksTwoPhase };
}
