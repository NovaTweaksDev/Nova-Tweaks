import { mergeTweakState } from '../utils/tweakState.mjs';

export function useTweakCatalogActions({ tweakReloadBlockedUntilRef, pushToast, t, activeTweaksLoadRequestRef, stateRefreshCounterRef, setIsRefreshingTweakStates, setIsLoadingTweaks, setTweaksError, setTweaks, didBootstrapRef, getStoredRebootPendingIds, normalizeTweakForUi, mergeTweakRuntimeState, hasLoadedTweaksRef, hasLoadedTweakStatesRef, getTweakRateLimitDelay, setTweakReloadBlockedUntil, activeTweaksRefreshPromiseRef, requiresRendererTweakStateCheck, setCheckingStateTweakIds, activeStateRefreshRunRef, stateChecksRef }) {
  async function retryTweakState(tweak) {
    const id = String(tweak?.id || '');
    if (!id) return { ok: false, code: 'INVALID_TWEAK_ID' };
    const store = stateChecksRef.current;
    if (store.pending.has(id)) return store.pending.get(id);
    const version = (store.versions.get(id) || 0) + 1;
    store.versions.set(id, version);
    setCheckingStateTweakIds((previous) => [...new Set([...previous, id])]);
    setTweaks((previous) => previous.map((item) => String(item.id) === id
      ? mergeTweakState({ ...item, checked: false, stateCheckStatus: 'pending', stateCheckError: null }, item, true) : item));
    const promise = (async () => {
      let result;
      try {
        if (!window.desktopApi?.checkTweakState) throw Object.assign(new Error('API unavailable'), { code: 'API_NOT_AVAILABLE' });
        result = await window.desktopApi.checkTweakState({ id });
        if (!result?.ok || !result.tweak) throw Object.assign(new Error(result?.message || 'State check failed'), { code: result?.code });
      } catch (error) {
        result = { ok: false, tweak: { ...tweak, checked: false, currentState: null, stateCheckStatus: 'failed',
          stateCheckError: { code: error?.code || 'TWEAK_STATE_UNAVAILABLE', message: error?.message } } };
      }
      setTweaks((previous) => previous.map((item) => String(item.id) === id && store.versions.get(id) === version
        ? mergeTweakState(normalizeTweakForUi({ ...result.tweak, premium: false, rebootPending: item.rebootPending }), item, true) : item));
      return result;
    })();
    store.pending.set(id, promise);
    try { return await promise; }
    finally {
      if (store.pending.get(id) === promise) {
        store.pending.delete(id);
        setCheckingStateTweakIds((previous) => previous.filter((entry) => String(entry) !== id));
      }
    }
  }

  async function loadTweaks(options = {}) {
    const notify = Boolean(options.notify);
    const includeState = Boolean(options.includeState);
    const background = Boolean(options.background);
    const isBackgroundStateRefresh = background && includeState;
    let unsubscribeStateUpdates;
    const completedIds = new Set();
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

    const stateRunId = includeState ? ++activeStateRefreshRunRef.current : null;
    const versions = new Map(stateChecksRef.current.versions);
    const individualChecksAtStart = new Set(stateChecksRef.current.pending.keys());
    const isCurrentVersion = (id) => !individualChecksAtStart.has(String(id)) && (stateChecksRef.current.versions.get(String(id)) || 0) === (versions.get(String(id)) || 0);
    const stateRequestId = includeState ? `tweak-states-${stateRunId}` : '';
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

    try {
      if (!listTweaks) {
        setTweaksError('API_NOT_AVAILABLE');
        if (!background) setTweaks([]);
        if (!background && (notify || didBootstrapRef.current)) {
          pushToast(t('errors.apiUnavailable'), 'error');
        }
        return { ok: false, tweaks: [] };
      }
      const normalizeIncomingTweak = (tweak) => {
        const normalized = normalizeTweakForUi({ ...tweak, premium: false });
        return {
          ...normalized,
          rebootPending: getStoredRebootPendingIds().some((id) => String(id) === String(normalized.id))
        };
      };
      if (includeState && window.desktopApi?.onTweakStateUpdated) {
        unsubscribeStateUpdates = window.desktopApi.onTweakStateUpdated((update) => {
          if (update?.requestId !== stateRequestId || activeStateRefreshRunRef.current !== stateRunId) return;
          const id = String(update?.tweak?.id || '');
          if (!id || completedIds.has(id)) return;
          completedIds.add(id);
          if (!isCurrentVersion(id)) return;
          const normalized = normalizeIncomingTweak(update.tweak);
          setTweaks((previous) => previous.map((item) => String(item.id) === id && isCurrentVersion(id)
            ? mergeTweakState(normalized, item, true) : item));
          setCheckingStateTweakIds((previous) => previous.filter((pendingId) => String(pendingId) !== id));
        });
      }
      const result = await listTweaks({ includeState, ...(includeState ? { stateRequestId } : {}) });
      if (includeState && activeStateRefreshRunRef.current !== stateRunId) return { ok: false, tweaks: [] };
      if (result?.ok) {
        const incomingTweaks = Array.isArray(result.tweaks) ? result.tweaks : [];
        if (!background && activeTweaksLoadRequestRef.current !== requestId) {
          return { ok: false, tweaks: [] };
        }

        const normalizedTweaks = incomingTweaks.map(normalizeIncomingTweak);
        setTweaks((previous) => {
          const previousById = new Map(previous.map((item) => [String(item.id), item]));
          return normalizedTweaks.map((tweak) => {
            const previousTweak = previousById.get(String(tweak.id));
            // A streamed result may already have been changed by the user.
            if (includeState && previousTweak && (completedIds.has(String(tweak.id)) || !isCurrentVersion(tweak.id) || !requiresRendererTweakStateCheck(tweak))) {
              return previousTweak;
            }
            return mergeTweakRuntimeState(tweak, previousTweak, includeState);
          });
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
      unsubscribeStateUpdates?.();
      if (includeState && activeStateRefreshRunRef.current === stateRunId) {
        setTweaks((previous) => previous.map((item) => item.stateCheckStatus === 'pending' && isCurrentVersion(item.id) && !stateChecksRef.current.pending.has(String(item.id))
          ? mergeTweakState({ ...item, checked: false, stateCheckStatus: 'failed', stateCheckError: { code: 'TWEAK_STATE_UNAVAILABLE' } }, item, true) : item));
        setCheckingStateTweakIds((previous) => previous.filter((id) => stateChecksRef.current.pending.has(String(id))));
      }
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

      hasLoadedTweakStatesRef.current = false;
      setCheckingStateTweakIds(tweakIds);
      setTweaks((previous) => previous.map((item) => tweakIds.includes(String(item.id)) && !stateChecksRef.current.pending.has(String(item.id))
        ? mergeTweakState({ ...item, checked: false, stateCheckStatus: 'pending', stateCheckError: null }, item, true) : item));

      await loadTweaks({ notify: false, includeState: true, background: true });

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

  return { loadTweaks, refreshTweaksTwoPhase, retryTweakState };
}
