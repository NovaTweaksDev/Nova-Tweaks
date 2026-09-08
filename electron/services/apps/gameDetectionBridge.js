const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');
const { assertBundledSidecarIntegrity } = require('../security/bundledSidecarIntegrity');

const DEFAULT_GAME_DETECTION_TIMEOUT_MS = 12000;
const GAME_DETECTOR_EXECUTABLE_NAME = 'NovaGameDetector.exe';

function resolveRuntimeIdentifier() {
  return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
}

function normalizePath(value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return '';
  }

  return candidate.replace(/\//g, '\\');
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function resolveHelperExecutablePath({ isPackaged = false } = {}) {
  const fromEnvironment = isPackaged ? '' : normalizePath(process.env.NOVA_GAME_DETECTOR_PATH);
  const resourcesPath = normalizePath(process.resourcesPath);
  const projectRoot = resolveProjectRoot();
  const runtimeIdentifier = resolveRuntimeIdentifier();

  const candidates = [
    fromEnvironment,
    path.join(resourcesPath, 'helpers', 'NovaGameDetector', 'publish', runtimeIdentifier, GAME_DETECTOR_EXECUTABLE_NAME),
    path.join(resourcesPath, 'helpers', 'NovaGameDetector', GAME_DETECTOR_EXECUTABLE_NAME),
    path.join(resourcesPath, 'helpers', 'NovaGameDetector', 'publish', GAME_DETECTOR_EXECUTABLE_NAME),
    path.join(projectRoot, 'resources', 'helpers', 'NovaGameDetector', 'publish', runtimeIdentifier, GAME_DETECTOR_EXECUTABLE_NAME),
    path.join(projectRoot, 'resources', 'helpers', 'NovaGameDetector', 'publish', GAME_DETECTOR_EXECUTABLE_NAME),
    path.join(
      projectRoot,
      'resources',
      'helpers',
      'NovaGameDetector',
      'bin',
      'Release',
      'net8.0-windows',
      'win-x64',
      'publish',
      GAME_DETECTOR_EXECUTABLE_NAME
    ),
    path.join(
      projectRoot,
      'resources',
      'helpers',
      'NovaGameDetector',
      'bin',
      'Release',
      'net8.0-windows',
      GAME_DETECTOR_EXECUTABLE_NAME
    ),
    path.join(projectRoot, 'resources', 'helpers', 'NovaGameDetector', GAME_DETECTOR_EXECUTABLE_NAME)
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizePath(candidate);
    if (!normalizedCandidate) {
      continue;
    }

    if (fs.existsSync(normalizedCandidate) && fs.statSync(normalizedCandidate).isFile()) {
      if (isPackaged) {
        try {
          assertBundledSidecarIntegrity(path.dirname(normalizedCandidate), 'game-detector-x64');
        } catch (_error) {
          return '';
        }
      }
      return normalizedCandidate;
    }
  }

  return '';
}

function normalizeRunningState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'active_foreground' ? 'active_foreground' : 'running_background';
}

function toIsoDate(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Date().toISOString();
  }

  const parsedTimestamp = Date.parse(normalized);
  return Number.isNaN(parsedTimestamp) ? new Date().toISOString() : new Date(parsedTimestamp).toISOString();
}

function normalizeDetectedGame(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const pid = Number(payload.pid);
  const processName = String(payload.processName || '').trim();
  const exePath = normalizePath(payload.exePath);
  if (!Number.isFinite(pid) || pid <= 0 || !processName || !exePath) {
    return null;
  }

  const confidenceValue = Number(payload.confidence);
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(100, Math.trunc(confidenceValue))) : 0;
  const reasons = Array.isArray(payload.reasons)
    ? payload.reasons.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  return {
    id: String(payload.id || '').trim(),
    displayName: String(payload.displayName || '').trim() || processName.replace(/\.exe$/i, ''),
    processName,
    pid: Math.trunc(pid),
    exePath,
    installDir: normalizePath(payload.installDir) || undefined,
    launcher: String(payload.launcher || '').trim() || undefined,
    state: normalizeRunningState(payload.state),
    confidence,
    reasons,
    detectedAt: toIsoDate(payload.detectedAt),
    lastForegroundAt: payload.lastForegroundAt ? toIsoDate(payload.lastForegroundAt) : undefined
  };
}

function normalizeDetectionResult(payload, fallbackError = '') {
  const games = Array.isArray(payload?.games)
    ? payload.games.map(normalizeDetectedGame).filter(Boolean)
    : [];

  const activeGameFromPayload = normalizeDetectedGame(payload?.activeGame);
  const activeGame = activeGameFromPayload && activeGameFromPayload.state === 'active_foreground'
    ? activeGameFromPayload
    : games.find((entry) => entry.state === 'active_foreground') || null;

  const normalizedError = String(payload?.error || fallbackError || '').trim();

  return {
    games,
    activeGame,
    lastUpdatedAt: toIsoDate(payload?.lastUpdatedAt),
    ...(normalizedError ? { error: normalizedError } : {})
  };
}

function runGameDetectionScan({
  timeoutMs = DEFAULT_GAME_DETECTION_TIMEOUT_MS,
  isPackaged = false
} = {}) {
  const helperExecutablePath = resolveHelperExecutablePath({ isPackaged });
  if (!helperExecutablePath) {
    return Promise.resolve({
      ok: false,
      code: 'GAME_DETECTOR_NOT_FOUND',
      message: 'NovaGameDetector.exe was not found.',
      details: {}
    });
  }

  return new Promise((resolve) => {
    let child = null;
    let usedPowerShellFallback = false;

    try {
      if (isPackaged) {
        assertBundledSidecarIntegrity(path.dirname(helperExecutablePath), 'game-detector-x64');
      }
      child = spawn(helperExecutablePath, ['--scan'], {
        windowsHide: true
      });
    } catch (error) {
      if (String(error?.code || '').toUpperCase() === 'EPERM') {
        try {
          usedPowerShellFallback = true;
          child = spawn(
            resolveWindowsSystemExecutable('powershell'),
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              `& '${helperExecutablePath.replace(/'/g, "''")}' --scan`
            ],
            { windowsHide: true }
          );
        } catch (fallbackError) {
          resolve({
            ok: false,
            code: 'GAME_DETECTOR_START_FAILED',
            message: 'Failed to start NovaGameDetector.exe.',
            details: {
              message: fallbackError?.message || error?.message || 'Unknown start error'
            }
          });
          return;
        }
      } else {
        resolve({
          ok: false,
          code: 'GAME_DETECTOR_START_FAILED',
          message: 'Failed to start NovaGameDetector.exe.',
          details: {
            message: error?.message || 'Unknown start error'
          }
        });
        return;
      }
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1000, Math.trunc(Number(timeoutMs) || DEFAULT_GAME_DETECTION_TIMEOUT_MS)));

    const finalize = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finalize({
        ok: false,
        code: 'GAME_DETECTOR_START_FAILED',
        message: 'Failed to start NovaGameDetector.exe.',
        details: {
          message: error?.message || 'Unknown start error',
          viaPowerShell: usedPowerShellFallback
        }
      });
    });

    child.on('close', (exitCode) => {
      if (timedOut) {
        finalize({
          ok: false,
          code: 'GAME_DETECTOR_TIMEOUT',
          message: 'Game detector helper timed out.',
          details: {
            timeoutMs
          }
        });
        return;
      }

      const trimmedStdout = String(stdout || '').trim();
      const trimmedStderr = String(stderr || '').trim();

      if (exitCode !== 0) {
        finalize({
          ok: false,
          code: 'GAME_DETECTOR_EXIT_NON_ZERO',
          message: 'Game detector helper exited with a non-zero code.',
          details: {
            exitCode,
            stderr: trimmedStderr,
            stdout: trimmedStdout
          }
        });
        return;
      }

      if (!trimmedStdout) {
        finalize({
          ok: false,
          code: 'GAME_DETECTOR_EMPTY_OUTPUT',
          message: 'Game detector helper returned empty output.',
          details: {
            stderr: trimmedStderr
          }
        });
        return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (error) {
        finalize({
          ok: false,
          code: 'GAME_DETECTOR_INVALID_JSON',
          message: 'Game detector helper returned invalid JSON.',
          details: {
            message: error?.message || 'JSON parse failed',
            outputPreview: trimmedStdout.slice(0, 1000),
            stderr: trimmedStderr
          }
        });
        return;
      }

      const normalized = normalizeDetectionResult(parsed, trimmedStderr);
      finalize({
        ok: true,
        result: normalized,
        stderr: trimmedStderr,
        helperExecutablePath,
        viaPowerShell: usedPowerShellFallback
      });
    });
  });
}

module.exports = {
  runGameDetectionScan,
  normalizeDetectionResult
};
