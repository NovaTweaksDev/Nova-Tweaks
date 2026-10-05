/** @param {{ipcMain: import('electron').IpcMain, restoreService: import('../../shared/desktopContracts').RestoreService}} dependencies */
function registerRestoreHandlers({ ipcMain, restoreService }) {
  /** @type {Record<string, (payload: import('../../shared/desktopContracts').RestoreRequest) => Promise<unknown>>} */
  const handlers = {
    'backup:restore:start': (payload) => restoreService.start(payload),
    'backup:restore:resume': (payload) => restoreService.resume(payload.id),
    'backup:restore:status': async (payload) => ({ ok: true, job: await restoreService.status(payload.id) }),
    'backup:restore:list': async () => ({ ok: true, jobs: await restoreService.list() })
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, payload = { id: '' }) => {
      try { return await handler(payload); }
      catch (error) { return { ok: false, code: error instanceof Error && 'code' in error ? String(error.code) : 'RESTORE_FAILED', message: error instanceof Error ? error.message : 'Restore failed.' }; }
    });
  }
}
module.exports = { registerRestoreHandlers };
