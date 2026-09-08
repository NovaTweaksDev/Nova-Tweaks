const configuredSupportUrl = String(import.meta.env.VITE_SUPPORT_URL || '').trim();

export const SUPPORT_URL = configuredSupportUrl || 'https://buymeacoffee.com/novatweaks';
