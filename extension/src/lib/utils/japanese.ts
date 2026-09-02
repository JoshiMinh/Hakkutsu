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
const ROMAJI_MAP: Record<string, string> = {
  "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ",
  "sha": "しゃ", "shu": "しゅ", "sho": "しょ",
  "cha": "ちゃ", "chu": "ちゅ", "cho": "ちょ",
  "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
  "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ",
  "mya": "みゃ", "myu": "みゅ", "myo": "みょ",
  "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
  "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
  "ja": "じゃ", "ju": "じゅ", "jo": "じょ", "jya": "じゃ", "jyu": "じゅ", "jyo": "じょ",
  "bya": "びゃ", "byu": "びゅ", "byo": "びょ",
  "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ",
  "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ",
  "sa": "さ", "shi": "し", "si": "し", "su": "す", "se": "せ", "so": "そ",
  "ta": "た", "chi": "ち", "ti": "ち", "tsu": "つ", "tu": "つ", "te": "て", "to": "と",
  "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
  "ha": "は", "hi": "ひ", "fu": "ふ", "hu": "ふ", "he": "へ", "ho": "ほ",
  "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も",
  "ya": "や", "yu": "ゆ", "yo": "よ",
  "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ",
  "wa": "わ", "wo": "を", "nn": "ん", "n'": "ん",
  "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご",
  "za": "ざ", "ji": "じ", "zi": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
  "da": "だ", "di": "ぢ", "du": "づ", "de": "で", "do": "ど",
  "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ",
  "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
  "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お"
};

export function romajiToHiragana(text: string): string {
  if (!text) return "";
  let str = text.toLowerCase();
  str = str.replace(/([bcdfghjklmpqrstvwxyz])\1/g, 'っ$1');
  let result = "";
  let i = 0;
  while (i < str.length) {
    // Single 'n' before consonants, apostrophe, or at end of string becomes 'ん'
    if (str[i] === "n") {
      const next = str[i + 1];
      if (!next) {
        result += "ん";
        i++;
        continue;
      }
      if (next === "'" || next === "n") {
        result += "ん";
        i += 2;
        continue;
      }
      if (!/[aeiouy]/.test(next)) {
        result += "ん";
        i++;
        continue;
      }
    }

    let matched = false;
    for (let len = 4; len >= 1; len--) {
      if (i + len <= str.length) {
        const sub = str.slice(i, i + len);
        if (ROMAJI_MAP[sub]) {
          result += ROMAJI_MAP[sub];
          i += len;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      result += str[i];
      i++;
    }
  }
  return result;
}

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
 * Sanitizes reading strings that contain multiple variants (e.g. "おれ、おら、うら" or "がち、かち").
 * Extracts a single clean hiragana reading, matching surface okurigana/suffix when applicable.
 */
export function sanitizeReading(rawReading: string, surface?: string): string {
  if (!rawReading) return "";
  const variants = rawReading
    .split(/[\u3001,;\/\s\u3000]+/)
    .map((v) => katakanaToHiragana(v.trim()))
    .filter(Boolean);

  if (variants.length === 0) return "";
  if (variants.length === 1) return variants[0];

  if (surface) {
    const cleanSurface = katakanaToHiragana(surface.trim());
    const exactMatch = variants.find((v) => v === cleanSurface);
    if (exactMatch) return exactMatch;

    // Match by trailing kana suffix (e.g. 勝ち -> かち instead of がち)
    const endMatch = variants.find((v) => {
      const sEnd = cleanSurface.slice(-1);
      const vEnd = v.slice(-1);
      return sEnd && vEnd && sEnd === vEnd;
    });
    if (endMatch) return endMatch;
  }

  return variants[0];
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

/** Check if a string contains any kanji characters */
export function hasKanji(text: string): boolean {
  if (!text) return false;
  return [...text].some(isKanji);
}

/** Check if a string is purely kana (hiragana or katakana, no kanji) */
export function isPureKana(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return [...text].every((c) => isHiragana(c) || isKatakana(c) || /[\s\u3000\u30FCー・]/.test(c));
}

export interface RubySegment {
  text: string;
  ruby?: string;
}

/**
 * Distributes reading across kanji and kana segments for clean ruby annotation.
 * Pure kana segments have no ruby, while kanji segments get their matched reading.
 */
export function distributeFurigana(text: string, reading?: string): RubySegment[] {
  if (!text) return [];

  const cleanText = text.trim();

  // If text has bracket format like 漢[かん]字[じ] or 彼女[かのじょ]
  if (cleanText.includes("[") && cleanText.includes("]")) {
    const segments: RubySegment[] = [];
    const bracketRe = /([\u4E00-\u9FFF\u3400-\u4DBF]+)\[([^\]]+)\]|([^\u4E00-\u9FFF\u3400-\u4DBF\[\]]+)/g;
    let match: RegExpExecArray | null;
    while ((match = bracketRe.exec(cleanText)) !== null) {
      if (match[1] && match[2]) {
        segments.push({ text: match[1], ruby: match[2] });
      } else if (match[3]) {
        segments.push({ text: match[3] });
      }
    }
    if (segments.length > 0) return segments;
  }

  if (!reading || !hasKanji(cleanText) || cleanText === reading.trim()) {
    return [{ text: cleanText }];
  }

  const cleanReading = reading.trim();

  // Step 1: Strip common kana prefixes
  let start = 0;
  while (
    start < cleanText.length &&
    start < cleanReading.length &&
    !isKanji(cleanText[start]) &&
    cleanText[start] === cleanReading[start]
  ) {
    start++;
  }

  // Step 2: Strip common kana suffixes
  let endText = cleanText.length - 1;
  let endReading = cleanReading.length - 1;
  while (
    endText >= start &&
    endReading >= start &&
    !isKanji(cleanText[endText]) &&
    cleanText[endText] === cleanReading[endReading]
  ) {
    endText--;
    endReading--;
  }

  const prefix = cleanText.slice(0, start);
  const suffix = cleanText.slice(endText + 1);
  const middleText = cleanText.slice(start, endText + 1);
  const middleReading = cleanReading.slice(start, endReading + 1);

  const result: RubySegment[] = [];
  if (prefix) result.push({ text: prefix });

  if (middleText) {
    // Check if middleText contains internal kana separators (e.g. "思" + "い" + "出")
    const parts = middleText.split(/([^\u4E00-\u9FFF\u3400-\u4DBF]+)/).filter(Boolean);
    if (parts.length > 1) {
      let currentReading = middleReading;
      let matchedAll = true;
      const subSegments: RubySegment[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!hasKanji(part)) {
          // Kana part: find where it occurs in currentReading
          const idx = currentReading.indexOf(part);
          if (idx !== -1) {
            subSegments.push({ text: part });
            currentReading = currentReading.slice(idx + part.length);
          } else {
            matchedAll = false;
            break;
          }
        } else {
          // Kanji part: it takes the reading up to the next kana part
          const nextKana = parts[i + 1];
          if (nextKana) {
            const nextIdx = currentReading.indexOf(nextKana);
            if (nextIdx !== -1) {
              const kanjiReading = currentReading.slice(0, nextIdx);
              subSegments.push({ text: part, ruby: kanjiReading });
              currentReading = currentReading.slice(nextIdx);
            } else {
              matchedAll = false;
              break;
            }
          } else {
            // Last part takes the remainder
            subSegments.push({ text: part, ruby: currentReading });
            currentReading = "";
          }
        }
      }

      if (matchedAll && currentReading.length === 0) {
        result.push(...subSegments);
      } else {
        result.push({ text: middleText, ruby: middleReading });
      }
    } else {
      result.push({ text: middleText, ruby: middleReading });
    }
  }

  if (suffix) result.push({ text: suffix });

  return result;
}

/** Common Japanese particles for boundary splitting */
const COMMON_PARTICLES = new Set([
  "の", "を", "に", "へ", "と", "から", "より", "で", "や", "が", "は", "も", "か", "など", "まで",
  "けど", "けれど", "けれども", "のに", "ので", "たら", "なら", "ば"
]);

/**
 * Fast offline segmentation for Japanese phrases and compounds.
 * Correctly splits compounds, particles, and kana inflections.
 */
export function segmentJapaneseTokens(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  const clean = text.trim();
  const tokens: string[] = [];

  // Match sequences of Kanji (CJK), Katakana, Hiragana, Punctuation/Latin
  const re = /([\u4E00-\u9FFF\u3400-\u4DBF]+)|([\u30A0-\u30FFー]+)|([\u3040-\u309F]+)|([a-zA-Z0-9]+)|([^\s\w\u3040-\u30FF\u4E00-\u9FFF]+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(clean)) !== null) {
    const chunk = match[0];
    // If hiragana chunk, check if it contains known particles
    if (/^[\u3040-\u309F]+$/.test(chunk) && chunk.length > 1) {
      // Check if it's a particle or compound
      if (COMMON_PARTICLES.has(chunk)) {
        tokens.push(chunk);
      } else {
        // Look for embedded single character particles like 'の', 'が', 'を', 'に'
        let sub = "";
        for (let i = 0; i < chunk.length; i++) {
          const char = chunk[i];
          if (COMMON_PARTICLES.has(char) && sub.length > 0) {
            tokens.push(sub);
            tokens.push(char);
            sub = "";
          } else {
            sub += char;
          }
        }
        if (sub) tokens.push(sub);
      }
    } else {
      tokens.push(chunk);
    }
  }

  return tokens.length > 0 ? tokens : [clean];
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
