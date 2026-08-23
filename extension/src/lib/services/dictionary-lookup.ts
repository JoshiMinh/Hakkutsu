/**
 * English Dictionary & JLPT Lookup Service (via Jisho API with local cache).
 */

interface LookupResult {
  meaning: string;
  jlpt?: string;
  reading?: string;
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

export async function lookupWordEnglish(word: string): Promise<LookupResult> {
  if (!word || word.trim() === "") return { meaning: "" };
  const key = word.trim();
  
  if (lookupCache.has(key)) {
    return lookupCache.get(key)!;
  }

  if (COMMON_EN_DICT[key]) {
    lookupCache.set(key, COMMON_EN_DICT[key]);
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

        const result: LookupResult = { meaning, jlpt, reading };
        lookupCache.set(key, result);
        return result;
      }
    }
  } catch (e) {
    console.warn("[Hakkutsu] Jisho lookup error for:", word, e);
  }

  return { meaning: "" };
}
