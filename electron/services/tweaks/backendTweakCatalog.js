const path = require("path");
const fs = require('fs');
const tweakServices = require('../localTweaks');
const bundledTweakManifest = require('../../generated/bundled-tweaks-manifest');
const {
  assertBundledTweakContent,
  assertBundledTweakIntegrity
} = require('../security/bundledTweakIntegrity');

function createBackendTweakCatalog(options = {}) {
  const resourcesRootPath = path.resolve(
    options.resourcesRootPath || path.join(__dirname, '../../../resources/tweaks')
  );

  const catalog = tweakServices.createTweakCatalog({
    configsDir: path.join(resourcesRootPath, 'configs'),
    scriptsDir: path.join(resourcesRootPath, 'scripts')
  });
  const enforceIntegrity = options.enforceIntegrity === true;

  return {
    ...catalog,
    assertIntegrity() {
      if (!enforceIntegrity) return { ok: true, skipped: true };
      return assertBundledTweakIntegrity(resourcesRootPath, bundledTweakManifest);
    },
    assertExecutionIntegrity(execution) {
      if (!enforceIntegrity) return { ok: true, skipped: true };
      const relativePath = `scripts/${String(execution?.scriptRelativePath || '').replace(/\\/g, '/')}`;
      return assertBundledTweakContent(relativePath, fs.readFileSync(execution.scriptPath), bundledTweakManifest);
    }
  };
}

module.exports = {
  createBackendTweakCatalog
};
