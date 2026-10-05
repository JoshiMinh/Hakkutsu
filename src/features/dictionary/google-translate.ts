/**
 * Google Translate Service for Hakkutsu.
 * Provides instant zero-configuration translation fallback when LLM is unavailable,
 * configured with explicit target language routing.
 */

import { deduplicateCueText } from "~/shared/japanese/text-normalization";
import { romajiToHiragana } from "~/shared/japanese/japanese";

export interface TranslationResult {
  translation: string;
  romaji: string;
  reading: string;
}

export class GoogleTranslateService {
  private cache: Map<string, TranslationResult> = new Map();
  private maxCacheSize = 250;

  /**
   * Translate Japanese text and retrieve its phonetic romanization and hiragana reading.
   */
  async translateWithReading(
    text: string,
    targetLang: string = "vi",
    sourceLang: string = "ja"
  ): Promise<TranslationResult> {
    if (!text || !text.trim()) return { translation: "", romaji: "", reading: "" };
    const cleanText = text.trim();
    const cacheKey = `${sourceLang}->${targetLang}:${cleanText}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sourceLang
      )}&tl=${encodeURIComponent(targetLang)}&dt=t&dt=rm&q=${encodeURIComponent(cleanText)}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Google Translate error status ${res.status}`);
      }

      const json = await res.json();
      let romaji = "";
      const uniquePieces: string[] = [];
      const seen = new Set<string>();

      if (Array.isArray(json) && Array.isArray(json[0])) {
        for (const segment of json[0]) {
          if (Array.isArray(segment)) {
            if (typeof segment[0] === "string" && segment[0].trim()) {
              const piece = segment[0].trim();
              const key = piece.toLowerCase().replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "");
              if (key && !seen.has(key)) {
                seen.add(key);
                uniquePieces.push(piece);
              }
            }
            if (!romaji && typeof segment[3] === "string" && segment[3].trim()) {
              romaji = segment[3].trim();
            }
          }
        }
      }

      const translation = uniquePieces.join(" ") || cleanText;
      const reading = romaji ? romajiToHiragana(romaji) : "";
      const result: TranslationResult = { translation, romaji, reading };

      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.warn("[Hakkutsu] Google Translate fallback request failed:", err);
    }

    return { translation: cleanText, romaji: "", reading: "" };
  }

  /**
   * Translate Japanese text to a specified target language (e.g., 'vi', 'en').
   */
  async translate(text: string, targetLang: string = "vi", sourceLang: string = "ja"): Promise<string> {
    const result = await this.translateWithReading(text, targetLang, sourceLang);
    return result.translation;
  }

  /**
   * Translate an array of texts in batches.
   */
  async translateBatch(
    texts: string[],
    targetLang: string = "vi",
    sourceLang: string = "ja"
  ): Promise<{ id: number; text: string }[]> {
    return Promise.all(
      texts.map(async (text, i) => {
        const trans = await this.translate(text, targetLang, sourceLang);
        return { id: i, text: trans };
      })
    );
  }
}

export const googleTranslateService = new GoogleTranslateService();
