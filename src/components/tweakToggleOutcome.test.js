const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const card = fs.readFileSync(path.join(__dirname, 'UnifiedTweakCard.jsx'), 'utf8');
const toggleSource = card.slice(card.indexOf('  async function toggle('), card.indexOf('  async function execute('));
const mascot = fs.readFileSync(path.join(__dirname, 'MascotToggle.jsx'), 'utf8');
const mascotSource = mascot.slice(mascot.indexOf('  async function handleToggle('), mascot.indexOf('  const visibleChecked'));

for (const initial of [false, true]) {
  for (const state of ['enabled', 'disabled', undefined]) {
    test(`card forwards ${state || 'missing state'} after ${initial ? 'disable' : 'enable'} without overriding parent state`, async () => {
      const result = { ok: true, ...(state ? { currentState: state } : {}) };
      let loading = false;
      let localStateWrites = 0;
      const context = {
        tweak: { id: 'test' }, enabled: initial, actionDisabled: false,
        setLoading: (value) => { loading = value; },
        // The former implementation used this setter to overwrite an explicit disabled result.
        setEnabled: (value) => { localStateWrites += 1; context.enabled = value; },
        onToggle: async (_tweak, nextEnabled, options) => {
          assert.equal(nextEnabled, !initial);
          assert.equal(options.suppressNotifications, true);
          assert.equal(loading, true);
          context.enabled = state ? state === 'enabled' : nextEnabled;
          return result;
        }
      };
      const toggle = vm.runInNewContext(`${toggleSource}\ntoggle;`, context);
      assert.equal(await toggle(!initial, { suppressNotifications: true }), result);
      assert.equal(context.enabled, state ? state === 'enabled' : !initial);
      assert.equal(localStateWrites, 0);
      assert.equal(loading, false);
    });
  }
}

test('card releases its loading state when the parent action rejects', async () => {
  let loading;
  const context = { enabled: false, actionDisabled: false, tweak: { id: 'test' },
    setLoading: (value) => { loading = value; }, onToggle: async () => { throw new Error('failed'); } };
  const toggle = vm.runInNewContext(`${toggleSource}\ntoggle;`, context);
  await assert.rejects(toggle(true), /failed/);
  assert.equal(loading, false);
});

for (const state of ['enabled', 'disabled', undefined]) {
  test(`mascot activation respects ${state || 'missing state'} and completes deferred feedback`, async () => {
    let timers = 0;
    let animated = false;
    let completed = 0;
    const context = {
      disabled: false, isAnimating: false, shouldReduceMotion: false,
      interactionLockRef: { current: false }, deferredSuccessRef: { current: null },
      pushTimerRef: { current: null }, completionTimerRef: { current: null },
      onChange: async () => ({ ok: true, ...(state ? { currentState: state } : {}), completeDeferredSuccess: () => { completed += 1; } }),
      setHasReachedPushFrame: () => {}, setAnimationRunId: () => {},
      setIsAnimating: (value) => { animated = value; }, completeAnimation: () => {},
      PUSH_TRIGGER_MS: 3200, ANIMATION_FALLBACK_MS: 6000,
      window: { setTimeout: () => { timers += 1; return timers; } }
    };
    const handleToggle = vm.runInNewContext(`${mascotSource}\nhandleToggle;`, context);
    await handleToggle(true);
    if (state === 'disabled') {
      assert.equal(animated, false);
      assert.equal(timers, 0);
      assert.equal(context.interactionLockRef.current, false);
      assert.equal(completed, 1);
    } else {
      assert.equal(animated, true);
      assert.equal(timers, 2);
      assert.equal(completed, 0);
      context.deferredSuccessRef.current();
      assert.equal(completed, 1);
    }
  });
}
