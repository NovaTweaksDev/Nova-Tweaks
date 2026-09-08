const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  resolveWindowsSystemExecutable
} = require('./security/systemExecutables');

const VALID_SCRIPT_MODES = ['Apply', 'Undo'];
const DEFAULT_TIMEOUT_MS = 45000;
const SCRIPT_FILE_PATTERN = /^[a-zA-Z0-9._/\\-]+\.ps1$/i;
const PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

class ScriptRunnerError extends Error {
  constructor(message, code = 'SCRIPT_RUNNER_ERROR', details = {}) {
    super(message);
    this.name = 'ScriptRunnerError';
    this.code = code;
    this.details = details;
  }
}

function normalizeMode(mode) {
  if (typeof mode !== 'string' || !mode.trim()) {
    return 'Apply';
  }

  const candidate = mode.trim().toLowerCase();
  if (candidate === 'undo') {
    return 'Undo';
  }
  if (candidate === 'apply') {
    return 'Apply';
  }
  return null;
}

function validateScriptName(scriptName) {
  if (typeof scriptName !== 'string') {
    throw new ScriptRunnerError('Invalid script name.', 'SCRIPT_INVALID_NAME', { scriptName });
  }

  const normalizedScriptName = scriptName.trim().replace(/\\/g, '/');

  if (!SCRIPT_FILE_PATTERN.test(normalizedScriptName) || normalizedScriptName.startsWith('/') || normalizedScriptName.includes('..')) {
    throw new ScriptRunnerError('Invalid script name.', 'SCRIPT_INVALID_NAME', { scriptName });
  }

  return normalizedScriptName;
}

function validateParamName(paramName) {
  if (!PARAM_NAME_PATTERN.test(paramName)) {
    throw new ScriptRunnerError('Invalid script parameter name.', 'SCRIPT_INVALID_PARAM_NAME', {
      paramName
    });
  }
}

function resolveScriptPath(scriptsPath, scriptName) {
  const validatedScriptName = validateScriptName(scriptName);
  const absoluteScriptsPath = path.resolve(scriptsPath);
  const scriptPath = path.resolve(path.join(absoluteScriptsPath, validatedScriptName));

  if (!scriptPath.startsWith(absoluteScriptsPath + path.sep)) {
    throw new ScriptRunnerError('Resolved script path is outside of scripts directory.', 'SCRIPT_PATH_VIOLATION', {
      scriptsPath: absoluteScriptsPath,
      scriptPath
    });
  }

  if (!fs.existsSync(scriptPath)) {
    throw new ScriptRunnerError('Script file not found.', 'SCRIPT_NOT_FOUND', {
      scriptPath,
      scriptName: validatedScriptName
    });
  }

  return scriptPath;
}

function buildScriptArgs(mode, params, includeMode) {
  const args = [];

  if (includeMode) {
    const normalizedMode = normalizeMode(mode);
    if (!VALID_SCRIPT_MODES.includes(normalizedMode)) {
      throw new ScriptRunnerError('Invalid script mode.', 'SCRIPT_INVALID_MODE', { mode });
    }
    args.push('-Mode', normalizedMode);
  }

  const sourceParams = params && typeof params === 'object' ? params : {};

  for (const [key, value] of Object.entries(sourceParams)) {
    validateParamName(key);

    if (typeof value === 'boolean') {
      if (value) {
        args.push(`-${key}`);
      }
      continue;
    }

    if (value === null || typeof value === 'undefined') {
      continue;
    }

    args.push(`-${key}`);
    args.push(String(value));
  }

  return args;
}

function createScriptRunner({ scriptsPath, logger, env = {} }) {
  if (!scriptsPath) {
    throw new Error('Script runner requires scriptsPath.');
  }

  const absoluteScriptsPath = path.resolve(scriptsPath);
  const processEnv = {
    ...process.env,
    ...(env && typeof env === 'object' ? env : {})
  };

  function listScripts() {
    if (!fs.existsSync(absoluteScriptsPath)) {
      return [];
    }

    const collected = [];

    function walk(currentAbsolutePath, relativePrefix = '') {
      for (const entry of fs.readdirSync(currentAbsolutePath, { withFileTypes: true })) {
        const nextRelative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        const nextAbsolute = path.join(currentAbsolutePath, entry.name);

        if (entry.isDirectory()) {
          walk(nextAbsolute, nextRelative);
          continue;
        }

        if (entry.isFile() && entry.name.toLowerCase().endsWith('.ps1')) {
          collected.push(nextRelative);
        }
      }
    }

    walk(absoluteScriptsPath);

    return collected.sort();
  }

  async function runScript(options = {}) {
    const scriptName = options.scriptName;
    const includeMode = options.includeMode !== false;
    const mode = includeMode ? normalizeMode(options.mode) : null;
    if (includeMode && !mode) {
      throw new ScriptRunnerError('Invalid script mode.', 'SCRIPT_INVALID_MODE', { mode: options.mode });
    }
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const scriptPath = resolveScriptPath(absoluteScriptsPath, scriptName);
    if (typeof options.verifyBeforeRun === 'function') {
      await options.verifyBeforeRun({ scriptName, scriptPath });
    }
    const scriptArgs = buildScriptArgs(mode, options.params, includeMode);
    const commandArgs = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      ...scriptArgs
    ];

    logger?.info?.('Starting script execution.', {
      scriptName,
      mode: includeMode ? mode : null,
      includeMode,
      timeoutMs
    });

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(resolveWindowsSystemExecutable('powershell'), commandArgs, {
        windowsHide: true,
        env: processEnv
      });

      let stdout = '';
      let stderr = '';
      let didTimeout = false;

      const timer = setTimeout(() => {
        didTimeout = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        const wrapped = new ScriptRunnerError('Failed to start PowerShell process.', 'SCRIPT_PROCESS_START_FAILED', {
          scriptName,
          mode: includeMode ? mode : null,
          message: error.message
        });
        logger?.error?.('PowerShell process failed to start.', wrapped.details);
        reject(wrapped);
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;

        if (didTimeout) {
          const timeoutError = new ScriptRunnerError('Script execution timed out.', 'SCRIPT_TIMEOUT', {
            scriptName,
            mode: includeMode ? mode : null,
            timeoutMs
          });
          logger?.error?.('Script execution timed out.', timeoutError.details);
          reject(timeoutError);
          return;
        }

        const result = {
          ok: exitCode === 0,
          scriptName,
          mode: includeMode ? mode : null,
          exitCode,
          durationMs,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        };

        if (!result.ok) {
          const runError = new ScriptRunnerError('Script execution failed.', 'SCRIPT_EXECUTION_FAILED', result);
          logger?.error?.('Script execution returned non-zero exit code.', {
            scriptName,
            mode: includeMode ? mode : null,
            exitCode,
            durationMs
          });
          reject(runError);
          return;
        }

        logger?.info?.('Script execution completed.', {
          scriptName,
          mode: includeMode ? mode : null,
          exitCode,
          durationMs
        });
        resolve(result);
      });
    });
  }

  return {
    listScripts,
    runScript
  };
}

module.exports = {
  createScriptRunner,
  ScriptRunnerError,
  VALID_SCRIPT_MODES
};
