const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('restore progress cannot regress on stale events and releases its subscription', async () => {
  let jobs = [];
  let update;
  let cleanup;
  let unsubscribed = false;
  const context = {
    useState: () => [[], (value) => { jobs = typeof value === 'function' ? value(jobs) : value; }],
    useEffect: (effect) => { cleanup = effect(); },
    window: { desktopApi: {
      onBackupRestoreUpdate: (callback) => { update = callback; return () => { unsubscribed = true; }; },
      listBackupRestores: async () => ({ ok: true, jobs: [{ id: 'a', revision: 1 }] })
    } }
  };
  const source = fs.readFileSync(require.resolve('./useRestoreJobs'), 'utf8')
    .replace("import { useEffect, useState } from 'react';", '').replace('export function', 'function');
  vm.runInNewContext(`${source}\nuseRestoreJobs();`, context);
  update({ id: 'a', revision: 3, status: 'completed' });
  const previous = jobs;
  update({ id: 'a', revision: 2, status: 'running' });
  assert.equal(jobs, previous);
  await Promise.resolve();
  assert.equal(jobs[0].revision, 3);
  const beforeCleanup = jobs;
  update({ id: 'a', revision: 3, status: 'completed' });
  assert.equal(jobs, beforeCleanup);
  cleanup();
  update({ id: 'a', revision: 4 });
  assert.equal(jobs, beforeCleanup);
  assert.equal(unsubscribed, true);
});
