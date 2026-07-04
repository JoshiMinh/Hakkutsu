/**
 * API response types matching the FastAPI backend schemas.
 */

// ── Token Analysis ──────────────────────────────────────────────────────────

export interface TokenReading {
  hiragana: string;
  romaji: string;
}

export interface DictionaryEntry {
  glosses: string[];
  pos: string[];
  field: string | null;
  misc: string[];
}

export interface TokenAnalysis {
  surface: string;
  dictionary_form: string;
  reading: TokenReading;
  pos: string;
  pos_detail: string[];
  is_japanese: boolean;
  jlpt_level: string | null;
  frequency_rank: number | null;
  definitions: DictionaryEntry[];
}

export interface AnalyzeRequest {
  text: string;
  include_definitions?: boolean;
  include_examples?: boolean;
}

export interface AnalyzeResponse {
  text: string;
  tokens: TokenAnalysis[];
  sentence_reading: string;
  token_count: number;
  difficulty_score: number | null;
  difficulty_label: string | null;
}

// ── Subtitles ───────────────────────────────────────────────────────────────

export interface SubtitleSegment {
  text: string;
  start: number;
  duration: number;
}

export interface SubtitleRequest {
  video_url: string;
  language?: string;
}

export interface SubtitleResponse {
  video_id: string;
  language: string;
  segments: SubtitleSegment[];
  full_text: string;
}

// ── OCR ─────────────────────────────────────────────────────────────────────

export interface OcrRegion {
  text: string;
  confidence: number;
  bbox: number[] | null;
}

export interface OcrRequest {
  image_data: string;
  language?: string;
}

export interface OcrResponse {
  full_text: string;
  regions: OcrRegion[];
  language: string;
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
