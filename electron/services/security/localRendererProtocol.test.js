const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const {
  LOCAL_RENDERER_URL,
  resolveLocalRendererPath
} = require('./localRendererProtocol');

test('local renderer protocol resolves files only inside the renderer root', () => {
  const root = path.resolve('C:\\app\\dist');

  assert.equal(
    resolveLocalRendererPath(root, LOCAL_RENDERER_URL),
    path.join(root, 'index.html')
  );
  assert.equal(
    resolveLocalRendererPath(root, 'nova-app://renderer/assets/index.js'),
    path.join(root, 'assets', 'index.js')
  );

  for (const rejectedUrl of [
    'nova-app://other/index.html',
    'nova-app://renderer/index.html?debug=true',
    'nova-app://renderer/%2e%2e%2fsecret.txt'
  ]) {
    assert.throws(
      () => resolveLocalRendererPath(root, rejectedUrl),
      /not allowed|escapes/
    );
  }
});
