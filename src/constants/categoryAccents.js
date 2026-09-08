const CATEGORY_ACCENTS = {
  performance: '#5F97CF',
  system: '#C7777E',
  network: '#55AAB8',
  appearance: '#55A994',
  privacy: '#67A766',
  security: '#67A766',
  apps: '#6397D4',
  backup: '#5F97CF',
  settings: '#5F97CF',
  debloat: '#C59A55',
  boot: '#C47F58',
  startup: '#C47F58',
  advanced: '#9878C8',
  latency: '#9878C8',
  hardware: '#748BD0'
};

const CATEGORY_ALIASES = {
  all: 'performance',
  general: 'system',
  'quick picks': 'performance',
  recommended: 'performance',
  'debloat & privacy': 'privacy',
  'boot & kernel': 'boot',
  'advanced lab': 'advanced',
  'cpu & scheduler': 'hardware',
  'gpu & graphics': 'hardware',
  'power & thermals': 'hardware',
  'kernel / boot': 'boot',
  'ui / background': 'appearance'
};

export const FALLBACK_CATEGORY_ACCENT = '#5F97CF';

export function normalizeCategoryAccentKey(category) {
  return String(category || '')
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getCategoryAccent(category, fallback = FALLBACK_CATEGORY_ACCENT) {
  const key = normalizeCategoryAccentKey(category);
  const mappedKey = CATEGORY_ALIASES[key] || key;
  return CATEGORY_ACCENTS[mappedKey] || fallback;
}

export function getCategoryAccentStyle(category, fallback = FALLBACK_CATEGORY_ACCENT) {
  return {
    '--category-accent': getCategoryAccent(category, fallback)
  };
}

export { CATEGORY_ACCENTS };
