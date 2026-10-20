import type { DensityWord, JlptLevel, LevelCounts, PageDensityAnalysis } from "./types";
import { densityContent, checkDensityAbort } from "./density-content";
import { yieldToPage } from "./page-text";

const LEVELS = ["N5", "N4", "N3", "N2", "N1", "unranked"] as const;
const emptyCounts = (): LevelCounts => ({ N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 });

export function balancedPercentages(counts: LevelCounts): LevelCounts {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!total) return emptyCounts();
  const result = emptyCounts();
  for (const level of LEVELS) result[level] = Math.floor(counts[level] * 100 / total);
  const remainder = 100 - Object.values(result).reduce((sum, value) => sum + value, 0);
  const order = [...LEVELS].sort((a, b) => (counts[b] * 100 % total) - (counts[a] * 100 % total));
  for (const level of order.slice(0, remainder)) result[level]++;
  return result;
}

function chunks(text: string): string[] {
  const result: string[] = [];
  while (text.length > 2000) {
    let end = 2000;
    const boundary = text.slice(0, end).search(/[。！？!?\s][^。！？!?\s]*$/u);
    if (boundary > 1000) end = boundary + 1;
    if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    result.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text) result.push(text);
  return result;
}

export async function analyzePageDensity(root: Element = document.body, signal?: AbortSignal): Promise<PageDensityAnalysis> {
  const url = window.location.href;
  const { texts, scope } = await densityContent(root, signal);
  let totalTextChars = 0, totalJapaneseChars = 0, totalKanji = 0;
  let deadline = performance.now() + 6;
  const kanji = new Set<string>();
  const batches: string[] = [];
  for (const text of texts) {
    let index = 0;
    for (const char of text) {
      if (/[\p{L}\p{N}]/u.test(char)) {
        totalTextChars++;
        if (/[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u.test(char)) totalJapaneseChars++;
        if (/\p{Script=Han}/u.test(char)) { totalKanji++; kanji.add(char); }
      }
      if (++index % 1024 === 0 && performance.now() > deadline) { checkDensityAbort(signal); await yieldToPage(); deadline = performance.now() + 6; }
    }
    if (/[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u.test(text)) batches.push(...chunks(text));
    checkDensityAbort(signal);
  }
  const words = new Map<string, DensityWord>();
  let vocabularyStatus: PageDensityAnalysis["vocabularyStatus"] = "available";
  let mature = new Set<string>(), learning = new Set<string>();
  let knowledgeAvailable = false;
  const knowledge = (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_DENSITY_KNOWLEDGE" });
      if (response?.type !== "DENSITY_KNOWLEDGE_RESULT" || !Array.isArray(response.payload?.mature) || !Array.isArray(response.payload?.learning)) return;
      mature = new Set(response.payload.mature); learning = new Set(response.payload.learning); knowledgeAvailable = true;
    } catch { /* Explicit unavailable state below. */ }
  })();
  try {
    for (let start = 0; start < batches.length; start += 8) {
      checkDensityAbort(signal);
      const response = await chrome.runtime.sendMessage({ type: "GET_DENSITY_VOCABULARY", payload: { texts: batches.slice(start, start + 8) } });
      checkDensityAbort(signal);
      if (response?.type !== "DENSITY_VOCABULARY_RESULT" || !Array.isArray(response.payload?.words)) throw new Error("Vocabulary analysis unavailable");
      for (const word of response.payload.words as DensityWord[]) {
        if (typeof word.lemma !== "string" || !Number.isSafeInteger(word.count) || word.count < 1 || (word.level !== null && !LEVELS.slice(0, 5).includes(word.level))) throw new Error("Invalid vocabulary result");
        const previous = words.get(word.lemma);
        if (previous) previous.count += word.count;
        else words.set(word.lemma, { ...word });
      }
      await yieldToPage();
    }
  } catch {
    checkDensityAbort(signal);
    words.clear(); vocabularyStatus = "unavailable";
  }
  await knowledge; checkDensityAbort(signal);
  const jlptDistribution = emptyCounts();
  const familiarity: PageDensityAnalysis["familiarity"] = {
    status: knowledgeAvailable && vocabularyStatus === "available" ? "available" : "unavailable", mature: 0, learning: 0, notSaved: 0,
  };
  let totalWords = 0;
  for (const word of words.values()) {
    totalWords += word.count;
    jlptDistribution[word.level || "unranked"] += word.count;
    if (familiarity.status === "available") familiarity[mature.has(word.lemma) ? "mature" : learning.has(word.lemma) ? "learning" : "notSaved"] += word.count;
  }
  const ranked = totalWords - jlptDistribution.unranked;
  const coverage = totalWords ? ranked * 100 / totalWords : 0;
  let dominantLevel: JlptLevel | null = null;
  if (totalWords >= 20 && coverage >= 70) {
    for (const level of LEVELS.slice(0, 5) as JlptLevel[]) {
      if (jlptDistribution[level] > 0 && (!dominantLevel || jlptDistribution[level] >= jlptDistribution[dominantLevel])) dominantLevel = level;
    }
  }
  return { url, scope, totalTextChars, totalJapaneseChars, totalKanji, uniqueKanji: kanji.size,
    scriptDensity: totalTextChars ? totalJapaneseChars * 100 / totalTextChars : 0,
    vocabularyStatus, totalWords, uniqueWords: words.size, coverage, jlptDistribution,
    percentages: balancedPercentages(jlptDistribution), dominantLevel, familiarity };
}
