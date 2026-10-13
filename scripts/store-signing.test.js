const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { signingContentSha256 } = require('./pe-signing-content');
const root = path.resolve(__dirname, '..');
const policy = require('./store-redistribution-policy.json');

function fixture() {
  const unsigned = Buffer.alloc(512);
  unsigned.writeUInt16LE(0x5a4d);
  unsigned.writeUInt32LE(64, 60);
  unsigned.writeUInt32LE(0x4550, 64);
  unsigned.writeUInt16LE(240, 84);
  unsigned.writeUInt16LE(0x20b, 88);
  unsigned[400] = 77;
  const signed = Buffer.concat([unsigned, Buffer.alloc(16)]);
  signed.writeUInt32LE(123, 152);
  signed.writeUInt32LE(512, 232);
  signed.writeUInt32LE(16, 236);
  // Structural fixture only; the signature gate separately requires valid Authenticode.
  signed.writeUInt32LE(16, 512);
  signed.writeUInt16LE(0x200, 516);
  signed.writeUInt16LE(2, 518);
  return { unsigned, signed };
}

test('redistribution preserves every PE byte except explicitly permitted signing fields', () => {
  const { unsigned, signed } = fixture();
  assert.equal(signingContentSha256(signed), signingContentSha256(unsigned));
  signed[400] ^= 1;
  assert.notEqual(signingContentSha256(signed), signingContentSha256(unsigned));
  const headerChanged = Buffer.from(unsigned);
  headerChanged[100] ^= 1;
  assert.notEqual(signingContentSha256(headerChanged), signingContentSha256(unsigned));
});

test('redistribution rejects certificate offsets, truncated entries and appended hidden payload', () => {
  const { signed } = fixture();
  const hidden = Buffer.concat([signed, Buffer.from('hidden')]);
  assert.throws(() => signingContentSha256(hidden), /end of file/);
  signed.writeUInt32LE(20, 512);
  assert.throws(() => signingContentSha256(signed), /certificate entry/);
  assert.throws(() => signingContentSha256(Buffer.from('not a PE')), /header/);
});

test('every approved unsigned redistribution matches its original bytes and license records', () => {
  assert.equal(policy.files.length, 25);
  assert.equal(new Set(policy.files.map(file => file.path)).size, 25);
  const upstream = require('./release-pe-policy.json').unsignedUpstream;
  for (const entry of policy.files) {
    assert.ok(upstream.some(file => file.path === entry.path && file.sha256 === entry.sha256));
    const original = fs.readFileSync(path.join(root, entry.source));
    assert.equal(crypto.createHash('sha256').update(original).digest('hex'), entry.sha256);
    assert.equal(signingContentSha256(original), entry.contentSha256);
    for (const license of entry.licenseFiles) assert.ok(fs.statSync(path.join(root, license)).size > 0);
  }
  assert.ok(!policy.files.some(file => file.path.endsWith('/PresentMon.exe')));
});

test('Store staging is limited to signed Store builds and certificate replacement is forbidden', () => {
  const config = fs.readFileSync(path.join(root, 'electron-builder.windows.cjs'), 'utf8');
  assert.match(config, /profile.store && profile.signed/);
  const signer = fs.readFileSync(path.join(root, 'scripts/sign-nova-file.ps1'), 'utf8');
  assert.match(signer, /UnsignedRedistribution -and \$existing.Status -ne 'NotSigned'/);
  const gate = fs.readFileSync(path.join(root, 'scripts/verify-windows-signatures.ps1'), 'utf8');
  assert.match(gate, /\$Mode -eq 'Store'.*\$thumbprint -eq \$ExpectedThumbprint/);
  assert.match(gate, /verify \/pa \/all \/tw/);
});
