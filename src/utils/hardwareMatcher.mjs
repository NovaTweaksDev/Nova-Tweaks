function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\b(?:processor|cpu|graphics|series)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getEntryNames(entry) {
  return [entry?.canonicalName, entry?.model, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
    .filter((value) => typeof value === 'string' && value.trim());
}

function getEntryPattern(entry, type) {
  if (type === 'cpu') {
    return {
      source: typeof entry?.matchPattern === 'string' ? entry.matchPattern : '',
      flags: typeof entry?.matchFlags === 'string' ? entry.matchFlags : 'i'
    };
  }

  const source = typeof entry?.matchRegex === 'string' ? entry.matchRegex : '';
  return {
    source: source.replace(/^\(\?i\)/, ''),
    flags: 'i'
  };
}

function regexMatchScore(entry, detectedName, type) {
  const { source, flags } = getEntryPattern(entry, type);
  if (!source || source.length > 500) {
    return 0;
  }

  try {
    const match = new RegExp(source, flags.includes('i') ? 'i' : '').exec(detectedName);
    if (!match?.[0]) {
      return 0;
    }

    return (match[0].length * 1000) + normalizeMatchText(entry?.model).length;
  } catch (_error) {
    return 0;
  }
}

export function getCatalogEntries(catalog, type) {
  const key = type === 'gpu' ? 'gpus' : 'cpus';
  return Array.isArray(catalog?.[key]) ? catalog[key] : [];
}

export function matchHardwareCatalogEntry(detectedName, catalog, type) {
  const name = String(detectedName || '').trim().slice(0, 300);
  if (!name) {
    return null;
  }

  const entries = getCatalogEntries(catalog, type);
  const normalizedDetectedName = normalizeMatchText(name);
  let bestNameMatch = null;

  for (const entry of entries) {
    for (const candidateName of getEntryNames(entry)) {
      const normalizedCandidate = normalizeMatchText(candidateName);
      if (!normalizedCandidate) {
        continue;
      }

      if (normalizedDetectedName === normalizedCandidate) {
        return entry;
      }

      if (
        normalizedDetectedName.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedDetectedName)
      ) {
        const score = normalizedCandidate.length;
        if (!bestNameMatch || score > bestNameMatch.score) {
          bestNameMatch = { entry, score };
        }
      }
    }
  }

  const regexMatches = entries
    .map((entry) => ({ entry, score: regexMatchScore(entry, name, type) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (regexMatches.length) {
    return regexMatches[0].entry;
  }

  return bestNameMatch?.entry || null;
}
