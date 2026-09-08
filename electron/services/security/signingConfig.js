function loadGeneratedConfig() {
  try {
    return require('../../generated/signing-config');
  } catch (_error) {
    return {};
  }
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function boolString(...values) {
  return firstString(...values).toLowerCase() === 'true';
}

function parseKeyCollection(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.includes('BEGIN PUBLIC KEY')) return [raw.replace(/\\n/g, '\n')];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Object.values(parsed || {});
  } catch (_error) {
    return [];
  }
}

function uniqueKeys(...values) {
  return [...new Set(values.flatMap(parseKeyCollection).map((value) => String(value || '').replace(/\\n/g, '\n').trim()).filter(Boolean))];
}

function getArtifactPublicKey() {
  const generated = loadGeneratedConfig();
  return firstString(
    generated.NOVA_ARTIFACT_PUBLIC_KEY,
    process.env.NOVA_ARTIFACT_PUBLIC_KEY
  );
}

function getArtifactPublicKeys() {
  const generated = loadGeneratedConfig();
  return uniqueKeys(
    generated.NOVA_ARTIFACT_PUBLIC_KEY,
    process.env.NOVA_ARTIFACT_PUBLIC_KEY,
    generated.NOVA_ARTIFACT_PUBLIC_KEYS,
    process.env.NOVA_ARTIFACT_PUBLIC_KEYS
  );
}

function getTweakPublicKey() {
  const generated = loadGeneratedConfig();
  return firstString(
    generated.NOVA_TWEAK_PUBLIC_KEY,
    process.env.NOVA_TWEAK_PUBLIC_KEY,
    generated.NOVA_ARTIFACT_PUBLIC_KEY,
    process.env.NOVA_ARTIFACT_PUBLIC_KEY
  );
}

function getTweakPublicKeys() {
  const generated = loadGeneratedConfig();
  return uniqueKeys(
    generated.NOVA_TWEAK_PUBLIC_KEY,
    process.env.NOVA_TWEAK_PUBLIC_KEY,
    generated.NOVA_TWEAK_PUBLIC_KEYS,
    process.env.NOVA_TWEAK_PUBLIC_KEYS,
    getArtifactPublicKeys()
  );
}

function getUpdatePublicKey() {
  const generated = loadGeneratedConfig();
  return firstString(
    generated.NOVA_UPDATE_PUBLIC_KEY,
    process.env.NOVA_UPDATE_PUBLIC_KEY,
    generated.NOVA_ARTIFACT_PUBLIC_KEY,
    process.env.NOVA_ARTIFACT_PUBLIC_KEY
  );
}

function getUpdatePublicKeys() {
  const generated = loadGeneratedConfig();
  return uniqueKeys(
    generated.NOVA_UPDATE_PUBLIC_KEY,
    process.env.NOVA_UPDATE_PUBLIC_KEY,
    generated.NOVA_UPDATE_PUBLIC_KEYS,
    process.env.NOVA_UPDATE_PUBLIC_KEYS,
    getArtifactPublicKeys()
  );
}

function requireTweakSignatures() {
  const generated = loadGeneratedConfig();
  return boolString(generated.NOVA_REQUIRE_TWEAK_SIGNATURES, process.env.NOVA_REQUIRE_TWEAK_SIGNATURES);
}

function requireUpdateSignatures() {
  const generated = loadGeneratedConfig();
  return boolString(generated.NOVA_REQUIRE_UPDATE_SIGNATURES, process.env.NOVA_REQUIRE_UPDATE_SIGNATURES);
}

module.exports = {
  getArtifactPublicKey,
  getArtifactPublicKeys,
  getTweakPublicKey,
  getTweakPublicKeys,
  getUpdatePublicKey,
  getUpdatePublicKeys,
  requireTweakSignatures,
  requireUpdateSignatures
};
