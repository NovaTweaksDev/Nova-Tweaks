export function normalizePresetId(value) {
  return String(value || '').trim();
}

function normalizeSelectionValue(value) {
  return String(value || '').trim();
}

function normalizeResolutionValue(value) {
  return String(value || '').trim().replace(',', '.');
}

export function isPresetTweakActive(tweak, presetDefinition) {
  if (String(tweak?.currentState || '').trim().toLowerCase() !== 'enabled') {
    return false;
  }

  if (presetDefinition.expectedSelection) {
    return normalizeSelectionValue(tweak?.selectedOption) === normalizeSelectionValue(presetDefinition.expectedSelection);
  }

  if (presetDefinition.expectedResolution) {
    return normalizeResolutionValue(tweak?.selectedResolution || tweak?.currentResolution) === normalizeResolutionValue(presetDefinition.expectedResolution);
  }

  return true;
}

export function createPresetRestoreSnapshot(resolvedTweaks) {
  return resolvedTweaks
    .filter(({ presetDefinition }) => presetDefinition.stateful !== false)
    .flatMap(({ tweak, presetDefinition }) => {
      const currentState = String(tweak?.currentState || '').trim().toLowerCase();
      if (!['enabled', 'disabled'].includes(currentState)) {
        return [];
      }
      return [{
        id: presetDefinition.id,
        currentState,
        selectedOption: String(tweak?.selectedOption || '').trim(),
        selectedResolution: String(tweak?.selectedResolution || tweak?.currentResolution || '').trim()
      }];
    });
}

function getRestoreParams(snapshotEntry) {
  if (snapshotEntry?.id === 'set_dns_provider' && snapshotEntry.selectedOption) {
    return { Selection: snapshotEntry.selectedOption };
  }
  if (snapshotEntry?.id === 'set_timer_resolution' && snapshotEntry.selectedResolution) {
    return { Resolution: snapshotEntry.selectedResolution };
  }
  return {};
}

export function createPresetExecutionPlan({ resolvedTweaks, disableRequested, restoreSnapshot = [] }) {
  if (!disableRequested) {
    return {
      ok: true,
      entries: resolvedTweaks.map((entry) => ({
        ...entry,
        targetState: 'enabled',
        executionParams: entry.presetDefinition.params || {}
      }))
    };
  }

  const statefulTweaks = resolvedTweaks.filter(({ presetDefinition }) => presetDefinition.stateful !== false);
  const snapshotById = new Map(restoreSnapshot.map((entry) => [normalizePresetId(entry?.id), entry]));
  const hasCompleteSnapshot = statefulTweaks.every(({ presetDefinition }) => (
    snapshotById.has(normalizePresetId(presetDefinition.id))
  ));

  if (!hasCompleteSnapshot) {
    return { ok: false, code: 'INCOMPLETE_RESTORE_SNAPSHOT', entries: [] };
  }

  return {
    ok: true,
    entries: statefulTweaks.map((entry) => {
      const snapshotEntry = snapshotById.get(normalizePresetId(entry.presetDefinition.id));
      return {
        ...entry,
        targetState: snapshotEntry.currentState,
        executionParams: getRestoreParams(snapshotEntry)
      };
    })
  };
}

export function createPresetOperation({ presetActive, presetDefinitions }) {
  const disableRequested = Boolean(presetActive);
  return {
    disableRequested,
    statusLabelKey: disableRequested ? 'gameMode.preset.disabling' : 'gameMode.preset.enabling',
    initialPresetDefinitions: disableRequested
      ? presetDefinitions.filter((entry) => entry.stateful !== false)
      : presetDefinitions
  };
}
