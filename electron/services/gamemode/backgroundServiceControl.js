const { execFile } = require('child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

const SERVICE_NAMES = Object.freeze([
  'DPS', 'wisvc', 'SysMain', 'WSearch', 'Spooler', 'lfsvc',
  'TabletInputService', 'RemoteRegistry', 'RetailDemo', 'SCardSvr', 'bthserv',
  'DiagTrack', 'Fax', 'XboxGipSvc', 'XboxNetApiSvc', 'XblAuthManager', 'XblGameSave', 'XboxSvc'
]);
const MODES = new Set(['Automatic', 'Manual', 'Disabled']);
function validState(state) {
  return state && MODES.has(state.startType) && typeof state.delayed === 'boolean' && ['Running', 'Stopped'].includes(state.status);
}

// All command text is bundled. Only validated data crosses the broker boundary.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__REQUEST__')) | ConvertFrom-Json
function Read-State($name) {
  try { $svc = Get-Service -Name $name -ErrorAction Stop }
  catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { return $null }; throw }
  $reg = Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $name)
  $delayed = $false
  if ($reg.PSObject.Properties.Name -contains 'DelayedAutoStart') { $delayed = [int]$reg.DelayedAutoStart -eq 1 }
  @{ name = $name; startType = $svc.StartType.ToString(); delayed = $delayed; status = $svc.Status.ToString(); dependents = @($svc.DependentServices | Where-Object Status -ne 'Stopped' | ForEach-Object Name) }
}
function Same-State($actual, $expected) {
  return $actual -and $actual.startType -eq $expected.startType -and $actual.delayed -eq $expected.delayed -and $actual.status -eq $expected.status
}
if ($request.action -eq 'read') {
  $items = @($request.names | ForEach-Object { $state = Read-State $_; if ($state) { $state } })
  ConvertTo-Json -InputObject $items -Depth 5 -Compress
  exit 0
}
$name = $request.name
$current = Read-State $name
if (-not (Same-State $current $request.expected)) { @{ ok = $false; code = 'SERVICE_STATE_CONFLICT'; state = $current } | ConvertTo-Json -Depth 5 -Compress; exit 0 }
if ($request.action -eq 'disable' -and @($current.dependents).Count -gt 0) {
  @{ ok = $false; code = 'SERVICE_DEPENDENTS_RUNNING'; state = $current } | ConvertTo-Json -Depth 5 -Compress; exit 0
}
try {
  $target = $request.target
  if ($target.status -eq 'Stopped' -and $current.status -ne 'Stopped') {
    # No -Force: never stop dependent services implicitly.
    Stop-Service -Name $name -ErrorAction Stop -NoWait
    (Get-Service -Name $name).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(8))
  }
  Set-Service -Name $name -StartupType $target.startType -ErrorAction Stop
  $regPath = 'HKLM:\SYSTEM\CurrentControlSet\Services\' + $name
  Set-ItemProperty -LiteralPath $regPath -Name DelayedAutoStart -Type DWord -Value ([int][bool]$target.delayed)
  if ($target.status -eq 'Running') {
    Start-Service -Name $name -ErrorAction Stop
    (Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(8))
  }
  $after = Read-State $name
  @{ ok = (Same-State $after $target); code = 'SERVICE_VERIFICATION'; state = $after } | ConvertTo-Json -Depth 5 -Compress
} catch {
  @{ ok = $false; code = 'SERVICE_CHANGE_FAILED'; message = $_.Exception.Message; state = (Read-State $name) } | ConvertTo-Json -Depth 5 -Compress
}
`;

function validateRequest(payload) {
  if (!payload || !['read', 'disable', 'restore'].includes(payload.action)) throw new Error('Invalid service action');
  const keys = payload.action === 'read' ? ['action'] : ['action', 'name', 'expected', 'target'];
  if (Object.keys(payload).some((key) => !keys.includes(key))) throw new Error('Unknown service parameter');
  if (payload.action === 'read') return { action: 'read', names: SERVICE_NAMES };
  if (!SERVICE_NAMES.includes(payload.name) || !validState(payload.expected) || !validState(payload.target)) throw new Error('Invalid service state');
  const pick = (state) => ({ startType: state.startType, delayed: state.delayed, status: state.status });
  const target = pick(payload.target);
  if (payload.action === 'disable' && (target.startType !== 'Disabled' || target.status !== 'Stopped' || target.delayed !== payload.expected.delayed)) throw new Error('Invalid disable target');
  if (target.startType === 'Disabled' && target.status === 'Running') throw new Error('Invalid running target');
  return { action: payload.action, name: payload.name, expected: pick(payload.expected), target };
}

function createBackgroundServiceControl({ execute = execFile } = {}) {
  return async (payload) => {
    let request;
    try { request = validateRequest(payload); }
    catch (error) { throw Object.assign(error, { code: 'ADMIN_BROKER_INVALID_PAYLOAD' }); }
    const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
    return new Promise((resolve, reject) => {
      execute(resolveWindowsSystemExecutable('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT.replace('__REQUEST__', encoded)],
        { windowsHide: true, encoding: 'utf8', timeout: 22000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          if (error) return reject(error);
          try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
        });
    });
  };
}

module.exports = { SERVICE_NAMES, validState, validateRequest, createBackgroundServiceControl };
