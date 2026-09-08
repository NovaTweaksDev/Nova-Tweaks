export const TWEAK_CATEGORY_ORDER = [
  'General',
  'Latency',
  'Hardware',
  'Debloat',
  'Boot',
  'Network'
];

export const TWEAK_SUBCATEGORY_ORDER = {
  Latency: [
    'Input',
    'Timer',
    'Timer Resolution'
  ],
  Hardware: [
    'CPU',
    'GPU',
    'Memory',
    'Storage',
    'Power'
  ],
  Debloat: [
    'Services',
    'Privacy',
    'Apps',
    'Interface'
  ],
  Boot: [
    'Startup',
    'Kernel',
    'Hypervisor'
  ],
  Network: [
    'Network Latency',
    'TCP IP',
    'Adapter',
    'Packet Handling',
    'DNS'
  ],
  General: [
    'System',
    'Cleanup',
    'Power Plans',
    'Maintenance',
    'Security',
    'Updates'
  ]
};

const DEFAULT_SUBCATEGORY_BY_CATEGORY = {
  Latency: 'Input',
  Hardware: 'CPU',
  Debloat: 'Services',
  Boot: 'Startup',
  Network: 'Network Latency',
  General: 'System'
};

const LEGACY_CATEGORY_MAP = {
  recommended: 'General',
  performance: 'General',
  'quick picks': 'General',
  general: 'General',
  '13': 'Latency',
  '15': 'Hardware',
  '14': 'Debloat',
  '20': 'Boot',
  '6': 'Network',
  '16': 'General',
  latency: 'Latency',
  network: 'Network',
  'cpu & scheduler': 'Hardware',
  memory: 'Hardware',
  'gpu & graphics': 'Hardware',
  'power & thermals': 'Hardware',
  'debloat & privacy': 'Debloat',
  system: 'General',
  'boot & kernel': 'Boot',
  'advanced lab': 'Boot',
  'kernel / boot': 'Boot',
  'cpu / scheduler': 'Hardware',
  gpu: 'Hardware',
  storage: 'Hardware',
  services: 'Debloat',
  privacy: 'Debloat',
  'ui / background': 'Debloat',
  drivers: 'Hardware',
  gaming: 'General',
  misc: 'General'
};

const LEGACY_SUBCATEGORY_MAP = {
  '67': 'Power Plans',
  '68': 'Timer Resolution',
  '70': 'DNS',
  '71': 'TCP IP',
  '72': 'Adapter',
  '73': 'Packet Handling',
  '74': 'Network Latency',
  '75': 'System',
  '76': 'Maintenance',
  '77': 'Security',
  '78': 'Updates',
  '79': 'Cleanup',
  '1': 'Memory',
  '16': 'Power',
  '21': 'GPU',
  '35': 'CPU',
  '25': 'Input',
  '26': 'Timer',
  '31': 'Privacy',
  '32': 'Apps',
  '49': 'Interface',
  '51': 'Services',
  '61': 'Experimental',
  '62': 'Startup',
  '64': 'Hypervisor',
  '65': 'Kernel',
  'best for gaming': 'System',
  'best for daily performance': 'System',
  'general performance': 'System',
  responsiveness: 'System',
  'system throughput': 'System',
  'best for low latency': 'Input',
  'best for laptop': 'System',
  'best for desktop': 'System',
  'safe starters': 'System',
  'advanced recommended': 'System',
  gaming: 'System',
  'daily use': 'System',
  'low latency': 'Input',
  laptop: 'System',
  desktop: 'System',
  'advanced picks': 'System',
  'timer resolution': 'Timer Resolution',
  'scheduling latency': 'Timer',
  'timer & clock source': 'Timer',
  'input latency': 'Input',
  'gpu latency': 'Input',
  'network latency': 'Network Latency',
  network: 'Network Latency',
  'tcp/ip': 'TCP IP',
  'tcp ip': 'TCP IP',
  tcpip: 'TCP IP',
  'adapter settings': 'Adapter',
  adapter: 'Adapter',
  adappter: 'Adapter',
  dns: 'DNS',
  'packet handling': 'Packet Handling',
  'gaming network': 'Network Latency',
  'core usage': 'CPU',
  'core parking': 'CPU',
  affinity: 'CPU',
  'hybrid cpu policies': 'CPU',
  'thread scheduling': 'CPU',
  'priority policies': 'CPU',
  'process priority': 'CPU',
  pagefile: 'Memory',
  'cache behavior': 'Memory',
  'kernel memory': 'Memory',
  allocation: 'Memory',
  'memory housekeeping': 'Memory',
  'graphics scheduling': 'GPU',
  'rendering path': 'GPU',
  'driver behavior': 'GPU',
  'display pipeline': 'GPU',
  'game rendering': 'GPU',
  'power plans': 'Power Plans',
  'desktop performance': 'Power',
  'laptop efficiency': 'Power',
  'boost behavior': 'Power',
  'idle behavior': 'Power',
  thermals: 'Power',
  'windows debloat': 'Apps',
  apps: 'Apps',
  'background apps': 'Apps',
  services: 'Services',
  'background load': 'Services',
  telemetry: 'Privacy',
  'tracking & data collection': 'Privacy',
  'consumer features': 'Privacy',
  privacy: 'Privacy',
  'optional feature removal': 'Privacy',
  system: 'System',
  maintenance: 'Maintenance',
  security: 'Security',
  updates: 'Updates',
  'windows update': 'Updates',
  cleanup: 'Cleanup',
  'clean up': 'Cleanup',
  features: 'Cleanup',
  feature: 'Cleanup',
  'windows features': 'Cleanup',
  interface: 'Interface',
  'explorer & shell': 'Interface',
  'ui behavior': 'Interface',
  notifications: 'Interface',
  'update behavior': 'Updates',
  'login & session': 'Security',
  startup: 'Startup',
  'boot configuration': 'Startup',
  'recovery & startup': 'Startup',
  kernel: 'Kernel',
  'kernel policies': 'Kernel',
  hypervisor: 'Hypervisor',
  experimental: 'Experimental',
  'expert only': 'Experimental',
  'vendor specific': 'Experimental',
  'unsupported combinations': 'Experimental',
  'legacy tweaks': 'Experimental'
};

const CATEGORY_BY_SUBCATEGORY = Object.fromEntries(
  Object.entries(TWEAK_SUBCATEGORY_ORDER).flatMap(([category, subcategories]) =>
    subcategories.map((subcategory) => [subcategory, category])
  )
);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isKnownCategory(category) {
  return TWEAK_CATEGORY_ORDER.includes(category);
}

function isKnownSubcategory(category, subcategory) {
  const allowed = TWEAK_SUBCATEGORY_ORDER[category];
  return Array.isArray(allowed) ? allowed.includes(subcategory) : false;
}

function resolveCategory(rawCategory) {
  if (isKnownCategory(rawCategory)) {
    return rawCategory;
  }

  return LEGACY_CATEGORY_MAP[normalizeKey(rawCategory)] || '';
}

function resolveLegacySubcategory(rawSubcategory) {
  const value = String(rawSubcategory || '').trim();
  if (!value) {
    return '';
  }

  return LEGACY_SUBCATEGORY_MAP[normalizeKey(value)] || '';
}

function resolveCategoryFromSubcategory(rawSubcategory) {
  const exact = String(rawSubcategory || '').trim();
  if (CATEGORY_BY_SUBCATEGORY[exact]) {
    return CATEGORY_BY_SUBCATEGORY[exact];
  }

  const legacy = resolveLegacySubcategory(rawSubcategory);
  return legacy ? CATEGORY_BY_SUBCATEGORY[legacy] || '' : '';
}

function resolveSubcategory(rawSubcategory, category) {
  if (!category) {
    return '';
  }

  const value = String(rawSubcategory || '').trim();
  if (!value) {
    return '';
  }

  if (isKnownSubcategory(category, value)) {
    return value;
  }

  const legacy = resolveLegacySubcategory(value);
  return legacy && isKnownSubcategory(category, legacy) ? legacy : '';
}

function normalizePathSegments(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => normalizeKey(segment))
    .filter(Boolean);
}

function inferTaxonomyFromTweak(tweak) {
  const scriptSegments = normalizePathSegments(tweak?.script || tweak?.applyScript || tweak?.apply_script);
  const scriptPath = scriptSegments.join('/');
  const tags = Array.isArray(tweak?.tags)
    ? tweak.tags.map((tag) => normalizeKey(tag)).filter(Boolean)
    : [];
  const containerType = normalizeKey(tweak?.containerType || tweak?.container_type);
  const haystack = `${scriptPath} ${tags.join(' ')} ${containerType}`;

  if (containerType === 'power_plan' || scriptSegments.includes('powerplans') || scriptSegments.includes('power-plans')) {
    return { category: 'General', subcategory: 'Power Plans' };
  }

  if (containerType === 'timer_resolution' || scriptSegments.includes('timerresolution')) {
    return { category: 'Latency', subcategory: 'Timer Resolution' };
  }

  if (scriptSegments.includes('general')) {
    if (scriptSegments.includes('cleanup') || tags.includes('cleanup')) {
      return { category: 'General', subcategory: 'Cleanup' };
    }
    if (scriptSegments.includes('maintenance') || /component-store|dism|sfc|repair|rebuild/.test(haystack)) {
      return { category: 'General', subcategory: 'Maintenance' };
    }
    if (scriptSegments.includes('security') || /defender|security/.test(haystack)) {
      return { category: 'General', subcategory: 'Security' };
    }
    if (scriptSegments.includes('updates') || /windows-update|update/.test(haystack)) {
      return { category: 'General', subcategory: 'Updates' };
    }
    return { category: 'General', subcategory: 'System' };
  }

  if (scriptSegments.includes('latency')) {
    if (scriptSegments.includes('input') || tags.includes('input')) {
      return { category: 'Latency', subcategory: 'Input' };
    }
    if (scriptSegments.includes('timer')) {
      return { category: 'Latency', subcategory: 'Timer' };
    }
    return { category: 'Latency', subcategory: 'Input' };
  }

  if (scriptSegments.includes('hardware')) {
    if (scriptSegments.includes('gpu') || tags.includes('gpu')) {
      return { category: 'Hardware', subcategory: 'GPU' };
    }
    if (scriptSegments.includes('cpu') || tags.includes('cpu')) {
      return { category: 'Hardware', subcategory: 'CPU' };
    }
    if (scriptSegments.includes('memory') || tags.includes('memory')) {
      return { category: 'Hardware', subcategory: 'Memory' };
    }
    if (scriptSegments.includes('storage') || tags.includes('storage')) {
      return { category: 'Hardware', subcategory: 'Storage' };
    }
    if (scriptSegments.includes('power') || tags.includes('power')) {
      return { category: 'Hardware', subcategory: 'Power' };
    }
    return { category: 'Hardware', subcategory: 'CPU' };
  }

  if (scriptSegments.includes('debloat')) {
    if (scriptSegments.includes('apps') || tags.includes('apps')) {
      return { category: 'Debloat', subcategory: 'Apps' };
    }
    if (scriptSegments.includes('privacy') || tags.includes('privacy')) {
      return { category: 'Debloat', subcategory: 'Privacy' };
    }
    if (scriptSegments.includes('interface') || /visual|widget|gamebar/.test(haystack)) {
      return { category: 'Debloat', subcategory: 'Interface' };
    }
    return { category: 'Debloat', subcategory: 'Services' };
  }

  if (scriptSegments.includes('boot')) {
    if (scriptSegments.includes('kernel') || /nx|hpet|dynamic|platform|tsc/.test(haystack)) {
      return { category: 'Boot', subcategory: 'Kernel' };
    }
    if (scriptSegments.includes('hypervisor') || haystack.includes('hyperv')) {
      return { category: 'Boot', subcategory: 'Hypervisor' };
    }
    return { category: 'Boot', subcategory: 'Startup' };
  }

  if (scriptSegments.includes('network')) {
    if (scriptSegments.includes('dns') || tags.includes('dns')) {
      return { category: 'Network', subcategory: 'DNS' };
    }
    if (scriptSegments.includes('tcp') || /tcp|winsock|ip-stack/.test(haystack)) {
      return { category: 'Network', subcategory: 'TCP IP' };
    }
    if (scriptSegments.includes('adapter') || /ethernet|eee/.test(haystack)) {
      return { category: 'Network', subcategory: 'Adapter' };
    }
    if (scriptSegments.includes('packet') || /qos|ecn/.test(haystack)) {
      return { category: 'Network', subcategory: 'Packet Handling' };
    }
    return { category: 'Network', subcategory: 'Network Latency' };
  }

  return { category: '', subcategory: '' };
}

export function normalizeTweakTaxonomy(tweak) {
  const rawCategory =
    tweak?.category ||
    tweak?.categoryName ||
    '';
  const rawSubcategory =
    tweak?.subcategory ||
    tweak?.subCategory ||
    tweak?.sub_category ||
    '';
  const inferred = inferTaxonomyFromTweak(tweak);

  const category =
    resolveCategoryFromSubcategory(rawSubcategory) ||
    resolveCategory(rawCategory) ||
    inferred.category ||
    'General';
  const subcategory =
    resolveSubcategory(rawSubcategory, category) ||
    (inferred.category === category ? inferred.subcategory : '') ||
    DEFAULT_SUBCATEGORY_BY_CATEGORY[category] ||
    '';

  return {
    ...tweak,
    category,
    subcategory
  };
}

export function getOrderedCategories(categoryStats = {}) {
  const discovered = Object.keys(categoryStats || {});
  const extras = discovered
    .filter((category) => category && !TWEAK_CATEGORY_ORDER.includes(category))
    .sort((left, right) => left.localeCompare(right));

  return [...TWEAK_CATEGORY_ORDER, ...extras];
}

export function getOrderedSubcategories(category, subcategoryStats = {}) {
  const baseOrder = Array.isArray(TWEAK_SUBCATEGORY_ORDER[category]) ? TWEAK_SUBCATEGORY_ORDER[category] : [];
  const discovered = Object.keys(subcategoryStats || {});
  const extras = discovered
    .filter((subcategory) => subcategory && !baseOrder.includes(subcategory))
    .sort((left, right) => left.localeCompare(right));

  return [...baseOrder, ...extras];
}
