const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRestoreJournal } = require('./restoreJournal');
test('durably replaces a journal entry and rejects traversal or mismatched identities', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-journal-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    await fs.rm(root, { recursive: true, force: true });
  });
  const journal = createRestoreJournal(root);
  const id = crypto.randomUUID();
  await journal.write({ id, status: 'prepared' });
  await journal.write({ id, status: 'running' });
  assert.deepEqual(await journal.read(id), { id, status: 'running' });
  assert.equal((await journal.list()).length, 1);
  assert.deepEqual(await fs.readdir(root), [`${id}.json`]);
  await assert.rejects(journal.read('../outside'), { code: 'INVALID_RESTORE_ID' });
  await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify({ id: crypto.randomUUID() }));
  await assert.rejects(journal.read(id), { code: 'RESTORE_JOURNAL_INVALID' });
});
