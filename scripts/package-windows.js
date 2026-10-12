const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { resolveBuildProfile } = require('./build-profile');
const { artifactName, validateRelease, verifyChecksum } = require('./validate-release');
const { writeChecksum } = require('./write-release-checksum');
const { windowsPowerShellEnv } = require('./windows-powershell-env');

const root = path.resolve(__dirname, '..');
const profile = resolveBuildProfile({ NOVA_BUILD_PROFILE: process.argv[2] });
const directoryOnly = process.argv.includes('--dir');
const env = { ...process.env, NOVA_BUILD_PROFILE: profile.name, NOVA_LOCAL_TEST_BUILD: String(profile.localTest) };
if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows.');
if (process.env.NOVA_LOCAL_TEST_BUILD === 'true' && !profile.localTest) throw new Error('Refusing a local-test bypass in this release.');
const output = path.join(root, '.cache', 'packaging', profile.name);
const thumbprint = process.env.NOVA_SIGNING_THUMBPRINT || require('../package.json').build.win.signtoolOptions.certificateSha1;
env.NOVA_SIGNING_THUMBPRINT = thumbprint;

function runNode(file, args = []) {
  execFileSync(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit' });
}
function runPowerShell(file, args = []) {
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', file, ...args], {
    cwd: root, env: windowsPowerShellEnv(env), windowsHide: true, stdio: 'inherit'
  });
}
function prepareSignedHelpers() {
  const resources = require('./signed-helper-resources');
  const { assertBundledSidecarIntegrity, computeSidecarSha256 } = require('../electron/services/security/bundledSidecarIntegrity');
  const stagedRoot = path.join(root, '.cache', 'signed-resources');
  fs.rmSync(stagedRoot, { recursive: true, force: true });
  const signedHashes = {};
  for (const resource of resources) {
    const source = path.join(root, resource.from);
    if (resource.policy) assertBundledSidecarIntegrity(source, resource.policy);
    const staged = path.join(stagedRoot, resource.from);
    fs.cpSync(source, staged, { recursive: true });
    for (const file of resource.files) {
      runPowerShell('scripts/sign-nova-file.ps1', ['-File', path.join(staged, file), '-Thumbprint', thumbprint, '-SignTool', process.env.NOVA_SIGNTOOL]);
    }
    if (resource.policy) signedHashes[resource.policy] = computeSidecarSha256(staged, resource.policy);
  }
  fs.writeFileSync(path.join(root, 'electron/generated/signed-helper-integrity.js'), `module.exports = ${JSON.stringify(signedHashes)};\n`);
}

async function main() {
  const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  if (profile.signed && (!/^[a-f0-9]{40}$/i.test(thumbprint) || !process.env.NOVA_SIGNTOOL)) {
    throw new Error('Set NOVA_SIGNTOOL to Windows SDK SignTool and unlock the reviewed Certum/SimplySign certificate.');
  }
  fs.rmSync(output, { recursive: true, force: true });
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Application build failed.');
  if (profile.signed) prepareSignedHelpers();
  runNode('node_modules/electron-builder/cli.js', ['--config', 'electron-builder.windows.cjs', '--win', directoryOnly ? 'dir' : 'nsis', '--x64', '--publish', 'never']);
  // NSIS leaves its temporary app.exe (uninstaller generation) in the output cache.
  // It is neither an installed file nor a publication input.
  const packagingCache = path.resolve(output, '.cache');
  if (path.dirname(packagingCache) !== path.resolve(output)) throw new Error('Unexpected packaging cache.');
  fs.rmSync(packagingCache, { recursive: true, force: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(output, 'release-build.json'), JSON.stringify({
    schemaVersion: 1, profile: profile.name, version: require('../package.json').version, commit, sourceDirty
  }, null, 2) + '\n');
  runNode('scripts/packaged-smoke.js', [path.join(output, 'win-unpacked', 'NovaTweaks.exe')]);
  validateRelease(output, profile.name, { requireInstaller: !directoryOnly, expectedCommit: commit });
  if (!directoryOnly) {
    const extraction = await require('./verify-installer-payload').verifyInstallerPayload(
      path.join(output, artifactName(profile.name, require('../package.json').version)),
      path.join(output, 'win-unpacked'), profile.name
    );
    runPowerShell('scripts/verify-windows-signatures.ps1', [
      '-Root', extraction, '-Mode', profile.signed ? (profile.store ? 'Store' : 'Stable') : 'Audit',
      '-ExpectedThumbprint', thumbprint, '-ReportPath', path.join(output, 'installer-payload-signatures.json'),
      ...(profile.signed ? ['-SignTool', process.env.NOVA_SIGNTOOL] : [])
    ]);
  }
  runPowerShell('scripts/verify-windows-signatures.ps1', [
    '-Root', output, '-Mode', profile.signed ? (profile.store ? 'Store' : 'Stable') : 'Audit',
    '-ExpectedThumbprint', thumbprint, '-ReportPath', path.join(output, 'signatures.json'),
    ...(profile.signed ? ['-SignTool', process.env.NOVA_SIGNTOOL] : [])
  ]);
  if (directoryOnly) return;
  const artifact = artifactName(profile.name, require('../package.json').version);
  writeChecksum(output, artifact);
  verifyChecksum(output, artifact);
  require('./retain-release-output').promoteValidatedRelease(output, profile.name);
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
