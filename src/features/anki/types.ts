// Anki Types

/**
 * Anki-related type definitions.
 */

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  options?: {
    allowDuplicate?: boolean;
  };
  tags?: string[];
}

export interface AnkiConnectRequest {
  action: string;
  version: number;
  params?: Record<string, unknown>;
}

export interface AnkiConnectResponse {
  result: unknown;
  error: string | null;
}

export interface AnkiDeck {
  name: string;
}

export interface AnkiModel {
  name: string;
  fields: string[];
}

export interface AnkiExportData {
  word: string;
  reading: string;
  wordFurigana?: string;
  meaning: string;
  vietnameseSound?: string;
  sentence: string;
  sentenceFurigana?: string;
  sentenceReading?: string;
  sentenceMeaning?: string;
  jlptLevel: string;
  pos: string;
  screenshot?: string;
  imageUrl?: string;
  sourceUrl?: string;
  audio?: string;
  sentenceAudio?: string;
}
