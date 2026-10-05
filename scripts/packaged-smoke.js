const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
async function main() {
  if (process.platform !== 'win32') throw new Error('Packaged smoke test requires Windows.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-smoke-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(path.resolve('dist-release/win-unpacked/NovaTweaks.exe'), ['--nova-packaged-smoke'], {
        windowsHide: true, stdio: 'inherit', env: { ...process.env, NOVA_SMOKE_USER_DATA: directory }
      });
      const timer = setTimeout(() => { child.kill(); }, 45000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Packaged smoke failed: ${code}`)); });
    });
  } finally {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('nova-smoke-')) throw new Error('Unexpected smoke directory.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
