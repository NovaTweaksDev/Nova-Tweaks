import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOneClickOptimizationForTab,
  getOneClickOptimizationTargets,
  partitionOneClickOptimizationTargets
} from './oneClickOptimizations.mjs';

const tweaks = [
  { id: 'cleanup', category: 'General', subcategory: 'Cleanup', recommended: true, containerType: 'one_shot_action' },
  { id: 'maintenance', category: 'General', subcategory: 'Maintenance', recommended: true, containerType: 'fix' },
  { id: 'network-dns', category: 'Network', subcategory: 'DNS', recommended: true, containerType: 'normal_tweak' },
  { id: 'network-adapter', category: 'Network', subcategory: 'Adapter', recommended: false, containerType: 'normal_tweak' },
  { id: 'storage-active', category: 'Hardware', subcategory: 'Storage', recommended: true, containerType: 'normal_tweak', currentState: 'enabled' },
  { id: 'storage-repeatable', category: 'Hardware', subcategory: 'Storage', recommended: true, containerType: 'one_shot_action', currentState: 'enabled' },
  { id: 'cpu', category: 'Hardware', subcategory: 'CPU', recommended: false, containerType: 'normal_tweak' }
];

test('resolves only the four supported tab contexts', () => {
  assert.equal(getOneClickOptimizationForTab('General', 'Cleanup')?.id, 'cleanup');
  assert.equal(getOneClickOptimizationForTab('Network', 'DNS')?.id, 'network');
  assert.equal(getOneClickOptimizationForTab('Hardware', 'CPU')?.id, 'cpu');
  assert.equal(getOneClickOptimizationForTab('Hardware', 'Storage')?.id, 'storage');
  assert.equal(getOneClickOptimizationForTab('General', 'System'), null);
});

test('selects recommended tweaks from the exact optimization scope', () => {
  assert.deepEqual(getOneClickOptimizationTargets(tweaks, 'cleanup').map((tweak) => tweak.id), ['cleanup']);
  assert.deepEqual(getOneClickOptimizationTargets(tweaks, 'network').map((tweak) => tweak.id), ['network-dns']);
  assert.deepEqual(getOneClickOptimizationTargets(tweaks, 'storage').map((tweak) => tweak.id), ['storage-active', 'storage-repeatable']);
  assert.deepEqual(getOneClickOptimizationTargets(tweaks, 'cpu'), []);
});

test('skips enabled toggles but keeps repeatable actions runnable', () => {
  const result = partitionOneClickOptimizationTargets(tweaks, 'storage');
  assert.deepEqual(result.runnable.map((tweak) => tweak.id), ['storage-repeatable']);
  assert.deepEqual(result.alreadyApplied.map((tweak) => tweak.id), ['storage-active']);
});
