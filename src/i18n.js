import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import de from '../locales/de.json';
import fr from '../locales/fr.json';

const resources = {
  en: {
    translation: en
  },
  de: {
    translation: de
  },
  fr: {
    translation: fr
  }
};

const supportedLanguages = ['en', 'de', 'fr'];
const LANGUAGE_STORAGE_KEY = 'app-language';

function normalizeLanguage(language) {
  if (!language || typeof language !== 'string') {
    return 'en';
  }

  const baseLanguage = language.toLowerCase().split('-')[0];
  return supportedLanguages.includes(baseLanguage) ? baseLanguage : 'en';
}

async function detectInitialLanguage() {
  try {
    const persistedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (persistedLanguage) {
      return normalizeLanguage(persistedLanguage);
    }
  } catch (_error) {
    // Ignore storage access issues and continue with OS/browser detection.
  }

  try {
    const osLanguage = await window.desktopApi?.getOsLanguage?.();
    if (osLanguage) {
      return normalizeLanguage(osLanguage);
    }
  } catch (_error) {
    // Fall back to navigator if IPC language detection fails.
  }

  return normalizeLanguage(navigator.language || navigator.languages?.[0]);
}

export async function initI18n() {
  if (i18n.isInitialized) {
    return i18n;
  }

  const initialLanguage = await detectInitialLanguage();

  await i18n.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

  i18n.on('languageChanged', (nextLanguage) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(nextLanguage));
    } catch (_error) {
      // Ignore storage access issues.
    }
  });

  return i18n;
}

export default i18n;

