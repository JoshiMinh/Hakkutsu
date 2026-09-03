/**
 * Google Translate Service for Hakkutsu.
 * Provides instant zero-configuration translation fallback when LLM is unavailable,
 * configured with explicit target language routing.
 */

import { deduplicateCueText } from "~lib/services/subtitle-parsers";

export class GoogleTranslateService {
  private cache: Map<string, string> = new Map();
  private maxCacheSize = 150;

  /**
   * Translate Japanese text to a specified target language (e.g., 'vi', 'en').
   */
  async translate(text: string, targetLang: string = "vi", sourceLang: string = "ja"): Promise<string> {
    if (!text || !text.trim()) return "";
    const cleanText = text.trim();
    const cacheKey = `${sourceLang}->${targetLang}:${cleanText}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sourceLang
      )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(cleanText)}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Google Translate error status ${res.status}`);
      }

      const json = await res.json();
      // Google translate returns an array of segments: [[["translated", "source", ...], ...], ...]
      if (Array.isArray(json) && Array.isArray(json[0])) {
        const uniquePieces: string[] = [];
        const seen = new Set<string>();
        for (const segment of json[0]) {
          if (Array.isArray(segment) && typeof segment[0] === "string" && segment[0].trim()) {
            const piece = segment[0].trim();
            const key = piece.toLowerCase().replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "");
            if (key && !seen.has(key)) {
              seen.add(key);
              uniquePieces.push(piece);
            }
          }
        }
        const translated = uniquePieces.join(" ");

        if (this.cache.size >= this.maxCacheSize) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(cacheKey, translated);
        return translated;
      }
    } catch (err) {
      console.warn("[Hakkutsu] Google Translate fallback request failed:", err);
    }

    return cleanText;
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
