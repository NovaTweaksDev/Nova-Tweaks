function registerDisplayProfileHandlers({ ipcMain, service, getWindow }) {
  const actions = {
    state: () => service.getState(),
    refresh: () => service.refresh(),
    capture: (payload) => service.capture(payload),
    configure: (payload) => service.configure(payload),
    delete: (payload) => service.remove(payload?.id),
    validate: (payload) => service.validate(payload?.id),
    activate: (payload) => service.activate(payload?.id),
    confirm: (payload) => service.confirm(payload?.id),
    restore: (payload) => service.restore({ force: payload?.force === true }),
    keep: () => service.keepCurrent()
  };
  for (const [action, execute] of Object.entries(actions)) {
    ipcMain.handle(`display-profiles:${action}`, async (event, payload) => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        return { ok: false, code: 'DISPLAY_SENDER_INVALID', message: 'Untrusted display profile request.' };
      try { await execute(payload); return { ok: true, state: service.getState() }; }
      catch (error) { return { ok: false, code: error.code || 'DISPLAY_OPERATION_FAILED', message: error.message, state: service.getState() }; }
    });
  }
}
module.exports = { registerDisplayProfileHandlers };
