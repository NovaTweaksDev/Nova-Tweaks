const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { memo } = require('react');

const card = fs.readFileSync(path.join(__dirname, 'UnifiedTweakCard.jsx'), 'utf8');
const wrapper = card.slice(card.indexOf('const MemoizedTweakCard ='));
const compiled = ts.transpileModule(wrapper.replace('export default TweakCard;', 'TweakCard;'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
}).outputText;

function setup() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const render = vm.runInNewContext(compiled, {
    require, exports: {}, memo, UnifiedTweakCard: () => null,
    useRef: (value) => slots[cursor++] ||= { current: value },
    useMemo: (factory) => slots[cursor++] ||= factory(),
    useLayoutEffect: (effect) => { effects.push(effect); }
  });
  return {
    render: (props) => { cursor = 0; return render(props); },
    commit: () => { effects.forEach(effect => effect()); effects = []; }
  };
}

test('unchanged card props remain stable across parent updates with new callbacks', () => {
  const view = setup();
  const tweak = { id: 'test', currentState: 'disabled' };
  const first = view.render({ tweak, disabled: false, onToggle: () => 'old' });
  view.commit();
  const next = view.render({ tweak, disabled: false, onToggle: () => 'new' });
  assert.deepEqual(next.props, first.props);
  assert.equal(next.props.onToggle(), 'old');
  view.commit();
  assert.equal(first.props.onToggle(), 'new');
});

test('action forwarding preserves arguments, async results, and optional actions', async () => {
  const view = setup();
  const tweak = { id: 'test' };
  const options = { suppressNotifications: true };
  const result = Promise.resolve({ ok: true, currentState: 'enabled' });
  const element = view.render({ tweak, onToggle: (...args) => {
    assert.deepEqual(args, [tweak, true, options]);
    return result;
  } });
  view.commit();
  assert.equal(element.props.onToggle(tweak, true, options), result);
  assert.equal(element.props.onRetryState(tweak), undefined);
  assert.equal((await result).currentState, 'enabled');
});

test('real state and selection changes still cross the memo boundary', () => {
  const view = setup();
  const first = view.render({ tweak: { id: 'test', currentState: 'disabled' }, isSelected: false });
  view.commit();
  const tweak = { id: 'test', currentState: 'enabled' };
  const next = view.render({ tweak, isSelected: true });
  view.commit();
  assert.equal(next.props.tweak, tweak);
  assert.equal(next.props.isSelected, true);
  assert.notDeepEqual(next.props, first.props);
});
