const fs = require('node:fs');
const path = require('node:path');

const PROFILES = Object.freeze({
  development: { signed: false, localTest: false, store: false },
  local: { signed: false, localTest: true, store: false },
  preview: { signed: false, localTest: true, store: false },
  candidate: { signed: false, localTest: false, store: false },
  stable: { signed: true, localTest: false, store: false },
  store: { signed: true, localTest: false, store: true },
  'store-candidate': { signed: false, localTest: false, store: true }
});

function resolveBuildProfile(env = process.env) {
  const name = env.NOVA_BUILD_PROFILE || (env.NOVA_LOCAL_TEST_BUILD === 'true' ? 'local' : 'development');
  if (!Object.hasOwn(PROFILES, name)) throw new Error('Unknown NOVA_BUILD_PROFILE.');
  const profile = { name, ...PROFILES[name] };
  if (env.NOVA_LOCAL_TEST_BUILD === 'true' && !profile.localTest) {
    throw new Error('Local unsigned broker bypass conflicts with this build profile.');
  }
  return profile;
}

function generateBuildProfile(root = path.resolve(__dirname, '..'), env = process.env) {
  const profile = resolveBuildProfile(env);
  const output = path.join(root, 'electron', 'generated');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'build-profile.js'), `module.exports = ${JSON.stringify(profile)};\n`);
  // Reset on every build so a previous signed staging area cannot contaminate another variant.
  fs.writeFileSync(path.join(output, 'signed-helper-integrity.js'), 'module.exports = {};\n');
  return profile;
}

if (require.main === module) generateBuildProfile();
module.exports = { PROFILES, resolveBuildProfile, generateBuildProfile };
