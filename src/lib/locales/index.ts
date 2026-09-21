/**
 * Modular Internationalization and Language Registry System for Hakkutsu
 * Centralizes metadata, dictionary adapters, TTS codes, translation codes,
 * and per-language locale dictionaries.
 */

import { useSettingsStore } from "~lib/utils/settings";
import { en } from "./en";
import { vi } from "./vi";
import { ja } from "./ja";
import { zh } from "./zh";
import { ko } from "./ko";
import { es } from "./es";
import { fr } from "./fr";
import { id } from "./id";

export interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  ttsLangCode: string;
  googleTranslateCode: string;
  supportsHanViet: boolean;
  dictionaryName: string;
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    flag: "🇬🇧",
    ttsLangCode: "en-US",
    googleTranslateCode: "en",
    supportsHanViet: false,
    dictionaryName: "Jisho / JMdict",
  },
  vi: {
    code: "vi",
    name: "Vietnamese",
    nativeName: "Tiếng Việt",
    flag: "🇻🇳",
    ttsLangCode: "vi-VN",
    googleTranslateCode: "vi",
    supportsHanViet: true,
    dictionaryName: "Mazii / Hán-Việt",
  },
  ja: {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    flag: "🇯🇵",
    ttsLangCode: "ja-JP",
    googleTranslateCode: "ja",
    supportsHanViet: false,
    dictionaryName: "JMdict / 国語",
  },
  zh: {
    code: "zh",
    name: "Chinese",
    nativeName: "中文",
    flag: "🇨🇳",
    ttsLangCode: "zh-CN",
    googleTranslateCode: "zh-CN",
    supportsHanViet: false,
    dictionaryName: "Mazii / CEDICT",
  },
  ko: {
    code: "ko",
    name: "Korean",
    nativeName: "한국語",
    flag: "🇰🇷",
    ttsLangCode: "ko-KR",
    googleTranslateCode: "ko",
    supportsHanViet: false,
    dictionaryName: "Mazii / KRdict",
  },
  es: {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    flag: "🇪🇸",
    ttsLangCode: "es-ES",
    googleTranslateCode: "es",
    supportsHanViet: false,
    dictionaryName: "JMdict / Español",
  },
  fr: {
    code: "fr",
    name: "French",
    nativeName: "Français",
    flag: "🇫🇷",
    ttsLangCode: "fr-FR",
    googleTranslateCode: "fr",
    supportsHanViet: false,
    dictionaryName: "JMdict / Français",
  },
  id: {
    code: "id",
    name: "Indonesian",
    nativeName: "Bahasa Indonesia",
    flag: "🇮🇩",
    ttsLangCode: "id-ID",
    googleTranslateCode: "id",
    supportsHanViet: false,
    dictionaryName: "JMdict / Indonesia",
  },
};

export type SupportedLanguageCode = "en" | "vi" | "ja" | "zh" | "ko" | "es" | "fr" | "id";

export function getLanguageConfig(langCode?: string): LanguageConfig {
  if (langCode && SUPPORTED_LANGUAGES[langCode]) {
    return SUPPORTED_LANGUAGES[langCode];
  }
  return SUPPORTED_LANGUAGES.en; // Fallback
}

export const translations: Record<string, Record<string, string>> = {
  en,
  vi,
  ja,
  zh,
  ko,
  es,
  fr,
  id,
};

export type TranslationKey = keyof typeof en;

export function t(key: TranslationKey, langCode?: string): string {
  const lang = (langCode && translations[langCode]) ? langCode : "vi";
  return translations[lang]?.[key] || translations.en?.[key] || (key as string);
}

export function useTranslation() {
  const store = useSettingsStore();
  const settings = store?.settings;
  const targetLang = settings?.targetLanguage;
  const lang = (targetLang && translations[targetLang]) ? targetLang : "vi";
  const showHanViet = settings?.showHanViet !== false;

  return {
    t: (key: TranslationKey) => (translations[lang]?.[key]) || translations.en?.[key] || key,
    lang,
    isVietnamese: lang === "vi",
    showHanViet,
  };
}
