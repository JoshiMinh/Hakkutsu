import { openDB, type DBSchema } from "idb";
import type { AnkiBackup, CachedAnkiCard, MediaRecord, StateRecord } from "./sync-types";

interface AnkiDB extends DBSchema {
  cards: { key: string; value: CachedAnkiCard };
  media: { key: string; value: MediaRecord };
  state: { key: string; value: StateRecord };
}

let connection: ReturnType<typeof openDB<AnkiDB>> | undefined;
function db() {
  return connection ??= openDB<AnkiDB>("hakkutsu-anki", 1, {
    upgrade(database) { database.createObjectStore("cards"); database.createObjectStore("media"); database.createObjectStore("state"); },
  }).catch(error => { connection = undefined; throw error; });
}

export const ankiStorage = {
  async cards() { return (await db()).getAll("cards"); },
  async putCards(cards: CachedAnkiCard[]) {
    const tx = (await db()).transaction("cards", "readwrite");
    for (const card of cards) await tx.store.put(card, card.key);
    await tx.done;
  },
  async state<T>(key: string): Promise<T | undefined> { return (await (await db()).get("state", key))?.value as T | undefined; },
  async states() { return (await db()).getAll("state"); },
  async setState(key: string, value: unknown) { await (await db()).put("state", { key, value }, key); },
  async media(key: string) { return (await db()).get("media", key); },
  async putMedia(value: MediaRecord) { await (await db()).put("media", value, value.key); },
  async hide(profile: string, noteId: number) { await this.setState(`hidden:${profile}:${noteId}`, true); },
  async backup(): Promise<AnkiBackup> {
    const database = await db();
    const [cards, media, state] = await Promise.all([database.getAll("cards"), database.getAll("media"), database.getAll("state")]);
    return { cards, media, state: state.filter(item => !item.key.startsWith("recovery:")) };
  },
  async restore(value: AnkiBackup) {
    const tx = (await db()).transaction(["cards", "media", "state"], "readwrite");
    for (const card of value.cards) await tx.objectStore("cards").put(card, card.key);
    for (const media of value.media) await tx.objectStore("media").put(media, media.key);
    // Recovery snapshots contain an entire backup: don't recursively embed them in future exports.
    for (const state of value.state) if (!state.key.startsWith("recovery:")) await tx.objectStore("state").put(state, state.key);
    await tx.done;
  },
};

export function validateAnkiBackup(value: unknown): asserts value is AnkiBackup {
  if (!value || typeof value !== "object") throw new Error("Invalid Anki backup.");
  const backup = value as AnkiBackup;
  if (!Array.isArray(backup.cards) || !Array.isArray(backup.media) || !Array.isArray(backup.state)) throw new Error("Invalid Anki backup stores.");
  for (const card of backup.cards) {
    if (!card || typeof card.key !== "string" || typeof card.profile !== "string" || typeof card.localId !== "string" ||
      !Number.isSafeInteger(card.cardId) || card.cardId <= 0 || !Number.isSafeInteger(card.note) ||
      !Number.isInteger(card.queue) || !Number.isInteger(card.type)) throw new Error("Invalid backed-up Anki card.");
  }
  for (const media of backup.media) {
    if (!media || typeof media.key !== "string" || typeof media.profile !== "string" || typeof media.filename !== "string" ||
      typeof media.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(media.data) ||
      !/^(?:audio\/(?:mpeg|ogg|wav|mp4|webm)|image\/(?:png|jpeg|gif|webp|avif))$/.test(media.mime)) throw new Error("Invalid backed-up media.");
  }
  for (const state of backup.state) if (!state || typeof state.key !== "string") throw new Error("Invalid backed-up sync state.");
}

/** Cross-tab lock; failure to acquire never silently falls back to concurrent writes. */
export async function withAnkiLock<T>(work: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) throw new Error("This browser cannot safely coordinate Anki writes.");
  return navigator.locks.request("hakkutsu-anki-write", { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Anki is busy in another Hakkutsu tab. Retry after it finishes.");
    return work();
  });
}
