const packageMetadata = require('./package.json');

const DEFAULT_MSIX_VERSION = '0.9.0.0';
const version = String(process.env.NOVA_MSIX_VERSION || DEFAULT_MSIX_VERSION).trim();
const parts = version.split('.').map((value) => Number.parseInt(value, 10));

if (!/^\d+\.\d+\.\d+\.\d+$/.test(version) || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)) {
  throw new Error('NOVA_MSIX_VERSION must contain four numeric parts between 0 and 65535, for example 0.9.0.0.');
}

const base = packageMetadata.build || {};
const electronVersion = parts.slice(0, 3).join('.');

module.exports = {
  ...base,
  extraMetadata: {
    ...(base.extraMetadata || {}),
    version: electronVersion
  },
  directories: {
    ...(base.directories || {}),
    output: 'dist-msix-test/unpacked'
  },
  win: {
    ...(base.win || {}),
    target: [
      {
        target: 'dir',
        arch: ['x64']
      }
    ],
    signAndEditExecutable: false
  }
};
