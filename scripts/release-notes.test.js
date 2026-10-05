const test = require('node:test');
const assert = require('node:assert/strict');
const { extractReleaseNotes } = require('./release-notes');
test('selects exactly the tagged version without a preview or following section', () => {
  const changelog = '## Unreleased\nFuture\n## 1.0.2 - 2026-09-20\n### Fixed\n- Correct\n## 1.0.2 Preview - 2026-09-20\n- Preview\n';
  assert.equal(extractReleaseNotes(changelog, '1.0.2'), '### Fixed\n- Correct');
});
test('rejects absent, duplicate, and empty release sections', () => {
  for (const changelog of ['## 1.0.2 Preview\n- Preview', '## 1.0.2\n- A\n## 1.0.2 - date\n- B', '## 1.0.2\n### Fixed\n']) {
    assert.throws(() => extractReleaseNotes(changelog, '1.0.2'));
  }
});
