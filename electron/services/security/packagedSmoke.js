const fs = require('node:fs');
const path = require('node:path');
const { assertBundledTweakIntegrity } = require('./bundledTweakIntegrity');
const { assertBundledSidecarIntegrity } = require('./bundledSidecarIntegrity');
const { assertMonitoringRuntimeIntegrity } = require('../monitoring/monitoringIntegrity');
const manifest = require('../../generated/bundled-tweaks-manifest');
const { createSettingsService } = require('../settings/settingsService');
const { LOCAL_RENDERER_URL, registerLocalRendererProtocol } = require('./localRendererProtocol');

function verifyPackagedHelpers(resources) {
  assertBundledTweakIntegrity(path.join(resources, 'tweaks'), manifest);
  assertMonitoringRuntimeIntegrity(path.join(resources, 'resources/monitoring/LibreHardwareMonitor'));
  const sidecars = {
    'presentmon-capture': 'capture/PresentMon', 'presentmon-tools': 'tools/presentmon',
    'presentmon-helper': 'tools/nova-presentmon-helper', 'game-detector-x64': 'helpers/NovaGameDetector/publish/win-x64',
    'nvidia-display-helper': 'tools/nvidia-display-helper/bin', 'nvidia-profile-helper': 'tools/nvidia-profile-helper/bin'
  };
  for (const [policy, relative] of Object.entries(sidecars)) assertBundledSidecarIntegrity(path.join(resources, relative), policy);
  const broker = path.join(resources, 'tools/nova-admin-broker/NovaAdminBrokerHost.exe');
  if (!fs.statSync(broker).isFile()) throw new Error('Administrator broker is missing.');
}
async function runPackagedSmoke({ app, BrowserWindow, protocol, net, ipcMain }) {
  if (!app.isPackaged) throw new Error('Smoke test requires a packaged application.');
  verifyPackagedHelpers(process.resourcesPath);
  registerLocalRendererProtocol({ protocol, net, rootDirectory: path.join(app.getAppPath(), 'dist') });
  const settings = createSettingsService({ app });
  // Load the real renderer without enabling any system-operation handler or background worker.
  const preload = fs.readFileSync(path.join(app.getAppPath(), 'electron/preload.js'), 'utf8');
  const channels = new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]));
  for (const channel of channels) {
    ipcMain.handle(channel, async () => {
      if (channel === 'app:get-os-language') return app.getLocale();
      if (channel === 'settings:get') return { ok: true, settings: settings.getSettings() };
      return { ok: false, code: 'SMOKE_SYSTEM_OPERATIONS_DISABLED', message: 'System operations are disabled in the packaged smoke test.' };
    });
  }
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(app.getAppPath(), 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true
  } });
  let rendererFailed = false;
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error' && /Uncaught|ReferenceError|TypeError/.test(details.message)) rendererFailed = true;
  });
  window.webContents.on('render-process-gone', () => { rendererFailed = true; });
  await window.loadURL(LOCAL_RENDERER_URL);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !rendererFailed) {
    const rendered = await window.webContents.executeJavaScript('Boolean(document.querySelector(".app-shell .dashboard-shell"))');
    if (rendered) { window.destroy(); return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Renderer did not mount successfully.');
}
module.exports = { runPackagedSmoke, verifyPackagedHelpers };
