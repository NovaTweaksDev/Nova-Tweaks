const BLOCKED_SECURITY_TWEAK_IDS = new Set([
  'enable_defender_real_time_protection',
  'enable_defender_pua_protection',
  'enable_smartscreen_protection',
  'enable_windows_firewall'
]);
const BLOCKED_SECURITY_TWEAK_NAMES = new Set([
  'enable defender real-time protection',
  'enable defender pua protection',
  'enable smartscreen protection',
  'enable windows firewall'
]);

function normalizeTweakId(value) {
  return String(value || '').trim().toLowerCase();
}

function isBlockedSecurityTweakId(tweakId) {
  return BLOCKED_SECURITY_TWEAK_IDS.has(normalizeTweakId(tweakId));
}

function isBlockedSecurityTweak(tweak) {
  if (typeof tweak === 'string') {
    return isBlockedSecurityTweakId(tweak);
  }

  if (!tweak || typeof tweak !== 'object') {
    return false;
  }

  if (isBlockedSecurityTweakId(tweak.id || tweak.tweak_id)) {
    return true;
  }

  const name = String(tweak.name || tweak.exact_name || '').trim().toLowerCase();
  return BLOCKED_SECURITY_TWEAK_NAMES.has(name);
}

function isBlockedSecurityTweakScriptName(scriptName) {
  const normalized = String(scriptName || '').trim().replace(/\\/g, '/');
  const [tweakId] = normalized.split('/');
  return isBlockedSecurityTweakId(tweakId);
}

module.exports = {
  BLOCKED_SECURITY_TWEAK_IDS,
  BLOCKED_SECURITY_TWEAK_NAMES,
  isBlockedSecurityTweak,
  isBlockedSecurityTweakId,
  isBlockedSecurityTweakScriptName
};
