const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const outputDir = path.join(root, 'electron', 'generated');
const outputPath = path.join(outputDir, 'signing-config.js');

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const index = trimmed.indexOf('=');
  if (index <= 0) {
    return null;
  }
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function readLocalEnv() {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map(parseEnvLine)
    .filter(Boolean)
    .reduce((values, entry) => {
      values[entry.key] = entry.value;
      return values;
    }, {});
}

function pick(values, key) {
  return String(process.env[key] || values[key] || '').trim();
}

function pickPublicKey(values, key) {
  const directValue = pick(values, key);
  if (directValue) {
    return directValue;
  }

  const filePath = pick(values, `${key}_FILE`);
  if (!filePath) {
    return '';
  }

  try {
    return fs.readFileSync(path.resolve(filePath), 'utf8').trim();
  } catch (error) {
    console.error(`Desktop signing config could not read ${key}_FILE: ${error.message}`);
    process.exit(1);
  }
}

function isTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function parsePublicKeyCollection(raw, label) {
  const value = String(raw || '').trim();
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    console.error(`${label} must be a JSON array or object containing PEM public keys.`);
    process.exit(1);
  }
  const source = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
  return source.map((entry) => String(entry || '').replace(/\\n/g, '\n').trim()).filter(Boolean);
}

function pickPublicKeys(values, key) {
  const direct = pick(values, key);
  const filePath = pick(values, `${key}_FILE`);
  let fileValue = '';
  if (filePath) {
    try {
      fileValue = fs.readFileSync(path.resolve(filePath), 'utf8');
    } catch (error) {
      console.error(`Desktop signing config could not read ${key}_FILE: ${error.message}`);
      process.exit(1);
    }
  }
  return [...new Set([
    ...parsePublicKeyCollection(direct, key),
    ...parsePublicKeyCollection(fileValue, `${key}_FILE`)
  ])];
}

function validatePublicKeys(keys, label) {
  for (const publicKey of keys) {
    try {
      if (crypto.createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') {
        throw new Error('key is not Ed25519');
      }
    } catch (error) {
      console.error(`${label} contains an invalid Ed25519 public key: ${error.message}`);
      process.exit(1);
    }
  }
}

const values = readLocalEnv();
const config = {
  NOVA_ARTIFACT_PUBLIC_KEY: pickPublicKey(values, 'NOVA_ARTIFACT_PUBLIC_KEY'),
  NOVA_TWEAK_PUBLIC_KEY: pickPublicKey(values, 'NOVA_TWEAK_PUBLIC_KEY'),
  NOVA_UPDATE_PUBLIC_KEY: pickPublicKey(values, 'NOVA_UPDATE_PUBLIC_KEY'),
  NOVA_ARTIFACT_PUBLIC_KEYS: pickPublicKeys(values, 'NOVA_ARTIFACT_PUBLIC_KEYS'),
  NOVA_TWEAK_PUBLIC_KEYS: pickPublicKeys(values, 'NOVA_TWEAK_PUBLIC_KEYS'),
  NOVA_UPDATE_PUBLIC_KEYS: pickPublicKeys(values, 'NOVA_UPDATE_PUBLIC_KEYS'),
  NOVA_REQUIRE_TWEAK_SIGNATURES: pick(values, 'NOVA_REQUIRE_TWEAK_SIGNATURES'),
  NOVA_REQUIRE_UPDATE_SIGNATURES: pick(values, 'NOVA_REQUIRE_UPDATE_SIGNATURES'),
  NOVA_LOCAL_TEST_BUILD: isTrue(process.env.NOVA_LOCAL_TEST_BUILD)
};

const artifactPublicKeys = [...new Set([config.NOVA_ARTIFACT_PUBLIC_KEY, ...config.NOVA_ARTIFACT_PUBLIC_KEYS].filter(Boolean))];
const tweakPublicKeys = [...new Set([config.NOVA_TWEAK_PUBLIC_KEY, ...config.NOVA_TWEAK_PUBLIC_KEYS, ...artifactPublicKeys].filter(Boolean))];
const updatePublicKeys = [...new Set([config.NOVA_UPDATE_PUBLIC_KEY, ...config.NOVA_UPDATE_PUBLIC_KEYS, ...artifactPublicKeys].filter(Boolean))];
validatePublicKeys(artifactPublicKeys, 'Artifact public-key configuration');
validatePublicKeys(tweakPublicKeys, 'Tweak public-key configuration');
validatePublicKeys(updatePublicKeys, 'Update public-key configuration');

if (isTrue(config.NOVA_REQUIRE_TWEAK_SIGNATURES) && !tweakPublicKeys.length) {
  console.error('Desktop signing config is incomplete: tweak signature enforcement requires a tweak or artifact public key.');
  process.exit(1);
}
if (isTrue(config.NOVA_REQUIRE_UPDATE_SIGNATURES) && !updatePublicKeys.length) {
  console.error('Desktop signing config is incomplete: update signature enforcement requires an update or artifact public key.');
  process.exit(1);
}
const hasAnyPublicKey = Boolean(artifactPublicKeys.length || tweakPublicKeys.length || updatePublicKeys.length);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  outputPath,
  [
    '// Generated by scripts/generate-desktop-signing-config.js.',
    '// Do not edit or commit this file.',
    `module.exports = ${JSON.stringify(config, null, 2)};`,
    ''
  ].join('\n'),
  'utf8'
);

console.log('Desktop signing config generated.');
console.log(`Public key configured: ${hasAnyPublicKey ? 'yes' : 'no'}`);
console.log(`Tweak signatures required: ${isTrue(config.NOVA_REQUIRE_TWEAK_SIGNATURES) ? 'yes' : 'no'}`);
console.log(`Update signatures required: ${isTrue(config.NOVA_REQUIRE_UPDATE_SIGNATURES) ? 'yes' : 'no'}`);
console.log(`Local unsigned test build: ${config.NOVA_LOCAL_TEST_BUILD ? 'yes' : 'no'}`);
