const path = require('node:path');
const { resolveBuildProfile } = require('./scripts/build-profile');
const policy = require('./electron/services/tweaks/storeTweakPolicy.json');
const base = require('./package.json').build;
const profile = resolveBuildProfile();
const signedResources = require('./scripts/signed-helper-resources');

module.exports = {
  ...base,
  artifactName: profile.name === 'stable'
    ? base.artifactName
    : 'NovaTweaks-' + profile.name + '-Setup-${version}-${arch}.${ext}',
  directories: { ...base.directories, output: `.cache/packaging/${profile.name}` },
  ...(profile.store && profile.signed ? { electronDist: '.cache/store-signing/electron' } : {}),
  extraFiles: base.extraFiles.map((resource) => ({
    ...resource,
    ...(profile.store && profile.signed && resource.from === 'third-party-components.json'
      ? { from: '.cache/store-signing/third-party-components.json' } : {})
  })),
  extraResources: base.extraResources.map((resource) => ({
    ...resource,
    ...(profile.signed && signedResources.some((entry) => entry.from === resource.from)
      ? { from: path.join('.cache', 'signed-resources', resource.from) } : {}),
    ...(profile.store && profile.signed && ['resources/monitoring', 'resources/capture/PresentMon'].includes(resource.from)
      ? { from: path.join('.cache', 'store-signing', resource.from) } : {}),
    ...(profile.store && resource.from === 'resources/tweaks' ? {
      filter: [
        ...resource.filter,
        ...Object.keys(policy.exclusions).flatMap((id) => [`!configs/${id}.json`, `!scripts/${id}/**`])
      ]
    } : {})
  })),
  win: {
    ...base.win,
    forceCodeSigning: profile.signed,
    signExecutable: profile.signed,
    ...(profile.signed ? { signtoolOptions: {
      ...base.win.signtoolOptions,
      certificateSha1: process.env.NOVA_SIGNING_THUMBPRINT || base.win.signtoolOptions.certificateSha1
    } } : {})
  }
};
