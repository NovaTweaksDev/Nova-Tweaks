function tweakSnapshotError(entry) {
  if (entry?.checked === false || !['enabled', 'disabled'].includes(entry?.currentState)) {
    return 'The current state could not be verified.';
  }
  const type = String(entry.containerType || entry.container_type || '').replace(/-/g, '_');
  if (type === 'range_selection' && !Number.isFinite(entry.currentValue)) return 'Range value is missing.';
  if (type === 'one_shot_selection' && !String(entry.selectedOption || '').trim()) return 'Selected option is missing.';
  if (type === 'timer_resolution' && entry.currentState === 'enabled' && !String(entry.selectedResolution || '').trim()) return 'Timer resolution is missing.';
  return '';
}
module.exports = { tweakSnapshotError };
