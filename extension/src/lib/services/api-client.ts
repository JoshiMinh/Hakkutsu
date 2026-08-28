/**
 * API client for Hakkutsu.
 *
 * Provides typed methods for text analysis, phrase breakdown,
 * translation, and subtitle fetching.
 */

import { DEFAULT_API_URL, API_V1 } from "~lib/utils/constants";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  PhraseAnalyzeResponse,
  SubtitleRequest,
  SubtitleResponse,
  OcrRequest,
  OcrResponse,
  HealthResponse,
  ApiError,
  WebTranslateResponse,
  TokenAnalysis,
  DictionaryEntry,
} from "~lib/types";
import { llmService } from "./llm-service";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import { containsJapanese } from "~lib/utils/japanese";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { useSettingsStore } from "~lib/utils/settings";

function mapRawTokenToAnalysis(t: any): TokenAnalysis {
  const surface = t.surface || t.text || "";
  const dictionary_form = t.dictionary_form || t.base_form || t.lemma || surface;
  const meaning = t.meaning || t.definition || "";
  
  const definitions: DictionaryEntry[] = Array.isArray(t.definitions) && t.definitions.length > 0
    ? t.definitions
    : (meaning ? [{
        dictionary: "Dict",
        glosses: Array.isArray(meaning) ? meaning : [meaning],
        pos: t.pos ? [t.pos] : [],
        field: null,
        misc: []
      }] : []);

  let reading = t.reading;
  if (typeof reading === "string") {
    reading = { hiragana: reading, romaji: "" };
  } else if (!reading || typeof reading !== "object") {
    reading = { hiragana: "", romaji: "" };
  }

  return {
    surface,
    dictionary_form,
    reading,
    pos: t.pos || "word",
    pos_detail: Array.isArray(t.pos_detail) ? t.pos_detail : [],
    is_japanese: typeof t.is_japanese === "boolean" ? t.is_japanese : containsJapanese(surface),
    jlpt_level: t.jlpt_level || t.jlpt || predictJlpt(dictionary_form || surface),
    frequency_rank: typeof t.frequency_rank === "number" ? t.frequency_rank : null,
    definitions,
    vietnamese_sound: t.vietnamese_sound || getHanViet(dictionary_form || surface) || ""
  };
}

class ApiClient {
  private baseUrl: string;
  private authToken: string | null = null;
  private analyzeCache: Map<string, AnalyzeResponse> = new Map();
  private phraseCache: Map<string, PhraseAnalyzeResponse> = new Map();
  private maxCacheSize = 50;

  constructor(baseUrl: string = DEFAULT_API_URL) {
    this.baseUrl = baseUrl;
  }

  /** Update the backend URL (from settings) */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  /** Set auth token for authenticated requests */
  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  /** Make a typed API request with error handling */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${API_V1}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorData: ApiError;
      try {
        const payload = await response.json() as Partial<ApiError> & {
          detail?: string;
        };
        errorData = {
          error:
            payload.error ||
            payload.detail ||
            `Request failed: HTTP ${response.status}`,
          detail: payload.detail || null,
          code: payload.code || "HTTP_ERROR",
        };
      } catch {
        errorData = {
          error: `HTTP ${response.status}`,
          detail: response.statusText,
          code: "HTTP_ERROR",
        };
      }
      throw new ApiClientError(
        errorData.error || `Request failed: ${response.status}`,
        response.status,
        errorData
      );
    }

    return response.json();
  }

  // ── Endpoints ──────────────────────────────────────────────────────

  /** Check backend health */
  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  /** Analyze Japanese text */
  async analyzeText(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    const targetLang = useSettingsStore.getState().settings.targetLanguage || "vi";
    const cacheKey = `${targetLang}:${JSON.stringify(request)}`;
    if (this.analyzeCache.has(cacheKey)) {
      return this.analyzeCache.get(cacheKey)!;
    }

    const llmResult = await llmService.analyzeText(request.text, false, targetLang);
    
    // Process tokens to add JLPT info
    const tokens: TokenAnalysis[] = llmResult.tokens?.map(mapRawTokenToAnalysis) || [];

    const sentenceReading = tokens.map(t => t.reading?.hiragana || t.surface).join("");

    const response: AnalyzeResponse = {
      text: request.text,
      tokens,
      sentence_reading: sentenceReading,
      token_count: tokens.length,
      difficulty_score: null,
      difficulty_label: null
    };

    if (this.analyzeCache.size >= this.maxCacheSize) {
      const firstKey = this.analyzeCache.keys().next().value;
      if (firstKey) this.analyzeCache.delete(firstKey);
    }
    this.analyzeCache.set(cacheKey, response);
    
    return response;
  }

  /** Analyze with the fine-tuned Ja–Vi model or fallback */
  async analyzeJavi(request: AnalyzeRequest): Promise<PhraseAnalyzeResponse> {
    return this.analyzePhrase(request);
  }

  /** Translate and deeply analyze a user-selected subtitle phrase */
  async analyzePhrase(request: AnalyzeRequest): Promise<PhraseAnalyzeResponse> {
    const targetLang = useSettingsStore.getState().settings.targetLanguage || "vi";
    const cacheKey = `${targetLang}:${request.text.trim()}`;
    const cached = this.phraseCache.get(cacheKey);
    if (cached) return cached;

    const llmResult = await llmService.analyzeText(request.text, true, targetLang);
    
    const tokens: TokenAnalysis[] = llmResult.tokens?.map(mapRawTokenToAnalysis) || [];

    const sentenceReading = tokens.map(t => t.reading?.hiragana || t.surface).join("");

    const response: PhraseAnalyzeResponse = {
      text: request.text,
      translation: llmResult.translation || "",
      tokens,
      sentence_reading: sentenceReading,
      token_count: tokens.length,
      difficulty_score: null,
      difficulty_label: null
    };

    if (this.phraseCache.size >= this.maxCacheSize) {
      const firstKey = this.phraseCache.keys().next().value;
      if (firstKey) this.phraseCache.delete(firstKey);
    }
    this.phraseCache.set(cacheKey, response);
    this.analyzeCache.set(
      `${targetLang}:${JSON.stringify({ text: request.text, include_definitions: true })}`,
      response
    );
    return response;
  }

  /** Translate Japanese webpage text into target language in one batch */
  async translateWebpage(
    texts: string[],
    pageUrl: string,
    pageTitle: string
  ): Promise<WebTranslateResponse> {
    const targetLang = useSettingsStore.getState().settings.targetLanguage || "vi";
    return llmService.translateWebpage(texts, pageUrl, pageTitle, targetLang);
  }

  /** Get YouTube subtitles */
  async getSubtitles(request: SubtitleRequest): Promise<SubtitleResponse> {
    return this.request<SubtitleResponse>("/subtitles/youtube", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}

/** Custom error class for API failures */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: ApiError
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Singleton API client instance */
export const apiClient = new ApiClient();
