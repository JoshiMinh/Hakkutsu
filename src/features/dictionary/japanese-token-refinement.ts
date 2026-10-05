import { deinflectWord, deriveInflectedReading } from "~/shared/japanese/japanese";
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
  return [...new Set(forms)];
}

export async function refineJapaneseTokens(tokens: Token[], lookup: (text: string) => Promise<DictEntry[]>): Promise<Token[]> {
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
    if (/[\u3400-\u9fff]/u.test(tokens[start].surface_form)) {
      let end = start;
      let surface = "";
      while (end < Math.min(tokens.length, start + 6) &&
        /^[\u3040-\u30ff\u3400-\u9fffー]+$/u.test(tokens[end].surface_form) &&
        surface.length + tokens[end].surface_form.length <= 24) {
        surface += tokens[end++].surface_form;
      }
      // Longest dictionary-confirmed word wins, without crossing punctuation,
      // numbers, spaces, or line breaks. Unconfirmed source text stays intact.
      for (let stop = end; stop > start + 1 && !matched; stop--) {
        surface = tokens.slice(start, stop).map(token => token.surface_form).join("");
        for (const lemma of lemmaCandidates(surface)) {
          const entry = (await search(lemma)).find(entry =>
            entry.kanjiElements.includes(lemma) || entry.readingElements.includes(lemma));
          if (!entry) continue;
          refined.push({ ...tokens[start], surface_form: surface, base_form: lemma,
            reading: deriveInflectedReading(surface, lemma, entry.readingElements[0] || ""),
            dictionary_reading: entry.readingElements[0] || "" });
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
