import { deinflectWord, deriveInflectedReading, distributeFurigana, hasKanji } from "~/shared/japanese/japanese";
import { refineJapaneseTokens } from "~/features/dictionary/japanese-token-refinement";
import type { Token } from "~/features/dictionary/local-tokenizer";
import type { DictEntry } from "~/features/dictionary/local-lookup";
import { predictJlpt } from "~/shared/japanese/jlpt-classifier";

export interface FuriganaWord {
  text: string;
  reading?: string;
  jlpt?: string | null;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new (Intl as any).Segmenter("ja", { granularity: "word" }) : null;

/** Local readings only. Never invoke translation/LLMs for automatic page annotation. */
export async function resolveFuriganaTexts(
  texts: string[], lookup: (text: string) => Promise<DictEntry[]>,
): Promise<FuriganaWord[][]> {
  // Cache promises (including misses) across all paragraphs in this request.
  const cache = new Map<string, Promise<DictEntry[]>>();
  const search = (text: string) => {
    let pending = cache.get(text);
    if (!pending) {
      pending = lookup(text);
      if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
      cache.set(text, pending);
    }
    return pending;
  };
  const results: FuriganaWord[][] = [];
  for (const text of texts) {
    const parts: string[] = segmenter
      ? Array.from(segmenter.segment(text), (part: any) => part.segment)
      : text.split(/([\s\u3000、。！？!?…]+)/u).filter(Boolean);
    const tokens: Token[] = parts.map(surface => ({ surface_form: surface, base_form: surface, pos: "Word" }));
    const refined = await refineJapaneseTokens(tokens, search);
    const words: FuriganaWord[] = [];
    for (const token of refined) {
      const surface = token.surface_form;
      if (!hasKanji(surface)) { words.push({ text: surface }); continue; }
      let reading = token.reading;
      let level: string | null = null;
      if (reading) {
        const entry = (await search(token.base_form)).find(entry => entry.kanjiElements.includes(token.base_form));
        level = entry?.jlpt || null;
      }
      if (!reading) {
        for (const lemma of new Set([surface, deinflectWord(surface)])) {
          const entry = (await search(lemma)).find(entry => entry.kanjiElements.includes(lemma));
          if (!entry) continue;
          reading = deriveInflectedReading(surface, lemma, entry.readingElements[0] || "");
          level = entry.jlpt || null;
          break;
        }
      }
      // Alignment must preserve every original character before we accept a reading.
      const aligned = distributeFurigana(surface, reading);
      if (!aligned.some(part => part.ruby) || aligned.map(part => part.text).join("") !== surface) reading = undefined;
      words.push({ text: surface, reading, jlpt: level || predictJlpt(token.base_form) });
    }
    results.push(words);
  }
  return results;
}
