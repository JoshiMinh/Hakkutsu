/**
 * Extension-specific type definitions.
 */

export type ExtensionView = "translate" | "srs" | "anki";

export interface ExtensionSettings {
  targetLanguage: "vi" | "en";
  showHanViet: boolean;
  ankiEnabled: boolean;
  ankiDeck: string;
  ankiModel: string;
  autoDetect: boolean;
  showFurigana: boolean;
  showJlptColors: boolean;
  hoverModifierKey: "alt" | "ctrl" | "shift" | "meta" | "none";
  theme: "dark" | "light" | "auto";
  fontSize: "small" | "medium" | "large";
  srsEnabled: boolean;
  textAnalysisEnabled: boolean;
  subtitlesEnabled: boolean;
  subtitlesFontSize: number;
  subtitlesSecondaryEnabled: boolean;
  subtitlesAutoPause: boolean;
  subtitlesOffset: number;
  netflixBtnPosition?: { x: number; y: number } | null;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  targetLanguage: "vi",
  showHanViet: true,
  ankiEnabled: true,
  ankiDeck: "Hakkutsu",
  ankiModel: "Hakkutsu Japanese",
  autoDetect: true,
  showFurigana: true,
  showJlptColors: true,
  hoverModifierKey: "alt",
  theme: "dark",
  fontSize: "medium",
  srsEnabled: true,
  textAnalysisEnabled: true,
  subtitlesEnabled: true,
  subtitlesFontSize: 26,
  subtitlesSecondaryEnabled: true,
  subtitlesAutoPause: false,
  subtitlesOffset: 0,
  netflixBtnPosition: null,
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
  | "EXPORT_ANKI"
  | "ANKI_RESULT"
  | "CHECK_ANKI"
  | "ANKI_STATUS"
  | "GET_SETTINGS"
  | "UPDATE_SETTINGS"
  | "TEXT_SELECTED"
  | "ADD_SRS_CARD"
  | "SRS_RESULT"
  | "OPEN_APP"
  | "OPEN_APP_RESULT"
  | "TRANSLATE_TEXT"
  | "TRANSLATE_RESULT"
  | "FETCH_TTS_AUDIO"
  | "TTS_AUDIO_RESULT"
  | "START_OCR_FLOW"
  | "START_OCR_FLOW_RESULT"
  | "CAPTURE_SCREENSHOT"
  | "SCREENSHOT_RESULT"
  | "FETCH_IMAGE"
  | "FETCH_IMAGE_RESULT"
  | "FETCH_TIMEDTEXT_URL"
  | "FETCH_TIMEDTEXT_URL_RESULT"
  | "OCR_IMAGE"
  | "OCR_RESULT"
  | "IGNORED"
  | "ERROR";

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}
