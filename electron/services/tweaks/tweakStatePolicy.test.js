const test = require('node:test');
const assert = require('node:assert/strict');
const { requiresTweakStateCheck } = require('./tweakStatePolicy');

test('checks one-shot selections only when their catalog metadata enables detection', () => {
  assert.equal(requiresTweakStateCheck({
    containerType: 'one_shot_selection',
    supportsStatusDetection: true
  }), true);
  assert.equal(requiresTweakStateCheck({
    container_type: 'one-shot-selection',
    supports_status_detection: true
  }), true);
  assert.equal(requiresTweakStateCheck({
    containerType: 'oneshotselection',
    supportsStatusDetection: true
  }), true);
  assert.equal(requiresTweakStateCheck({
    containerType: 'one_shot_selection',
    supportsStatusDetection: false
  }), false);
  assert.equal(requiresTweakStateCheck({
    containerType: 'one_shot_selection'
  }), false);
});

test('keeps actions and fixes stateless while preserving checks for stateful containers', () => {
  assert.equal(requiresTweakStateCheck({ containerType: 'one_shot_action' }), false);
  assert.equal(requiresTweakStateCheck({ containerType: 'one_shot_actions' }), false);
  assert.equal(requiresTweakStateCheck({ containerType: 'fix' }), false);
  assert.equal(requiresTweakStateCheck({ containerType: 'normal_tweak' }), true);
  assert.equal(requiresTweakStateCheck({ containerType: 'timer_resolution' }), true);
});
