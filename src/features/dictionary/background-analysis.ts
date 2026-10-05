import { getSettings } from "~/features/settings/settings-storage";
import type {
  AnalyzeResponse,
  TokenAnalysis,
  DictionaryEntry,
} from "~/features/dictionary/types";
import { tokenize } from "~/features/dictionary/local-tokenizer";
import { searchDictionary } from "~/features/dictionary/local-lookup";
import { getHanViet } from "~/shared/japanese/hanviet-dict";
import {
  containsJapanese,
  katakanaToHiragana,
  hasKanji,
  sanitizeReading,
  deriveInflectedReading,
  deinflectWord,
  getPeopleCounterReading,
} from "~/shared/japanese/japanese";
import {
  lookupWord,
  type LookupResult,
} from "~/features/dictionary/dictionary-lookup";
import { googleTranslateService } from "~/features/dictionary/google-translate";
import { predictJlpt } from "~/shared/japanese/jlpt-classifier";

export async function fetchDictionaryFallback(
  text: string,
): Promise<AnalyzeResponse> {
  const settings = await getSettings();
  const targetLang = settings.targetLanguage || "vi";
  const info = await lookupWord(text, targetLang);
  const isVietnamese = targetLang === "vi";
  const cleanReading = sanitizeReading(info.reading || "", text);

  return {
    text,
    sentence_reading: cleanReading || text,
    token_count: 1,
    difficulty_score: null,
    difficulty_label: null,
    tokens: [
      {
        surface: text,
        dictionary_form: text,
        pos: "Word",
        pos_detail: [],
        reading: { hiragana: cleanReading, romaji: "" },
        is_japanese: true,
        jlpt_level: info.jlpt || null,
        frequency_rank: null,
        vietnamese_sound: isVietnamese
          ? info.hanviet || getHanViet(text)
          : undefined,
        definitions: info.meaning
          ? [
              {
                dictionary: info.source || "Dict",
                glosses: [info.meaning],
                pos: ["Word"],
                field: null,
                misc: [],
              },
            ]
          : [],
      },
    ],
  };
}

export async function analyzeLocal(
  text: string,
  includeDefinitions = true,
): Promise<AnalyzeResponse> {
  const cleanText = text.trim();
  const settings = await getSettings();
  const targetLang = settings.targetLanguage || "vi";
  const isVietnamese = targetLang === "vi";

  // 1. Direct whole-word dictionary match check (e.g. "お知らせ", "お弁当", "お土産")
  if (
    containsJapanese(cleanText) &&
    cleanText.length <= 16 &&
    !/[\s\u3000、。！？!?…]/u.test(cleanText)
  ) {
    const fullTextDictEntries = await searchDictionary(cleanText);
    let fullTextDictInfo: LookupResult | null = null;
    try {
      if (
        includeDefinitions ||
        !fullTextDictEntries[0]?.readingElements?.length
      )
        fullTextDictInfo = await lookupWord(cleanText, targetLang);
    } catch {}

    const hasExactHeadword = Boolean(
      fullTextDictEntries &&
        fullTextDictEntries.some(
          (e) =>
            e.kanjiElements?.includes(cleanText) ||
            e.readingElements?.includes(cleanText),
        ),
    );

    if (hasExactHeadword) {
      const firstEntry = fullTextDictEntries.find(
        (e) =>
          e.kanjiElements?.includes(cleanText) ||
          e.readingElements?.includes(cleanText),
      )!;
      const kanjiForm = firstEntry?.kanjiElements?.[0] || cleanText;
      const rawReading =
        getPeopleCounterReading(cleanText) ||
        firstEntry?.readingElements?.[0] ||
        fullTextDictInfo?.reading ||
        "";
      const reading = sanitizeReading(rawReading, cleanText);
      const jlptLevel =
        firstEntry?.jlpt || fullTextDictInfo?.jlpt || predictJlpt(cleanText);

      let definitions: DictionaryEntry[] = [];
      if (includeDefinitions && fullTextDictInfo?.meaning) {
        definitions.push({
          dictionary: fullTextDictInfo.source || "Dict",
          glosses: [fullTextDictInfo.meaning],
          pos: ["Word"],
          field: null,
          misc: [],
        });
      }

      if (
        includeDefinitions &&
        definitions.length === 0 &&
        fullTextDictEntries.length > 0
      ) {
        definitions = fullTextDictEntries.flatMap((d) =>
          d.senses.map((s) => ({
            dictionary: "JMdict",
            glosses: s.glosses,
            pos: s.partOfSpeech || ["Word"],
            field: null,
            misc: [],
          })),
        );
      }

      const singleToken: TokenAnalysis = {
        surface: cleanText,
        dictionary_form: kanjiForm,
        pos: "Word",
        pos_detail: [],
        reading: { hiragana: reading, romaji: "" },
        is_japanese: true,
        jlpt_level: jlptLevel,
        frequency_rank: null,
        vietnamese_sound: isVietnamese
          ? fullTextDictInfo?.hanviet || getHanViet(cleanText)
          : undefined,
        definitions,
      };

      return {
        text: cleanText,
        sentence_reading: reading || cleanText,
        tokens: [singleToken],
        token_count: 1,
        difficulty_score: null,
        difficulty_label: null,
      };
    }
  }

  // 2. Tokenize text using local tokenizer
  const rawTokens = await tokenize(cleanText);

  // Combine honorific prefixes (お, ご) or compound tokens if combined form exists in dictionary
  const tokens: typeof rawTokens = [];
  let idx = 0;
  while (idx < rawTokens.length) {
    const current = rawTokens[idx];
    const next = rawTokens[idx + 1];

    if (
      next &&
      (current.surface_form === "お" || current.surface_form === "ご") &&
      containsJapanese(next.surface_form)
    ) {
      const combinedSurface = current.surface_form + next.surface_form;
      const combinedEntries = await searchDictionary(combinedSurface);
      let combinedLookup: LookupResult | null = null;
      try {
        if (includeDefinitions || combinedEntries.length === 0)
          combinedLookup = await lookupWord(combinedSurface, targetLang);
      } catch {}

      if (
        (combinedEntries && combinedEntries.length > 0) ||
        (combinedLookup &&
          combinedLookup.meaning &&
          combinedLookup.meaning.trim())
      ) {
        tokens.push({
          surface_form: combinedSurface,
          pos: "Word",
          reading: combinedLookup?.reading,
          base_form: combinedSurface,
        });
        idx += 2;
        continue;
      }
    }

    tokens.push(current);
    idx++;
  }

  const tokenAnalyses: TokenAnalysis[] = await Promise.all(
    tokens.map(async (t) => {
      const surface = t.surface_form;
      const is_jp = containsJapanese(surface);
      if (!is_jp) {
        return {
          surface,
          dictionary_form: surface,
          pos: t.pos,
          pos_detail: [],
          reading: { hiragana: "", romaji: "" },
          is_japanese: false,
          jlpt_level: null,
          frequency_rank: null,
          definitions: [],
        };
      }

      const dictEntries = await searchDictionary(surface);
      const firstEntry = dictEntries[0];
      const kanjiForm =
        t.base_form || firstEntry?.kanjiElements?.[0] || surface;
      const kuromojiReading = (t as any).reading
        ? katakanaToHiragana((t as any).reading)
        : "";
      const rawReading =
        kuromojiReading || firstEntry?.readingElements?.[0] || "";
      let reading = sanitizeReading(rawReading, surface);
      let jlptLevel = firstEntry?.jlpt || predictJlpt(surface);

      // If no reading found on surface and base_form differs (e.g. inflected verb/adj):
      if (!reading && t.base_form && t.base_form !== surface) {
        const baseEntries = await searchDictionary(t.base_form);
        const baseFirst = baseEntries[0];
        if (baseFirst?.readingElements?.[0]) {
          const derived = deriveInflectedReading(
            surface,
            t.base_form,
            baseFirst.readingElements[0],
          );
          reading = sanitizeReading(derived, surface);
          if (!jlptLevel && baseFirst.jlpt) jlptLevel = baseFirst.jlpt;
        }
      }

      let definitions: DictionaryEntry[] = [];

      // Query target-language dictionary lookup
      try {
        const queryWord =
          !reading && t.base_form && t.base_form !== surface
            ? t.base_form
            : surface;
        const dictInfo =
          includeDefinitions || !reading
            ? await lookupWord(queryWord, targetLang)
            : null;
        if (dictInfo) {
          if (dictInfo.reading && !reading) {
            const raw =
              queryWord !== surface
                ? deriveInflectedReading(surface, queryWord, dictInfo.reading)
                : dictInfo.reading;
            reading = sanitizeReading(raw, surface);
          }
          if (dictInfo.jlpt && !jlptLevel) {
            jlptLevel = dictInfo.jlpt;
          }
          if (includeDefinitions && dictInfo.meaning) {
            definitions = [
              {
                dictionary: dictInfo.source || "Dict",
                glosses: [dictInfo.meaning],
                pos: [t.pos || "Word"],
                field: null,
                misc: [],
              },
            ];
          }
        }
      } catch (e) {
        console.warn(
          "[Hakkutsu] Token target dictionary lookup error:",
          surface,
          e,
        );
      }

      // If still no reading and has kanji, try deinflecting:
      if (!reading && hasKanji(surface)) {
        const deinflected = deinflectWord(surface);
        if (deinflected !== surface) {
          try {
            const deinflectedInfo = await lookupWord(deinflected, targetLang);
            if (deinflectedInfo?.reading) {
              const derived = deriveInflectedReading(
                surface,
                deinflected,
                deinflectedInfo.reading,
              );
              reading = sanitizeReading(derived, surface);
              if (!jlptLevel && deinflectedInfo.jlpt)
                jlptLevel = deinflectedInfo.jlpt;
            }
          } catch {}
        }
      }

      // Pure kana fallback:
      if (!reading && !hasKanji(surface)) {
        reading = katakanaToHiragana(surface);
      }

      // If no target language definition was found from adapter, use IndexedDB JMdict entries
      if (
        includeDefinitions &&
        definitions.length === 0 &&
        dictEntries.length > 0
      ) {
        definitions = dictEntries.flatMap((d) =>
          d.senses.map((s) => ({
            dictionary: "JMdict",
            glosses: s.glosses,
            pos: s.partOfSpeech || ["Word"],
            field: null,
            misc: [],
          })),
        );

        // If target language is not English, translate local JMdict glosses to target language
        if (targetLang !== "en") {
          definitions = await Promise.all(
            definitions.map(async (def) => {
              try {
                const translatedGlosses = await Promise.all(
                  def.glosses.map((g) =>
                    googleTranslateService.translate(g, targetLang, "en"),
                  ),
                );
                return {
                  ...def,
                  dictionary: `JMdict (${targetLang.toUpperCase()})`,
                  glosses: translatedGlosses.map(
                    (tg, idx) => tg || def.glosses[idx],
                  ),
                };
              } catch {
                return def;
              }
            }),
          );
        }
      }

      return {
        surface,
        dictionary_form: kanjiForm,
        pos: t.pos,
        pos_detail: [],
        reading: { hiragana: reading, romaji: "" },
        is_japanese: true,
        jlpt_level: jlptLevel,
        frequency_rank: null,
        vietnamese_sound: isVietnamese ? getHanViet(surface) : undefined,
        definitions,
      };
    }),
  );

  return {
    text,
    sentence_reading: text,
    tokens: tokenAnalyses,
    token_count: tokens.length,
    difficulty_score: null,
    difficulty_label: null,
  };
}
