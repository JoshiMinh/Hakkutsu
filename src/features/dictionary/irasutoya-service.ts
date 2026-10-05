/**
 * Zero-API-Key Irasutoya Illustration Service.
 * Queries public Blogger feed for www.irasutoya.com to fetch illustration image URLs.
 */

import { googleTranslateService } from "./google-translate";

const irasutoyaCache = new Map<string, string[]>();

/**
 * Clean Blogger thumbnail URL to get higher resolution preview image.
 * e.g. /s72-c/ or /s1600-w400/ -> /s400/
 */
function upgradeImageUrl(url: string): string {
  if (!url) return "";
  return url
    .replace(/\/s\d+(-c)?\//, "/s400/")
    .replace(/\/w\d+-h\d+(-c)?\//, "/s400/");
}

interface ScoredImage {
  url: string;
  score: number;
  title: string;
}

/**
 * Calculate relevance score for an Irasutoya blog entry based on title, category tags, and query words.
 */
function scoreEntry(
  title: string,
  categories: string[],
  word: string,
  translatedKeywords: string[]
): number {
  let score = 0;
  const cleanTitle = title.trim().toLowerCase();
  const cleanWord = word.trim().toLowerCase();

  // 1. Exact match or contains full target Japanese word
  if (cleanTitle.includes(cleanWord)) {
    score += 100;
  }

  // 2. Contains individual characters of word (for multi-character kanji like 週間 -> 週 or 間)
  if (cleanWord.length >= 2) {
    for (const char of cleanWord) {
      if (cleanTitle.includes(char)) {
        score += 20;
      }
    }
  }

  // 3. Translated gloss keywords (e.g. week -> 1週間, カレンダー)
  for (const kw of translatedKeywords) {
    if (kw && cleanTitle.includes(kw.toLowerCase())) {
      score += 50;
    }
  }

  // 4. Category term matches
  for (const cat of categories) {
    const cleanCat = cat.trim().toLowerCase();
    if (cleanCat.includes(cleanWord)) {
      score += 40;
    }
    for (const kw of translatedKeywords) {
      if (kw && cleanCat.includes(kw.toLowerCase())) {
        score += 30;
      }
    }
  }

  // 5. Contains "イラスト" in title (standard Irasutoya post title format)
  if (cleanTitle.includes("イラスト")) {
    score += 10;
  }

  // 6. Penalty for loose full-text body hits where neither target word nor translated keywords are in title/category
  const hasWordInTitle = cleanTitle.includes(cleanWord) || categories.some(c => c.toLowerCase().includes(cleanWord));
  const hasKwInTitle = translatedKeywords.some(kw => kw && (cleanTitle.includes(kw.toLowerCase()) || categories.some(c => c.toLowerCase().includes(kw.toLowerCase()))));
  
  if (!hasWordInTitle && !hasKwInTitle) {
    score -= 100; // Penalize entries where word only appeared in body text
  }

  return score;
}

/**
 * Fetch Irasutoya illustrations directly via network request (for background script).
 */
export async function fetchIrasutoyaImagesDirect(
  word: string,
  targetLang: string = "en",
  meaning?: string
): Promise<string[]> {
  if (!word || word.trim() === "") return [];
  const key = word.trim();
  const cacheKey = `irasutoya:${key}:${meaning || ""}`;

  if (irasutoyaCache.has(cacheKey)) {
    return irasutoyaCache.get(cacheKey)!;
  }

  // Prepare translated keywords if meaning gloss is provided
  const translatedKeywords: string[] = [];
  if (meaning && meaning.trim()) {
    try {
      const firstGloss = meaning.split(/[;,]/)[0].trim();
      if (firstGloss) {
        const jpGloss = await googleTranslateService.translate(firstGloss, "ja", targetLang);
        if (jpGloss && jpGloss !== firstGloss) {
          translatedKeywords.push(jpGloss);
        }
      }
    } catch {}
  }

  const scoredEntries: ScoredImage[] = [];

  const queryApi = async (q: string): Promise<ScoredImage[]> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const url = `https://www.irasutoya.com/feeds/posts/default?alt=json&max-results=8&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const entries = json.feed?.entry || [];
        const items: ScoredImage[] = [];

        for (const entry of entries) {
          const title = entry?.title?.$t || "";
          const categories: string[] = Array.isArray(entry?.category)
            ? entry.category.map((c: any) => c?.term || "").filter(Boolean)
            : [];

          let imgUrl = entry?.["media$thumbnail"]?.url || entry?.media$thumbnail?.url || "";

          if (!imgUrl && entry?.content?.$t) {
            const match = String(entry.content.$t).match(/src=["'](https?:[^"']+)["']/i);
            if (match && match[1]) {
              imgUrl = match[1];
            }
          }

          if (imgUrl) {
            const highRes = upgradeImageUrl(imgUrl);
            if (highRes) {
              const score = scoreEntry(title, categories, key, translatedKeywords);
              items.push({ url: highRes, score, title });
            }
          }
        }
        return items;
      }
    } catch (e) {
      console.warn("[Hakkutsu] Irasutoya fetch error for:", q, e);
    }
    return [];
  };

  // 1. Primary Query: Japanese word + イラスト
  let items = await queryApi(`${key} イラスト`);
  scoredEntries.push(...items);

  // 2. Secondary Query: Japanese word directly
  if (scoredEntries.length < 3) {
    const rawItems = await queryApi(key);
    for (const item of rawItems) {
      if (!scoredEntries.some(e => e.url === item.url)) {
        scoredEntries.push(item);
      }
    }
  }

  // 3. Fallback Query: Translated keyword + イラスト
  if (scoredEntries.length === 0 && translatedKeywords.length > 0) {
    for (const kw of translatedKeywords) {
      const kwItems = await queryApi(`${kw} イラスト`);
      for (const item of kwItems) {
        if (!scoredEntries.some(e => e.url === item.url)) {
          scoredEntries.push(item);
        }
      }
    }
  }

  // Filter out heavily penalized entries if valid relevant entries exist
  const positiveScored = scoredEntries.filter(e => e.score > 0);
  const pool = positiveScored.length > 0 ? positiveScored : scoredEntries;

  // Sort pool by score descending
  pool.sort((a, b) => b.score - a.score);

  // Deduplicate URLs
  const finalUrls: string[] = [];
  for (const item of pool) {
    if (!finalUrls.includes(item.url)) {
      finalUrls.push(item.url);
    }
  }

  const result = finalUrls.slice(0, 4);
  irasutoyaCache.set(cacheKey, result);
  return result;
}

/**
 * Fetch Irasutoya illustrations for a word.
 * Routes through extension background worker if in content script context to bypass CORS/CSP.
 */
export async function fetchIrasutoyaImages(
  word: string,
  targetLang: string = "en",
  meaning?: string
): Promise<string[]> {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "FETCH_IMAGE",
        payload: { query: word, targetLang, meaning }
      });
      if (response && response.type === "FETCH_IMAGE_RESULT" && Array.isArray(response.payload?.images)) {
        return response.payload.images;
      }
    } catch (e) {
      // Fallback to direct fetch if message fails
    }
  }

  return fetchIrasutoyaImagesDirect(word, targetLang, meaning);
}

