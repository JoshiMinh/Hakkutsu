/** Share repeat hover requests without persisting any lookup text. */
const cache = new Map<string, any>();
const pending = new Map<string, Promise<any>>();
const MAX_ENTRIES = 100;

export function requestLookupAnalysis(type: string, text: string, includeDefinitions: boolean, language: string, source?: "ocr"): Promise<any> {
  const key = JSON.stringify([type, text.trim(), includeDefinitions, language, source]);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = chrome.runtime.sendMessage({ type, payload: { text, include_definitions: includeDefinitions, ...(source ? { source } : {}) } })
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
