import lexicon from "~/shared/japanese/data/density-jlpt.json";
import type { DensityWord, JlptLevel } from "./types";
import { yieldToPage } from "./page-text";

const dictionary = lexicon as Record<string, JlptLevel | null>;
export const normalizeDensityWord = (word: string) => word.normalize("NFKC").trim();
export const hasJapaneseScript = (text: string) => /[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u.test(text);
const japaneseWord = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+$/u;
const has = (word: string) => Object.prototype.hasOwnProperty.call(dictionary, word);
const segmenter = "Segmenter" in Intl ? new (Intl as any).Segmenter("ja", { granularity: "word" }) : null;
const cache = new Map<string, DensityWord[]>();

// Only dictionary-confirmed candidates may replace a surface. Multiple possible
// lemmas remain unranked: the bundled list cannot resolve grammatical ambiguity.
function dictionaryForm(surface: string): string | null {
  if (has(surface)) return surface;
  const candidates = new Set<string>();
  const endings: Array<[string, string[]]> = [
    ["ました", ["る"]], ["ます", ["る"]], ["ません", ["る"]],
    ["なかった", ["る", "い"]], ["ない", ["る"]], ["かった", ["い"]],
    ["くない", ["い"]], ["くなかった", ["い"]],
    ["した", ["す"]], ["して", ["す"]], ["った", ["う", "つ", "る"]],
    ["って", ["う", "つ", "る"]], ["んだ", ["む", "ぶ", "ぬ"]],
    ["んで", ["む", "ぶ", "ぬ"]], ["いた", ["く"]], ["いて", ["く"]],
    ["いだ", ["ぐ"]], ["いで", ["ぐ"]], ["た", ["る"]], ["て", ["る"]],
  ];
  // Polite godan stems: 読みました → 読む, 書きます → 書く.
  for (const ending of ["ました", "ます", "ません", "ませんでした"]) {
    if (!surface.endsWith(ending)) continue;
    const stem = surface.slice(0, -ending.length);
    const godan: Record<string, string> = { い:"う", き:"く", ぎ:"ぐ", し:"す", ち:"つ", に:"ぬ", び:"ぶ", み:"む", り:"る" };
    if (godan[stem.slice(-1)]) candidates.add(stem.slice(0, -1) + godan[stem.slice(-1)]);
    candidates.add(stem + "る");
    if (stem.endsWith("し")) candidates.add(stem.slice(0, -1) + "する");
    if (stem === "来") candidates.add("来る");
  }
  for (const [ending, replacements] of endings) {
    if (surface.length > ending.length && surface.endsWith(ending)) {
      for (const replacement of replacements) candidates.add(surface.slice(0, -ending.length) + replacement);
    }
  }
  const confirmed = [...candidates].filter(has);
  return confirmed.length === 1 ? confirmed[0] : null;
}

/** Offline only; no imported dictionary, translation service, or network needed. */
export async function resolveDensityVocabulary(texts: string[]): Promise<DensityWord[]> {
  if (!segmenter) throw new Error("Japanese word segmentation is unavailable");
  const totals = new Map<string, DensityWord>();
  let deadline = performance.now() + 6;
  for (const text of texts) {
    let words = cache.get(text);
    if (!words) {
      const parts = Array.from(segmenter.segment(text), (part: any): string => part.segment);
      words = [];
      for (let index = 0; index < parts.length; index++) {
        const part = normalizeDensityWord(parts[index]);
        if (!hasJapaneseScript(part) || !japaneseWord.test(part) || /^[〇一二三四五六七八九十百千万億兆]+$/u.test(part)) continue;
        let lemma: string | null = null;
        let surface = "";
        const options: Array<[string, number]> = [];
        for (let end = index; end < Math.min(index + 6, parts.length); end++) {
          if (!japaneseWord.test(normalizeDensityWord(parts[end]))) break;
          surface += normalizeDensityWord(parts[end]);
          if (surface.length > 24) break;
          options.push([surface, end]);
        }
        for (const [candidate, end] of options.reverse()) {
          lemma = dictionaryForm(candidate);
          if (lemma) { index = end; break; }
        }
        const key = lemma || part;
        words.push({ lemma: key, level: lemma ? dictionary[lemma] : null, count: 1 });
        if (performance.now() > deadline) { await yieldToPage(); deadline = performance.now() + 6; }
      }
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      cache.set(text, words);
    }
    for (const word of words) {
      const previous = totals.get(word.lemma);
      if (previous) previous.count += word.count;
      else totals.set(word.lemma, { ...word });
    }
    if (performance.now() > deadline) { await yieldToPage(); deadline = performance.now() + 6; }
  }
  return [...totals.values()];
}

export function densityKnowledge(cards: Array<{ word: string; interval: number; repetition: number; state?: number }>) {
  const mature = new Set<string>();
  const learning = new Set<string>();
  for (const card of cards) {
    const word = normalizeDensityWord(card.word);
    if (!word) continue;
    const reviewed = card.state === 2 || (card.state == null && card.repetition > 0);
    const target = reviewed && card.interval >= 21 ? mature : learning;
    target.add(word);
    const lemma = dictionaryForm(word);
    if (lemma) target.add(lemma);
  }
  return { mature: [...mature], learning: [...learning].filter(word => !mature.has(word)) };
}
