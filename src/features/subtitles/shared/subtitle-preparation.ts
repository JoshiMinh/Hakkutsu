import type { SubtitleSegment } from "./types";
import type { TokenAnalysis } from "~/features/dictionary/types";
import { cleanSubtitleText } from "./subtitle-parsers";
import { requestTranscriptReadings } from "./transcript-readings";
import { requestSubtitleTranslation } from "./subtitle-translations";
import type { SubtitleRequestOptions } from "./subtitle-requests";

/** Track-owned results survive the small shared request cache, then release with the track. */
export function createSubtitlePreparation(segments: SubtitleSegment[], language: string) {
  const texts = segments.map(cue => cleanSubtitleText(cue.text));
  const readings = new Map<string, TokenAnalysis[]>();
  const translations = new Map<string, string>();
  let anchor = 0, stopped = true, lastTime = 0;
  const getReadings = async (text: string, options: SubtitleRequestOptions = {}) => {
    if (readings.has(text)) return readings.get(text)!;
    const value = await requestTranscriptReadings(text, language, options);
    if (!options.signal?.aborted) readings.set(text, value);
    return value;
  };
  const getTranslation = async (text: string, options: SubtitleRequestOptions = {}) => {
    if (translations.has(text)) return translations.get(text)!;
    const value = await requestSubtitleTranslation(text, language, options);
    if (!options.signal?.aborted) translations.set(text, value);
    return value;
  };
  // One background job per lane leaves request capacity for current playback.
  const lane = (request: (text: string, options: SubtitleRequestOptions) => Promise<unknown>) => {
    const attempted = new Set<string>();
    let cursor = 0, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let enabled = false, generation = 0;
    const choose = () => {
      for (let i = anchor; i < segments.length && segments[i].start <= (segments[anchor]?.start || 0) + 60; i++) {
        if (texts[i] && !attempted.has(texts[i])) return i;
      }
      while (cursor < texts.length && (!texts[cursor] || attempted.has(texts[cursor]))) cursor++;
      return cursor < texts.length ? cursor : -1;
    };
    const pump = () => {
      if (stopped || !enabled || controller) return;
      const index = choose();
      if (index < 0) return;
      const text = texts[index], current = new AbortController(), version = generation;
      controller = current;
      let retry = false;
      void request(text, { signal: current.signal, priority: -1 }).catch(error => {
        retry = error instanceof Error && /queue full|superseded/u.test(error.message);
      }).finally(() => {
        if (version !== generation) return;
        if (!current.signal.aborted && !retry) attempted.add(text);
        controller = undefined;
        // Yield between cues, even when a repeated line is already cached.
        if (!stopped) timer = setTimeout(pump, retry ? 100 : 0);
      }).catch(() => {});
    };
    const interrupt = () => {
      generation++; clearTimeout(timer); controller?.abort(); controller = undefined;
    };
    return {
      start(value: boolean) { enabled = value; interrupt(); pump(); },
      seek() { interrupt(); pump(); },
      stop: interrupt,
    };
  };
  const readingLane = lane(getReadings), translationLane = lane(getTranslation);
  return {
    identity: {},
    getReadings, getTranslation,
    peekReadings: (text: string) => readings.get(text),
    peekTranslation: (text: string) => translations.get(text),
    start(options: { readings: boolean; translations: boolean }) {
      stopped = false; readingLane.start(options.readings); translationLane.start(options.translations);
    },
    setPosition(time: number) {
      const jumpedTime = Math.abs(time - lastTime) > 5;
      lastTime = time;
      let low = 0, high = segments.length;
      while (low < high) { const mid = (low + high) >>> 1; if (segments[mid].start <= time) low = mid + 1; else high = mid; }
      const next = Math.max(0, low - 1);
      if (next === anchor) return;
      const jumped = jumpedTime || Math.abs(next - anchor) > 1;
      anchor = next;
      if (jumped && !stopped) { readingLane.seek(); translationLane.seek(); }
    },
    stop() { stopped = true; readingLane.stop(); translationLane.stop(); },
  };
}
