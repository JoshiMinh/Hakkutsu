import type { TokenAnalysis } from "~/features/dictionary/types";

interface Subscriber {
  resolve: (tokens: TokenAnalysis[]) => void;
  reject: (error: unknown) => void;
  detach: () => void;
}
interface ReadingJob {
  key: string;
  text: string;
  priority: number;
  running: boolean;
  subscribers: Set<Subscriber>;
}
const cache = new Map<string, TokenAnalysis[]>();
const pending = new Map<string, ReadingJob>();
const queue: ReadingJob[] = [];
let active = 0, scheduled = false;

function finish(job: ReadingJob, tokens?: TokenAnalysis[], error?: unknown) {
  pending.delete(job.key);
  for (const subscriber of job.subscribers) {
    subscriber.detach();
    if (tokens) subscriber.resolve(tokens);
    else subscriber.reject(error);
  }
  job.subscribers.clear();
}

async function run(job: ReadingJob) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "ANALYZE_TEXT", payload: { text: job.text, include_definitions: false } });
    const tokens: TokenAnalysis[] = response?.payload?.tokens;
    if (response?.type !== "ANALYZE_RESULT" || !Array.isArray(tokens) || tokens.some(token => typeof token?.surface !== "string") ||
      tokens.map(token => token.surface).join("").replace(/\s/g, "") !== job.text.replace(/\s/g, "")) throw new Error("Incomplete subtitle readings");
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(job.key, tokens);
    finish(job, tokens);
  } catch (error) { finish(job, undefined, error); }
  finally { active--; scheduleDrain(); }
}

function scheduleDrain() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    while (active < 2 && queue.length) {
      // Current playback gets the next free slot ahead of transcript rows.
      let next = 0;
      for (let index = 1; index < queue.length; index++) if (queue[index].priority > queue[next].priority) next = index;
      const [job] = queue.splice(next, 1);
      job.running = true; active++;
      void run(job);
    }
  });
}

/** Shared by the overlay and mounted transcript rows; abandoned queued rows drop. */
export function requestTranscriptReadings(text: string, language: string, options: { signal?: AbortSignal; priority?: number } = {}): Promise<TokenAnalysis[]> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  const key = JSON.stringify([text, language]);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  let job = pending.get(key);
  if (!job) {
    if (queue.length >= 64) {
      const index = queue.findIndex(item => item.priority <= (options.priority || 0));
      if (index < 0) return Promise.reject(new Error("Subtitle reading queue full"));
      finish(queue.splice(index, 1)[0], undefined, new Error("Subtitle reading superseded"));
    }
    job = { key, text, priority: options.priority || 0, running: false, subscribers: new Set() };
    pending.set(key, job); queue.push(job);
  }
  job.priority = Math.max(job.priority, options.priority || 0);
  const current = job;
  const result = new Promise<TokenAnalysis[]>((resolve, reject) => {
    const abort = () => {
      current.subscribers.delete(subscriber);
      subscriber.detach(); reject(options.signal!.reason);
      if (!current.running && current.subscribers.size === 0) {
        const index = queue.indexOf(current);
        if (index >= 0) queue.splice(index, 1);
        pending.delete(key);
      }
    };
    const subscriber: Subscriber = { resolve, reject, detach: () => options.signal?.removeEventListener("abort", abort) };
    current.subscribers.add(subscriber);
    options.signal?.addEventListener("abort", abort, { once: true });
  });
  scheduleDrain();
  return result;
}
