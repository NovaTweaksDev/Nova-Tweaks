const test = require('node:test');
const assert = require('node:assert/strict');
const { registerDisplayProfileHandlers } = require('./displayProfileHandlers');

test('display profile mutations reject foreign senders and subframes', async () => {
  const handlers = new Map(); const frame = {}; const webContents = { mainFrame: frame }; let calls = 0;
  const service = { activate: async () => { calls += 1; }, getState: () => ({ busy: false }) };
  registerDisplayProfileHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, service, getWindow: () => ({ webContents }) });
  const activate = handlers.get('display-profiles:activate');
  assert.equal((await activate({ sender: {}, senderFrame: frame }, { id: 'x' })).code, 'DISPLAY_SENDER_INVALID');
  assert.equal((await activate({ sender: webContents, senderFrame: {} }, { id: 'x' })).code, 'DISPLAY_SENDER_INVALID');
  assert.equal(calls, 0);
  assert.equal((await activate({ sender: webContents, senderFrame: frame }, { id: 'x' })).ok, true);
  assert.equal(calls, 1);
});
