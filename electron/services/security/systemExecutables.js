const fs = require('fs');
const path = require('path');

const WINDOWS_EXECUTABLES = Object.freeze({
  cmd: ['System32', 'cmd.exe'],
  msiexec: ['System32', 'msiexec.exe'],
  powershell: ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
  reg: ['System32', 'reg.exe'],
  taskkill: ['System32', 'taskkill.exe'],
  tasklist: ['System32', 'tasklist.exe']
});

class SystemExecutableError extends Error {
  constructor(message, code = 'TRUSTED_SYSTEM_EXECUTABLE_UNAVAILABLE') {
    super(message);
    this.name = 'SystemExecutableError';
    this.code = code;
  }
}

function normalizeWindowsRoot(value) {
  const raw = String(value || '').trim();
  if (!raw || !path.win32.isAbsolute(raw) || raw.startsWith('\\\\')) {
    return '';
  }
  return path.win32.resolve(raw).replace(/[\\/]+$/, '');
}

function resolveWindowsRoot() {
  if (process.platform !== 'win32') {
    return '';
  }

  const roots = [
    normalizeWindowsRoot(process.env.SystemRoot),
    normalizeWindowsRoot(process.env.WINDIR)
  ].filter(Boolean);
  if (!roots.length) {
    throw new SystemExecutableError('The Windows system directory is unavailable.');
  }
  if (roots.some((entry) => entry.toLowerCase() !== roots[0].toLowerCase())) {
    throw new SystemExecutableError('Conflicting Windows system directories were supplied.');
  }

  const windowsRoot = roots[0];
  if (!fs.existsSync(windowsRoot) || !fs.statSync(windowsRoot).isDirectory()) {
    throw new SystemExecutableError('The Windows system directory is unavailable.');
  }
  return windowsRoot;
}

function resolveWindowsSystemExecutable(name) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const relativeSegments = WINDOWS_EXECUTABLES[normalizedName];
  if (!relativeSegments) {
    throw new SystemExecutableError('The requested system executable is not allowlisted.');
  }
  if (process.platform !== 'win32') {
    return relativeSegments[relativeSegments.length - 1];
  }

  const windowsRoot = resolveWindowsRoot();
  const executablePath = path.win32.resolve(windowsRoot, ...relativeSegments);
  const expectedPrefix = `${windowsRoot.toLowerCase()}\\`;
  if (
    !executablePath.toLowerCase().startsWith(expectedPrefix)
    || !fs.existsSync(executablePath)
    || !fs.statSync(executablePath).isFile()
  ) {
    throw new SystemExecutableError('A trusted Windows system executable is unavailable.');
  }
  return executablePath;
}

function hardenWindowsChildProcessEnvironment() {
  if (process.platform !== 'win32') {
    return;
  }

  const windowsRoot = resolveWindowsRoot();
  const trustedDirectories = [
    path.win32.join(windowsRoot, 'System32'),
    path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    path.win32.join(windowsRoot, 'System32', 'Wbem'),
    windowsRoot
  ];
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path';
  const existingEntries = String(process.env[pathKey] || '')
    .split(path.win32.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => (
      path.win32.isAbsolute(entry)
      && !entry.startsWith('\\\\')
    ));
  const seen = new Set();
  const safePathEntries = [...trustedDirectories, ...existingEntries].filter((entry) => {
    const normalized = path.win32.resolve(entry).toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });

  process.env[pathKey] = safePathEntries.join(path.win32.delimiter);
  process.env.ComSpec = resolveWindowsSystemExecutable('cmd');
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
}

module.exports = {
  SystemExecutableError,
  hardenWindowsChildProcessEnvironment,
  resolveWindowsRoot,
  resolveWindowsSystemExecutable
};
