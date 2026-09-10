const test = require('node:test');
const assert = require('node:assert/strict');
const { getReleaseInfo } = require('./releaseInfo');

test('reports the actual newest published tag including previews separately from the installed version', async () => {
  const result = await getReleaseInfo('1.0.1', async () => ({ ok: true, json: async () => [
    { tag_name: 'v1.0.0', published_at: '2026-09-01', prerelease: false },
    { tag_name: 'preview-v1.0.2', published_at: '2026-09-10', prerelease: true },
    { tag_name: 'v9.0.0', published_at: '2026-09-11', draft: true }
  ] }));
  assert.equal(result.version, '1.0.1');
  assert.equal(result.releaseTag, 'preview-v1.0.2');
  assert.equal(result.prerelease, true);
  assert.equal(result.downloadUrl, 'https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/preview-v1.0.2');
});

test('does not invent a version when GitHub fails or has no releases', async () => {
  for (const fetchRelease of [async () => { throw new Error('offline'); }, async () => ({ ok: false })]) {
    const result = await getReleaseInfo('1.0.0', fetchRelease);
    assert.equal(result.releaseStatus, 'unavailable');
    assert.equal(result.releaseTag, undefined);
  }
  const empty = await getReleaseInfo('1.0.0', async () => ({ ok: true, json: async () => [] }));
  assert.equal(empty.releaseStatus, 'empty');
});
