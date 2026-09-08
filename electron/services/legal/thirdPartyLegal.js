const path = require('path');

function resolveThirdPartyNoticesPath({ isPackaged, appPath, resourcesPath }) {
  if (isPackaged) {
    return path.resolve(resourcesPath, '..', 'THIRD-PARTY-NOTICES.md');
  }
  return path.resolve(appPath, 'THIRD-PARTY-NOTICES.md');
}

module.exports = {
  resolveThirdPartyNoticesPath
};
