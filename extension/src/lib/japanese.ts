/**
 * Japanese text utility functions.
 *
 * Character detection, classification, and basic transformations
 * without external dependencies.
 */

import { UNICODE_RANGES } from "./constants";

/** Check if a character is hiragana */
export function isHiragana(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= UNICODE_RANGES.hiragana.start && code <= UNICODE_RANGES.hiragana.end;
}

/** Check if a character is katakana */
export function isKatakana(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= UNICODE_RANGES.katakana.start && code <= UNICODE_RANGES.katakana.end;
}

/** Check if a character is kanji (CJK unified ideographs) */
export function isKanji(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= UNICODE_RANGES.cjk.start && code <= UNICODE_RANGES.cjk.end) ||
    (code >= UNICODE_RANGES.cjkExtA.start && code <= UNICODE_RANGES.cjkExtA.end)
  );
}

/** Check if a character is any Japanese character (hiragana, katakana, or kanji) */
export function isJapanese(char: string): boolean {
  return isHiragana(char) || isKatakana(char) || isKanji(char);
}

/** Check if a string contains any Japanese characters */
export function containsJapanese(text: string): boolean {
  return [...text].some(isJapanese);
}

/** Count the number of Japanese characters in a string */
export function countJapanese(text: string): number {
  return [...text].filter(isJapanese).length;
}

/** Check if a string is predominantly Japanese (>50% Japanese characters) */
export function isPredominantlyJapanese(text: string): boolean {
  const chars = [...text].filter((c) => c.trim().length > 0);
  if (chars.length === 0) return false;
  const jpCount = chars.filter(isJapanese).length;
  return jpCount / chars.length > 0.5;
}

/**
 * Japanese text detection regex pattern.
 * Matches strings containing hiragana, katakana, or kanji.
 */
export const JAPANESE_REGEX =
  /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * Convert katakana string to hiragana.
 */
export function katakanaToHiragana(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= UNICODE_RANGES.katakana.start && code <= UNICODE_RANGES.katakana.end) {
        return String.fromCharCode(code - 0x60);
      }
      return char;
    })
    .join("");
}

/**
 * Convert hiragana string to katakana.
 */
export function hiraganaToKatakana(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= UNICODE_RANGES.hiragana.start && code <= UNICODE_RANGES.hiragana.end) {
        return String.fromCharCode(code + 0x60);
      }
      return char;
    })
    .join("");
}

/**
 * Extract Japanese text segments from mixed-language text.
 * Returns an array of { text, isJapanese } segments.
 */
export function segmentText(
  text: string
): Array<{ text: string; isJapanese: boolean }> {
  const segments: Array<{ text: string; isJapanese: boolean }> = [];
  let current = "";
  let currentIsJp: boolean | null = null;

  for (const char of text) {
    const charIsJp = isJapanese(char);

    if (currentIsJp !== null && charIsJp !== currentIsJp) {
      segments.push({ text: current, isJapanese: currentIsJp });
      current = "";
    }

    current += char;
    currentIsJp = charIsJp;
  }

  if (current && currentIsJp !== null) {
    segments.push({ text: current, isJapanese: currentIsJp });
  }

  return segments;
}
