const path = require('path');
const { execFile } = require('child_process');
const { WINDOWS_PROCESS_SCRIPT, isProtectedProcess } = require('../automation/processWatcherService');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

// Exact executable names and installation-directory segments; WebView and
// generic Electron helpers deliberately do not qualify.
const APP_PATHS = Object.freeze({
  'onedrive.exe': ['microsoft\\onedrive'],
  'dropbox.exe': ['dropbox\\client'],
  'googledrivefs.exe': ['google\\drive file stream'],
  'phoneexperiencehost.exe': ['microsoft.yourphone_'],
  'widgets.exe': ['microsoftwindows.client.webexperience_'],
  'chrome.exe': ['google\\chrome\\application'],
  'msedge.exe': ['microsoft\\edge\\application'],
  'firefox.exe': ['mozilla firefox'],
  'brave.exe': ['bravesoftware\\brave-browser\\application'],
  'opera.exe': ['programs\\opera', 'programs\\opera gx', 'opera\\'],
  'teams.exe': ['microsoft\\teams\\current'],
  'ms-teams.exe': ['msteams_'],
  'skype.exe': ['microsoft\\skype for desktop', 'microsoft.skypeapp_'],
  'zoom.exe': ['zoom\\bin'],
  'obs64.exe': ['obs-studio\\bin\\64bit'],
  'streamlabs desktop.exe': ['streamlabs obs', 'streamlabs desktop']
});
const PROTECTED_NAMES = new Set(['discord', 'discordcanary', 'discordptb', 'steam', 'steamwebhelper', 'epicgameslauncher', 'epicwebhelper', 'galaxyclient', 'goggalaxy', 'eadesktop', 'ealauncher', 'origin', 'battle.net', 'agent', 'ubisoftconnect', 'upc', 'riotclientservices', 'riotclientux', 'easyanticheat', 'easyanticheat_eos', 'beservice', 'vgc', 'vgtray', 'gamingservices', 'gamingservicesnet', 'xboxpcapp']);
function normalizedPath(value) { return String(value || '').replaceAll('/', '\\').toLowerCase(); }
function matchesApp(processInfo) {
  const image = normalizedPath(processInfo.executablePath);
  const name = path.win32.basename(image);
  // Only canonical absolute Windows paths with matching installation segments.
  if (!/^[a-z]:\\/.test(image) || image.split('\\').includes('..')) return false;
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean).map(normalizedPath);
  if (!roots.some((root) => image.startsWith(root.replace(/\\$/, '') + '\\'))) return false;
  return APP_PATHS[name]?.some((segment) => image.includes('\\' + segment)) === true;
}

function selectBackgroundApps(processes, games = []) {
  const protectedIds = new Set();
  const gamePaths = new Set(games.map((game) => normalizedPath(game?.executablePath)).filter(Boolean));
  for (const item of processes) {
    const name = String(item.name || '').toLowerCase().replace(/\.exe$/, '');
    if (isProtectedProcess(item) || PROTECTED_NAMES.has(name) || gamePaths.has(normalizedPath(item.executablePath)) || games.some((game) => Number(game?.pid || game?.processId) === item.pid)) protectedIds.add(item.pid);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) if (protectedIds.has(item.parentPid) && !protectedIds.has(item.pid)) { protectedIds.add(item.pid); changed = true; }
  }
  return processes.filter((item) => matchesApp(item)).map((item) => ({
    ...item,
    skipReason: protectedIds.has(item.pid) ? 'PROTECTED_PROCESS'
      : !item.ownerSid || item.ownerSid !== item.currentSid ? 'PROCESS_OWNER_UNVERIFIED'
        : !item.startTime || !item.executablePath ? 'PROCESS_IDENTITY_MISSING'
          : !Number.isInteger(item.parentPid) || item.parentPid < 0 ? 'PROCESS_ANCESTRY_UNVERIFIED' : null
  }));
}

function runJson(script, timeout = 15000) {
  return new Promise((resolve, reject) => execFile(resolveWindowsSystemExecutable('powershell'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 },
    (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    }));
}

async function snapshotApps(run = runJson) {
  const names = Object.keys(APP_PATHS).map((name) => name.replace(/\.exe$/, ''));
  const data = Buffer.from(JSON.stringify(names)).toString('base64');
  const enrichment = String.raw`
$names = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$metadata = @{}
Get-CimInstance Win32_Process | ForEach-Object { $metadata[[int]$_.ProcessId] = $_ }
foreach ($item in $items) {
  $meta = $metadata[$item.pid]
  $owner = ''
  if ($names -contains $item.name -and $meta) { try { $owner = (Invoke-CimMethod -InputObject $meta -MethodName GetOwnerSid -ErrorAction Stop).Sid } catch {} }
  $parent = -1
  if ($meta) { $parent = [int]$meta.ParentProcessId }
  $item | Add-Member -NotePropertyName parentPid -NotePropertyValue $parent
  $item | Add-Member -NotePropertyName ownerSid -NotePropertyValue $owner
  $item | Add-Member -NotePropertyName currentSid -NotePropertyValue $sid
}
ConvertTo-Json -InputObject @($items) -Depth 5 -Compress`;
  return run(WINDOWS_PROCESS_SCRIPT.replace('$items | ConvertTo-Json -Depth 4 -Compress', enrichment));
}

async function closeApps(targets, run = runJson) {
  if (!targets.length) return [];
  const data = Buffer.from(JSON.stringify(targets.map(({ pid, startTime, executablePath, ownerSid }) => ({ pid, startTime, executablePath, ownerSid })))).toString('base64');
  // Reuse the watcher's limited-access image/start-time reader in this process.
  const identityScript = WINDOWS_PROCESS_SCRIPT.split('$items =')[0];
  const script = identityScript + String.raw`
$targets = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$results = @()
foreach ($item in $targets) {
  $result = @{ pid = $item.pid; name = [IO.Path]::GetFileName($item.executablePath); status = 'skipped'; code = 'PROCESS_IDENTITY_CHANGED' }
  try {
    $target = Get-Process -Id $item.pid -ErrorAction Stop
    $identity = [NovaProcessIdentity]::Query([int]$item.pid)
    $meta = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$item.pid) -ErrorAction Stop
    $owner = (Invoke-CimMethod -InputObject $meta -MethodName GetOwnerSid -ErrorAction Stop).Sid
    if ($identity[0] -and $identity[0] -eq $item.executablePath -and $identity[1] -eq $item.startTime -and $owner -eq $sid -and $owner -eq $item.ownerSid) {
      $result.status = 'skipped'; $result.code = 'APP_CLOSE_UNSUPPORTED'
      if ($target.MainWindowHandle -ne 0 -and $target.CloseMainWindow()) { $result.status = 'requested'; $result.code = '' }
    }
  } catch { $result.code = 'PROCESS_UNAVAILABLE' }
  $results += $result
}
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $pending = $false
  foreach ($result in $results) {
    if ($result.status -ne 'requested') { continue }
    $identity = [NovaProcessIdentity]::Query([int]$result.pid)
    $original = $targets | Where-Object pid -eq $result.pid | Select-Object -First 1
    if (-not $identity[1] -or $identity[1] -ne $original.startTime) { $result.status = 'closed' } else { $pending = $true }
  }
  if ($pending -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
} while ($pending -and [DateTime]::UtcNow -lt $deadline)
foreach ($result in $results) { if ($result.status -eq 'requested') { $result.status = 'skipped'; $result.code = 'APP_STILL_RUNNING' } }
ConvertTo-Json -InputObject @($results) -Depth 5 -Compress`;
  return run(script, 20000);
}

async function minimizeBackgroundApps({ games = [], snapshot = snapshotApps, close = closeApps } = {}) {
  const candidates = selectBackgroundApps(await snapshot(), games);
  const skipped = candidates.filter((item) => item.skipReason).map((item) => ({ pid: item.pid, name: item.name, status: 'skipped', code: item.skipReason }));
  // Browser/Electron child processes share their executable with the app. The
  // normal window-close request belongs to the owning instance, not each helper.
  const eligible = candidates.filter((item) => !item.skipReason);
  const targets = eligible.filter((item) => item.mainWindowHandle || !eligible.some((parent) => parent.pid === item.parentPid && normalizedPath(parent.executablePath) === normalizedPath(item.executablePath)));
  return [...skipped, ...await close(targets)];
}

module.exports = { APP_PATHS, matchesApp, selectBackgroundApps, minimizeBackgroundApps, snapshotApps, closeApps };
