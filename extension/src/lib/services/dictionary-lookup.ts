/**
 * Multi-Language Dictionary Lookup Service.
 * Supports English (Jisho/JMdict), Vietnamese (Mazii/Hán-Việt), and Google Translate fallback.
 */

import { googleTranslateService } from "./google-translate";
import { getHanViet } from "~lib/utils/hanviet-dict";

export interface LookupResult {
  meaning: string;
  jlpt?: string;
  reading?: string;
  hanviet?: string;
  source?: string;
}

const lookupCache = new Map<string, LookupResult>();

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
  "の": { meaning: "của (trợ từ sở hữu)", jlpt: "N5", reading: "の" },
};

/**
 * Look up a Japanese word in English using Jisho API.
 */
export async function lookupWordEnglish(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const key = word.trim();
  const cacheKey = `en:${key}`;
  
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  if (COMMON_EN_DICT[key]) {
    lookupCache.set(cacheKey, COMMON_EN_DICT[key]);
    return COMMON_EN_DICT[key];
  }

  try {
    const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(key)}`);
    if (res.ok) {
      const json = await res.json();
      if (json.data && json.data.length > 0) {
        const entry = json.data[0];
        const englishDefs: string[] = entry.senses
          .flatMap((s: any) => s.english_definitions || [])
          .slice(0, 3);
        
        const meaning = englishDefs.join("; ");
        const reading = entry.japanese?.[0]?.reading || "";
        const jlpt = entry.jlpt?.length ? entry.jlpt[0].replace(/jlpt-/i, "").toUpperCase() : undefined;

        const result: LookupResult = { meaning, jlpt, reading, source: "jisho" };
        lookupCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Jisho lookup error for:", word, e);
  }

  // Fallback to Google Translate
  const gtMeaning = await googleTranslateService.translate(key, "en", "ja");
  const fallbackResult: LookupResult = { meaning: gtMeaning, source: "google" };
  lookupCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Look up a Japanese word in Vietnamese using Mazii API / Hán-Việt.
 */
export async function lookupWordVietnamese(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const key = word.trim();
  const cacheKey = `vi:${key}`;

  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey)!;
  }

  const hanviet = getHanViet(key);

  if (COMMON_VI_DICT[key]) {
    const res = { ...COMMON_VI_DICT[key], hanviet: hanviet || COMMON_VI_DICT[key].hanviet };
    lookupCache.set(cacheKey, res);
    return res;
  }

  try {
    const res = await fetch("https://mazii.net/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dict: "javi",
        type: "word",
        query: key,
        page: 1,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.status === 200 && json.data && json.data.length > 0) {
        const item = json.data[0];
        const means = (item.means || [])
          .map((m: any) => m.mean || "")
          .filter(Boolean)
          .slice(0, 3);

        const meaning = means.join("; ");
        const reading = item.phonetic || "";
        const result: LookupResult = {
          meaning: meaning || "",
          reading,
          hanviet: hanviet || undefined,
          source: "mazii",
        };
        if (meaning) {
          lookupCache.set(cacheKey, result);
          return result;
        }
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Mazii lookup error for:", word, e);
  }

  // Fallback to Google Translate + Han-Viet
  const gtMeaning = await googleTranslateService.translate(key, "vi", "ja");
  const fallbackResult: LookupResult = {
    meaning: gtMeaning,
    hanviet: hanviet || undefined,
    source: "google",
  };
  lookupCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Universal dictionary lookup routed by target language.
 */
export async function lookupWord(word: string, targetLang: string = "vi"): Promise<LookupResult> {
  if (targetLang === "en") {
    return lookupWordEnglish(word);
  }
  return lookupWordVietnamese(word);
}
