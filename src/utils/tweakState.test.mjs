import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTweakState, isTweakStateBlocked, takeAdminStateRetryTargets } from './tweakState.mjs';

const verified = { id: 'test', checked: true, stateCheckStatus: 'verified', currentState: 'enabled',
  selectedOption: 'Balanced', currentValue: 0, selectedResolution: '0.5', currentResolution: '0.5' };
const failed = { id: 'test', checked: false, stateCheckStatus: 'failed', currentState: null, stateCheckError: { code: 'SCRIPT_TIMEOUT' } };

test('a startup permission failure is retried once after admin approval', () => {
  const attempted = new Set();
  const dynamicTick = { ...failed, id: 'disable_dynamic_tick', stateCheckError: { code: 'ADMIN_BROKER_APPROVAL_REQUIRED' } };
  assert.deepEqual(takeAdminStateRetryTargets([dynamicTick], false, attempted), []);
  assert.equal(attempted.size, 0);
  assert.deepEqual(takeAdminStateRetryTargets([dynamicTick], true, attempted), [dynamicTick]);
  assert.deepEqual(takeAdminStateRetryTargets([dynamicTick], true, attempted), []);
});

test('late permission failures are recovered without retrying unrelated or verified states', () => {
  const attempted = new Set();
  assert.deepEqual(takeAdminStateRetryTargets([], true, attempted), []);
  const adminFailure = { ...failed, id: 'late', stateCheckError: { code: 'ADMIN_REQUIRED' } };
  const verifiedAdmin = { ...verified, stateCheckError: { code: 'ADMIN_REQUIRED' } };
  const pendingAdmin = { ...adminFailure, id: 'pending', stateCheckStatus: 'pending' };
  const targets = takeAdminStateRetryTargets([failed, verifiedAdmin, pendingAdmin, adminFailure, adminFailure], true, attempted);
  assert.deepEqual(targets, [adminFailure]);
  assert.equal(adminFailure.currentState, null);
});

test('a new administrator session allows one new retry after a failed recovery', () => {
  const attempted = new Set();
  const adminFailure = { ...failed, stateCheckError: { code: 'ADMIN_REQUIRED' } };
  assert.equal(takeAdminStateRetryTargets([adminFailure], true, attempted).length, 1);
  assert.equal(takeAdminStateRetryTargets([adminFailure], true, attempted).length, 0);
  takeAdminStateRetryTargets([adminFailure], false, attempted);
  assert.equal(takeAdminStateRetryTargets([adminFailure], true, attempted).length, 1);
});

test('failed first check stays unknown; an explicitly disabled result stays verified', () => {
  const result = mergeTweakState(failed, null, true);
  assert.equal(result.currentState, null);
  assert.equal(result.lastConfirmedState, null);
  assert.equal(isTweakStateBlocked(result), true);
  const disabled = mergeTweakState({ ...verified, currentState: 'disabled' }, result, true);
  assert.equal(disabled.currentState, 'disabled');
  assert.equal(disabled.checked, true);
  assert.equal(isTweakStateBlocked(disabled), false);
});

test('a failed check retains all previously confirmed values, including zero', () => {
  const pending = mergeTweakState({ ...verified, checked: false, stateCheckStatus: 'pending' }, verified, true);
  const result = mergeTweakState(failed, pending, true);
  assert.deepEqual(result.lastConfirmedState, { currentState: 'enabled', selectedOption: 'Balanced', currentValue: 0, selectedResolution: '0.5', currentResolution: '0.5' });
  assert.equal(result.currentState, null);
  assert.equal(result.selectedOption, '');
  assert.equal(result.stateCheckError.code, 'SCRIPT_TIMEOUT');
  assert.equal(isTweakStateBlocked(result), true);
});

test('catalog metadata cannot reset a failed check or the last confirmed state', () => {
  const previous = mergeTweakState(failed, verified, true);
  const result = mergeTweakState({ id: 'test', currentState: 'disabled', name: 'Renamed' }, previous, false);
  assert.equal(result.name, 'Renamed');
  assert.equal(result.currentState, null);
  assert.equal(result.stateCheckStatus, 'failed');
  assert.equal(result.lastConfirmedState.currentState, 'enabled');
});

test('unsupported detection and stateless actions do not acquire a failed-check lock', () => {
  for (const incoming of [{ containerType: 'one_shot_action' }, { containerType: 'fix' }, { supportsStatusDetection: false, checked: false }]) {
    const result = mergeTweakState(incoming, null, true);
    assert.equal(result.stateCheckStatus, 'unsupported');
    assert.equal(isTweakStateBlocked(result), false);
  }
});
