/**
 * Google Translate Service for Hakkutsu.
 * Provides instant zero-configuration translation fallback when LLM is unavailable,
 * configured with explicit target language routing.
 */

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
        const translated = json[0]
          .map((segment: any) => (Array.isArray(segment) && segment[0] ? segment[0] : ""))
          .join("");

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
    const results: { id: number; text: string }[] = [];
    for (let i = 0; i < texts.length; i++) {
      const trans = await this.translate(texts[i], targetLang, sourceLang);
      results.push({ id: i, text: trans });
    }
    return results;
  }
}

export const googleTranslateService = new GoogleTranslateService();
