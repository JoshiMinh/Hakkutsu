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
  let str = text
    .normalize("NFD")
    .replace(/o\u0304/gi, "ou")
    .replace(/u\u0304/gi, "uu")
    .replace(/a\u0304/gi, "aa")
    .replace(/e\u0304/gi, "ee")
    .replace(/i\u0304/gi, "ii")
    .normalize("NFC")
    .replace(/ō/gi, "ou")
    .replace(/ū/gi, "uu")
    .replace(/ā/gi, "aa")
    .replace(/ē/gi, "ee")
    .replace(/ī/gi, "ii")
    .toLowerCase()
    .replace(/[-]/g, "");

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
  if (!text) return "";
  return text.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

/**
 * Sanitizes reading strings that contain multiple variants (e.g. "おれ、おら、うら" or "がち、かち").
 * Extracts a single clean hiragana reading, matching surface okurigana/suffix when applicable.
 */
export function sanitizeReading(rawReading: string, surface?: string): string {
  if (!rawReading) return "";
  const rawVariants = rawReading
    .split(/[\u3001,;\/\s\u3000]+/)
    .map((v) => katakanaToHiragana(v.trim()))
    .filter(Boolean);

  if (rawVariants.length === 0) return "";

  // Deduplicate variants while cleaning doubled strings (e.g. おもいおもい -> おmoい)
  const variants = Array.from(new Set(rawVariants)).map((v) => {
    if (v.length >= 4 && v.length % 2 === 0) {
      const half = v.slice(0, v.length / 2);
      if (half + half === v) return half;
    }
    return v;
  });

  let reading = variants[0];

  if (surface) {
    const cleanSurface = katakanaToHiragana(surface.trim());
    const exactMatch = variants.find((v) => v === cleanSurface);
    if (exactMatch) {
      reading = exactMatch;
    } else {
      // Match by trailing kana suffix (e.g. 勝ち -> かち instead of がち)
      const endMatch = variants.find((v) => {
        const sEnd = cleanSurface.slice(-1);
        const vEnd = v.slice(-1);
        return sEnd && vEnd && sEnd === vEnd;
      });
      if (endMatch) reading = endMatch;
    }

    // Strip lemma verb suffixes attached to adverbial/inflected stems (e.g. 楽に + らくにする -> らくに)
    const lemmaSuffixes = ["にする", "した", "して", "する", "させる", "られる", "れる"];
    for (const suf of lemmaSuffixes) {
      if (reading.endsWith(suf) && !cleanSurface.endsWith(suf)) {
        if (cleanSurface.endsWith(suf[0])) {
          reading = reading.slice(0, reading.length - (suf.length - 1));
          break;
        }
      }
    }
  }

  return reading;
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
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);
}

/** Count the number of kanji characters in a string */
export function countKanji(text: string): number {
  if (!text) return 0;
  return (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
}

const OKURIGANA_PARTICLES = new Set([
  "は", "が", "を", "に", "へ", "で", "と", "の", "も", "か", "や", "よ", "ね", "わ", "ぞ", "ぜ", "さ",
  "から", "まで", "より", "ほど", "だけ", "しか", "ばかり", "など", "くらい", "ぐらい",
  "けど", "けれど", "けれども", "のに", "ので", "たら", "なら", "ば"
]);

const OKURIGANA_STOP_WORDS = new Set([
  "だ", "だろう", "です", "でしょう", "だった",
  "すべて", "これ", "それ", "あれ", "どれ", "ここ", "そこ", "あそこ", "どこ",
  "こと", "もの", "とき", "わけ", "はず", "ほう", "ひと", "ため"
]);

const OKURIGANA_AUX_VERBS = new Set([
  "する", "した", "して", "し", "すれ", "しよう", "される", "された",
  "できる", "できた", "ある", "あった", "いる", "いた", "なる", "なり", "なった", "なります"
]);

export function deinflectWord(surface: string): string {
  if (surface.endsWith("られない")) return surface.slice(0, -4) + "る";
  if (surface.endsWith("られる")) return surface.slice(0, -3) + "る";
  if (surface.endsWith("れない")) return surface.slice(0, -3) + "る";
  if (surface.endsWith("れる")) return surface.slice(0, -2) + "る";
  if (surface.endsWith("なかった")) return surface.slice(0, -4) + "い";
  if (surface.endsWith("なくて")) return surface.slice(0, -3) + "い";
  if (surface.endsWith("ない")) return surface.slice(0, -2) + "る";
  if (surface.endsWith("かった")) return surface.slice(0, -3) + "い";
  if (surface.endsWith("ろう")) return surface.slice(0, -2) + "る";
  if (surface.endsWith("こう")) return surface.slice(0, -2) + "く";
  if (surface.endsWith("ごう")) return surface.slice(0, -2) + "ぐ";
  if (surface.endsWith("そう")) return surface.slice(0, -2) + "す";
  if (surface.endsWith("とう")) return surface.slice(0, -2) + "つ";
  if (surface.endsWith("のう")) return surface.slice(0, -2) + "ぬ";
  if (surface.endsWith("ぼう")) return surface.slice(0, -2) + "ぶ";
  if (surface.endsWith("もう")) return surface.slice(0, -2) + "む";
  if (surface.endsWith("よう")) return surface.slice(0, -2) + "る";
  if (surface.endsWith("せた")) return surface.slice(0, -2) + "せる";
  if (surface.endsWith("べた")) return surface.slice(0, -2) + "べる";
  if (surface.endsWith("めた")) return surface.slice(0, -2) + "める";
  if (surface.endsWith("れた")) return surface.slice(0, -2) + "れる";
  if (surface.endsWith("けた")) return surface.slice(0, -2) + "ける";
  if (surface.endsWith("てた")) return surface.slice(0, -2) + "てる";
  if (surface.endsWith("ねた")) return surface.slice(0, -2) + "ねる";
  if (surface.endsWith("げた")) return surface.slice(0, -2) + "げる";
  if (surface.endsWith("えだ")) return surface.slice(0, -2) + "える";
  if (surface.endsWith("った")) return surface.slice(0, -2) + "る";
  if (surface.endsWith("んだ")) return surface.slice(0, -2) + "む";
  if (surface.endsWith("いた")) return surface.slice(0, -2) + "く";
  if (surface.endsWith("いだ")) return surface.slice(0, -2) + "ぐ";
  if (surface.endsWith("した")) return surface.slice(0, -2) + "する";
  return surface;
}

/**
 * Derives the inflected reading for a surface form given its base dictionary form and base reading.
 * e.g. surface: "戻ろう", baseForm: "戻る", baseReading: "もどる" -> "もどろう"
 *      surface: "任せた", baseForm: "任せる", baseReading: "まかせる" -> "まかせた"
 *      surface: "信じられない", baseForm: "信じる", baseReading: "しんじる" -> "しんじられない"
 */
export function deriveInflectedReading(surface: string, baseForm: string, baseReading: string): string {
  if (!surface || !baseReading) return baseReading || "";
  if (!baseForm || surface === baseForm) return baseReading;

  // Find the kanji prefix boundary in baseForm
  const lastKanjiIdx = baseForm
    .split("")
    .map((c, i) => (isKanji(c) ? i : -1))
    .reduce((max, i) => Math.max(max, i), -1);

  if (lastKanjiIdx === -1) {
    return katakanaToHiragana(surface);
  }

  const baseOkurigana = baseForm.slice(lastKanjiIdx + 1);
  const cleanBaseReading = katakanaToHiragana(baseReading.trim());

  // Extract kanji stem reading from baseReading
  let stemReading = cleanBaseReading;
  if (baseOkurigana && cleanBaseReading.endsWith(baseOkurigana)) {
    stemReading = cleanBaseReading.slice(0, cleanBaseReading.length - baseOkurigana.length);
  }

  // Find surface okurigana (everything after last kanji)
  const surfaceKanjiIdx = surface
    .split("")
    .map((c, i) => (isKanji(c) ? i : -1))
    .reduce((max, i) => Math.max(max, i), -1);

  const surfaceOkurigana = surfaceKanjiIdx !== -1 ? surface.slice(surfaceKanjiIdx + 1) : "";

  return stemReading + surfaceOkurigana;
}

export interface MergeableToken {
  surface?: string;
  surface_form?: string;
  dictionary_form?: string;
  base_form?: string;
  pos?: string;
  [key: string]: any;
}

export function mergeOkuriganaTokens<T extends MergeableToken>(rawTokens: T[]): T[] {
  const getSurface = (t: T): string => t.surface ?? t.surface_form ?? "";
  const getBase = (t: T): string => t.dictionary_form ?? t.base_form ?? "";
  const setSurface = (t: T, val: string) => {
    if ("surface" in t || !("surface_form" in t)) (t as any).surface = val;
    if ("surface_form" in t) (t as any).surface_form = val;
  };
  const setBase = (t: T, val: string) => {
    if ("dictionary_form" in t || "surface" in t) (t as any).dictionary_form = val;
    if ("base_form" in t || "surface_form" in t) (t as any).base_form = val;
  };

  const merged: T[] = [];
  let i = 0;

  while (i < rawTokens.length) {
    const cur = { ...rawTokens[i] };
    const curSurface = getSurface(cur);

    // 1. Honorific prefix お/ご + next word (e.g. お前, お弁当, ご飯)
    if (
      (curSurface === "お" || curSurface === "ご") &&
      i + 1 < rawTokens.length &&
      rawTokens[i + 1].pos === "Word"
    ) {
      const next = rawTokens[i + 1];
      const nextSurface = getSurface(next);
      setSurface(cur, curSurface + nextSurface);
      setBase(cur, getBase(cur) + getBase(next));
      merged.push(cur);
      i += 2;
      continue;
    }

    // 2. 何 + counter/duration (e.g. 何週間, 何日, 何回, 何人, 何枚, 何度)
    if (
      curSurface === "何" &&
      i + 1 < rawTokens.length &&
      rawTokens[i + 1].pos === "Word" &&
      hasKanji(getSurface(rawTokens[i + 1]))
    ) {
      const next = rawTokens[i + 1];
      const nextSurface = getSurface(next);
      setSurface(cur, curSurface + nextSurface);
      setBase(cur, getBase(cur) + getBase(next));
      merged.push(cur);
      i += 2;
      continue;
    }

    // 3. Single-kanji verb/adjective stem + Hiragana okurigana / auxiliaries
    // e.g. 戻 + ろう -> 戻ろう, 任 + せ + た -> 任せた, 走 + っ + た -> 走った
    const endsInKanji = isKanji(curSurface.slice(-1));
    const isSingleKanji = countKanji(curSurface) === 1;

    if (cur.pos === "Word" && endsInKanji && isSingleKanji) {
      let combinedSurface = curSurface;
      while (i + 1 < rawTokens.length) {
        const next = rawTokens[i + 1];
        if (next.pos !== "Word") break;

        const nextSurface = getSurface(next);
        if (!/^[\u3040-\u309F]+$/.test(nextSurface)) break;

        // If next is a particle, conjunction, copula, or common noun, ALWAYS STOP
        if (OKURIGANA_PARTICLES.has(nextSurface) || OKURIGANA_STOP_WORDS.has(nextSurface)) {
          break;
        }

        // If next is a separate auxiliary verb not attached to stem
        if (combinedSurface.length === 1 && OKURIGANA_AUX_VERBS.has(nextSurface)) {
          break;
        }

        // Stop if already at realistic maximum okurigana length
        if (combinedSurface.length >= 7) {
          break;
        }

        combinedSurface += nextSurface;
        i++;
      }
      setSurface(cur, combinedSurface);
      setBase(cur, deinflectWord(combinedSurface));
    }

    merged.push(cur);
    i++;
  }

  return merged;
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

  const kanjiCount = countKanji(cleanText);
  if (kanjiCount > 0 && reading.trim().length > kanjiCount * 5 + 4) {
    return [{ text: cleanText }];
  }

  let cleanReading = reading.trim();
  if (cleanText.length === 1 && cleanReading.length >= 4 && cleanReading.length % 2 === 0) {
    const half = cleanReading.slice(0, cleanReading.length / 2);
    if (half + half === cleanReading) {
      cleanReading = half;
    }
  }

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

export interface ClozeSentenceResult {
  hasMatch: boolean;
  prefix: string;
  target: string;
  suffix: string;
  revealedTarget: string;
  revealedFurigana: string;
  clozeSentence: string;
  fullSentence: string;
}

/**
 * Automatically generates fill-in-the-blank cloze data from a context sentence and target word.
 * Handles bracketed furigana, verb/adjective stem inflections, and fallbacks.
 *
 * Example:
 * Input: sentence="今日は寿司を食べた", targetWord="寿司"
 * Output: clozeSentence="今日は［ …… ］を食べた"
 */
export function generateClozeSentence(
  sentence: string | undefined,
  targetWord: string,
  sentenceFurigana?: string,
  wordFurigana?: string,
  reading?: string
): ClozeSentenceResult {
  const cleanWord = (targetWord || "").trim();
  if (!cleanWord) {
    return {
      hasMatch: false,
      prefix: "",
      target: "",
      suffix: "",
      revealedTarget: "",
      revealedFurigana: "",
      clozeSentence: "［ …… ］",
      fullSentence: "",
    };
  }

  let sourceText = (sentenceFurigana && sentenceFurigana.trim().length > 0)
    ? sentenceFurigana.trim()
    : (sentence && sentence.trim().length > 0)
      ? sentence.trim()
      : "";

  // If no sentence is available or sentence is just the word itself, construct a contextual fallback
  if (!sourceText || sourceText === cleanWord) {
    const fallbackSentence = `${cleanWord}の意味を覚えます。`;
    const fallbackFurigana = wordFurigana ? `${wordFurigana}のいみをおぼえます。` : fallbackSentence;
    return {
      hasMatch: true,
      prefix: "",
      target: cleanWord,
      suffix: "の意味を覚えます。",
      revealedTarget: cleanWord,
      revealedFurigana: fallbackFurigana,
      clozeSentence: "［ …… ］の意味を覚えます。",
      fullSentence: fallbackSentence,
    };
  }

  // 1. Try matching bracketed furigana pattern for the word in sentence
  // e.g. target "彼女", sentence contains "彼女[かのじょ]"
  const escapedWord = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bracketPattern = new RegExp(`(${escapedWord}\\[[^\\]]+\\]|${escapedWord})`);
  const bracketMatch = sourceText.match(bracketPattern);

  if (bracketMatch && bracketMatch.index !== undefined) {
    const matchIdx = bracketMatch.index;
    const matchLen = bracketMatch[0].length;
    const prefix = sourceText.slice(0, matchIdx);
    const matchedTarget = bracketMatch[0];
    const suffix = sourceText.slice(matchIdx + matchLen);

    return {
      hasMatch: true,
      prefix,
      target: matchedTarget,
      suffix,
      revealedTarget: cleanWord,
      revealedFurigana: sourceText,
      clozeSentence: `${prefix}［ …… ］${suffix}`,
      fullSentence: sentence || sourceText.replace(/\[[^\]]+\]/g, ""),
    };
  }

  // 2. Try stem matching for verbs / adjectives with inflections
  // e.g. target "食べる" (stem "食"), sentence contains "食[た]べた" or "食べた" or "食べました"
  if (hasKanji(cleanWord)) {
    // Extract kanji stem (leading kanji sequence)
    const kanjiStemMatch = cleanWord.match(/^([\u4E00-\u9FFF\u3400-\u4DBF]+)/);
    if (kanjiStemMatch) {
      const stem = kanjiStemMatch[1];
      const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match stem with optional furigana bracket followed by 1 to 5 hiragana characters (inflection)
      const stemPattern = new RegExp(`(${escapedStem}(\\[[^\\]]+\\])?([ぁ-ん]{1,5}))`);
      const stemMatch = sourceText.match(stemPattern);

      if (stemMatch && stemMatch.index !== undefined) {
        const matchIdx = stemMatch.index;
        const matchLen = stemMatch[0].length;
        const prefix = sourceText.slice(0, matchIdx);
        const matchedTarget = stemMatch[0];
        const suffix = sourceText.slice(matchIdx + matchLen);

        return {
          hasMatch: true,
          prefix,
          target: matchedTarget,
          suffix,
          revealedTarget: matchedTarget.replace(/\[[^\]]+\]/g, ""),
          revealedFurigana: sourceText,
          clozeSentence: `${prefix}［ …… ］${suffix}`,
          fullSentence: sentence || sourceText.replace(/\[[^\]]+\]/g, ""),
        };
      }
    }
  }

  // 3. Try reading / kana matching if reading is provided
  if (reading && reading.trim().length > 0 && reading !== cleanWord) {
    const cleanReading = reading.trim();
    const escapedReading = cleanReading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const readingPattern = new RegExp(`(${escapedReading})`);
    const readingMatch = sourceText.match(readingPattern);

    if (readingMatch && readingMatch.index !== undefined) {
      const matchIdx = readingMatch.index;
      const matchLen = readingMatch[0].length;
      const prefix = sourceText.slice(0, matchIdx);
      const matchedTarget = readingMatch[0];
      const suffix = sourceText.slice(matchIdx + matchLen);

      return {
        hasMatch: true,
        prefix,
        target: matchedTarget,
        suffix,
        revealedTarget: cleanWord,
        revealedFurigana: sourceText,
        clozeSentence: `${prefix}［ …… ］${suffix}`,
        fullSentence: sentence || sourceText.replace(/\[[^\]]+\]/g, ""),
      };
    }
  }

  // 4. Fallback if target word is not directly inside context sentence
  return {
    hasMatch: false,
    prefix: sourceText,
    target: cleanWord,
    suffix: "",
    revealedTarget: cleanWord,
    revealedFurigana: wordFurigana || cleanWord,
    clozeSentence: `${sourceText} （［ …… ］）`,
    fullSentence: sentence || sourceText.replace(/\[[^\]]+\]/g, ""),
  };
}

function kanaMatch(originalChar: string, readingChar: string): boolean {
  const o = katakanaToHiragana(originalChar);
  const r = katakanaToHiragana(readingChar);
  if (o === r) return true;
  if (o === "は" && r === "わ") return true;
  if (o === "へ" && r === "え") return true;
  if (o === "を" && r === "お") return true;
  if (o === "づ" && r === "ず") return true;
  if (o === "ぢ" && r === "じ") return true;
  if (o === "ー" && /[あいうえお]/.test(r)) return true;
  return false;
}

const COMMON_READINGS: Record<string, string[]> = {
  "多": ["た"],
  "民族": ["みんぞく"],
  "言語": ["げんご"],
  "国家": ["こっか"],
  "韓国": ["かんこく"],
  "人": ["ひと", "じん", "にん"],
  "国民": ["こくみん"],
  "半分": ["はんぶん"],
  "以上": ["いじょう"],
  "半": ["はん"],
  "分": ["ぶん", "ふん", "ぷん", "わ"],
  "以": ["い"],
  "上": ["じょう", "うえ", "あ"],
  "麻薬": ["まやく"],
  "産業": ["さんぎょう"],
  "関わる": ["かかわる"],
  "信じる": ["しんじる"],
  "信じられない": ["しんじられない"],
  "俺": ["おれ"],
  "体験": ["たいけん"],
  "洪水": ["こうずい"],
  "解決": ["かいけつ"],
  "学校": ["がっこう"],
  "建設": ["けんせつ"],
  "毎日": ["まいにち"],
  "登校": ["とうこう"],
  "楽": ["らく"],
  "何週間": ["なんしゅうかん"],
};

function findBestSplit<T extends MergeableToken>(groupReading: string, kanjiGroup: T[]): string[] {
  const invalidStarters = /^[んっーゃゅょぁぃぅぇぉゎンッーャュョァィゥェォヮ]/;
  const kCounts = kanjiGroup.map((tok) => countKanji(tok.surface || tok.surface_form || ""));
  const totalKanji = kCounts.reduce((a, b) => a + b, 0);

  if (kanjiGroup.length === 1) return [groupReading];

  function solve(tokenIdx: number, charIdx: number): string[] | null {
    if (tokenIdx === kanjiGroup.length - 1) {
      const rem = groupReading.slice(charIdx);
      if (rem.length === 0) return null;
      if (invalidStarters.test(rem)) return null;
      const lastK = kCounts[tokenIdx];
      if (rem.length > lastK * 4 + 2 || rem.length < lastK) return null;
      return [rem];
    }

    const tok = kanjiGroup[tokenIdx];
    const tokSurf = (tok.surface || tok.surface_form || "").trim();
    const k = kCounts[tokenIdx];
    const minLen = Math.max(1, k);
    const maxLen = Math.min(groupReading.length - charIdx - (kanjiGroup.length - 1 - tokenIdx), k * 3 + 1);
    const ideal = Math.round((k / Math.max(1, totalKanji)) * groupReading.length);

    const candidates: number[] = [];
    if (COMMON_READINGS[tokSurf]) {
      for (const r of COMMON_READINGS[tokSurf]) {
        if (groupReading.startsWith(r, charIdx)) {
          candidates.push(r.length);
        }
      }
    }

    for (let len = minLen; len <= maxLen; len++) {
      if (!candidates.includes(len)) candidates.push(len);
    }
    candidates.sort((a, b) => {
      const aKnown = COMMON_READINGS[tokSurf]?.some((r) => r.length === a && groupReading.startsWith(r, charIdx));
      const bKnown = COMMON_READINGS[tokSurf]?.some((r) => r.length === b && groupReading.startsWith(r, charIdx));
      if (aKnown && !bKnown) return -1;
      if (!aKnown && bKnown) return 1;
      return Math.abs(a - ideal) - Math.abs(b - ideal);
    });

    for (const len of candidates) {
      const chunk = groupReading.slice(charIdx, charIdx + len);
      const nextChar = groupReading[charIdx + len];
      if (nextChar && invalidStarters.test(nextChar)) continue;

      const sub = solve(tokenIdx + 1, charIdx + len);
      if (sub) {
        return [chunk, ...sub];
      }
    }
    return null;
  }

  const result = solve(0, 0);
  if (result) return result;

  let consumed = 0;
  const fallback: string[] = [];
  for (let i = 0; i < kanjiGroup.length; i++) {
    if (i === kanjiGroup.length - 1) {
      fallback.push(groupReading.slice(consumed));
    } else {
      const len = Math.max(1, Math.round((kCounts[i] / Math.max(1, totalKanji)) * groupReading.length));
      fallback.push(groupReading.slice(consumed, consumed + len));
      consumed += len;
    }
  }
  return fallback;
}

/**
 * Aligns pre-tokenized Japanese segments with a full sentence reading (romaji or hiragana).
 * Distributes the accurate contextual reading to each token.
 */
export function alignTokensWithReading<T extends MergeableToken>(
  tokens: T[],
  sentenceReadingOrRomaji: string
): Array<T & { reading: { hiragana: string; romaji: string } }> {
  if (!sentenceReadingOrRomaji || !sentenceReadingOrRomaji.trim() || !tokens || tokens.length === 0) {
    return tokens.map((t) => {
      const surface = (t.surface || t.surface_form || "").trim();
      return {
        ...t,
        reading: { hiragana: katakanaToHiragana(surface), romaji: "" },
      };
    });
  }

  // Convert romaji if present, or clean reading
  const romajiWords = sentenceReadingOrRomaji.trim().split(/\s+/).filter(Boolean);
  const hWords = romajiWords.map((w) => (/[a-zA-Z]/.test(w) ? romajiToHiragana(w) : katakanaToHiragana(w)));
  const fullReading = hWords.join("");

  const result: Array<T & { reading: { hiragana: string; romaji: string } }> = [];
  let rIdx = 0;
  let tIdx = 0;

  while (tIdx < tokens.length) {
    const token = tokens[tIdx];
    const surface = (token.surface || token.surface_form || "").trim();

    if (!surface || !hasKanji(surface)) {
      let r = "";
      for (const c of surface) {
        if (/[\s\u3000、。！？!?…,\.]/.test(c)) continue;
        if (rIdx < fullReading.length && kanaMatch(c, fullReading[rIdx])) {
          r += fullReading[rIdx];
          rIdx++;
        }
      }
      result.push({
        ...token,
        reading: { hiragana: r || katakanaToHiragana(surface), romaji: "" },
      });
      tIdx++;
      continue;
    }

    const lastKanjiIdx = surface
      .split("")
      .map((c, i) => (isKanji(c) ? i : -1))
      .reduce((max, i) => Math.max(max, i), -1);
    const selfOkuri = lastKanjiIdx !== -1 ? surface.slice(lastKanjiIdx + 1) : "";

    if (selfOkuri) {
      let foundIdx = -1;
      for (let s = rIdx + 1; s < fullReading.length; s++) {
        if (kanaMatch(selfOkuri[0], fullReading[s])) {
          let m = true;
          for (let k = 1; k < selfOkuri.length; k++) {
            if (s + k >= fullReading.length || !kanaMatch(selfOkuri[k], fullReading[s + k])) {
              m = false;
              break;
            }
          }
          if (m) {
            foundIdx = s;
            break;
          }
        }
      }

      if (foundIdx !== -1) {
        const tokenReading = fullReading.slice(rIdx, foundIdx + selfOkuri.length);
        const maxLen = countKanji(surface) * 5 + 4;
        if (tokenReading.length <= maxLen) {
          rIdx = foundIdx + selfOkuri.length;
          result.push({
            ...token,
            reading: { hiragana: sanitizeReading(tokenReading, surface), romaji: "" },
          });
          tIdx++;
          continue;
        }
      }
    }

    const kanjiGroup: T[] = [token];
    let nextAnchor = "";
    let nextI = tIdx + 1;

    while (nextI < tokens.length) {
      const nextSurf = (tokens[nextI].surface || tokens[nextI].surface_form || "").trim();
      const lastK = nextSurf
        .split("")
        .map((c, i) => (isKanji(c) ? i : -1))
        .reduce((max, i) => Math.max(max, i), -1);

      if (lastK === -1) {
        const m = nextSurf.match(/^[^\u4E00-\u9FFF\u3400-\u4DBF]+/);
        if (m) {
          nextAnchor = m[0];
          break;
        }
      } else if (lastK < nextSurf.length - 1) {
        kanjiGroup.push(tokens[nextI]);
        nextAnchor = nextSurf.slice(lastK + 1);
        nextI++;
        break;
      } else {
        kanjiGroup.push(tokens[nextI]);
        nextI++;
      }
    }

    let foundAnchorPos = -1;
    if (nextAnchor) {
      for (let s = rIdx; s < fullReading.length; s++) {
        let m = true;
        for (let k = 0; k < Math.min(nextAnchor.length, 3); k++) {
          if (s + k >= fullReading.length || !kanaMatch(nextAnchor[k], fullReading[s + k])) {
            m = false;
            break;
          }
        }
        if (m) {
          foundAnchorPos = s;
          break;
        }
      }
    }

    if (foundAnchorPos !== -1) {
      const groupReading = fullReading.slice(rIdx, foundAnchorPos);
      rIdx = foundAnchorPos;

      const splitReadings = findBestSplit(groupReading, kanjiGroup);

      for (let k = 0; k < kanjiGroup.length; k++) {
        const tok = kanjiGroup[k];
        const tokSurf = (tok.surface || tok.surface_form || "").trim();
        const kCount = countKanji(tokSurf);
        let tokReading = splitReadings[k] || "";

        const maxLen = kCount * 5 + 4;
        if (tokReading.length > maxLen) {
          tokReading = tokReading.slice(0, maxLen);
        }

        result.push({
          ...tok,
          reading: { hiragana: sanitizeReading(tokReading, tokSurf), romaji: "" },
        });
      }

      tIdx = nextI;
    } else {
      const kCount = countKanji(surface);
      const safeChunk = fullReading.slice(rIdx, rIdx + Math.max(2, kCount * 2));
      rIdx += safeChunk.length;
      result.push({
        ...token,
        reading: { hiragana: sanitizeReading(safeChunk, surface), romaji: "" },
      });
      tIdx++;
    }
  }

  return result;
}

