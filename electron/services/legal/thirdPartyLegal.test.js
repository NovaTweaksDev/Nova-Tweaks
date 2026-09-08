const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const { resolveThirdPartyNoticesPath } = require('./thirdPartyLegal');

test('resolves the checked-in notice file during development', () => {
  assert.equal(
    resolveThirdPartyNoticesPath({
      isPackaged: false,
      appPath: path.join('C:', 'repo'),
      resourcesPath: path.join('C:', 'ignored')
    }),
    path.resolve(path.join('C:', 'repo'), 'THIRD-PARTY-NOTICES.md')
  );
});

test('resolves the notice beside the packaged executable', () => {
  assert.equal(
    resolveThirdPartyNoticesPath({
      isPackaged: true,
      appPath: path.join('C:', 'app', 'resources', 'app.asar'),
      resourcesPath: path.join('C:', 'app', 'resources')
    }),
    path.resolve(path.join('C:', 'app'), 'THIRD-PARTY-NOTICES.md')
  );
});
