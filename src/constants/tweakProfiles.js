export const TWEAK_PROFILE_IDS = [
  'daily_safe',
  'gaming_performance',
  'laptop_battery',
  'privacy_debloat',
  'network_boost',
  'system_cleanup'
];

export const TWEAK_PROFILE_DEFINITIONS = [
  {
    id: 'daily_safe',
    icon: 'shield',
    tone: 'success',
    titleKey: 'tweaks.profiles.daily_safe.title',
    title: 'Daily Safe',
    descriptionKey: 'tweaks.profiles.daily_safe.description',
    description: 'Safe everyday optimizations for most systems.'
  },
  {
    id: 'gaming_performance',
    icon: 'gamepad',
    tone: 'accent',
    titleKey: 'tweaks.profiles.gaming_performance.title',
    title: 'Gaming Performance',
    descriptionKey: 'tweaks.profiles.gaming_performance.description',
    description: 'Responsive gaming tweaks without going full benchmark mode.'
  },
  {
    id: 'laptop_battery',
    icon: 'battery',
    tone: 'efficiency',
    titleKey: 'tweaks.profiles.laptop_battery.title',
    title: 'Laptop Battery',
    descriptionKey: 'tweaks.profiles.laptop_battery.description',
    description: 'Quiet, efficient defaults for notebooks.'
  },
  {
    id: 'privacy_debloat',
    icon: 'lock',
    tone: 'privacy',
    titleKey: 'tweaks.profiles.privacy_debloat.title',
    title: 'Privacy & Debloat',
    descriptionKey: 'tweaks.profiles.privacy_debloat.description',
    description: 'Reduce tracking, background noise, and bundled extras.'
  },
  {
    id: 'network_boost',
    icon: 'wifi',
    tone: 'network',
    titleKey: 'tweaks.profiles.network_boost.title',
    title: 'Network Boost',
    descriptionKey: 'tweaks.profiles.network_boost.description',
    description: 'Network-focused tweaks for gaming, streaming, and daily use.'
  },
  {
    id: 'system_cleanup',
    icon: 'brush',
    tone: 'cleanup',
    titleKey: 'tweaks.profiles.system_cleanup.title',
    title: 'System Cleanup',
    descriptionKey: 'tweaks.profiles.system_cleanup.description',
    description: 'One-shot cleanup tasks for temporary files and caches.'
  }
];

export const TWEAK_PROFILE_ID_SET = new Set(TWEAK_PROFILE_IDS);

export function normalizeTweakProfiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const id = String(entry?.id || '').trim();
      if (!TWEAK_PROFILE_ID_SET.has(id)) {
        return null;
      }

      const params = entry?.params && typeof entry.params === 'object' && !Array.isArray(entry.params)
        ? entry.params
        : {};

      return {
        id,
        defaultChecked: entry?.defaultChecked === false ? false : true,
        params
      };
    })
    .filter(Boolean);
}
