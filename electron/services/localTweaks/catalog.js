const fs = require("fs");
const path = require("path");

const VALID_ACTIONS = ["apply", "detect", "restore"];
const VALID_EXECUTION_TYPES = ["powershell"];
const VALID_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const VALID_PROFILE_IDS = new Set([
    "daily_safe",
    "gaming_performance",
    "laptop_battery",
    "privacy_debloat",
    "network_boost",
    "system_cleanup"
]);
const SCRIPT_FILE_PATTERN = /^[A-Za-z0-9._-]+\.ps1$/;
const PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const DEFAULT_DETECT_OUTPUT = {
    enabled: "ENABLED",
    disabled: "DISABLED",
    unknown: "UNKNOWN"
};

class TweakCatalogError extends Error {
    constructor(message, code = "TWEAK_CATALOG_ERROR", details = {}) {
        super(message);
        this.name = "TweakCatalogError";
        this.code = code;
        this.details = details;
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeProfiles(value, context) {
    if (value === undefined || value === null) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new TweakCatalogError("profiles must be an array.", "TWEAK_INVALID_PROFILES", context);
    }

    return value.map((entry, index) => {
        if (!isPlainObject(entry)) {
            throw new TweakCatalogError("profiles entries must be objects.", "TWEAK_INVALID_PROFILES", {
                ...context,
                index
            });
        }

        const id = String(entry.id || "").trim();
        if (!VALID_PROFILE_IDS.has(id)) {
            throw new TweakCatalogError("profiles contains an unknown profile id.", "TWEAK_INVALID_PROFILE_ID", {
                ...context,
                index,
                profileId: id
            });
        }

        if (entry.params !== undefined && !isPlainObject(entry.params)) {
            throw new TweakCatalogError("profiles params must be an object.", "TWEAK_INVALID_PROFILE_PARAMS", {
                ...context,
                index,
                profileId: id
            });
        }

        return {
            id,
            ...(entry.defaultChecked === false ? { defaultChecked: false } : {}),
            ...(entry.params !== undefined ? { params: { ...entry.params } } : {})
        };
    });
}

function normalizeIdentifierFragment(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_")
        .toLowerCase();
}

function normalizeTweakIdFromName(name) {
    return normalizeIdentifierFragment(name);
}

function normalizeExistingTweakId(id) {
    return normalizeIdentifierFragment(id);
}

function normalizeConfigFileName(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return "";
    }

    const fileName = path.basename(trimmed);
    return fileName.toLowerCase().endsWith(".json") ? fileName : `${fileName}.json`;
}

function toBoolean(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
}

function toInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function detectSupportsStatus(config) {
    if (typeof config.supports_status_detection === "boolean") {
        return config.supports_status_detection;
    }

    if (typeof config.supportsStatusDetection === "boolean") {
        return config.supportsStatusDetection;
    }

    const containerType = String(config.container_type || config.containerType || "")
        .trim()
        .toLowerCase();

    if (containerType === "one_shot_action") {
        return false;
    }

    return true;
}

function detectAllowedParams(config) {
    const containerType = String(config.container_type || config.containerType || "")
        .trim()
        .toLowerCase();
    const allowed = new Set();

    if (Array.isArray(config.selections) && config.selections.length > 0) {
        allowed.add("Selection");
    }

    if (containerType === "timer_resolution") {
        allowed.add("Resolution");
    }

    if (containerType === "range_selection") {
        allowed.add("Value");
    }

    return [...allowed];
}

function inferScriptFileName(tweakId) {
    return `${tweakId}.ps1`;
}

function buildDefaultExecution(config, tweakId) {
    const supportsStatusDetection = detectSupportsStatus(config);
    const requiresAdmin = toBoolean(config.requires_admin ?? config.requiresAdmin, false);
    const allowedParams = detectAllowedParams(config);
    const timeoutMs = toInteger(config.timeout_ms ?? config.timeoutMs, 30000);
    const actionTimeoutMs = timeoutMs > 0 ? timeoutMs : 30000;
    const detectArgs = ["-State", "Check", "-Silent"];
    const applyArgs = ["-State", "On", "-Silent"];
    const restoreArgs = ["-State", "Off", "-Silent"];

    const applyAction = {
        args: applyArgs,
        success_exit_codes: [0],
        requires_admin: requiresAdmin
    };

    if (allowedParams.length > 0) {
        applyAction.allowed_params = allowedParams;
    }

    const detectAction = {
        args: detectArgs,
        success_exit_codes: [0],
        requires_admin: false,
        expected_output: DEFAULT_DETECT_OUTPUT
    };

    const restoreAction = {
        args: restoreArgs,
        success_exit_codes: [0],
        requires_admin: requiresAdmin
    };

    const restoreAllowedParams = allowedParams.filter((name) => name !== "Value");
    if (restoreAllowedParams.length > 0) {
        restoreAction.allowed_params = restoreAllowedParams;
    }

    return {
        type: "powershell",
        script: inferScriptFileName(tweakId),
        requires_admin: requiresAdmin,
        timeout_ms: actionTimeoutMs,
        supports_status_detection: supportsStatusDetection,
        actions: {
            apply: applyAction,
            detect: detectAction,
            restore: restoreAction
        }
    };
}

function validateActionArgs(args, context) {
    if (!Array.isArray(args) || args.length === 0) {
        throw new TweakCatalogError("Execution action args must be a non-empty array.", "TWEAK_INVALID_ACTION_ARGS", context);
    }

    for (const arg of args) {
        if (typeof arg !== "string" || !arg.trim()) {
            throw new TweakCatalogError("Execution action args must contain non-empty strings.", "TWEAK_INVALID_ACTION_ARGS", context);
        }
    }

    return args.map((arg) => arg.trim());
}

function validateSuccessExitCodes(value, context) {
    const source = Array.isArray(value) && value.length > 0 ? value : [0];

    if (source.some((entry) => !Number.isInteger(entry))) {
        throw new TweakCatalogError("Execution success_exit_codes must contain integers.", "TWEAK_INVALID_EXIT_CODES", context);
    }

    return [...new Set(source)];
}

function validateAllowedParams(value, context) {
    if (!Array.isArray(value) || value.length === 0) {
        return [];
    }

    const normalized = value.map((entry) => String(entry || "").trim()).filter(Boolean);

    if (normalized.some((entry) => !PARAM_NAME_PATTERN.test(entry))) {
        throw new TweakCatalogError("Execution allowed_params contains an invalid parameter name.", "TWEAK_INVALID_ALLOWED_PARAMS", context);
    }

    return [...new Set(normalized)];
}

function normalizeAction(actionName, actionConfig, fallbackRequiresAdmin, context) {
    if (!isPlainObject(actionConfig)) {
        throw new TweakCatalogError(`Execution action "${actionName}" must be an object.`, "TWEAK_INVALID_ACTION", context);
    }

    const normalized = {
        args: validateActionArgs(actionConfig.args, context),
        success_exit_codes: validateSuccessExitCodes(actionConfig.success_exit_codes, context),
        requires_admin: toBoolean(actionConfig.requires_admin, fallbackRequiresAdmin)
    };

    const allowedParams = validateAllowedParams(actionConfig.allowed_params, context);
    if (allowedParams.length > 0) {
        normalized.allowed_params = allowedParams;
    }

    if (actionName === "detect") {
        normalized.expected_output = isPlainObject(actionConfig.expected_output)
            ? {
                enabled: String(actionConfig.expected_output.enabled || DEFAULT_DETECT_OUTPUT.enabled),
                disabled: String(actionConfig.expected_output.disabled || DEFAULT_DETECT_OUTPUT.disabled),
                unknown: String(actionConfig.expected_output.unknown || DEFAULT_DETECT_OUTPUT.unknown)
            }
            : { ...DEFAULT_DETECT_OUTPUT };
    }

    return normalized;
}

function validateScriptName(scriptName, context) {
    const normalized = String(scriptName || "").trim();

    if (!normalized || !SCRIPT_FILE_PATTERN.test(normalized) || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
        throw new TweakCatalogError("Execution script must be a single .ps1 filename inside the tweak folder.", "TWEAK_INVALID_SCRIPT_NAME", {
            ...context,
            script: scriptName
        });
    }

    return normalized;
}

function resolveScriptLocation(scriptsDir, tweakId, scriptName) {
    const tweakRoot = path.resolve(scriptsDir, tweakId);
    const scriptPath = path.resolve(tweakRoot, scriptName);

    if (!scriptPath.startsWith(tweakRoot + path.sep)) {
        throw new TweakCatalogError("Resolved tweak script path is outside the allowed tweak directory.", "TWEAK_SCRIPT_PATH_VIOLATION", {
            tweakId,
            scriptName,
            scriptPath
        });
    }

    return {
        tweakRoot,
        scriptPath,
        exists: fs.existsSync(scriptPath),
        relativeScriptPath: path.join(tweakId, scriptName).replace(/\\/g, "/")
    };
}

function normalizeExecution(config, tweakId, scriptsDir) {
    const executionSource = isPlainObject(config.execution)
        ? config.execution
        : buildDefaultExecution(config, tweakId);
    const context = {
        tweakId,
        configFile: config.__configFile || ""
    };
    const type = String(executionSource.type || "").trim().toLowerCase();

    if (!VALID_EXECUTION_TYPES.includes(type)) {
        throw new TweakCatalogError("Execution type is not supported.", "TWEAK_INVALID_EXECUTION_TYPE", {
            ...context,
            type
        });
    }

    const requiresAdmin = toBoolean(executionSource.requires_admin, toBoolean(config.requires_admin ?? config.requiresAdmin, false));
    const timeoutMs = toInteger(executionSource.timeout_ms, 30000);
    const actionsSource = isPlainObject(executionSource.actions) ? executionSource.actions : {};
    const script = validateScriptName(executionSource.script, context);

    const normalized = {
        type,
        script,
        requires_admin: requiresAdmin,
        timeout_ms: timeoutMs > 0 ? timeoutMs : 30000,
        supports_status_detection: toBoolean(executionSource.supports_status_detection, detectSupportsStatus(config)),
        actions: {}
    };

    for (const actionName of VALID_ACTIONS) {
        const actionSource = actionsSource[actionName];
        if (!actionSource) {
            throw new TweakCatalogError(`Execution action "${actionName}" is required.`, "TWEAK_MISSING_ACTION", {
                ...context,
                action: actionName
            });
        }

        normalized.actions[actionName] = normalizeAction(actionName, actionSource, requiresAdmin, {
            ...context,
            action: actionName
        });
    }

    const location = resolveScriptLocation(scriptsDir, tweakId, script);

    return {
        ...normalized,
        script_exists: location.exists
    };
}

function sanitizeConfigForClient(config) {
    if (!isPlainObject(config)) {
        return {};
    }

    const clone = JSON.parse(JSON.stringify(config));
    delete clone.__configFile;
    delete clone.__scriptResolution;
    return clone;
}

function normalizeRangeConfig(value, context) {
    if (!isPlainObject(value)) {
        throw new TweakCatalogError("range_selection tweaks require a range object.", "TWEAK_INVALID_RANGE", context);
    }

    const minimum = Number(value.min ?? value.minimum);
    const maximum = Number(value.max ?? value.maximum);
    const step = Number(value.step);
    const recommendedValue = Number(value.recommended_value ?? value.recommendedValue);
    const parameter = String(value.parameter || "Value").trim();

    if (parameter !== "Value") {
        throw new TweakCatalogError("range.parameter must be Value.", "TWEAK_INVALID_RANGE_PARAMETER", {
            ...context,
            parameter
        });
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
        throw new TweakCatalogError("range min and max must define a valid numeric interval.", "TWEAK_INVALID_RANGE", context);
    }
    if (!Number.isFinite(step) || step <= 0 || step > maximum - minimum) {
        throw new TweakCatalogError("range step is invalid.", "TWEAK_INVALID_RANGE", context);
    }
    if (!Number.isFinite(recommendedValue) || recommendedValue < minimum || recommendedValue > maximum) {
        throw new TweakCatalogError("range recommended_value is outside the supported interval.", "TWEAK_INVALID_RANGE", context);
    }

    return {
        parameter,
        min: minimum,
        max: maximum,
        step,
        unit: String(value.unit || "").trim().slice(0, 16),
        recommended_value: recommendedValue
    };
}

function isCanonicalConfigFileForId(fileName, tweakId) {
    return normalizeConfigFileName(fileName) === `${normalizeExistingTweakId(tweakId)}.json`;
}

function buildParamObjectFromArgs(args) {
    const params = {};

    for (let index = 0; index < args.length; index += 1) {
        const token = String(args[index] || "").trim();
        if (!token.startsWith("-")) {
            continue;
        }

        const key = token.slice(1);
        const next = args[index + 1];

        if (typeof next === "string" && !String(next).startsWith("-")) {
            params[key] = next;
            index += 1;
        } else {
            params[key] = true;
        }
    }

    return params;
}

function sanitizeRequestedParams(requestedParams, allowedParams) {
    if (!isPlainObject(requestedParams) || allowedParams.length === 0) {
        return {};
    }

    return allowedParams.reduce((accumulator, paramName) => {
        if (!Object.prototype.hasOwnProperty.call(requestedParams, paramName)) {
            return accumulator;
        }

        const value = requestedParams[paramName];
        if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
            accumulator[paramName] = value;
        }

        return accumulator;
    }, {});
}

function createTweakCatalog(options = {}) {
    const resourcesRoot = path.join(process.cwd(), "resources", "tweaks");
    const configsDir = path.resolve(options.configsDir || path.join(resourcesRoot, "configs"));
    const scriptsDir = path.resolve(options.scriptsDir || path.join(resourcesRoot, "scripts"));
    let cache = null;

    function loadConfigs() {
        if (cache) {
            return cache;
        }

        if (!fs.existsSync(configsDir)) {
            throw new TweakCatalogError("Tweak config directory does not exist.", "TWEAK_CONFIG_DIR_MISSING", {
                configsDir
            });
        }

        const files = fs.readdirSync(configsDir)
            .filter((entry) => entry.toLowerCase().endsWith(".json"))
            .sort((left, right) => left.localeCompare(right));

        const tweaks = [];
        const tweakById = new Map();
        const tweakByConfigFile = new Map();
        for (const fileName of files) {
            const absoluteFilePath = path.join(configsDir, fileName);
            let parsed;

            try {
                parsed = JSON.parse(fs.readFileSync(absoluteFilePath, "utf8"));
            } catch (error) {
                throw new TweakCatalogError("Tweak config contains invalid JSON.", "TWEAK_CONFIG_INVALID_JSON", {
                    configFile: fileName,
                    message: error.message
                });
            }

            if (!isPlainObject(parsed)) {
                throw new TweakCatalogError("Tweak config root must be an object.", "TWEAK_CONFIG_INVALID_ROOT", {
                    configFile: fileName
                });
            }

            const tweakId = String(parsed.id || "").trim();
            if (!VALID_ID_PATTERN.test(tweakId)) {
                throw new TweakCatalogError("Tweak config id must be stable lowercase snake_case.", "TWEAK_INVALID_ID", {
                    configFile: fileName,
                    tweakId
                });
            }

            if (!isCanonicalConfigFileForId(fileName, tweakId)) {
                throw new TweakCatalogError("Tweak config filename must match its id.", "TWEAK_CONFIG_FILENAME_MISMATCH", {
                    configFile: fileName,
                    expectedConfigFile: `${tweakId}.json`,
                    tweakId
                });
            }

            if (tweakById.has(tweakId)) {
                throw new TweakCatalogError("Tweak config id must be unique.", "TWEAK_DUPLICATE_ID", {
                    configFile: fileName,
                    existingConfigFile: tweakById.get(tweakId).__configFile,
                    tweakId
                });
            }

            const normalized = {
                ...parsed,
                id: tweakId,
                premium: false,
                ...(String(parsed.container_type || parsed.containerType || "").trim().toLowerCase() === "range_selection"
                    ? {
                        range: normalizeRangeConfig(parsed.range || parsed.range_config, {
                            tweakId,
                            configFile: fileName
                        })
                    }
                    : {}),
                profiles: normalizeProfiles(parsed.profiles, {
                    tweakId,
                    configFile: fileName
                }),
                execution: normalizeExecution({
                    ...parsed,
                    __configFile: fileName
                }, tweakId, scriptsDir),
                __configFile: fileName
            };

            tweaks.push(normalized);
            tweakById.set(tweakId, normalized);
            tweakByConfigFile.set(fileName, normalized);
        }

        cache = {
            tweaks,
            tweakById,
            tweakByConfigFile
        };

        return cache;
    }

    function listTweaks() {
        return loadConfigs().tweaks.map((config) => sanitizeConfigForClient(config));
    }

    function getConfigById(tweakId) {
        const normalizedId = normalizeExistingTweakId(tweakId);
        let config = loadConfigs().tweakById.get(normalizedId);
        if (!config && cache) {
            cache = null;
            config = loadConfigs().tweakById.get(normalizedId);
        }
        if (!config) {
            throw new TweakCatalogError("Tweak config not found.", "TWEAK_NOT_FOUND", {
                tweakId: normalizedId
            });
        }
        return sanitizeConfigForClient(config);
    }

    function getRawConfigById(tweakId) {
        const normalizedId = normalizeExistingTweakId(tweakId);
        let config = loadConfigs().tweakById.get(normalizedId);
        if (!config && cache) {
            cache = null;
            config = loadConfigs().tweakById.get(normalizedId);
        }
        if (!config) {
            throw new TweakCatalogError("Tweak config not found.", "TWEAK_NOT_FOUND", {
                tweakId: normalizedId
            });
        }
        return config;
    }

    function getConfigByConfigFile(configFile) {
        const value = normalizeConfigFileName(configFile);
        let config = loadConfigs().tweakByConfigFile.get(value);
        if (!config && cache) {
            cache = null;
            config = loadConfigs().tweakByConfigFile.get(value);
        }
        if (!config) {
            throw new TweakCatalogError("Tweak config file not found.", "TWEAK_CONFIG_FILE_NOT_FOUND", {
                configFile: value
            });
        }
        return sanitizeConfigForClient(config);
    }

    function getRawConfigByConfigFile(configFile) {
        const value = normalizeConfigFileName(configFile);
        let config = loadConfigs().tweakByConfigFile.get(value);
        if (!config && cache) {
            cache = null;
            config = loadConfigs().tweakByConfigFile.get(value);
        }
        if (!config) {
            throw new TweakCatalogError("Tweak config file not found.", "TWEAK_CONFIG_FILE_NOT_FOUND", {
                configFile: value
            });
        }
        return config;
    }

    function resolveExecution(tweakId, action, requestedParams = {}) {
        const normalizedAction = String(action || "").trim().toLowerCase();
        if (!VALID_ACTIONS.includes(normalizedAction)) {
            throw new TweakCatalogError("Unsupported tweak action.", "TWEAK_INVALID_ACTION", {
                tweakId,
                action
            });
        }

        const config = getRawConfigById(tweakId);
        const actionConfig = config.execution.actions[normalizedAction];
        const location = resolveScriptLocation(scriptsDir, config.id, config.execution.script);

        if (!location.exists) {
            throw new TweakCatalogError("Resolved tweak script does not exist.", "TWEAK_SCRIPT_MISSING", {
                tweakId: config.id,
                action: normalizedAction,
                script: config.execution.script,
                scriptPath: location.scriptPath
            });
        }

        const allowedParams = safeArray(actionConfig.allowed_params);
        const params = {
            ...buildParamObjectFromArgs(actionConfig.args),
            ...sanitizeRequestedParams(requestedParams, allowedParams)
        };

        return {
            tweakId: config.id,
            action: normalizedAction,
            type: config.execution.type,
            script: config.execution.script,
            scriptPath: location.scriptPath,
            scriptRelativePath: location.relativeScriptPath,
            tweakRoot: location.tweakRoot,
            timeoutMs: config.execution.timeout_ms,
            requiresAdmin: toBoolean(actionConfig.requires_admin, config.execution.requires_admin),
            successExitCodes: safeArray(actionConfig.success_exit_codes),
            expectedOutput: normalizedAction === "detect" ? { ...DEFAULT_DETECT_OUTPUT, ...(actionConfig.expected_output || {}) } : null,
            params
        };
    }

    function reload() {
        cache = null;
        return listTweaks();
    }

    return {
        listTweaks,
        getConfigById,
        getRawConfigById,
        getConfigByConfigFile,
        getRawConfigByConfigFile,
        normalizeTweakIdFromName,
        normalizeExistingTweakId,
        resolveExecution,
        reload,
        sanitizeConfigForClient
    };
}

module.exports = {
    VALID_ACTIONS,
    VALID_ID_PATTERN,
    TweakCatalogError,
    createTweakCatalog,
    normalizeTweakIdFromName,
    normalizeExistingTweakId
};
