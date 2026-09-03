/**
 * Language Registry for Hakkutsu.
 * Centralizes metadata, dictionary adapters, TTS codes, and translation codes
 * for easily extending supported target languages.
 */

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
};

export type SupportedLanguageCode = "vi" | "en";

export function getLanguageConfig(langCode?: string): LanguageConfig {
  if (langCode && SUPPORTED_LANGUAGES[langCode]) {
    return SUPPORTED_LANGUAGES[langCode];
  }
  return SUPPORTED_LANGUAGES.vi; // Default to Vietnamese
}
