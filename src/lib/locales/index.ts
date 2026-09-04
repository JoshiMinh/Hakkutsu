/**
 * Modular Internationalization and Language Registry System for Hakkutsu
 * Centralizes metadata, dictionary adapters, TTS codes, translation codes,
 * and per-language locale dictionaries.
 */

import { useSettingsStore } from "~lib/utils/settings";
import { vi } from "./vi";
import { en } from "./en";
import { zh } from "./zh";
import { ja } from "./ja";
import { ko } from "./ko";

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
  zh: {
    code: "zh",
    name: "Chinese",
    nativeName: "中文",
    flag: "🇨🇳",
    ttsLangCode: "zh-CN",
    googleTranslateCode: "zh-CN",
    supportsHanViet: false,
    dictionaryName: "CEDICT",
  },
  ja: {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    flag: "🇯🇵",
    ttsLangCode: "ja-JP",
    googleTranslateCode: "ja",
    supportsHanViet: false,
    dictionaryName: "JMdict",
  },
  ko: {
    code: "ko",
    name: "Korean",
    nativeName: "한국語",
    flag: "🇰🇷",
    ttsLangCode: "ko-KR",
    googleTranslateCode: "ko",
    supportsHanViet: false,
    dictionaryName: "KRdict",
  },
};

export type SupportedLanguageCode = "vi" | "en" | "zh" | "ja" | "ko";

export function getLanguageConfig(langCode?: string): LanguageConfig {
  if (langCode && SUPPORTED_LANGUAGES[langCode]) {
    return SUPPORTED_LANGUAGES[langCode];
  }
  return SUPPORTED_LANGUAGES.vi; // Default to Vietnamese
}

export const translations: Record<string, Record<string, string>> = {
  vi,
  en,
  zh,
  ja,
  ko,
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
