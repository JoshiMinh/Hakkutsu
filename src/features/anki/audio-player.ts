import { ankiClient } from "./anki-connect";
import { loadMedia } from "./media";

export function soundNames(field: string): string[] {
  return [...field.matchAll(/\[sound:([^\]\r\n]+)\]/g)].map(match => match[1]);
}
export interface AudioState { key: string; status: "idle" | "loading" | "playing" | "error"; error?: unknown }

/** One player for all vocabulary recordings. A new request invalidates every older response. */
export class VocabularyAudioPlayer {
  private state: AudioState = { key: "", status: "idle" };
  private listeners = new Set<() => void>();
  private audio?: HTMLAudioElement;
  private finish?: () => void;
  private request = 0;
  constructor(private load = loadMedia, private activeProfile = () => ankiClient.getProfile(), private createAudio = (source: string) => new Audio(source)) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(state: AudioState) { this.state = state; for (const listener of this.listeners) listener(); }
  stop = () => {
    this.request++;
    this.finish?.(); this.finish = undefined;
    this.audio?.pause(); this.audio = undefined;
    this.publish({ key: "", status: "idle" });
  };
  async play(key: string, field: string, expectedProfile?: string): Promise<void> {
    this.stop();
    const request = this.request;
    const filenames = soundNames(field);
    if (!filenames.length) return;
    this.publish({ key, status: "loading" });
    try {
      const profile = expectedProfile || await this.activeProfile();
      for (const filename of filenames) {
        if (request !== this.request) return;
        this.publish({ key, status: "loading" });
        const source = await this.load(profile, filename);
        if (request !== this.request) return;
        const audio = this.createAudio(source); this.audio = audio;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => { settled = true; audio.removeEventListener("ended", ended); audio.removeEventListener("error", failed); if (this.finish === ended) this.finish = undefined; };
          const ended = () => { if (settled) return; cleanup(); resolve(); };
          const failed = () => { if (settled) return; cleanup(); reject(new Error("Missing or unsupported audio recording")); };
          this.finish = ended;
          audio.addEventListener("ended", ended, { once: true }); audio.addEventListener("error", failed, { once: true });
          void audio.play().then(() => { if (!settled && request === this.request) this.publish({ key, status: "playing" }); }, failed);
        });
      }
      if (request === this.request) { this.audio = undefined; this.publish({ key: "", status: "idle" }); }
    } catch (error) { if (request === this.request) { this.audio?.pause(); this.audio = undefined; this.publish({ key, status: "error", error }); } }
  }
}
export const vocabularyAudio = new VocabularyAudioPlayer();
