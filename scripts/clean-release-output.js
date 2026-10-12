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

if (fs.existsSync(releaseDirectory)) {
  console.log('Keeping the last validated release. Packaging stages replacements in .cache and cleans superseded releases only after validation.');
}
