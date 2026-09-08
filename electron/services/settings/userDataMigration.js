const fs = require('fs');
const path = require('path');

function migrateLegacyUserData({ appDataPath, currentUserDataPath, legacyDirectoryName }) {
  const appDataRoot = path.resolve(appDataPath);
  const currentRoot = path.resolve(currentUserDataPath);
  const legacyRoot = path.resolve(appDataRoot, legacyDirectoryName);
  const relativeCurrentRoot = path.relative(appDataRoot, currentRoot);
  const relativeLegacyRoot = path.relative(appDataRoot, legacyRoot);

  if (
    relativeCurrentRoot.startsWith('..')
    || path.isAbsolute(relativeCurrentRoot)
    || relativeLegacyRoot.startsWith('..')
    || path.isAbsolute(relativeLegacyRoot)
  ) {
    throw new Error('User-data migration paths must remain inside the application-data directory.');
  }

  if (currentRoot === legacyRoot || fs.existsSync(currentRoot) || !fs.existsSync(legacyRoot)) {
    return { migrated: false, source: legacyRoot, destination: currentRoot };
  }

  const temporaryRoot = `${currentRoot}.migration-${process.pid}`;
  try {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.cpSync(legacyRoot, temporaryRoot, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    fs.renameSync(temporaryRoot, currentRoot);
    return { migrated: true, source: legacyRoot, destination: currentRoot };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { migrateLegacyUserData };
