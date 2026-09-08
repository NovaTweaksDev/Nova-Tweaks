const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProfiles,
  findOptimizationProfile,
  toProfileSummary
} = require('./appOptimizationCatalog');

const env = {
  LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
  APPDATA: 'C:\\Users\\Test\\AppData\\Roaming'
};

const cases = [
  ['Google Chrome', 'Google LLC', 'chrome.exe', 'chrome'],
  ['Microsoft Edge', 'Microsoft Corporation', 'msedge.exe', 'edge'],
  ['Mozilla Firefox', 'Mozilla', 'firefox.exe', 'firefox'],
  ['Brave', 'Brave Software', 'brave.exe', 'brave'],
  ['Opera Stable', 'Opera Software', 'opera.exe', 'opera'],
  ['Vivaldi', 'Vivaldi Technologies', 'vivaldi.exe', 'vivaldi'],
  ['Discord', 'Discord Inc.', 'Discord.exe', 'discord'],
  ['Steam', 'Valve Corporation', 'steam.exe', 'steam'],
  ['Spotify', 'Spotify AB', 'Spotify.exe', 'spotify'],
  ['OBS Studio', 'OBS Project', 'obs64.exe', 'obs-studio']
];

for (const [name, publisher, executable, expectedProfile] of cases) {
  test(`matches ${name} to its stable optimization profile`, () => {
    const result = findOptimizationProfile({
      name,
      publisher,
      executablePath: `C:\\Program Files\\${name}\\${executable}`
    }, env);
    assert.equal(result?.id, expectedProfile);
  });
}

test('does not match a similarly named app from an unrelated publisher', () => {
  const result = findOptimizationProfile({
    name: 'Chrome Theme Builder',
    publisher: 'Example Corp',
    executablePath: 'C:\\Apps\\theme.exe'
  }, env);
  assert.equal(result, null);
});

test('does not treat Edge WebView or NVIDIA driver components as end-user apps', () => {
  assert.equal(findOptimizationProfile({
    name: 'Microsoft Edge WebView2 Runtime',
    publisher: 'Microsoft Corporation',
    executablePath: 'C:\\Program Files\\EdgeWebView\\msedgewebview2.exe'
  }, env), null);
  assert.equal(findOptimizationProfile({
    name: 'NVIDIA App driver settings',
    publisher: 'NVIDIA Corporation'
  }, env), null);
});

test('does not treat Steam-launched games as the Steam client', () => {
  assert.equal(findOptimizationProfile({
    name: 'Dying Light: The Beast',
    publisher: 'Techland',
    iconPath: 'C:\\Program Files (x86)\\Steam\\steam.exe'
  }, env), null);
});

test('counts multiple cache roots as one user-facing cleanup action', () => {
  const discord = buildProfiles(env).find((entry) => entry.id === 'discord');
  const summary = toProfileSummary(discord);
  assert.equal(summary.availableCount, 4);
  assert.equal(summary.recommendedCount, 2);
  assert.equal(summary.analyzed, false);
  assert.deepEqual(
    summary.actions.map((entry) => [entry.id, entry.needsChange]),
    [
      ['discord.hardwareAcceleration', null],
      ['discord.minimizeToTray', null],
      ['cache.cleanup', null],
      ['startup.disable', null]
    ]
  );
});

test('exposes Discord settings as optional reversible optimizations', () => {
  const discord = buildProfiles(env).find((entry) => entry.id === 'discord');
  assert.deepEqual(
    discord.settings.map((entry) => [entry.id, entry.recommended, entry.requiresClose]),
    [
      ['discord.hardwareAcceleration', false, true],
      ['discord.minimizeToTray', false, true]
    ]
  );
});

test('keeps status-only profiles visible without claiming automatic actions', () => {
  const onedrive = buildProfiles(env).find((entry) => entry.id === 'onedrive');
  const summary = toProfileSummary(onedrive);
  assert.equal(summary.profileId, 'onedrive');
  assert.equal(summary.status, 'status-only');
  assert.equal(summary.supported, false);
});
