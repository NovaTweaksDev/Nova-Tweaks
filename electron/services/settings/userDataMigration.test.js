const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { migrateLegacyUserData } = require('./userDataMigration');

test('copies legacy user data once without changing the legacy directory', () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-user-data-migration-'));
  const legacyPath = path.join(appDataPath, 'Nova Tweaks Local');
  const currentPath = path.join(appDataPath, 'Nova Tweaks');
  fs.mkdirSync(path.join(legacyPath, 'settings'), { recursive: true });
  fs.writeFileSync(path.join(legacyPath, 'settings', 'settings.json'), '{"version":1}', 'utf8');

  try {
    const firstResult = migrateLegacyUserData({
      appDataPath,
      currentUserDataPath: currentPath,
      legacyDirectoryName: 'Nova Tweaks Local'
    });
    assert.equal(firstResult.migrated, true);
    assert.equal(fs.existsSync(path.join(legacyPath, 'settings', 'settings.json')), true);
    assert.equal(fs.readFileSync(path.join(currentPath, 'settings', 'settings.json'), 'utf8'), '{"version":1}');

    fs.writeFileSync(path.join(currentPath, 'marker.txt'), 'keep', 'utf8');
    const secondResult = migrateLegacyUserData({
      appDataPath,
      currentUserDataPath: currentPath,
      legacyDirectoryName: 'Nova Tweaks Local'
    });
    assert.equal(secondResult.migrated, false);
    assert.equal(fs.readFileSync(path.join(currentPath, 'marker.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
