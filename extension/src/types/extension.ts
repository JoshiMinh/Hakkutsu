/**
 * Extension-specific type definitions.
 */

export type ExtensionView = "analysis" | "subtitles" | "srs" | "settings" | "history";

export interface ExtensionSettings {
  backendUrl: string;
  ankiEnabled: boolean;
  ankiDeck: string;
  ankiModel: string;
  autoDetect: boolean;
  showFurigana: boolean;
  theme: "dark" | "light" | "auto";
  fontSize: "small" | "medium" | "large";
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendUrl: "http://localhost:8000",
  ankiEnabled: true,
  ankiDeck: "Hakkutsu",
  ankiModel: "Hakkutsu Japanese",
  autoDetect: true,
  showFurigana: true,
  theme: "dark",
  fontSize: "medium",
};

export interface VocabularyEntry {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  jlptLevel: string | null;
  context: string;
  sourceUrl: string;
  addedAt: number;
  exported: boolean;
}

export interface SelectionEvent {
  text: string;
  context: string;
  x: number;
  y: number;
  sourceUrl: string;
}

/** Message types for communication between content scripts and background */
export type MessageType =
  | "ANALYZE_TEXT"
  | "ANALYZE_RESULT"
  | "GET_SUBTITLES"
  | "SUBTITLES_RESULT"
  | "GET_CAPTION_TRACKS"
  | "CAPTION_TRACKS_RESULT"
  | "EXPORT_ANKI"
  | "ANKI_RESULT"
  | "CHECK_ANKI"
  | "ANKI_STATUS"
  | "GET_SETTINGS"
  | "UPDATE_SETTINGS"
  | "TEXT_SELECTED"
  | "ADD_SRS_CARD"
  | "SRS_RESULT"
  | "MINE_SENTENCE"
  | "CAPTURE_SCREENSHOT"
  | "SCREENSHOT_RESULT"
  | "IGNORED"
  | "ERROR";

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}
