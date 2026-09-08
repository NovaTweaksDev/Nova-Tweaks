const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BLOCKED_SECURITY_TWEAK_IDS,
  isBlockedSecurityTweak,
  isBlockedSecurityTweakId,
  isBlockedSecurityTweakScriptName
} = require('./blockedSecurityTweaks');

test('blocks every security tweak removed from the local catalog', () => {
  assert.deepEqual([...BLOCKED_SECURITY_TWEAK_IDS].sort(), [
    'enable_defender_pua_protection',
    'enable_defender_real_time_protection',
    'enable_smartscreen_protection',
    'enable_windows_firewall'
  ]);

  for (const tweakId of BLOCKED_SECURITY_TWEAK_IDS) {
    assert.equal(isBlockedSecurityTweakId(tweakId), true);
    assert.equal(isBlockedSecurityTweakScriptName(`${tweakId}/${tweakId}.ps1`), true);
  }

  assert.equal(isBlockedSecurityTweak({ name: 'Enable Windows Firewall' }), true);
});

test('does not block unrelated tweak IDs or script paths', () => {
  assert.equal(isBlockedSecurityTweakId('update_defender_signatures'), false);
  assert.equal(isBlockedSecurityTweak({ name: 'Update Defender Signatures' }), false);
  assert.equal(isBlockedSecurityTweakScriptName('update_defender_signatures/update_defender_signatures.ps1'), false);
});
