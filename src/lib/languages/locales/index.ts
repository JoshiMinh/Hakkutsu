/**
 * Modular Internationalization System for Hakkutsu
 * Automatically registers per-language locale dictionaries.
 */

import { useSettingsStore } from "~lib/utils/settings";
import { vi } from "./vi";
import { en } from "./en";
import { zh } from "./zh";
import { ja } from "./ja";
import { ko } from "./ko";

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

