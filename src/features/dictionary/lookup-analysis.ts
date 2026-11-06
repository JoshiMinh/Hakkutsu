import type { AnalyzeResponse, TokenAnalysis } from "./types";
import { resolveSurfaceReading } from "~/shared/japanese/japanese";
import { resolveHanViet } from "~/shared/japanese/hanviet-dict";

/** Share repeat hover requests without persisting any lookup text. */
const cache = new Map<string, any>();
const pending = new Map<string, Promise<any>>();
const MAX_ENTRIES = 100;

export function requestLookupAnalysis(type: string, text: string, includeDefinitions: boolean, language: string, source?: "ocr"): Promise<any> {
  const key = JSON.stringify([type, text.trim(), includeDefinitions, language, source]);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = chrome.runtime.sendMessage({ type, payload: { text, include_definitions: includeDefinitions,
    ...(type !== "ANALYZE_PHRASE" && includeDefinitions && !source ? { analysis_mode: "dictionary" } : {}),
    ...(source ? { source } : {}) } })
    .then((response) => {
      if (["ANALYZE_RESULT", "ANALYZE_PHRASE_RESULT"].includes(response?.type) && response.payload?.text?.trim() === text.trim()) {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, response);
      }
      return response;
    }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** Preserve the clicked token's sentence reading without changing cached results. */
export function applyLookupContext<T extends AnalyzeResponse>(response: T, context?: TokenAnalysis): T {
  if (!context || typeof context.surface !== "string" || context.surface !== response.text.trim()) return response;
  const reading = resolveSurfaceReading(context.surface, context.reading?.hiragana);
  if (!reading) return response;
  const form = typeof context.dictionary_form === "string" ? context.dictionary_form : context.surface;
  const dictionaryReading = resolveSurfaceReading(form, context.dictionary_reading || (form === context.surface ? reading : ""));
  // An inflected surface reading must never become the lemma's pronunciation.
  if (form !== context.surface && !dictionaryReading) return response;
  const match = response.tokens.findIndex(token => token.surface === context.surface);
  if (match < 0) return response;
  const tokens = response.tokens.map((token, index) => index === match ? {
    ...token, dictionary_form: form, dictionary_reading: dictionaryReading,
    reading: { hiragana: reading, romaji: "" },
    vietnamese_sound: resolveHanViet(form, context.vietnamese_sound, context.surface),
  } : token);
  return { ...response, tokens, sentence_reading: tokens.map(token => token.reading.hiragana || token.surface).join("") };
}
