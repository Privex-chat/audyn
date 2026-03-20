import en from './en';
import hi from './hi';
import es from './es';
import ja from './ja';
import ko from './ko';

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'es', 'ja', 'ko'];
export const DEFAULT_LANGUAGE = 'en';

const translations = { en, hi, es, ja, ko };

function getNestedValue(obj, keyPath) {
  return keyPath.split('.').reduce((acc, key) => acc?.[key], obj);
}

export function createT(language) {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  const currentTranslations = translations[lang] || translations[DEFAULT_LANGUAGE];
  const fallbackTranslations = translations[DEFAULT_LANGUAGE];

  return function t(key, params) {
    let value = getNestedValue(currentTranslations, key);

    if (value === undefined) {
      value = getNestedValue(fallbackTranslations, key);
    }

    if (value === undefined) {
      console.warn(`[i18n] Missing translation: "${key}" for language "${lang}"`);
      return key;
    }

    if (params && typeof value === 'string') {
      return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey] !== undefined ? params[paramKey] : match;
      });
    }

    return value;
  };
}

export function detectBrowserLanguage() {
  try {
    const browserLangs = navigator.languages || [navigator.language || navigator.userLanguage || ''];
    for (const lang of browserLangs) {

      const code = lang.toLowerCase().split('-')[0];
      if (SUPPORTED_LANGUAGES.includes(code)) {
        return code;
      }
    }
  } catch {

  }
  return DEFAULT_LANGUAGE;
}

export default translations;
