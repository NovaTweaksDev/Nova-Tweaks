const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBackupManager } = require('./backupManager');

test('automatic backups honor enablement, frequency, concurrency and restart history', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-auto-backup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { app: { getPath: () => root }, dialog: { showOpenDialog() {}, showSaveDialog() {} }, getBackupRoot: () => root,
    windowsRestoreStateProvider: async () => ({ available: false, points: [] }) };
  const manager = createBackupManager(options);
  let captures = 0;
  const capture = async () => { captures++; return { appSettings: { captureStatus: 'complete', data: { theme: 'dark' } } }; };
  assert.equal((await manager.runAutomaticBackup(capture)).skipped, true);
  assert.equal(captures, 0);
  await manager.updateBackupSettings({ automaticBackupsEnabled: true, frequencyDays: 7 });
  await Promise.all([manager.runAutomaticBackup(capture), manager.runAutomaticBackup(capture)]);
  assert.equal(captures, 1);
  assert.equal((await manager.listBackups()).backups.length, 1);
  assert.equal((await createBackupManager(options).runAutomaticBackup(capture)).skipped, true);
  assert.equal(captures, 1);
  const oldBackup = (await manager.listBackups()).backups[0];
  const filePath = path.join(root, oldBackup.fileName);
  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  document.createdAt = new Date(Date.now() - 8 * 86400000).toISOString();
  await fs.writeFile(filePath, JSON.stringify(document));
  await manager.updateBackupSettings({ cleanOlderThanDays: 1 });
  const next = await manager.runAutomaticBackup(capture);
  assert.equal(captures, 2);
  assert.notEqual(next.backup.id, oldBackup.id);
  assert.equal((await manager.listBackups()).backups.length, 1);
  await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
});

test('failed automatic captures remain due and never delete existing backups', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-auto-backup-fail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = createBackupManager({ app: { getPath: () => root }, dialog: { showOpenDialog() {}, showSaveDialog() {} }, getBackupRoot: () => root,
    windowsRestoreStateProvider: async () => ({ available: false, points: [] }) });
  await manager.createBackup({ name: 'Manual', scope: ['appSettings'], snapshot: { appSettings: { data: { theme: 'dark' } } } });
  await manager.updateBackupSettings({ automaticBackupsEnabled: true, maxStorageBytes: 1 });
  await assert.rejects(manager.runAutomaticBackup(async () => { throw new Error('disk unavailable'); }), /disk unavailable/);
  assert.equal((await manager.listBackups()).backups.length, 1);
  await manager.runAutomaticBackup(async () => ({ appSettings: { data: { theme: 'dark' } } }));
  assert.equal((await manager.listBackups()).backups.length, 2);
});

test('serializes concurrent backup index writes without temp-file collisions', async (t) => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-backup-index-'));
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));

  const backupsRoot = path.join(testRoot, 'backups');
  const manager = createBackupManager({
    app: {
      getName: () => 'Nova Tweaks',
      getPath: () => testRoot
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: '' })
    },
    getBackupRoot: () => backupsRoot
  });

  await Promise.all(
    Array.from({ length: 100 }, (_, index) => manager.updateBackupSettings({
      frequencyDays: (index % 30) + 1
    }))
  );

  const persistedIndex = JSON.parse(
    await fs.readFile(path.join(backupsRoot, 'index.json'), 'utf8')
  );
  const temporaryFiles = (await fs.readdir(backupsRoot))
    .filter((fileName) => fileName.endsWith('.tmp'));

  assert.equal(persistedIndex.schema, 'nova-tweaks-backup-index');
  assert.ok(
    Number.isInteger(persistedIndex.settings.frequencyDays)
      && persistedIndex.settings.frequencyDays >= 1
      && persistedIndex.settings.frequencyDays <= 30
  );
  assert.deepEqual(temporaryFiles, []);
});

test('keeps cached restore points visible when live Windows enumeration is unavailable', async (t) => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-backup-restore-history-'));
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));

  const backupsRoot = path.join(testRoot, 'backups');
  let restoreStateReadCount = 0;
  const manager = createBackupManager({
    app: {
      getName: () => 'Nova Tweaks',
      getPath: () => testRoot
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: '' })
    },
    getBackupRoot: () => backupsRoot,
    windowsRestoreStateProvider: async () => {
      restoreStateReadCount += 1;
      return restoreStateReadCount === 1
        ? {
            available: true,
            code: 'WINDOWS_RESTORE_AVAILABLE',
            message: '',
            points: []
          }
        : {
            available: false,
            code: 'WINDOWS_RESTORE_ADMIN_REQUIRED',
            message: 'Administrator access is required.',
            points: []
          };
    }
  });
  const createdAt = '2026-08-22T10:00:00.000Z';
  const restorePoint = {
    id: 'winrp-42',
    sequenceNumber: 42,
    name: 'Nova restore point',
    fileName: '',
    createdAt,
    updatedAt: createdAt,
    type: 'restorePoint',
    origin: 'windows',
    scope: ['systemRestore', 'bootBcd', 'registryChanges'],
    sizeBytes: 0,
    sizeLabel: 'System-managed',
    status: 'successful',
    description: 'Windows System Restore point',
    path: '',
    appVersion: '',
    includedItems: ['systemRestore', 'bootBcd', 'registryChanges'],
    adminRequired: true,
    rebootLikely: true,
    eventType: 100,
    restorePointType: 12
  };

  const createdState = await manager.createBackup(
    { engine: 'windows', name: restorePoint.name },
    { createWindowsProvider: async () => restorePoint }
  );
  const listedState = await manager.listBackups();

  assert.deepEqual(createdState.windowsRestorePoints.map((entry) => entry.id), ['winrp-42']);
  assert.deepEqual(listedState.windowsRestorePoints.map((entry) => entry.id), ['winrp-42']);
  assert.equal(listedState.windowsRestoreIntegration.available, false);
});
