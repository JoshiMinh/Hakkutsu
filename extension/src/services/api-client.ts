/**
 * FastAPI backend client.
 *
 * Provides typed methods for all API endpoints with
 * error handling, auth token injection, and retry logic.
 */

import { DEFAULT_API_URL, API_V1 } from "~lib/constants";
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
} from "~types";
import { llmService } from "./llm-service";
import { predictJlpt } from "~lib/jlpt-classifier";

class ApiClient {
  private baseUrl: string;
  private authToken: string | null = null;

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

  private analyzeCache: Map<string, AnalyzeResponse> = new Map();
  private maxCacheSize = 50;

  /** Analyze Japanese text */
  async analyzeText(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    const cacheKey = JSON.stringify(request);
    if (this.analyzeCache.has(cacheKey)) {
      return this.analyzeCache.get(cacheKey)!;
    }

    const llmResult = await llmService.analyzeText(request.text, false);
    
    // Process tokens to add JLPT info
    const tokens = llmResult.tokens?.map((t: any) => ({
      ...t,
      jlpt: predictJlpt(t.base_form || t.text)
    })) || [];

    const response: AnalyzeResponse = {
      text: request.text,
      tokens,
      sentence_reading: llmResult.tokens?.map((t: any) => t.reading).join("") || "",
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

  private phraseCache: Map<string, PhraseAnalyzeResponse> = new Map();
  private javiCache: Map<string, PhraseAnalyzeResponse> = new Map();

  /** Analyze with the fine-tuned Ja–Vi model, or local fallback when disabled. */
  async analyzeJavi(request: AnalyzeRequest): Promise<PhraseAnalyzeResponse> {
    // Just wrap to llmService
    const res = await this.analyzePhrase(request);
    return res;
  }

  /** Translate and deeply analyze a user-selected subtitle phrase. */
  async analyzePhrase(request: AnalyzeRequest): Promise<PhraseAnalyzeResponse> {
    const cacheKey = request.text.trim();
    const cached = this.phraseCache.get(cacheKey);
    if (cached) return cached;

    const llmResult = await llmService.analyzeText(request.text, true);
    
    const tokens = llmResult.tokens?.map((t: any) => ({
      ...t,
      jlpt: predictJlpt(t.base_form || t.text)
    })) || [];

    const response: PhraseAnalyzeResponse = {
      text: request.text,
      translation: llmResult.translation || "",
      tokens,
      sentence_reading: llmResult.tokens?.map((t: any) => t.reading).join("") || "",
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
      JSON.stringify({ text: request.text, include_definitions: true }),
      response
    );
    return response;
  }

  /** Translate Japanese webpage text into Vietnamese in one batch. */
  async translateWebpage(
    texts: string[],
    pageUrl: string,
    pageTitle: string
  ): Promise<WebTranslateResponse> {
    return llmService.translateWebpage(texts, pageUrl, pageTitle);
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
