const fs = require('fs');
const path = require('path');

function removeLegacyStartMenuShortcut({ app, shell, logger }) {
  const programsPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const legacyPath = path.join(programsPath, app.isPackaged ? 'Nova Tweak.lnk' : 'Electron.lnk');
  if (!fs.existsSync(legacyPath)) return;

  try {
    const legacy = shell.readShortcutLink(legacyPath);
    const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' &&
      path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
    if (!samePath(legacy.target, process.execPath) || legacy.args?.trim()) return;
    if (!['de.novatweaks.desktop', 'de.novatweaks.desktop.development'].includes(legacy.appUserModelId)) return;
    if (app.isPackaged) {
      const canonical = shell.readShortcutLink(path.join(programsPath, 'Nova Tweaks.lnk'));
      if (!samePath(canonical.target, legacy.target) || canonical.args?.trim() ||
          canonical.appUserModelId !== 'de.novatweaks.desktop') return;
    }
    fs.unlinkSync(legacyPath);
    logger.info('Removed legacy Nova Start Menu shortcut.', { shortcut: path.basename(legacyPath) });
  } catch (error) {
    logger.warn('Unable to remove legacy Nova Start Menu shortcut.', { message: error.message });
  }
}

module.exports = { removeLegacyStartMenuShortcut };
