const fs = require('node:fs');
const path = require('node:path');
const { validateRelease, verifyChecksum } = require('./validate-release');
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
function formatDistributionNotes(notes, profile, report) {
  if (profile === 'preview') return `${notes}\n\nUnsigned preview for evaluation. Windows may display an unknown-publisher or reputation warning.\nVerify checksums.txt before installation.\n`;
  if (!['stable', 'store'].includes(profile) || report?.mode?.toLowerCase() !== profile || !Array.isArray(report.files) || report.files.length === 0 || report.failures?.length !== 0) {
    throw new Error('Signed release notes require a successful signature report for this variant.');
  }
  const nova = report.files.filter((file) => file.owner === 'Nova');
  if (!nova.length || nova.some((file) => file.status !== 'Valid' || !file.timestampAuthority || !file.publisher)) throw new Error('Nova signature evidence is incomplete.');
  const publishers = [...new Set(nova.map((file) => file.publisher))];
  if (publishers.length !== 1) throw new Error('Nova publisher identity is inconsistent.');
  const unsigned = report.files.filter((file) => file.status === 'NotSigned');
  const redistributed = report.files.filter((file) => file.redistributedByNova === true);
  if (profile === 'store' && unsigned.length) throw new Error('Store release cannot contain unsigned PE files.');
  return `${notes}\n\nWindows distribution: ${profile}. Nova executables and installer: validated Authenticode signatures and timestamps.\nPublisher: ${publishers[0]}.\n${redistributed.length ? `Includes ${redistributed.length} reviewed upstream PE files signed by Nova as distributor; original code content and existing vendor signatures are preserved. See redistribution-signing.json and bundled third-party notices/source records.\n` : ''}${unsigned.length ? `Includes ${unsigned.length} hash-pinned unsigned upstream PE files; see signatures.json. This package does not meet Store all-PE signing requirements.\n` : ''}SHA-256 in checksums.txt covers the final installer after signing.\nValid signatures do not guarantee SmartScreen reputation. Installation and hardware-specific behavior require separate VM verification.\n`;
}
if (require.main === module) {
  const version = require('../package.json').version;
  const directory = path.resolve(process.argv[2] || '');
  const profile = process.argv[3];
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
  if (tag && tag !== `${profile === 'preview' ? 'preview-v' : 'v'}${version}`) throw new Error('Tag does not match package version.');
  const release = validateRelease(directory, profile, { expectedCommit: process.env.NOVA_RELEASE_COMMIT, requireClean: true });
  verifyChecksum(directory, release.installer);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'signatures.json'), 'utf8').replace(/^\uFEFF/, ''));
  const installer = report.files.find((file) => file.path === release.installer);
  if (!installer || installer.sha256 !== release.installerSha256) throw new Error('Signature evidence does not match the final installer.');
  const notes = extractReleaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), version);
  fs.writeFileSync('release-notes.md', formatDistributionNotes(notes, profile, report));
}
module.exports = { extractReleaseNotes, formatDistributionNotes };
