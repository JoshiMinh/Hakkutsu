// API Types

/**
 * API response types matching the FastAPI backend schemas.
 */

// ── Grammar ─────────────────────────────────────────────────────────────────

export interface GrammarPattern {
  pattern: string;
  meaning: string;
  explanation: string;
  jlpt_level: string | null;
}

// ── Token Analysis ──────────────────────────────────────────────────────────

export interface TokenReading {
  hiragana: string;
  romaji: string;
}

export interface DictionaryEntry {
  dictionary?: string;
  glosses: string[];
  pos: string[];
  field: string | null;
  misc: string[];
}

export interface TokenAnalysis {
  surface: string;
  dictionary_form: string;
  reading: TokenReading;
  dictionary_reading?: string;
  pos: string;
  pos_detail: string[];
  is_japanese: boolean;
  jlpt_level: string | null;
  frequency_rank: number | null;
  definitions: DictionaryEntry[];
  vietnamese_sound?: string;
  srs_state?: string | null;
  grammar_note_vi?: string;
  imageUrl?: string;
  components?: Array<{
    surface: string;
    lemma: string;
    reading: string;
    part_of_speech: string;
  }>;
}

export interface AnalyzeRequest {
  text: string;
  source?: "ocr";
  include_definitions?: boolean;
  include_examples?: boolean;
  user_id?: string;
}

export interface AnalyzeResponse {
  text: string;
  tokens: TokenAnalysis[];
  sentence_reading: string;
  token_count: number;
  difficulty_score: number | null;
  difficulty_label: string | null;
  grammar_patterns?: GrammarPattern[];
}

export interface PhraseAnalyzeResponse extends AnalyzeResponse {
  translation: string;
}

export interface WebTranslateItem {
  index: number;
  source: string;
  translation: string;
  tokens: TokenAnalysis[];
}

export interface WebTranslateResponse {
  source_language?: string;
  target_language?: string;
  items?: WebTranslateItem[];
  translations?: Array<{ id: number; text: string }>;
}

// ── Common ──────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  detail: string | null;
  code: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface SelectionEvent {
  text: string;
  context: string;
  x: number;
  y: number;
  sourceUrl: string;
}
