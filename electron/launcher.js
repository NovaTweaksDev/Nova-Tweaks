const { spawn } = require('child_process');

// Refresh local tweak hashes before Electron and its administrator worker load them.
require('../scripts/generate-bundled-tweak-manifest');

const electronBinary = require('electron');
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.'], {
  env,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  console.error('Failed to launch Electron:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
    return;
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(1);
});
