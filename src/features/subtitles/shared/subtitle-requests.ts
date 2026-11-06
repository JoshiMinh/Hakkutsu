export interface SubtitleRequestOptions { signal?: AbortSignal; priority?: number }

/** Bounded, shared work for playback, transcript rows and background preparation. */
export function createSubtitleRequests<T>(run: (text: string, language: string) => Promise<T>, concurrency = 2) {
  interface Subscriber { resolve: (value: T) => void; reject: (error: unknown) => void; detach: () => void }
  interface Job { key: string; text: string; language: string; priority: number; running: boolean; subscribers: Set<Subscriber> }
  const cache = new Map<string, T>();
  const pending = new Map<string, Job>();
  const queue: Job[] = [];
  let active = 0, scheduled = false;
  const keyFor = (text: string, language: string) => JSON.stringify([text, language]);
  const finish = (job: Job, value?: T, error?: unknown) => {
    pending.delete(job.key);
    for (const subscriber of job.subscribers) {
      subscriber.detach();
      if (error !== undefined) subscriber.reject(error);
      else subscriber.resolve(value!);
    }
    job.subscribers.clear();
  };
  const drain = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      while (active < concurrency && queue.length) {
        let next = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i].priority > queue[next].priority) next = i;
        const [job] = queue.splice(next, 1);
        job.running = true; active++;
        void Promise.resolve().then(() => run(job.text, job.language)).then(value => {
          if (cache.size >= 200) cache.delete(cache.keys().next().value!);
          cache.set(job.key, value); finish(job, value);
        }, error => finish(job, undefined, error)).finally(() => { active--; drain(); });
      }
    });
  };
  const request = (text: string, language: string, options: SubtitleRequestOptions = {}): Promise<T> => {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const key = keyFor(text, language);
    if (cache.has(key)) return Promise.resolve(cache.get(key)!);
    let job = pending.get(key);
    if (!job) {
      if (queue.length >= 64) {
        const index = queue.findIndex(item => item.priority <= (options.priority || 0));
        if (index < 0) return Promise.reject(new Error("Subtitle preparation queue full"));
        finish(queue.splice(index, 1)[0], undefined, new Error("Subtitle preparation superseded"));
      }
      job = { key, text, language, priority: options.priority || 0, running: false, subscribers: new Set() };
      pending.set(key, job); queue.push(job);
    }
    job.priority = Math.max(job.priority, options.priority || 0);
    const current = job;
    const result = new Promise<T>((resolve, reject) => {
      const abort = () => {
        current.subscribers.delete(subscriber); subscriber.detach(); reject(options.signal!.reason);
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
    drain(); return result;
  };
  return { request, peek: (text: string, language: string) => cache.get(keyFor(text, language)) };
}
