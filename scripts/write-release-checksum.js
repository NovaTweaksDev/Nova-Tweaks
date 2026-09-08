const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(__dirname, '..', 'dist-release');
const packageMetadata = require('../package.json');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release directory not found: ${releaseDir}`);
  }

  const expectedArtifactName = `NovaTweaks-Setup-${packageMetadata.version}-x64.exe`;
  const artifacts = fs
    .readdirSync(releaseDir)
    .filter((name) => name === expectedArtifactName);

  if (artifacts.length !== 1) {
    throw new Error(`Expected release artifact was not found: ${path.join(releaseDir, expectedArtifactName)}`);
  }

  const lines = artifacts.map((name) => `${sha256File(path.join(releaseDir, name))}  ${name}`);
  const outputPath = path.join(releaseDir, 'checksums.txt');
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(`Wrote ${outputPath}`);
  for (const line of lines) {
    console.log(line);
  }
}

main();
