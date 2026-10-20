import { analyzeLocal } from "~/features/dictionary/background-analysis";
import { getSettings } from "~/features/settings/settings-storage";
import type { AnalyzeResponse } from "~/features/dictionary/types";

const cache = new Map<string, AnalyzeResponse>();
const pending = new Map<string, Promise<AnalyzeResponse>>();

/** Background-owned deduplication also works across the video and sidebar pages. */
export async function analyzeSubtitleReadings(text: string): Promise<AnalyzeResponse> {
  const { targetLanguage } = await getSettings();
  const key = JSON.stringify([targetLanguage || "vi", text]);
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;
  const request = analyzeLocal(text, false).then(result => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
