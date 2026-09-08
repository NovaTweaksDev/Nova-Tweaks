const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  EXPECTED_CRITICAL_RUNTIME_SHA256,
  assertMonitoringRuntimeIntegrity,
  computeCriticalRuntimeSha256,
  runtimeRootForExecutable
} = require('./monitoringIntegrity');

function createRuntimeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-monitoring-integrity-'));
  fs.mkdirSync(path.join(root, 'patched'), { recursive: true });
  fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.exe'), 'app-host');
  fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.dll'), 'application');
  fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.deps.json'), '{}');
  fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.config'), 'mutable');

  return root;
}

test('accepts exactly the pinned set of monitoring runtime binaries', () => {
  const root = createRuntimeFixture();
  try {
    const expected = computeCriticalRuntimeSha256(root);
    assert.equal(assertMonitoringRuntimeIntegrity(root, expected), true);
    assert.equal(
      runtimeRootForExecutable(path.join(root, 'patched', 'LibreHardwareMonitor.exe')),
      root
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects modified and additional executable runtime content', () => {
  const root = createRuntimeFixture();
  try {
    const expected = computeCriticalRuntimeSha256(root);
    fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.dll'), 'tampered');
    assert.throws(
      () => assertMonitoringRuntimeIntegrity(root, expected),
      { code: 'MONITORING_RUNTIME_INTEGRITY_INVALID' }
    );

    fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.dll'), 'application');
    fs.writeFileSync(path.join(root, 'patched', 'unexpected.dll'), 'unexpected');
    assert.throws(
      () => assertMonitoringRuntimeIntegrity(root, expected),
      { code: 'MONITORING_RUNTIME_INTEGRITY_INVALID' }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('allows the generated LHM settings file to change without trusting new code', () => {
  const root = createRuntimeFixture();
  try {
    const expected = computeCriticalRuntimeSha256(root);
    fs.writeFileSync(path.join(root, 'patched', 'LibreHardwareMonitor.config'), 'updated');
    assert.equal(assertMonitoringRuntimeIntegrity(root, expected), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the checked-in monitoring runtime matches the pinned production digest', () => {
  const runtimeRoot = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'resources',
    'monitoring',
    'LibreHardwareMonitor'
  );
  assert.equal(
    computeCriticalRuntimeSha256(runtimeRoot),
    EXPECTED_CRITICAL_RUNTIME_SHA256
  );
});
