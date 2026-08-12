/**
 * Extension-specific type definitions.
 */

export type ExtensionView = "translate" | "srs" | "anki";

export interface ExtensionSettings {
  backendUrl: string;
  llmProvider: "openai" | "deepseek" | "none";
  llmApiKey: string;
  ankiEnabled: boolean;
  ankiDeck: string;
  ankiModel: string;
  autoDetect: boolean;
  showFurigana: boolean;
  theme: "dark" | "light" | "auto";
  fontSize: "small" | "medium" | "large";
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendUrl: "http://127.0.0.1:8000",
  llmProvider: "none",
  llmApiKey: "",
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
  | "ANALYZE_JAVI"
  | "ANALYZE_PHRASE"
  | "ANALYZE_PHRASE_RESULT"
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
  | "CAPTURE_SCREENSHOT"
  | "SCREENSHOT_RESULT"
  | "FETCH_IMAGE"
  | "FETCH_IMAGE_RESULT"
  | "OPEN_APP"
  | "OPEN_APP_RESULT"
  | "TRANSLATE_TEXT"
  | "TRANSLATE_RESULT"
  | "OCR_IMAGE"
  | "OCR_RESULT"
  | "INPAINT_IMAGE"
  | "INPAINT_RESULT"
  | "IGNORED"
  | "ERROR";

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}
