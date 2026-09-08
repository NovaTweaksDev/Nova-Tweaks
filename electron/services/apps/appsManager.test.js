const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AppsManagerError,
  isStartupAccessDeniedError
} = require('./appsManager');

test('classifies localized PowerShell access-denied failures for startup toggles', () => {
  const englishError = new AppsManagerError('PowerShell command failed.', 'APPS_POWERSHELL_FAILED', {
    stderr: 'New-ItemProperty: Requested registry access is not allowed.'
  });
  const germanError = new AppsManagerError('PowerShell command failed.', 'APPS_POWERSHELL_FAILED', {
    stderr: 'Disable-ScheduledTask: Zugriff verweigert (0x80070005).'
  });

  assert.equal(isStartupAccessDeniedError(englishError), true);
  assert.equal(isStartupAccessDeniedError(germanError), true);
});

test('does not classify unrelated PowerShell failures as access denied', () => {
  const error = new AppsManagerError('PowerShell command failed.', 'APPS_POWERSHELL_FAILED', {
    stderr: 'The requested scheduled task was not found.'
  });

  assert.equal(isStartupAccessDeniedError(error), false);
  assert.equal(isStartupAccessDeniedError(new Error('Access is denied')), false);
});
