const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { assertBundledSidecarIntegrity } = require('../security/bundledSidecarIntegrity');

function createDisplayProfileProvider({ app, helperPath, watchErrorPath, spawnProcess = spawn, logger } = {}) {
  const executable = helperPath || path.join(app?.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../..'),
    'tools', 'nvidia-display-helper', 'bin', 'nvidia-display-helper.exe');
  function check() {
    if (process.platform !== 'win32') throw Object.assign(new Error('Display profiles require Windows.'), { code: 'UNSUPPORTED_PLATFORM' });
    if (app?.isPackaged) assertBundledSidecarIntegrity(path.dirname(executable), 'nvidia-display-helper');
  }
  const argsFor = (snapshot) => ['--monitor', Buffer.from(snapshot.id, 'utf8').toString('hex'), '--token', snapshot.token];
  const summary = (snapshot) => ({
    width: snapshot.width, height: snapshot.height, refresh: snapshot.refresh,
    signal: snapshot.signal, scaling: snapshot.scaling, vibrance: snapshot.vibrance,
    nativeState: snapshot.nativeState
  });
  function run(args) {
    check();
    return new Promise((resolve, reject) => {
      execFile(executable, args, { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) return reject(Object.assign(new Error(stderr.trim() || error.message), { code: 'DISPLAY_HELPER_FAILED' }));
        try { resolve(JSON.parse(stdout)); } catch { reject(Object.assign(new Error('Invalid display helper response.'), { code: 'DISPLAY_HELPER_PROTOCOL' })); }
      });
    });
  }
  return {
    list: async () => (await run(['profile-list'])).displays,
    capture: async (id, options = {}) => {
      const snapshot = await run(['profile-capture', '--monitor', Buffer.from(id, 'utf8').toString('hex'),
        ...(options.vibrance ? ['--vibrance'] : [])]);
      logger?.info?.('Display state captured.', summary(snapshot));
      return snapshot;
    },
    validate: (snapshot) => run(['profile-validate', ...argsFor(snapshot)]),
    apply: async (snapshot) => {
      logger?.info?.('Display profile apply requested.', summary(snapshot));
      try {
        const result = await run(['profile-apply', ...argsFor(snapshot)]);
        logger?.info?.('Display profile apply completed.');
        return result;
      } catch (error) {
        logger?.warn?.('Display profile apply failed.', { code: error.code, message: error.message });
        throw error;
      }
    },
    merge: async (snapshot, fallback) => {
      if (snapshot.id !== fallback.id || snapshot.fingerprint !== fallback.fingerprint)
        throw Object.assign(new Error('Cannot combine snapshots from different monitors or drivers.'), { code: 'DISPLAY_HARDWARE_CHANGED' });
      const merged = await run(['profile-merge', ...argsFor(snapshot), '--fallback-token', fallback.token]);
      if (merged.id !== snapshot.id || merged.fingerprint !== snapshot.fingerprint)
        throw Object.assign(new Error('Monitor or driver changed while combining display settings.'), { code: 'DISPLAY_HARDWARE_CHANGED' });
      return merged;
    },
    watch: (snapshot, { confirmed = false, onRestore = () => {}, onFailure = () => {} } = {}) => {
      check();
      return new Promise((resolve, reject) => {
        const errorFile = watchErrorPath ? fs.openSync(watchErrorPath, 'a') : null;
        const child = spawnProcess(executable, ['profile-watch', ...argsFor(snapshot), '--owner', String(process.pid), ...(confirmed ? ['--confirmed'] : [])],
          // Detached keeps the guard out of libuv's kill-on-parent-exit job.
          // Pipes still carry confirmation commands; the native owner handle
          // and pipe closure trigger recovery when Nova dies.
          { detached: true, windowsHide: true, stdio: ['pipe', 'pipe', errorFile === null ? 'pipe' : errorFile] });
        if (errorFile !== null) fs.closeSync(errorFile);
        let ready = false, disarmed = false, restored = false, hasStopped = false, stopPromise = null, output = '', stderr = '';
        let finishStopped;
        const stopped = new Promise((done) => { finishStopped = done; });
        const disarm = () => {
          if (!disarmed && !hasStopped) {
            disarmed = true;
            // Keep the pipe open until the helper exits after reading disarm.
            // EOF is a recovery trigger, not a disarm acknowledgement.
            child.stdin.write('disarm\n');
          }
        };
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Display recovery guard did not start.')); }, 5000);
        child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
        child.stdin.on('error', () => {});
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          let newline;
          while ((newline = output.indexOf('\n')) >= 0) {
            const line = output.slice(0, newline); output = output.slice(newline + 1);
            try {
              const event = JSON.parse(line);
              if (event.ready && !ready) {
                ready = true; clearTimeout(timeout);
                logger?.info?.('Display recovery guard ready.', { pid: child.pid, confirmed });
                resolve({ confirm: () => child.stdin.write('confirm\n'),
                  expect: (expected) => child.stdin.write(`expected ${expected.token}\n`),
                  disarm,
                  disarmAndWait: ({ allowRestore = false } = {}) => {
                    if (stopPromise) return stopPromise;
                    stopPromise = (async () => {
                      disarm();
                      let deadline;
                      try {
                        const result = await Promise.race([stopped, new Promise((_, fail) => {
                          deadline = setTimeout(() => fail(new Error('Display recovery guard did not stop.')), 5000);
                        })]);
                        if (result.error || result.code !== 0 || (restored && !allowRestore))
                          throw new Error(result.error?.message || stderr || 'Display recovery guard did not disarm cleanly.');
                        logger?.info?.('Display recovery guard stopped.', { pid: child.pid, restored });
                      } finally { clearTimeout(deadline); }
                    })();
                    return stopPromise;
                  },
                  restore: () => child.stdin.write('restore\n') });
              }
              if (event.restored) {
                restored = true;
                logger?.warn?.('Display recovery guard restored its saved state.', { pid: child.pid });
                onRestore();
              }
            } catch { /* Report malformed output through the exit path. */ }
          }
        });
        child.on('error', (error) => { hasStopped = true; finishStopped({ error }); clearTimeout(timeout); if (!ready) reject(error); else onFailure(error); });
        child.on('close', (code) => { hasStopped = true; finishStopped({ code }); });
        child.on('exit', (code) => {
          clearTimeout(timeout);
          if (!ready) reject(new Error(stderr || 'Display recovery guard exited before startup.'));
          else if (!disarmed && (!restored || code !== 0)) onFailure(new Error(stderr || 'Display recovery failed.'));
        });
      });
    }
  };
}
module.exports = { createDisplayProfileProvider };
