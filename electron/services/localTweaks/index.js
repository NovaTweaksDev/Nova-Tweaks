const path = require("path");
const {
    VALID_ACTIONS,
    VALID_ID_PATTERN,
    TweakCatalogError,
    createTweakCatalog,
    normalizeTweakIdFromName,
    normalizeExistingTweakId
} = require("./catalog");

function createDefaultTweakCatalog(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, "../../.."));
    const resourcesRoot = path.join(projectRoot, "resources", "tweaks");

    return createTweakCatalog({
        configsDir: options.configsDir || path.join(resourcesRoot, "configs"),
        scriptsDir: options.scriptsDir || path.join(resourcesRoot, "scripts")
    });
}

module.exports = {
    VALID_ACTIONS,
    VALID_ID_PATTERN,
    TweakCatalogError,
    createTweakCatalog,
    createDefaultTweakCatalog,
    normalizeTweakIdFromName,
    normalizeExistingTweakId
};
