const { spawn } = require('node:child_process');
const { resolveWindowsSystemExecutable } = require('../security/systemExecutables');

// One Windows PowerShell session for the existing watcher. The identity helper
// is compiled once per worker, rather than starting PowerShell/C# every poll.
function createProcessSnapshotWorker({ script, spawnProcess = spawn, timeoutMs = 4500 } = {}) {
  const queryOffset = script.indexOf('$items =');
  if (queryOffset < 0) throw new Error('Process snapshot query is missing.');
  const initialization = script.slice(0, queryOffset);
  const query = script.slice(queryOffset);
  let child = null, pending = null, sequence = 0, output = '';

  function fail(error, owner = child) {
    if (owner !== child) return;
    const current = child;
    child = null; output = '';
    if (pending) {
      clearTimeout(pending.timer);
      const reject = pending.reject;
      pending = null;
      reject(error);
    }
    current?.kill();
  }

  function ensureWorker() {
    if (child) return;
    const worker = spawnProcess(resolveWindowsSystemExecutable('powershell'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = worker;
    worker.on('error', (error) => fail(error, worker));
    worker.on('close', () => fail(new Error('Process snapshot worker exited.'), worker));
    worker.stdin.on('error', (error) => fail(error, worker));
    worker.stderr.on('data', () => {});
    worker.stdout.on('data', (chunk) => {
      if (worker !== child) return;
      output += chunk.toString();
      if (output.length > 8 * 1024 * 1024) return fail(new Error('Process snapshot response exceeded its limit.'), worker);
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (!pending || !line.startsWith(`NOVA_SNAPSHOT:${pending.id}:`)) continue;
        const payload = line.slice(`NOVA_SNAPSHOT:${pending.id}:`.length);
        try {
          const result = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
          if (!result.ok || !Array.isArray(result.processes)) throw new Error(result.message || 'Invalid process snapshot.');
          const current = pending;
          pending = null; clearTimeout(current.timer);
          current.resolve(result.processes);
        } catch (error) { fail(error, worker); }
      }
    });
  }

  function snapshot({ includeMetrics = true } = {}) {
    if (pending) return pending.promise;
    ensureWorker();
    const id = ++sequence;
    const command = `try {
      if (-not ('NovaProcessIdentity' -as [type])) {
        ${initialization}
        if (-not ('NovaProcessIdentity' -as [type])) { throw 'Process identity initialization failed.' }
      }
      $includeMetrics = ${includeMetrics ? '$true' : '$false'}
      $ErrorActionPreference = 'Stop'
      $json = & { ${query} }
      $processes = if ([string]::IsNullOrWhiteSpace([string]$json)) { @() } else { @($json | ConvertFrom-Json -ErrorAction Stop) }
      $response = @{ ok = $true; processes = @($processes) } | ConvertTo-Json -Depth 5 -Compress
    } catch { $response = @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress }
    [Console]::Out.WriteLine('NOVA_SNAPSHOT:${id}:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($response)))`;
    // A single line avoids PowerShell stdin's interactive multiline buffering.
    const encoded = Buffer.from(command, 'utf8').toString('base64');
    const worker = child;
    const promise = new Promise((resolve, reject) => {
      pending = { id, resolve, reject, timer: setTimeout(() => {
        if (pending?.id === id) fail(new Error('Process snapshot timed out.'), worker);
      }, timeoutMs) };
    });
    pending.promise = promise;
    worker.stdin.write(`& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))))\n`, (error) => {
      if (error) fail(error, worker);
    });
    return promise;
  }

  return { snapshot, stop: () => fail(new Error('Process snapshot worker stopped.')) };
}

module.exports = { createProcessSnapshotWorker };
