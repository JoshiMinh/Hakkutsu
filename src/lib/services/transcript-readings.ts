import type { TokenAnalysis } from "~lib/utils/types";

const cache = new Map<string, TokenAnalysis[]>();
const pending = new Map<string, Promise<TokenAnalysis[]>>();
const queue: Array<() => Promise<void>> = [];
let active = 0;
function drain() {
  while (active < 2 && queue.length) {
    ++active;
    void queue.shift()!().finally(() => { --active; drain(); });
  }
}

/** Only mounted rows request readings. Limit background work and share repeats. */
export function requestTranscriptReadings(text: string, language: string): Promise<TokenAnalysis[]> {
  const key = JSON.stringify([text, language]);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (pending.has(key)) return pending.get(key)!;
  const result = new Promise<TokenAnalysis[]>((resolve, reject) => {
    queue.push(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: "ANALYZE_TEXT", payload: { text, include_definitions: false } });
        const tokens: TokenAnalysis[] = response?.payload?.tokens;
        if (response?.type !== "ANALYZE_RESULT" || !Array.isArray(tokens) ||
          tokens.map((token) => token.surface).join("").replace(/\s/g, "") !== text.replace(/\s/g, "")) throw new Error("Incomplete transcript readings");
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(key, tokens);
        resolve(tokens);
      } catch (error) { reject(error); }
      finally { pending.delete(key); }
    });
  });
  pending.set(key, result);
  drain();
  return result;
}
