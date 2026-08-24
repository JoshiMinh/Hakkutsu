/**
 * Extension-specific type definitions.
 */

export type ExtensionView = "translate" | "srs" | "anki";

export interface ExtensionSettings {
  targetLanguage: "vi" | "en";
  showHanViet: boolean;
  llmProvider: "gemini" | "openai" | "custom";
  llmApiKey: string;
  llmCustomUrl?: string;
  ankiEnabled: boolean;
  ankiDeck: string;
  ankiModel: string;
  autoDetect: boolean;
  localOcrEnabled: boolean;
  showFurigana: boolean;
  showJlptColors: boolean;
  autoFetchJapaneseSubtitles: boolean;
  universalVideoEnabled: boolean;
  subtitleFontSize: "small" | "medium" | "large";
  autoPauseSubtitles: boolean;
  jimakuApiKey?: string;
  theme: "dark" | "light" | "auto";
  fontSize: "small" | "medium" | "large";
  srsEnabled: boolean;
  youtubeEnabled: boolean;
  netflixEnabled: boolean;
  textAnalysisEnabled: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  targetLanguage: "vi",
  showHanViet: true,
  llmProvider: "gemini",
  llmApiKey: "",
  ankiEnabled: true,
  ankiDeck: "Hakkutsu",
  ankiModel: "Hakkutsu Japanese",
  autoDetect: true,
  localOcrEnabled: false,
  showFurigana: true,
  showJlptColors: true,
  autoFetchJapaneseSubtitles: true,
  universalVideoEnabled: true,
  subtitleFontSize: "medium",
  autoPauseSubtitles: false,
  jimakuApiKey: "",
  theme: "dark",
  fontSize: "medium",
  srsEnabled: true,
  youtubeEnabled: true,
  netflixEnabled: true,
  textAnalysisEnabled: true,
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
