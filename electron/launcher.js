const { spawn } = require('child_process');

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
