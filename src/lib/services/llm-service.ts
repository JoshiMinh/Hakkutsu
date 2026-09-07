import { useSettingsStore } from "~lib/utils/settings";
import type { ExtensionSettings, WebTranslateResponse } from "~lib/utils/types";
import { googleTranslateService } from "./google-translate";
import { lookupWord, type LookupResult } from "./dictionary-lookup";
import { katakanaToHiragana, containsJapanese, hasKanji, romajiToHiragana, segmentJapaneseTokens } from "~lib/utils/japanese";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import { tokenize } from "./local-tokenizer";
import { getSettings } from "./storage";

export class LlmServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmServiceError";
  }
}

/**
 * High-performance text analysis and translation service using 
 * local Kuromoji tokenizer, offline JMDict, and Google Translate.
 */
class LlmService {
  private async getSettings(providedSettings?: ExtensionSettings): Promise<ExtensionSettings> {
    if (providedSettings) return providedSettings;
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      try {
        return await getSettings();
      } catch {}
    }
    const state = useSettingsStore.getState();
    return state.settings;
  }

  async analyzeText(text: string, isPhrase: boolean = false, targetLang: string = "vi"): Promise<any> {
    const cleanText = text.trim();
    // 1. Start Google Translate for sentence translation in parallel
    const translationPromise = googleTranslateService.translate(cleanText, targetLang, "ja");

    // 2. Direct whole-word dictionary match check for single terms (e.g. "好き", "お知らせ")
    if (containsJapanese(cleanText) && cleanText.length <= 16 && !/[\s\u3000、。！？!?…]/u.test(cleanText)) {
      try {
        const directDict = await lookupWord(cleanText, targetLang);
        if (directDict && directDict.meaning && directDict.meaning.trim().length > 0) {
          const translation = await translationPromise;
          return {
            translation: translation || directDict.meaning,
            usedFallback: true,
            tokens: [
              {
                surface: cleanText,
                reading: directDict.reading || cleanText,
                pos: "Word",
                meaning: directDict.meaning,
                dictionary_form: cleanText,
                jlpt: directDict.jlpt || predictJlpt(cleanText),
                vietnamese_sound: targetLang === "vi" && hasKanji(cleanText) ? (directDict.hanviet || getHanViet(cleanText)) : undefined,
                is_japanese: true,
              },
            ],
          };
        }
      } catch {}
    }
    
    // 3. Local Kuromoji Tokenizer + Dictionary Lookup
    try {
      let tokenList: Array<{ surface: string; base_form: string; reading?: string; pos?: string }> = [];

      try {
        const kTokens = await tokenize(text);
        if (kTokens && kTokens.length > 0) {
          tokenList = kTokens.map(t => ({
            surface: t.surface_form,
            base_form: t.base_form || t.surface_form,
            reading: t.reading,
            pos: t.pos
          }));
        }
      } catch {
        // Kuromoji offline / segmenter fallback
      }

      if (tokenList.length === 0) {
        const segs = segmentJapaneseTokens(text);
        tokenList = segs.map(s => ({ surface: s, base_form: s, pos: "Word" }));
      }

      if (tokenList && tokenList.length > 0) {
        // Deduplicate dictionary lookups for tokens in the same request
        const tokenLookupCache = new Map<string, Promise<LookupResult>>();

        const tokens = await Promise.all(
          tokenList.map(async (t) => {
            const surface = t.surface;
            const baseForm = t.base_form || surface;
            const isJp = containsJapanese(surface);
            const hiraganaFromRomaji = !isJp ? romajiToHiragana(surface) : "";
            const searchKey = isJp ? baseForm : (hiraganaFromRomaji !== surface ? hiraganaFromRomaji : baseForm);

            let lookupPromise = tokenLookupCache.get(searchKey);
            if (!lookupPromise) {
              lookupPromise = lookupWord(searchKey, targetLang);
              tokenLookupCache.set(searchKey, lookupPromise);
            }
            const dict = await lookupPromise;

            const readingKana = t.reading
              ? katakanaToHiragana(t.reading)
              : (hasKanji(baseForm) ? (dict.reading || surface) : (dict.reading || hiraganaFromRomaji || surface));

            return {
              surface,
              reading: readingKana,
              pos: t.pos || "Word",
              meaning: dict.meaning || "",
              dictionary_form: baseForm,
              jlpt: dict.jlpt || predictJlpt(baseForm),
              vietnamese_sound: targetLang === "vi" && hasKanji(baseForm) ? (dict.hanviet || getHanViet(baseForm || surface)) : undefined,
              is_japanese: isJp || Boolean(dict.meaning),
            };
          })
        );

        const translation = await translationPromise;

        return {
          translation,
          usedFallback: true,
          tokens,
        };
      }
    } catch (e) {
      console.warn("[Hakkutsu] Local tokenization error:", e);
    }

    const dictLookup = await lookupWord(text, targetLang);
    const translation = await translationPromise;

    return {
      translation,
      usedFallback: true,
      tokens: [
        {
          surface: text,
          reading: dictLookup.reading || text,
          pos: "Word",
          meaning: dictLookup.meaning || translation,
          dictionary_form: text,
          jlpt: dictLookup.jlpt,
          vietnamese_sound: targetLang === "vi" ? dictLookup.hanviet : undefined,
        },
      ],
    };
  }

  async translateWebpage(
    texts: string[],
    pageUrl: string,
    pageTitle: string,
    targetLang: string = "vi"
  ): Promise<WebTranslateResponse> {
    const translations = await googleTranslateService.translateBatch(texts, targetLang, "ja");
    return { translations };
  }
}

export const llmService = new LlmService();
