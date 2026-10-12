const fs = require('node:fs');
const path = require('node:path');

function promoteValidatedRelease(source, profile, root = path.resolve(__dirname, '..', 'dist-release')) {
  const absoluteRoot = path.resolve(root);
  if (!/^[a-z-]+$/.test(profile)) throw new Error('Invalid release profile.');
  if (fs.existsSync(absoluteRoot) && fs.lstatSync(absoluteRoot).isSymbolicLink()) throw new Error('Release root cannot be a reparse point.');
  const absoluteSource = fs.realpathSync(source);
  if (absoluteSource === absoluteRoot || absoluteSource.startsWith(absoluteRoot + path.sep)) throw new Error('Release source must be outside dist-release.');
  const destination = path.resolve(absoluteRoot, `${profile}-${require('../package.json').version}`);
  if (path.dirname(destination) !== absoluteRoot) throw new Error('Unexpected release destination.');
  const staging = path.join(absoluteRoot, `replacement-${Date.now()}`);
  fs.mkdirSync(absoluteRoot, { recursive: true });
  fs.cpSync(absoluteSource, staging, {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(absoluteSource, file);
      return relative !== '.cache' && relative !== 'builder-debug.yml' && !relative.endsWith('.blockmap');
    }
  });
  const selected = fs.existsSync(destination) ? `${destination}-${Date.now()}` : destination;
  fs.renameSync(staging, selected);
  for (const entry of fs.readdirSync(absoluteRoot)) {
    const target = path.resolve(absoluteRoot, entry);
    if (path.dirname(target) !== absoluteRoot || target === selected) continue;
    try { fs.rmSync(target, { recursive: true, force: true }); }
    catch (error) { console.warn(`Previous release cleanup blocked; retained ${entry}: ${error.code}`); }
  }
  console.log(`Validated release retained: ${selected}`);
  return selected;
}
module.exports = { promoteValidatedRelease };
