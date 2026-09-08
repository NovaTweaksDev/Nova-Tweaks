const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.resolve(projectRoot, 'dist-release');

if (
  path.dirname(releaseDirectory) !== projectRoot
  || path.basename(releaseDirectory) !== 'dist-release'
) {
  throw new Error(`Refusing to clean unexpected release path: ${releaseDirectory}`);
}

fs.rmSync(releaseDirectory, { recursive: true, force: true });
console.log(`Cleaned ${releaseDirectory}`);
