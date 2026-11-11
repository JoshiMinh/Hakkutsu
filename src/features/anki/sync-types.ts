import type { JapaneseValues } from "./japanese-schema";

export interface AnkiLink {
  profile: string;
  deckId: number;
  deck: string;
  model: string;
  noteId: number;
  baseline: JapaneseValues;
  localBaseline: JapaneseValues;
  tags: string[];
  verified: boolean;
  missing?: boolean;
  previousLocalProgress?: Record<string, number>;
}

export interface RemoteNote {
  noteId: number;
  modelName: string;
  fields: Record<string, { value: string; order: number }>;
  tags: string[];
  cards: number[];
}

export interface RemoteCard {
  cardId: number;
  note: number;
  deckName: string;
  modelName: string;
  template: string;
  ord: number;
  type: number;
  queue: number;
  due: number;
  interval: number;
  reps: number;
  lapses: number;
  factor: number;
  mod: number;
  odid?: number;
}

export interface CachedAnkiCard extends RemoteCard {
  key: string;
  profile: string;
  localId: string;
  dueNow: boolean;
  refreshedAt: number;
}

export interface MediaRecord { key: string; profile: string; filename: string; data: string; mime: string }
export interface StateRecord { key: string; value: unknown }
export interface AnkiBackup { cards: CachedAnkiCard[]; media: MediaRecord[]; state: StateRecord[] }
export interface ReviewAttempt {
  profile: string;
  cardId: number;
  ease: number;
  startedAt: number;
  previousReviewIds: number[];
  status: "pending" | "confirmed";
}
