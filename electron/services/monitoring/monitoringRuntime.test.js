const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { prepareMsixLhmRuntime } = require('./monitoringRuntime');
const { computeCriticalRuntimeSha256 } = require('./monitoringIntegrity');

test('bundled LibreHardwareMonitor targets the supported .NET 8 desktop runtime', () => {
  const runtimeConfigPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'resources',
    'monitoring',
    'LibreHardwareMonitor',
    'patched',
    'LibreHardwareMonitor.runtimeconfig.json'
  );
  const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
  const frameworks = runtimeConfig?.runtimeOptions?.frameworks || [];

  assert.deepEqual(
    frameworks.map((entry) => ({ name: entry.name, major: String(entry.version || '').split('.')[0] })),
    [
      { name: 'Microsoft.NETCore.App', major: '8' },
      { name: 'Microsoft.WindowsDesktop.App', major: '8' }
    ]
  );
});

test('bundled LibreHardwareMonitor does not expose sensor data to arbitrary browser origins', () => {
  const sourcePath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'resources',
    'monitoring',
    'LibreHardwareMonitor',
    'LibreHardwareMonitor',
    'Utilities',
    'HttpServer.cs'
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.equal(source.includes('Access-Control-Allow-Origin", "*"'), false);
});

test('Nova requires authentication for the bundled LibreHardwareMonitor loopback server', () => {
  const managerPath = path.join(__dirname, 'monitoringManager.js');
  const source = fs.readFileSync(managerPath, 'utf8');

  assert.match(source, /listenerIp:\s*'127\.0\.0\.1'/);
  assert.match(source, /authenticationEnabled:\s*'true'/);
  assert.match(source, /authenticationUserName:/);
  assert.match(source, /authenticationPassword:/);
});

test('bundled LibreHardwareMonitor headless mode hides both taskbar and tray UI', () => {
  const sourcePath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'resources',
    'monitoring',
    'LibreHardwareMonitor',
    'LibreHardwareMonitor',
    'UI',
    'MainForm.cs'
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const systemTrayPath = path.join(path.dirname(sourcePath), 'SystemTray.cs');
  const systemTraySource = fs.readFileSync(systemTrayPath, 'utf8');
  const managerSource = fs.readFileSync(path.join(__dirname, 'monitoringManager.js'), 'utf8');
  const headlessBlock = source.match(/if\s*\(_runHeadless\)\s*\{([\s\S]*?)\r?\n\s*\}\s*else if/)?.[1] || '';

  assert.ok(
    source.indexOf('_runHeadless = IsHeadlessMode();') < source.indexOf('InitializeComponent();'),
    'Headless mode must be known before WinForms initializes the window.'
  );
  assert.match(source, /new SystemTray\(_computer, _settings, _unitManager, _runHeadless\)/);
  assert.match(source, /--nova-headless/);
  assert.match(managerSource, /spawn\(executablePath, \[LHM_HEADLESS_ARGUMENT\]/);
  assert.match(managerSource, /-ArgumentList '\$\{LHM_HEADLESS_ARGUMENT\}'/);
  assert.match(systemTraySource, /if\s*\(_suppressIcons\)\s*\r?\n\s*return/);
  assert.match(headlessBlock, /ShowInTaskbar\s*=\s*false/);
  assert.match(headlessBlock, /_systemTray\.IsMainIconEnabled\s*=\s*false/);
  assert.match(headlessBlock, /Visible\s*=\s*false/);
  assert.doesNotMatch(headlessBlock, /Show\(\)|Hide\(\)/);
  assert.match(source, /SetVisibleCore\(bool value\)[\s\S]*?base\.SetVisibleCore\(_runHeadless \? false : value\)/);
});

test('bundled LibreHardwareMonitor inherits elevation from the session broker', () => {
  const manifestPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'resources',
    'monitoring',
    'LibreHardwareMonitor',
    'LibreHardwareMonitor',
    'Resources',
    'app.manifest'
  );
  const manifest = fs.readFileSync(manifestPath, 'utf8');

  assert.match(manifest, /requestedExecutionLevel\s+level="asInvoker"/);
  assert.doesNotMatch(manifest, /requestedExecutionLevel\s+level="requireAdministrator"/);
});


function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-msix-monitoring-'));
  const resourcesPath = path.join(root, 'package-resources');
  const source = path.join(resourcesPath, 'resources', 'monitoring', 'LibreHardwareMonitor');
  const userData = path.join(root, 'user-data');

  fs.mkdirSync(path.join(source, 'patched'), { recursive: true });
  fs.writeFileSync(path.join(source, 'patched', 'LibreHardwareMonitor.exe'), 'lhm');


  return {
    root,
    resourcesPath,
    source,
    expectedRuntimeSha256: computeCriticalRuntimeSha256(source),
    app: {
      getPath(name) {
        assert.equal(name, 'userData');
        return userData;
      },
      getVersion() {
        return '0.9.0';
      }
    }
  };
}

test('copies the MSIX monitoring runtime to versioned writable app data and reuses it', () => {
  const fixture = createFixture();

  try {
    const first = prepareMsixLhmRuntime({
      app: fixture.app,
      resourcesPath: fixture.resourcesPath,
      isWindowsStore: true,
      expectedRuntimeSha256: fixture.expectedRuntimeSha256
    });
    const second = prepareMsixLhmRuntime({
      app: fixture.app,
      resourcesPath: fixture.resourcesPath,
      isWindowsStore: true,
      expectedRuntimeSha256: fixture.expectedRuntimeSha256
    });

    assert.equal(first, second);
    assert.equal(
      first,
      path.join(fixture.root, 'user-data', 'msix-runtime', '0.9.0', 'monitoring', 'LibreHardwareMonitor')
    );
    assert.equal(fs.readFileSync(path.join(first, 'patched', 'LibreHardwareMonitor.exe'), 'utf8'), 'lhm');

    assert.equal(fs.existsSync(path.join(first, '.nova-msix-runtime.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.source, '.nova-msix-runtime.json')), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('replaces an incomplete version directory only after a complete copy is ready', () => {
  const fixture = createFixture();
  const incomplete = path.join(
    fixture.root,
    'user-data',
    'msix-runtime',
    '0.9.0',
    'monitoring',
    'LibreHardwareMonitor'
  );

  try {
    fs.mkdirSync(incomplete, { recursive: true });
    fs.writeFileSync(path.join(incomplete, 'partial.txt'), 'incomplete');

    const result = prepareMsixLhmRuntime({
      app: fixture.app,
      resourcesPath: fixture.resourcesPath,
      isWindowsStore: true,
      expectedRuntimeSha256: fixture.expectedRuntimeSha256
    });

    assert.equal(result, incomplete);
    assert.equal(fs.existsSync(path.join(result, 'partial.txt')), false);
    assert.equal(fs.existsSync(path.join(result, '.nova-msix-runtime.json')), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('replaces a previously copied runtime after executable tampering', () => {
  const fixture = createFixture();

  try {
    const result = prepareMsixLhmRuntime({
      app: fixture.app,
      resourcesPath: fixture.resourcesPath,
      isWindowsStore: true,
      expectedRuntimeSha256: fixture.expectedRuntimeSha256
    });
    const executablePath = path.join(result, 'patched', 'LibreHardwareMonitor.exe');
    fs.writeFileSync(executablePath, 'tampered');

    const repaired = prepareMsixLhmRuntime({
      app: fixture.app,
      resourcesPath: fixture.resourcesPath,
      isWindowsStore: true,
      expectedRuntimeSha256: fixture.expectedRuntimeSha256
    });

    assert.equal(repaired, result);
    assert.equal(fs.readFileSync(executablePath, 'utf8'), 'lhm');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('does not copy monitoring resources outside the MSIX runtime', () => {
  const fixture = createFixture();

  try {
    const result = prepareMsixLhmRuntime({
      app: fixture.app,
      resourcesPath: fixture.resourcesPath,
      isWindowsStore: false
    });

    assert.equal(result, null);
    assert.equal(fs.existsSync(path.join(fixture.root, 'user-data')), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
