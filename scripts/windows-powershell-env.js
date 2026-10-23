// PowerShell 7's module path must not leak into Windows PowerShell 5.1.
function windowsPowerShellEnv(input = process.env) {
  const env = { ...input };
  for (const name of Object.keys(env)) {
    if (name.toLowerCase() === 'psmodulepath') delete env[name];
  }
  return env;
}
module.exports = { windowsPowerShellEnv };
