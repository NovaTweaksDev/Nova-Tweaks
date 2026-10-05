const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createRestoreJournal(directory) {
  function file(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Invalid restore id.'), { code: 'INVALID_RESTORE_ID' });
    return path.join(directory, `${id}.json`);
  }
  return {
    async write(job) {
      await fs.mkdir(directory, { recursive: true });
      const destination = file(job.id);
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(job), 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(temporary, destination);
      } finally {
        await handle?.close();
        await fs.rm(temporary, { force: true });
      }
    },
    async read(id) {
      const job = JSON.parse(await fs.readFile(file(id), 'utf8'));
      if (job.id !== id) throw Object.assign(new Error('Restore journal identity mismatch.'), { code: 'RESTORE_JOURNAL_INVALID' });
      return job;
    },
    async list() {
      let names;
      try { names = await fs.readdir(directory); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const jobs = [];
      for (const name of names.filter((entry) => /^[a-f0-9-]{36}\.json$/.test(entry))) {
        jobs.push(await this.read(name.slice(0, -5)));
      }
      return jobs;
    }
  };
}
module.exports = { createRestoreJournal };
