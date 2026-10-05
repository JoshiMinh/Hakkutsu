/**
 * Multi-Language Dictionary Lookup Service.
 * Supports English (Jisho/JMdict), Vietnamese (Mazii/Hán-Việt), and Google Translate fallback.
 */

import { googleTranslateService } from "./google-translate";
import { getHanViet } from "~/shared/japanese/hanviet-dict";
import { containsJapanese, romajiToHiragana, sanitizeReading } from "~/shared/japanese/japanese";

export interface LookupResult {
  meaning: string;
  jlpt?: string;
  reading?: string;
  hanviet?: string;
  source?: string;
  frequency_rank?: number | null;
}

const MAX_LOOKUP_CACHE = 250;
const lookupCache = new Map<string, LookupResult>();

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, maxSize = MAX_LOOKUP_CACHE): void {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

// Pre-populated common dictionary fallbacks for fast offline access
const COMMON_EN_DICT: Record<string, LookupResult> = {
  "逮捕": { meaning: "arrest, apprehension, capture", jlpt: "N3", reading: "たいほ" },
  "授業": { meaning: "lesson, class work, teaching", jlpt: "N3", reading: "じゅぎょう" },
  "日本": { meaning: "Japan", jlpt: "N5", reading: "にほん" },
  "日本語": { meaning: "Japanese language", jlpt: "N5", reading: "にほんご" },
  "学生": { meaning: "student, pupil", jlpt: "N5", reading: "がくせい" },
  "学校": { meaning: "school", jlpt: "N5", reading: "がっこう" },
  "先生": { meaning: "teacher, master, doctor", jlpt: "N5", reading: "せんせい" },
  "食べる": { meaning: "to eat", jlpt: "N5", reading: "たべる" },
  "飲む": { meaning: "to drink", jlpt: "N5", reading: "のむ" },
  "見る": { meaning: "to see, to watch", jlpt: "N5", reading: "みる" },
  "聞く": { meaning: "to hear, to listen, to ask", jlpt: "N5", reading: "きく" },
  "行く": { meaning: "to go, to move", jlpt: "N5", reading: "いく" },
  "来る": { meaning: "to come", jlpt: "N5", reading: "くる" },
  "帰る": { meaning: "to return, to go home", jlpt: "N5", reading: "かえる" },
  "本": { meaning: "book, volume, origin", jlpt: "N5", reading: "ほん" },
  "水": { meaning: "water", jlpt: "N5", reading: "みず" },
  "火": { meaning: "fire", jlpt: "N5", reading: "ひ" },
  "友達": { meaning: "friend, companion", jlpt: "N5", reading: "ともだち" },
  "勉強": { meaning: "study, diligence", jlpt: "N5", reading: "べんきょう" },
  "仕事": { meaning: "work, job, occupation", jlpt: "N5", reading: "しごと" },
  "韓国": { meaning: "South Korea, Republic of Korea", jlpt: "N4", reading: "かんこく" },
  "人": { meaning: "person, human", jlpt: "N5", reading: "ひと" },
  "国民": { meaning: "citizen, people of a country", jlpt: "N3", reading: "こくみん" },
  "半分": { meaning: "half", jlpt: "N5", reading: "はんぶん" },
  "以上": { meaning: "not less than, more than, above", jlpt: "N4", reading: "いじょう" },
  "麻薬": { meaning: "narcotic, drug", jlpt: "N1", reading: "まやく" },
  "産業": { meaning: "industry", jlpt: "N3", reading: "さんぎょう" },
  "関わる": { meaning: "to be affected, to be involved", jlpt: "N1", reading: "かかわる" },
  "多": { meaning: "many, multi-", jlpt: "N3", reading: "た" },
  "民族": { meaning: "people, race, ethnicity", jlpt: "N3", reading: "みんぞく" },
  "言語": { meaning: "language", jlpt: "N3", reading: "げんご" },
  "国家": { meaning: "state, nation, country", jlpt: "N3", reading: "こっか" },
  "信じる": { meaning: "to believe, to trust", jlpt: "N3", reading: "しんじる" },
  "俺": { meaning: "I, me (male informal)", jlpt: "N3", reading: "おれ" },
  "体験": { meaning: "personal experience", jlpt: "N3", reading: "たいけん" },
  "解決": { meaning: "settlement, solution, resolution", jlpt: "N3", reading: "かいけつ" },
  "建設": { meaning: "construction, establishment", jlpt: "N3", reading: "けんせつ" },
  "洪水": { meaning: "flood", jlpt: "N2", reading: "こうずい" },
  "戻る": { meaning: "to turn back, to return", jlpt: "N4", reading: "もどる" },
  "任せる": { meaning: "to entrust, to leave to", jlpt: "N3", reading: "まかせる" },
  "登校": { meaning: "attendance at school, going to school", jlpt: "N3", reading: "とうこう" },
  "楽": { meaning: "comfortable, easy", jlpt: "N4", reading: "らく" },
  "何週間": { meaning: "several weeks, how many weeks", jlpt: "N4", reading: "なんしゅうかん" },
  "の": { meaning: "possessive particle, ones", jlpt: "N5", reading: "の" },
};

const COMMON_VI_DICT: Record<string, LookupResult> = {
  "逮捕": { meaning: "bắt giữ, bắt bớ", jlpt: "N3", reading: "たいほ", hanviet: "ĐÃI BỘ" },
  "授業": { meaning: "tiết học, bài học", jlpt: "N3", reading: "じゅぎょう", hanviet: "THỤ NGHIỆP" },
  "日本": { meaning: "Nhật Bản", jlpt: "N5", reading: "にほん", hanviet: "NHẬT BẢN" },
  "日本語": { meaning: "tiếng Nhật", jlpt: "N5", reading: "にほんご", hanviet: "NHẬT BẢN NGỮ" },
  "学生": { meaning: "học sinh, sinh viên", jlpt: "N5", reading: "がくせい", hanviet: "HỌC SINH" },
  "学校": { meaning: "trường học", jlpt: "N5", reading: "がっこう", hanviet: "HỌC HIỆU" },
  "先生": { meaning: "thầy cô giáo, giáo viên", jlpt: "N5", reading: "せんせい", hanviet: "TIÊN SINH" },
  "食べる": { meaning: "ăn", jlpt: "N5", reading: "たべる", hanviet: "THỰC" },
  "飲む": { meaning: "uống", jlpt: "N5", reading: "のむ", hanviet: "ẨM" },
  "見る": { meaning: "nhìn, xem", jlpt: "N5", reading: "みる", hanviet: "KIẾN" },
  "聞く": { meaning: "nghe, hỏi", jlpt: "N5", reading: "きく", hanviet: "VĂN" },
  "行く": { meaning: "đi", jlpt: "N5", reading: "いく", hanviet: "HÀNH" },
  "来る": { meaning: "đến", jlpt: "N5", reading: "くる", hanviet: "LAI" },
  "帰る": { meaning: "về, trở về", jlpt: "N5", reading: "かえる", hanviet: "QUY" },
  "本": { meaning: "sách, cuốn sách", jlpt: "N5", reading: "ほん", hanviet: "BỔN" },
  "水": { meaning: "nước", jlpt: "N5", reading: "みず", hanviet: "THỦY" },
  "火": { meaning: "lửa", jlpt: "N5", reading: "ひ", hanviet: "HỎA" },
  "友達": { meaning: "bạn bè", jlpt: "N5", reading: "ともだち", hanviet: "HỮU ĐẠT" },
  "勉強": { meaning: "học tập", jlpt: "N5", reading: "べんきょう", hanviet: "MIỄN CƯỜNG" },
  "仕事": { meaning: "công việc", jlpt: "N5", reading: "しごと", hanviet: "SĨ SỰ" },
  "韓国": { meaning: "Hàn Quốc", jlpt: "N4", reading: "かんこく", hanviet: "HÀN QUỐC" },
  "人": { meaning: "người", jlpt: "N5", reading: "ひと", hanviet: "NHÂN" },
  "国民": { meaning: "quốc dân, người dân", jlpt: "N3", reading: "こくみん", hanviet: "QUỐC DÂN" },
  "半分": { meaning: "một nửa", jlpt: "N5", reading: "はんぶん", hanviet: "BÁN PHÂN" },
  "以上": { meaning: "trở lên, nhiều hơn", jlpt: "N4", reading: "いじょう", hanviet: "DĨ THƯỢNG" },
  "麻薬": { meaning: "ma túy", jlpt: "N1", reading: "まやく", hanviet: "MA DƯỢC" },
  "産業": { meaning: "ngành nghề, công nghiệp", jlpt: "N3", reading: "さんぎょう", hanviet: "SẢN NGHIỆP" },
  "関わる": { meaning: "liên quan, dính líu", jlpt: "N1", reading: "かかわる", hanviet: "QUAN" },
  "多": { meaning: "nhiều, đa", jlpt: "N3", reading: "た", hanviet: "ĐA" },
  "民族": { meaning: "dân tộc", jlpt: "N3", reading: "みんぞく", hanviet: "DÂN TỘC" },
  "言語": { meaning: "ngôn ngữ", jlpt: "N3", reading: "げんご", hanviet: "NGÔN NGỮ" },
  "国家": { meaning: "quốc gia", jlpt: "N3", reading: "こっか", hanviet: "QUỐC GIA" },
  "信じる": { meaning: "tin tưởng", jlpt: "N3", reading: "しんじる", hanviet: "TÍN" },
  "俺": { meaning: "tao, tôi (nam thân mật)", jlpt: "N3", reading: "おれ", hanviet: "YÊM" },
  "体験": { meaning: "trải nghiệm", jlpt: "N3", reading: "たいけん", hanviet: "THỂ NGHIỆM" },
  "解決": { meaning: "giải quyết", jlpt: "N3", reading: "かいけつ", hanviet: "GIẢI QUYẾT" },
  "建設": { meaning: "xây dựng, kiến thiết", jlpt: "N3", reading: "けんせつ", hanviet: "KIẾN THIẾT" },
  "洪水": { meaning: "lũ lụt, hồng thủy", jlpt: "N2", reading: "こうずい", hanviet: "HỒNG THỦY" },
  "戻る": { meaning: "quay lại, trở về", jlpt: "N4", reading: "もどる", hanviet: "LỆ" },
  "任せる": { meaning: "giao phó, để mặc", jlpt: "N3", reading: "まかせる", hanviet: "NHIỆM" },
  "登校": { meaning: "đi học, đến trường", jlpt: "N3", reading: "とうこう", hanviet: "ĐĂNG HIỆU" },
  "楽": { meaning: "dễ dàng, thoải mái", jlpt: "N4", reading: "らく", hanviet: "LẠC" },
  "何週間": { meaning: "mấy tuần, nhiều tuần", jlpt: "N4", reading: "なんしゅうかん", hanviet: "HÀ CHU GIAN" },
  "の": { meaning: "của (trợ từ sở hữu)", jlpt: "N5", reading: "の" },
};

export interface ExampleSentence {
  id: string;
  japanese: string;
  reading?: string;
  translation: string;
  source?: string;
}

const exampleCache = new Map<string, ExampleSentence[]>();

/**
 * Look up a Japanese word in English using Jisho API.
 */
export async function lookupWordEnglish(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const rawKey = word.trim();
  const isJp = containsJapanese(rawKey);
  const hiraganaKey = !isJp ? romajiToHiragana(rawKey) : rawKey;
  const key = hiraganaKey || rawKey;

  const cacheKey = `en:${rawKey}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  if (COMMON_EN_DICT[rawKey]) {
    setBoundedMap(lookupCache, cacheKey, COMMON_EN_DICT[rawKey]);
    return COMMON_EN_DICT[rawKey];
  }
  if (COMMON_EN_DICT[key]) {
    setBoundedMap(lookupCache, cacheKey, COMMON_EN_DICT[key]);
    return COMMON_EN_DICT[key];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(key)}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.data && json.data.length > 0) {
        const match = json.data.find((entry: any) =>
          entry.slug === key ||
          entry.slug === rawKey ||
          entry.japanese?.some((j: any) => j.word === key || j.word === rawKey || j.reading === key || j.reading === rawKey)
        ) || json.data[0];

        if (match) {
          const englishDefs: string[] = match.senses
            ?.flatMap((s: any) => s.english_definitions || [])
            .slice(0, 3) || [];
          
          const meaning = englishDefs.join("; ");
          // Search results may be related words rather than this headword.
          // Their meanings remain useful, but their readings are not furigana
          // for the requested surface (e.g. 食べ物 returned for 食べ).
          const exactReading = match.japanese?.find((j: any) =>
            j.word === key || j.word === rawKey || j.reading === key || j.reading === rawKey);
          const rawReading = exactReading?.reading || "";
          const reading = sanitizeReading(rawReading, rawKey);
          const jlpt = match.jlpt?.length ? match.jlpt[0].replace(/jlpt-/i, "").toUpperCase() : undefined;

          if (meaning) {
            const result: LookupResult = { meaning, jlpt, reading: reading || undefined, source: "jisho" };
            setBoundedMap(lookupCache, cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Jisho lookup error for:", word, e);
  }

  // Fallback to Google Translate
  const gtRes = await googleTranslateService.translateWithReading(rawKey, "en", "ja");
  const fallbackReading = sanitizeReading(gtRes.reading || (key !== rawKey ? key : ""), rawKey);
  const fallbackResult: LookupResult = { meaning: gtRes.translation, reading: fallbackReading || undefined, source: "google" };
  setBoundedMap(lookupCache, cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Look up a Japanese word in Vietnamese using Mazii API / Hán-Việt.
 */
export async function lookupWordVietnamese(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const rawKey = word.trim();
  const isJp = containsJapanese(rawKey);
  const hiraganaKey = !isJp ? romajiToHiragana(rawKey) : rawKey;
  const key = hiraganaKey || rawKey;

  const cacheKey = `vi:${rawKey}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  const hanviet = getHanViet(rawKey) || getHanViet(key);

  if (COMMON_VI_DICT[rawKey]) {
    const res = { ...COMMON_VI_DICT[rawKey], hanviet: hanviet || COMMON_VI_DICT[rawKey].hanviet };
    setBoundedMap(lookupCache, cacheKey, res);
    return res;
  }
  if (COMMON_VI_DICT[key]) {
    const res = { ...COMMON_VI_DICT[key], hanviet: hanviet || COMMON_VI_DICT[key].hanviet };
    setBoundedMap(lookupCache, cacheKey, res);
    return res;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch("https://mazii.net/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        dict: "javi",
        type: "word",
        query: key,
        page: 1,
      }),
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.status === 200 && json.data && json.data.length > 0) {
        const match = json.data.find((item: any) => item.word === key || item.phonetic === key || item.word === rawKey) || json.data[0];
        if (match) {
          const means = (match.means || [])
            .map((m: any) => m.mean || "")
            .filter(Boolean)
            .slice(0, 3);

          const meaning = means.join("; ");
          const exactMatch = match.word === key || match.word === rawKey || match.phonetic === key;
          const reading = exactMatch ? sanitizeReading(match.phonetic || key, rawKey) : "";
          const result: LookupResult = {
            meaning: meaning || "",
            reading,
            hanviet: hanviet || undefined,
            source: "mazii",
          };
          if (meaning) {
            setBoundedMap(lookupCache, cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Mazii lookup error for:", word, e);
  }

  // Fallback to Google Translate + Han-Viet
  const gtRes = await googleTranslateService.translateWithReading(rawKey, "vi", "ja");
  const fallbackReading = sanitizeReading(gtRes.reading || (key !== rawKey ? key : ""), rawKey);
  const fallbackResult: LookupResult = {
    meaning: gtRes.translation,
    reading: fallbackReading || undefined,
    hanviet: hanviet || undefined,
    source: "google",
  };
  setBoundedMap(lookupCache, cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Look up a Japanese word in Chinese using Mazii / CEDICT / Translate fallback.
 */
export async function lookupWordChinese(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const rawKey = word.trim();
  const isJp = containsJapanese(rawKey);
  const hiraganaKey = !isJp ? romajiToHiragana(rawKey) : rawKey;
  const key = hiraganaKey || rawKey;

  const cacheKey = `zh:${rawKey}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch("https://mazii.net/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        dict: "jaza",
        type: "word",
        query: key,
        page: 1,
      }),
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.status === 200 && json.data && json.data.length > 0) {
        const match = json.data.find((item: any) => item.word === key || item.phonetic === key || item.word === rawKey) || json.data[0];
        if (match) {
          const means = (match.means || [])
            .map((m: any) => m.mean || "")
            .filter(Boolean)
            .slice(0, 3);

          const meaning = means.join("; ");
          const exactMatch = match.word === key || match.word === rawKey || match.phonetic === key;
          const reading = exactMatch ? sanitizeReading(match.phonetic || key, rawKey) : "";
          if (meaning) {
            const result: LookupResult = { meaning, reading, source: "mazii-zh" };
            setBoundedMap(lookupCache, cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Mazii ZH lookup error for:", word, e);
  }

  // Fallback: Jisho English -> Chinese translate
  const enRes = await lookupWordEnglish(rawKey);
  let meaning = enRes.meaning;
  if (meaning) {
    try {
      const zhMeaning = await googleTranslateService.translate(meaning, "zh-CN", "en");
      if (zhMeaning) meaning = zhMeaning;
    } catch {}
  } else {
    meaning = await googleTranslateService.translate(rawKey, "zh-CN", "ja");
  }

  const fallbackResult: LookupResult = {
    meaning,
    reading: enRes.reading || (key !== rawKey ? key : undefined),
    jlpt: enRes.jlpt,
    source: "JMdict (ZH)",
  };
  setBoundedMap(lookupCache, cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Look up a Japanese word in Korean using Mazii / KRdict / Translate fallback.
 */
export async function lookupWordKorean(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const rawKey = word.trim();
  const isJp = containsJapanese(rawKey);
  const hiraganaKey = !isJp ? romajiToHiragana(rawKey) : rawKey;
  const key = hiraganaKey || rawKey;

  const cacheKey = `ko:${rawKey}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch("https://mazii.net/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        dict: "jako",
        type: "word",
        query: key,
        page: 1,
      }),
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.status === 200 && json.data && json.data.length > 0) {
        const match = json.data.find((item: any) => item.word === key || item.phonetic === key || item.word === rawKey) || json.data[0];
        if (match) {
          const means = (match.means || [])
            .map((m: any) => m.mean || "")
            .filter(Boolean)
            .slice(0, 3);

          const meaning = means.join("; ");
          const exactMatch = match.word === key || match.word === rawKey || match.phonetic === key;
          const reading = exactMatch ? sanitizeReading(match.phonetic || key, rawKey) : "";
          if (meaning) {
            const result: LookupResult = { meaning, reading, source: "mazii-ko" };
            setBoundedMap(lookupCache, cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Mazii KO lookup error for:", word, e);
  }

  // Fallback: Jisho English -> Korean translate
  const enRes = await lookupWordEnglish(rawKey);
  let meaning = enRes.meaning;
  if (meaning) {
    try {
      const koMeaning = await googleTranslateService.translate(meaning, "ko", "en");
      if (koMeaning) meaning = koMeaning;
    } catch {}
  } else {
    meaning = await googleTranslateService.translate(rawKey, "ko", "ja");
  }

  const fallbackResult: LookupResult = {
    meaning,
    reading: enRes.reading || (key !== rawKey ? key : undefined),
    jlpt: enRes.jlpt,
    source: "JMdict (KO)",
  };
  setBoundedMap(lookupCache, cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Look up a Japanese word in Japanese (Monolingual / Jisho Japanese gloss).
 */
export async function lookupWordJapanese(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const rawKey = word.trim();
  const cacheKey = `ja:${rawKey}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  const enRes = await lookupWordEnglish(rawKey);
  let meaning = enRes.meaning;
  if (meaning) {
    try {
      const jaMeaning = await googleTranslateService.translate(meaning, "ja", "en");
      if (jaMeaning) meaning = jaMeaning;
    } catch {}
  }

  const result: LookupResult = {
    meaning: meaning || rawKey,
    reading: enRes.reading || rawKey,
    jlpt: enRes.jlpt,
    source: "JMdict (JA)",
  };
  setBoundedMap(lookupCache, cacheKey, result);
  return result;
}

/**
 * Fetch example sentences for a Japanese word with translations.
 */
export async function fetchExampleSentences(
  word: string,
  targetLang: string = "en",
  limit = 3
): Promise<ExampleSentence[]> {
  if (!word || word.trim() === "") return [];
  const key = word.trim();
  const lang = targetLang || "en";
  const cacheKey = `${lang}:${key}`;

  if (exampleCache.has(cacheKey)) {
    return exampleCache.get(cacheKey)!.slice(0, limit);
  }

  const results: ExampleSentence[] = [];

  // 1. Try Mazii Example Search
  try {
    const dictType = lang === "vi" ? "javi" : (lang === "zh" ? "jaza" : (lang === "ko" ? "jako" : "jaen"));
    const res = await fetch("https://mazii.net/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dict: dictType,
        type: "example",
        query: key,
        page: 1,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const rawExamples = json.results || json.data || [];
      if (Array.isArray(rawExamples) && rawExamples.length > 0) {
        for (const item of rawExamples.slice(0, limit)) {
          const japanese = (item.content || item.example || item.entry || "").trim();
          let translation = (item.mean || item.trans || item.translation || "").trim();
          const reading = (item.phonetic || item.transcription || "").trim();
          if (japanese && translation) {
            if (dictType === "jaen" && lang !== "en") {
              try {
                const tr = await googleTranslateService.translate(translation, lang, "en");
                if (tr) translation = tr;
              } catch {}
            }
            results.push({
              id: `mazii-${results.length}`,
              japanese,
              reading: reading || undefined,
              translation,
              source: "mazii",
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Mazii example fetch error:", word, e);
  }

  // 2. Fallback to Tatoeba API if Mazii returned no results
  if (results.length === 0) {
    try {
      const tatoebaLangMap: Record<string, string> = {
        vi: "vie",
        en: "eng",
        zh: "cmn",
        ko: "kor",
        ja: "jpn",
        es: "spa",
        fr: "fra",
        id: "ind",
      };
      const tatoebaLang = tatoebaLangMap[lang] || "eng";
      const res = await fetch(
        `https://tatoeba.org/en/api_v0/search?from=jpn&to=${tatoebaLang}&query=${encodeURIComponent(key)}`
      );
      if (res.ok) {
        const json = await res.json();
        const data = json.results || [];
        if (Array.isArray(data)) {
          for (const item of data.slice(0, limit)) {
            const japanese = item.text?.trim();
            const translations = item.translations?.[0];
            let translation = translations?.find((t: any) => t.lang === tatoebaLang)?.text?.trim();
            if (!translation && lang !== "en") {
              const engTrans = translations?.find((t: any) => t.lang === "eng")?.text?.trim();
              if (engTrans) {
                try {
                  translation = await googleTranslateService.translate(engTrans, lang, "en");
                } catch {
                  translation = engTrans;
                }
              }
            }
            if (japanese && translation) {
              results.push({
                id: `tatoeba-${item.id || results.length}`,
                japanese,
                translation,
                source: "tatoeba",
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Hakkutsu] Tatoeba example fetch error:", word, e);
    }
  }

  if (results.length > 0) {
    setBoundedMap(exampleCache, cacheKey, results);
  }

  return results.slice(0, limit);
}

/**
 * Universal dictionary lookup routed by target language.
 * Seamlessly handles any future language by translating dictionary definitions.
 */
export async function lookupWord(word: string, targetLang: string = "vi"): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const lang = targetLang || "vi";

  if (lang === "en") {
    return lookupWordEnglish(word);
  }
  if (lang === "vi") {
    return lookupWordVietnamese(word);
  }
  if (lang === "zh") {
    return lookupWordChinese(word);
  }
  if (lang === "ko") {
    return lookupWordKorean(word);
  }
  if (lang === "ja") {
    return lookupWordJapanese(word);
  }

  const rawKey = word.trim();
  const cacheKey = `${lang}:${rawKey}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  // Universal dynamic language adapter for any target language:
  const enResult = await lookupWordEnglish(word);
  if (enResult && enResult.meaning) {
    try {
      const translatedMeaning = await googleTranslateService.translate(enResult.meaning, lang, "en");
      const res = {
        ...enResult,
        meaning: translatedMeaning || enResult.meaning,
        source: `JMdict (${lang.toUpperCase()})`
      };
      setBoundedMap(lookupCache, cacheKey, res);
      return res;
    } catch {
      return enResult;
    }
  }

  // Direct translation fallback
  try {
    const gtRes = await googleTranslateService.translateWithReading(word, lang, "ja");
    const reading = sanitizeReading(gtRes.reading || enResult.reading || word, word);
    const res = {
      meaning: gtRes.translation,
      reading: reading || undefined,
      jlpt: enResult.jlpt,
      source: "Google Translate"
    };
    setBoundedMap(lookupCache, cacheKey, res);
    return res;
  } catch {
    return { meaning: "" };
  }
}

export interface WordVariant {
  word: string;
  reading?: string;
  meaning: string;
}

const variantCache = new Map<string, WordVariant[]>();

/**
 * Fetch other word variants / compound words containing the target word or kanji.
 * e.g. 小説 -> 小説家, 私小説, 時代小説
 */
export async function fetchWordVariants(
  word: string,
  targetLang: string = "en",
  limit = 4
): Promise<WordVariant[]> {
  if (!word || word.trim() === "") return [];
  const key = word.trim();
  const lang = targetLang || "en";
  const cacheKey = `var:${lang}:${key}`;

  if (variantCache.has(cacheKey)) {
    return variantCache.get(cacheKey)!;
  }

  const variants: WordVariant[] = [];
  const seenWords = new Set<string>([key]);

  // 1. Query Jisho API for compounds containing this word/kanji
  try {
    const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=*${encodeURIComponent(key)}*`);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data)) {
        for (const entry of json.data) {
          const matchedJp = entry.japanese?.find((j: any) => j.word && j.word.includes(key));
          const entryWord = matchedJp?.word || entry.slug;
          if (entryWord && entryWord !== key && entryWord.includes(key) && !seenWords.has(entryWord)) {
            seenWords.add(entryWord);

            const reading = matchedJp?.reading || entry.japanese?.[0]?.reading || "";
            const englishDefs: string[] = entry.senses
              ?.flatMap((s: any) => s.english_definitions || [])
              .slice(0, 2);

            let meaning = englishDefs.join("; ");
            if (lang !== "en" && meaning) {
              try {
                const trMeaning = await googleTranslateService.translate(meaning, lang, "en");
                if (trMeaning) meaning = trMeaning;
              } catch {}
            }

            variants.push({
              word: entryWord,
              reading: reading || undefined,
              meaning: meaning || "",
            });

            if (variants.length >= limit) break;
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Jisho variant fetch error:", word, e);
  }

  // 2. Fallback to Mazii for non-English variants if Jisho returns < limit
  if (variants.length < limit && lang !== "en") {
    try {
      const dictType = lang === "vi" ? "javi" : (lang === "zh" ? "jaza" : (lang === "ko" ? "jako" : "jaen"));
      const res = await fetch("https://mazii.net/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dict: dictType,
          type: "word",
          query: key,
          page: 1,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.status === 200 && Array.isArray(json.data)) {
          for (const item of json.data) {
            const itemWord = item.word || item.phonetic;
            if (itemWord && itemWord !== key && itemWord.includes(key) && !seenWords.has(itemWord)) {
              seenWords.add(itemWord);
              let means = (item.means || [])
                .map((m: any) => m.mean || "")
                .filter(Boolean)
                .slice(0, 2)
                .join("; ");

              if (dictType === "jaen" && lang !== "en" && means) {
                try {
                  const tr = await googleTranslateService.translate(means, lang, "en");
                  if (tr) means = tr;
                } catch {}
              }

              variants.push({
                word: itemWord,
                reading: item.phonetic || undefined,
                meaning: means || "",
              });

              if (variants.length >= limit) break;
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Hakkutsu] Mazii variant fetch error:", word, e);
    }
  }

  if (variants.length > 0) {
    setBoundedMap(variantCache, cacheKey, variants);
  }

  return variants.slice(0, limit);
}
