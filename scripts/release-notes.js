const fs = require('node:fs');
function extractReleaseNotes(changelog, version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  const sections = [...changelog.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  const matches = sections.map((section, index) => ({ section, end: sections[index + 1]?.index ?? changelog.length }))
    .filter(({ section }) => section[1] === version || section[1].startsWith(`${version} - `));
  if (matches.length !== 1) throw new Error(`Expected exactly one changelog section for ${version}, found ${matches.length}.`);
  const { section, end } = matches[0];
  const notes = changelog.slice(section.index + section[0].length, end).trim();
  if (!notes.replace(/^#+.*$/gm, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').trim()) throw new Error(`Changelog section ${version} is empty.`);
  return notes;
}
if (require.main === module) {
  const version = require('../package.json').version;
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Tag does not match package version.');
  const notes = extractReleaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), version);
  fs.writeFileSync('release-notes.md', `${notes}\n\nThis installer is unsigned. Windows may show an unknown-publisher warning.\nVerify the installer against the included checksums.txt file before running it.\n`);
}
module.exports = { extractReleaseNotes };
