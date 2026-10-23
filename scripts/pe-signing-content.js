const crypto = require('node:crypto');
const fs = require('node:fs');

// Compare all PE bytes except the checksum, certificate-directory entry and
// appended WIN_CERTIFICATE table. This is stricter than a section-only digest.
function signingContentSha256(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Invalid PE header.');
  const pe = bytes.readUInt32LE(60);
  if (pe < 64 || pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Invalid PE signature.');
  const optional = pe + 24;
  const size = bytes.readUInt16LE(pe + 20);
  if (optional + size > bytes.length || size < 152) throw new Error('Invalid PE optional header.');
  const magic = bytes.readUInt16LE(optional);
  if (![0x10b, 0x20b].includes(magic)) throw new Error('Unsupported PE format.');
  const security = optional + (magic === 0x20b ? 144 : 128);
  const offset = bytes.readUInt32LE(security);
  const length = bytes.readUInt32LE(security + 4);
  let content = bytes;
  if (offset || length) {
    if (!offset || length < 8 || offset % 8 || length % 8 || offset < optional + size || offset + length !== bytes.length) {
      throw new Error('Certificate table must be valid and appended at end of file.');
    }
    let cursor = offset;
    while (cursor < offset + length) {
      if (cursor + 8 > bytes.length) throw new Error('Truncated certificate entry.');
      const certificateLength = bytes.readUInt32LE(cursor);
      if (certificateLength < 8 || cursor + certificateLength > bytes.length
        || bytes.readUInt16LE(cursor + 4) !== 0x200 || bytes.readUInt16LE(cursor + 6) !== 2) {
        throw new Error('Invalid Authenticode certificate entry.');
      }
      cursor += Math.ceil(certificateLength / 8) * 8;
    }
    if (cursor !== bytes.length) throw new Error('Invalid certificate table length.');
    content = bytes.subarray(0, offset);
  }
  content.fill(0, optional + 64, optional + 68);
  content.fill(0, security, security + 8);
  const padded = Buffer.alloc(Math.ceil(content.length / 8) * 8);
  content.copy(padded);
  return crypto.createHash('sha256').update(padded).digest('hex');
}

if (require.main === module) console.log(signingContentSha256(fs.readFileSync(process.argv[2])));
module.exports = { signingContentSha256 };
