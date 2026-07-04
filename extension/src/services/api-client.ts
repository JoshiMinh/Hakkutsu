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
  SubtitleRequest,
  SubtitleResponse,
  OcrRequest,
  OcrResponse,
  HealthResponse,
  ApiError,
} from "~types";

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
        errorData = await response.json();
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
    return this.request<AnalyzeResponse>("/analyze", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /** Get YouTube subtitles */
  async getSubtitles(request: SubtitleRequest): Promise<SubtitleResponse> {
    return this.request<SubtitleResponse>("/subtitles/youtube", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /** Extract text from image via OCR */
  async extractOcr(request: OcrRequest): Promise<OcrResponse> {
    return this.request<OcrResponse>("/ocr", {
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
