const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const { hashFile } = require('./validate-release');

async function verifyInstallerPayload(installer, unpacked, profile) {
  const root = path.resolve(__dirname, '..', '.cache', 'installer-inspection');
  const extraction = path.resolve(root, profile);
  if (!/^[a-z-]+$/.test(profile) || path.dirname(extraction) !== root) throw new Error('Invalid extraction target.');
  fs.rmSync(extraction, { recursive: true, force: true });
  fs.mkdirSync(extraction, { recursive: true });
  // Read archive bytes only; never run the installer.
  execFileSync(await getPath7za(), ['x', path.resolve(installer), '-o' + extraction, '-y'], { windowsHide: true, stdio: 'pipe' });
  const verify = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Reparse point in installer comparison.');
      if (entry.isDirectory()) { verify(source); continue; }
      const relative = path.relative(unpacked, source);
      const extracted = path.join(extraction, relative);
      if (!fs.existsSync(extracted) || hashFile(source) !== hashFile(extracted)) {
        throw new Error(`Final installer payload differs from validated package: ${relative}`);
      }
    }
  };
  verify(path.resolve(unpacked));
  return extraction;
}
module.exports = { verifyInstallerPayload };
