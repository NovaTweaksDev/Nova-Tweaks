const { hashFile, artifactName } = require('./validate-release');
const fs = require('fs');
const path = require('path');

function writeChecksum(directory, artifact) {
  if (path.basename(artifact) !== artifact || !artifact.endsWith('.exe')) throw new Error('Invalid checksum artifact.');
  const output = `${hashFile(path.join(directory, artifact))}  ${artifact}\n`;
  fs.writeFileSync(path.join(directory, 'checksums.txt'), output, 'utf8');
  return output;
}
if (require.main === module) {
  const directory = path.resolve(process.argv[2] || 'dist-release');
  const profile = process.argv[3] || 'stable';
  writeChecksum(directory, artifactName(profile, require('../package.json').version));
  console.log('Final installer SHA-256 written.');
}
module.exports = { writeChecksum };
