import { getSettings } from "~/features/settings/settings-storage";
import type { AnalyzeResponse, TokenAnalysis, DictionaryEntry } from "./types";
import { tokenize } from "./local-tokenizer";
import { searchDictionary, type DictEntry } from "~/features/dictionary/local-lookup";
import { refineJapaneseTokens } from "./japanese-token-refinement";
import { resolveHanViet } from "~/shared/japanese/hanviet-dict";
import {
  containsJapanese, katakanaToHiragana, hasKanji, deriveInflectedReading,
  resolveSurfaceReading, getPeopleCounterReading,
} from "~/shared/japanese/japanese";
import { getCommonWord, lookupWord, type LookupResult } from "~/features/dictionary/dictionary-lookup";
import { googleTranslateService } from "~/features/dictionary/google-translate";
import { predictJlpt } from "~/shared/japanese/jlpt-classifier";

function dictionaryDefinitions(entries: DictEntry[]): DictionaryEntry[] {
  return entries.flatMap(entry => entry.senses.map(sense => ({
    dictionary: "JMdict", glosses: sense.glosses, pos: sense.partOfSpeech || ["Word"], field: null, misc: [],
  })));
}

function providerDefinitions(info: LookupResult | undefined): DictionaryEntry[] {
  return info?.meaning ? [{ dictionary: info.source || "Dict", glosses: [info.meaning], pos: ["Word"], field: null, misc: [] }] : [];
}

export async function fetchDictionaryFallback(text: string, language?: string): Promise<AnalyzeResponse> {
  const targetLanguage = language || (await getSettings()).targetLanguage || "vi";
  const info = await lookupWord(text, targetLanguage);
  const reading = resolveSurfaceReading(text, info.reading);
  return {
    text, sentence_reading: reading || text, token_count: 1, difficulty_score: null, difficulty_label: null,
    tokens: [{
      surface: text, dictionary_form: text, dictionary_reading: reading,
      pos: "Word", pos_detail: [], reading: { hiragana: reading, romaji: "" }, is_japanese: containsJapanese(text),
      jlpt_level: info.jlpt || null, frequency_rank: null,
      vietnamese_sound: targetLanguage === "vi" ? resolveHanViet(text, info.hanviet) : undefined,
      definitions: providerDefinitions(info),
    }],
  };
}

export async function analyzeLocal(text: string, includeDefinitions = true, targetLanguage?: string): Promise<AnalyzeResponse> {
  const language = targetLanguage || (await getSettings()).targetLanguage || "vi";
  const entries = new Map<string, Promise<DictEntry[]>>();
  const lookups = new Map<string, Promise<LookupResult>>();
  const search = (word: string): Promise<DictEntry[]> => {
    if (!entries.has(word)) entries.set(word, searchDictionary(word).then(found => {
      if (found.length) return found;
      const common = getCommonWord(word);
      return common?.reading ? [{ id: `bundled:${word}`, kanjiElements: [word], readingElements: [common.reading],
        senses: [{ glosses: [common.meaning], partOfSpeech: ["Word"] }], jlpt: common.jlpt }] : [];
    }));
    return entries.get(word)!;
  };
  const lookup = (word: string) => {
    if (!lookups.has(word)) lookups.set(word, lookupWord(word, language));
    return lookups.get(word)!;
  };

  // Keep source whitespace intact; dictionary refinement never crosses it.
  const cleanText = text.trim();
  const wholeEntries = containsJapanese(cleanText) && (includeDefinitions || hasKanji(cleanText)) &&
    text === cleanText && cleanText.length <= 16 && !/[\s、。！？!?…]/u.test(cleanText)
    ? await search(cleanText) : [];
  const wholeEntry = wholeEntries.find(entry => entry.kanjiElements.includes(cleanText) || entry.readingElements.includes(cleanText));
  const rawTokens = wholeEntry
    ? [{ surface_form: text, base_form: text, pos: "Word", reading: undefined, dictionary_reading: undefined }]
    : await tokenize(text);
  const tokens = await refineJapaneseTokens(rawTokens, search);

  const analyses = await Promise.all(tokens.map(async (token): Promise<TokenAnalysis> => {
    const surface = token.surface_form;
    const japanese = containsJapanese(surface);
    const result: TokenAnalysis = {
      surface, dictionary_form: surface, pos: token.pos, pos_detail: [], reading: { hiragana: "", romaji: "" },
      is_japanese: japanese, jlpt_level: null, frequency_rank: null, definitions: [],
    };
    if (!japanese) return result;

    const lemma = token.base_form || surface;
    const matches = includeDefinitions || hasKanji(surface) ? await search(lemma) : [];
    const exactEntries = matches.filter(entry => entry.kanjiElements.includes(lemma) || entry.readingElements.includes(lemma));
    const entry = exactEntries[0];
    const dictionaryForm = hasKanji(lemma) ? lemma : entry?.kanjiElements[0] || lemma;
    let dictionaryReading = resolveSurfaceReading(lemma, token.dictionary_reading);
    for (const candidate of entry?.readingElements || []) {
      if (dictionaryReading) break;
      dictionaryReading = resolveSurfaceReading(lemma, candidate);
    }
    let reading = getPeopleCounterReading(surface) || resolveSurfaceReading(surface, token.reading) ||
      resolveSurfaceReading(surface, deriveInflectedReading(surface, lemma, dictionaryReading));
    let info: LookupResult | undefined;
    let definitions = includeDefinitions ? dictionaryDefinitions(exactEntries) : [];

    // Automatic subtitle readings use installed/bundled dictionaries only.
    // Definitions may use online dictionaries, without invoking phrase/LLM analysis.
    if (includeDefinitions) {
      info = getCommonWord(lemma, language);
      if (!info && (language !== "en" || definitions.length === 0)) {
        try { info = await lookup(lemma); } catch { /* Retain local readings and definitions. */ }
      }
      if (!dictionaryReading) dictionaryReading = resolveSurfaceReading(lemma, info?.reading);
      if (!reading) reading = resolveSurfaceReading(surface, deriveInflectedReading(surface, lemma, dictionaryReading));
      const translated = providerDefinitions(info);
      if (translated.length) definitions = translated;
      else if (language !== "en" && definitions.length) {
        definitions = await Promise.all(definitions.map(async definition => {
          try {
            const glosses = await Promise.all(definition.glosses.map(gloss => googleTranslateService.translate(gloss, language, "en")));
            return { ...definition, glosses: glosses.map((gloss, index) => gloss || definition.glosses[index]) };
          } catch { return definition; }
        }));
      }
    }

    if (!reading && !hasKanji(surface)) reading = katakanaToHiragana(surface.normalize("NFKC"));
    return {
      ...result, dictionary_form: dictionaryForm, dictionary_reading: dictionaryReading || undefined,
      reading: { hiragana: reading, romaji: "" }, definitions,
      jlpt_level: entry?.jlpt || info?.jlpt || predictJlpt(dictionaryForm),
      vietnamese_sound: language === "vi" ? resolveHanViet(dictionaryForm, info?.hanviet, surface) : undefined,
    };
  }));
  return {
    text, sentence_reading: analyses.map(token => token.reading.hiragana || token.surface).join(""),
    tokens: analyses, token_count: analyses.length, difficulty_score: null, difficulty_label: null,
  };
}
