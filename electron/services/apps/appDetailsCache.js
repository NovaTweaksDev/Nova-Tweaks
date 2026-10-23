const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STATIC_FIELDS = ['id', 'inventoryKey', 'name', 'publisher', 'version', 'source', 'installScope',
  'installType', 'installLocation', 'installDate', 'estimatedSize', 'packageFullName', 'packageFamilyName',
  'isMicrosoft', 'isTechnical', 'isSystemComponent', 'executablePath', 'iconPath', 'iconDataUrl',
  'sizeBytes', 'sizeKnown', 'sizeCheckFailed', 'detailsLoaded', 'detailsUpdatedAt', 'sizeUpdatedAt'];

function appKey(app) {
  return app.inventoryKey || `${app.source}|${app.installScope}|${app.id}`;
}

function fingerprint(app) {
  return crypto.createHash('sha256').update(JSON.stringify([
    appKey(app), app.source, app.installScope, app.name, app.publisher, app.version, app.installLocation, app.installDate,
    app.estimatedSize, app.packageFullName, app.packageFamilyName, app.iconPath,
    app.uninstallCommand, app.quietUninstallCommand, app.canUninstall, app.isSystemComponent
  ])).digest('hex');
}

function staticApp(app) {
  return Object.fromEntries(STATIC_FIELDS.filter((key) => app[key] !== undefined).map((key) => [key, app[key]]));
}

function createAppDetailsCache({ filePath, logger, now = Date.now, stat = fs.stat } = {}) {
  let records = new Map();
  let loadPromise;
  let writePromise = Promise.resolve();
  let revision = 0;
  const invalidatedAt = new Map();

  async function load() {
    if (!loadPromise) loadPromise = (async () => {
      if (!filePath) return;
      try {
        const info = await fs.lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) return;
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (data.schemaVersion !== 1 || !Array.isArray(data.apps) || data.apps.length > 10000) return;
        const valid = data.apps.every((record) => record && typeof record.key === 'string'
          && /^[a-f0-9]{64}$/.test(record.fingerprint) && record.app && typeof record.app.id === 'string'
          && record.app.id && typeof record.app.name === 'string' && record.app.name
          && Number.isFinite(record.app.detailsUpdatedAt) && record.app.detailsUpdatedAt <= now()
          && Number.isFinite(record.app.sizeUpdatedAt) && record.app.sizeUpdatedAt <= now()
          && Number.isFinite(record.app.sizeBytes) && record.app.sizeBytes >= 0
          && typeof record.app.sizeKnown === 'boolean' && typeof record.app.detailsLoaded === 'boolean'
          && ['installLocation', 'executablePath', 'iconPath', 'iconDataUrl'].every((key) =>
            record.app[key] === undefined || typeof record.app[key] === 'string')
          && typeof record.fileStamp === 'string');
        if (valid) records = new Map(data.apps.map((record) => [record.key, { ...record, app: staticApp(record.app) }]));
      } catch (error) {
        if (error.code !== 'ENOENT') logger?.warn?.('App detail cache could not be read.', { code: error.code || 'INVALID_CACHE' });
      }
    })();
    await loadPromise;
  }

  async function fileStamp(app) {
    const files = [...new Set([app.installLocation, app.executablePath, app.iconPath].filter(Boolean))];
    return JSON.stringify(await Promise.all(files.map(async (file) => {
      try {
        const info = await stat(file);
        return [file.toLowerCase(), info.size, info.mtimeMs];
      } catch (error) { return [file.toLowerCase(), error.code || 'UNAVAILABLE']; }
    })));
  }

  async function cached() {
    const startedAt = now();
    await load();
    logger?.info?.('App detail cache loaded.', { count: records.size, durationMs: now() - startedAt });
    return [...records.values()].map(({ app }) => ({ ...app, canUninstall: false,
      runtimeStatus: 'unknown', processActive: false, processId: 0, detailsStale: true }));
  }

  async function prepare(inventory, { forceRefresh = false, refreshAppId } = {}) {
    await load();
    const reuse = new Map();
    await Promise.all(inventory.map(async (app) => {
      const record = records.get(appKey(app));
      if (!forceRefresh && app.id !== refreshAppId && record && record.fingerprint === fingerprint(app)
        && record.app.detailsLoaded
        && (record.app.sizeCheckFailed
          ? now() - record.app.detailsUpdatedAt < 5 * 60 * 1000
          : now() - record.app.sizeUpdatedAt < MAX_AGE_MS)
        && await fileStamp(record.app) === record.fileStamp) {
        reuse.set(appKey(app), { ...record.app });
      }
    }));
    return reuse;
  }

  async function merge(inventory) {
    await load();
    return inventory.map((app) => {
      const record = records.get(appKey(app));
      if (!record || record.fingerprint !== fingerprint(app)) return { ...app, detailsLoaded: false };
      // Inventory always supplies current installation identity and action targets.
      return { ...app, executablePath: record.app.executablePath, iconPath: record.app.iconPath,
        iconDataUrl: record.app.iconDataUrl, sizeBytes: record.app.sizeBytes, sizeKnown: record.app.sizeKnown,
        detailsLoaded: record.app.detailsLoaded, detailsUpdatedAt: record.app.detailsUpdatedAt,
        sizeUpdatedAt: record.app.sizeUpdatedAt, detailsStale: true };
    });
  }

  async function persist() {
    if (!filePath) return;
    const contents = JSON.stringify({ schemaVersion: 1, apps: [...records.values()] });
    writePromise = writePromise.catch(() => {}).then(async () => {
      const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, filePath);
      } catch (error) {
        logger?.warn?.('App detail cache could not be saved.', { code: error.code });
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    });
    await writePromise;
  }

  async function save(inventory, detailed, refreshRevision = revision) {
    await load();
    const updated = new Map(detailed.map((app) => [appKey(app), app]));
    const next = new Map();
    for (const current of inventory) {
      const key = appKey(current);
      const previous = records.get(key);
      const result = updated.get(key);
      if (!result?.detailsLoaded) {
        if (previous) next.set(key, previous);
        continue;
      }
      const app = staticApp({ ...result, sizeCheckFailed: result.sizeCheckFailed || !result.sizeKnown,
        detailsUpdatedAt: result.detailsUpdatedAt || now(),
        sizeUpdatedAt: result.sizeKnown ? result.sizeUpdatedAt || now() : 0 });
      if (!result.sizeKnown && previous?.app.sizeKnown) {
        app.sizeBytes = previous.app.sizeBytes;
        app.sizeKnown = true;
        app.sizeUpdatedAt = previous.app.sizeUpdatedAt;
      }
      if (!app.iconDataUrl && previous?.app.iconDataUrl && app.iconPath === previous.app.iconPath) app.iconDataUrl = previous.app.iconDataUrl;
      if ((invalidatedAt.get(app.id) || 0) > refreshRevision) {
        app.sizeUpdatedAt = 0;
        app.detailsUpdatedAt = 0;
      }
      next.set(key, { key, fingerprint: fingerprint(current), fileStamp: await fileStamp(app), app });
    }
    records = next;
    const merged = detailed.map((app) => {
      const saved = next.get(appKey(app))?.app;
      return saved ? { ...app, sizeBytes: saved.sizeBytes, sizeKnown: saved.sizeKnown,
        sizeCheckFailed: saved.sizeCheckFailed, sizeUpdatedAt: saved.sizeUpdatedAt, iconDataUrl: saved.iconDataUrl } : app;
    });
    await persist();
    return merged;
  }

  async function invalidate(appId) {
    await load();
    revision += 1;
    invalidatedAt.set(appId, revision);
    for (const record of records.values()) {
      if (record.app.id === appId) {
        record.app.sizeUpdatedAt = 0;
        record.app.detailsUpdatedAt = 0;
      }
    }
    await persist();
  }

  return { cached, prepare, merge, save, invalidate, getRevision: () => revision };
}

module.exports = { createAppDetailsCache, appKey, fingerprint, MAX_AGE_MS };
