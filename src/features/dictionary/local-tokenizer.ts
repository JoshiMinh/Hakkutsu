/**
 * Local Japanese Tokenizer for Hakkutsu.
 * Uses Chrome's native Intl.Segmenter API for 100% offline, zero-latency,
 * robust word segmentation that works reliably in background service workers
 * and content scripts without heavy external dependencies.
 */

export interface Token {
  surface_form: string;
  pos: string;
  reading?: string;
  dictionary_reading?: string;
  base_form: string;
}

export async function initNLP(): Promise<void> {
  // Built-in Intl.Segmenter requires no asynchronous network initialization
  return Promise.resolve();
}

import { deinflectWord, mergeOkuriganaTokens } from "~/shared/japanese/japanese";
import { refineJapaneseTokens } from "./japanese-token-refinement";
import { getDB, searchDictionary } from "./local-lookup";

export { deinflectWord, mergeOkuriganaTokens };

/**
 * Tokenize Japanese text into words and punctuation tokens.
 */
export async function tokenize(text: string, options: { dictionaryAware?: boolean } = {}): Promise<Token[]> {
  if (!text || !text.trim()) return [];

  const cleanText = text.trim();

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
    const segments = Array.from(segmenter.segment(cleanText)) as Array<{
      segment: string;
      index: number;
      input: string;
      isWordLike: boolean;
    }>;

    const rawTokens: Token[] = segments.map((s) => ({
      surface_form: s.segment,
      pos: s.isWordLike ? "Word" : "Punctuation",
      reading: undefined,
      base_form: s.segment,
    }));

    if (options.dictionaryAware) {
      // An uninstalled local dictionary is a normal state, not a reason to
      // issue a failing database query for every possible compound.
      try {
        const db = await getDB();
        if (db.objectStoreNames.contains("jmdict") && await db.count("jmdict") > 0) {
          return mergeOkuriganaTokens(await refineJapaneseTokens(rawTokens, searchDictionary));
        }
      } catch { /* Keep the standard local segmentation available. */ }
    }
    return mergeOkuriganaTokens(rawTokens);
  }

  // Fallback regex segmentation by whitespace and Japanese punctuation
  const words = cleanText.split(/([\s\u3000、。！？!?…]+)/).filter(Boolean);
  return words.map((w) => ({
    surface_form: w,
    pos: "Word",
    reading: undefined,
    base_form: w,
  }));
}

/**
 * Strips or generates basic ruby markup if needed.
 */
export async function getFurigana(text: string): Promise<string> {
  return text;
}
