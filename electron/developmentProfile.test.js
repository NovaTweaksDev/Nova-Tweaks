const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const configureProfile = main.slice(main.indexOf('const isPackagedSmoke ='), main.indexOf('const PRODUCT_NAME ='));

function profile({ packaged = false, smoke = false, smokePath } = {}) {
  const paths = { appData: path.resolve('test-appdata'), userData: path.resolve('test-appdata', 'Nova Tweaks') };
  const writes = [];
  vm.runInNewContext(configureProfile, {
    path,
    process: { argv: smoke ? ['--nova-packaged-smoke'] : [], env: { NOVA_SMOKE_USER_DATA: smokePath } },
    app: {
      isPackaged: packaged,
      getPath: name => paths[name],
      setPath(name, value) { paths[name] = value; writes.push(name); }
    }
  });
  return { paths, writes };
}

test('development uses its own user and session profile to avoid the installed single-instance lock', () => {
  const dev = profile();
  const installed = profile({ packaged: true });
  assert.notEqual(dev.paths.userData, installed.paths.userData);
  assert.equal(dev.paths.userData, path.join(dev.paths.appData, 'Nova Tweaks Development'));
  assert.equal(dev.paths.sessionData, dev.paths.userData);
  assert.deepEqual(installed.writes, [], 'installed profile configuration remains unchanged');
});

test('the smoke-test profile takes precedence in packaged and development runs', () => {
  for (const packaged of [false, true]) {
    const smokePath = path.resolve('test-smoke-profile');
    const smoke = profile({ packaged, smoke: true, smokePath });
    assert.equal(smoke.paths.userData, smokePath);
    assert.equal(smoke.paths.sessionData, smokePath);
  }
  assert.throws(() => profile({ smoke: true }), /Smoke user-data directory is required/);
});
