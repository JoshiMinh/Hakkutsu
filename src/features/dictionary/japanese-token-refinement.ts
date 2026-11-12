import { deinflectWord, deriveInflectedReading, hasKanji, resolveSurfaceReading } from "~/shared/japanese/japanese";
import type { Token } from "./local-tokenizer";
import type { DictEntry } from "./local-lookup";

// These are candidates, never corrections: an exact dictionary entry must
// confirm the lemma before adjacent segments can become one selectable word.
function lemmaCandidates(surface: string): string[] {
  const forms = [surface, deinflectWord(surface)];
  const endings: Array<[string, string[]]> = [
    ["した", ["す"]], ["った", ["う", "つ", "る"]],
    ["んだ", ["ぬ", "ぶ", "む"]], ["いた", ["く"]], ["いだ", ["ぐ"]],
    ["た", ["る"]], ["して", ["す"]], ["って", ["う", "つ", "る"]],
    ["んで", ["ぬ", "ぶ", "む"]], ["いて", ["く"]], ["いで", ["ぐ"]], ["て", ["る"]],
  ];
  for (const [ending, replacements] of endings) if (surface.endsWith(ending)) {
    for (const replacement of replacements) forms.push(surface.slice(0, -ending.length) + replacement);
  }
  const rows = [
    { suffixes: ["ませんでした", "ません", "ました", "まして", "ます", "ましょう"], kana: "いきぎしちにびみり" },
    { suffixes: ["なかった", "なくて", "なければ", "ない"], kana: "わかがさたなばまら" },
  ];
  for (const { suffixes, kana } of rows) for (const suffix of suffixes) {
    if (!surface.endsWith(suffix)) continue;
    const stem = surface.slice(0, -suffix.length);
    forms.push(stem + "る");
    const column = kana.indexOf(stem.slice(-1));
    if (stem && column >= 0) forms.push(stem.slice(0, -1) + "うくぐすつぬぶむる"[column]);
    if (stem.endsWith("し")) forms.push(stem.slice(0, -1) + "する");
  }
  return [...new Set(forms)];
}

export async function refineJapaneseTokens(tokens: Token[], lookup: (text: string) => Promise<DictEntry[]>, allowKana = false): Promise<Token[]> {
  const cache = new Map<string, Promise<DictEntry[]>>();
  const search = (text: string) => {
    if (!cache.has(text)) {
      if (cache.size >= 128) return Promise.resolve([]);
      cache.set(text, lookup(text).catch(() => []));
    }
    return cache.get(text)!;
  };
  const refined: Token[] = [];
  for (let start = 0; start < tokens.length; start++) {
    let matched = false;
    if (hasKanji(tokens[start].surface_form) || allowKana) {
      let end = start;
      let surface = "";
      while (end < Math.min(tokens.length, start + 6) &&
        /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Unified_Ideograph}\uF900-\uFAFF々ー]+$/u.test(tokens[end].surface_form) &&
        surface.length + tokens[end].surface_form.length <= 24) {
        surface += tokens[end++].surface_form;
      }
      // Longest dictionary-confirmed word wins, without crossing punctuation,
      // numbers, spaces, or line breaks. Unconfirmed source text stays intact.
      for (let stop = end; stop > start && !matched; stop--) {
        surface = tokens.slice(start, stop).map(token => token.surface_form).join("");
        for (const lemma of lemmaCandidates(surface)) {
          const entry = (await search(lemma)).find(entry =>
            entry.kanjiElements.includes(lemma) || entry.readingElements.includes(lemma));
          if (!entry) continue;
          const dictionaryReading = entry.readingElements.find(reading => resolveSurfaceReading(lemma, reading)) || "";
          const reading = resolveSurfaceReading(surface, deriveInflectedReading(surface, lemma, dictionaryReading));
          if (!reading) continue;
          refined.push({ ...tokens[start], surface_form: surface, base_form: lemma,
            reading, dictionary_reading: resolveSurfaceReading(lemma, dictionaryReading) });
          start = stop - 1;
          matched = true;
          break;
        }
      }
    }
    if (!matched) refined.push({ ...tokens[start] });
  }
  return refined;
}
