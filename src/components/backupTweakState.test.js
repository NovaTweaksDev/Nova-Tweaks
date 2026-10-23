const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual snapshot builder without mounting the UI or writing backups.
const source = fs.readFileSync(path.join(__dirname, 'BackupRestorePanel.jsx'), 'utf8');
const snapshotSource = source.slice(source.indexOf('  function buildSnapshot('), source.indexOf('  function applyBackupState('));
const context = {
  appStateSnapshot: {}, settings: {}, normalizeOptionalNumber: (value) => value ?? null,
  isRegistryBackedTweakEntry: () => false,
  TIMER_SCOPE_SUBCATEGORIES: new Set(), SERVICE_SCOPE_SUBCATEGORIES: new Set(),
  BOOT_SCOPE_CATEGORIES: new Set(), BOOT_SCOPE_SUBCATEGORIES: new Set(),
  buildSection: (data, captureStatus) => ({ data, captureStatus })
};
const buildSnapshot = vm.runInNewContext(`${snapshotSource}\nbuildSnapshot;`, context);

test('manual backups omit unknown and unverified states and mark partial capture', () => {
  const snapshot = buildSnapshot(['tweakStates', 'powerPlans'], { tweaks: [
    { id: 'known', currentState: 'enabled', checked: true },
    { id: 'unknown', currentState: null, status: 'unknown', checked: false },
    { id: 'legacy-fallback', currentState: 'disabled', checked: false }
  ] });
  assert.deepEqual(Array.from(snapshot.tweakStates.data, (entry) => entry.id), ['known']);
  assert.equal(snapshot.tweakStates.captureStatus, 'partial');
  assert.equal(snapshot.powerPlans.data.length, 0);
  assert.equal(snapshot.powerPlans.captureStatus, 'complete');
});

test('a backup with no verified tweak states is unavailable rather than all-disabled', () => {
  const snapshot = buildSnapshot(['tweakStates'], { tweaks: [
    { id: 'unknown', currentState: null, status: 'unknown', checked: false }
  ] });
  assert.equal(snapshot.tweakStates.data.length, 0);
  assert.equal(snapshot.tweakStates.captureStatus, 'unavailable');
});
