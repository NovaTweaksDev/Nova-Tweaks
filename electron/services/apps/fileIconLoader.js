function createFileIconLoader(getFileIcon, timeoutMs = 3000) {
  const pending = new Map();
  const cache = new Map();
  return function load(iconPath) {
    const key = String(iconPath).toLowerCase();
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key);
    let timer;
    const extraction = Promise.resolve().then(() => getFileIcon(iconPath, { size: 'normal' }))
      .then((icon) => {
        const data = icon && !icon.isEmpty() ? icon.toDataURL() : '';
        if (data) cache.set(key, data);
        return data;
      }).catch(() => '');
    const result = Promise.race([
      extraction,
      new Promise((resolve) => { timer = setTimeout(() => resolve(''), timeoutMs); })
    ]).finally(() => { clearTimeout(timer); });
    pending.set(key, result);
    // Keep stalled native requests deduplicated; cache late successes for the next scan.
    void extraction.finally(() => { pending.delete(key); });
    return result;
  };
}

module.exports = { createFileIconLoader };
