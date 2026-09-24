/**
 * Local WebAssembly OCR Engine for Hakkutsu.
 *
 * Wraps Tesseract.js WASM for client-side Japanese text extraction
 * Supporting both horizontal (jpn) and vertical (jpn_vert) text orientations.
 */

import { createWorker, type Worker } from "tesseract.js";

const extensionAssetUrl = (path: string) => browser.runtime.getURL(path as never);
const workerUrl = extensionAssetUrl("/ocr/worker.min.js");
const coreUrl = extensionAssetUrl("/ocr/tesseract-core-simd-lstm.js");

export type OcrOrientation = "auto" | "vertical" | "horizontal";

export interface OcrExecutionResult {
  text: string;
  confidence: number;
  orientation: "vertical" | "horizontal";
}

export interface OcrProgressCallback {
  (progress: { status: string; progress: number }): void;
}

class OcrEngineService {
  private workers: Map<string, Promise<Worker>> = new Map();

  /**
   * Initializes or reuses a cached Tesseract worker for the requested language/orientation.
   */
  private async getWorker(lang: "jpn" | "jpn_vert", onProgress?: OcrProgressCallback): Promise<Worker> {
    if (!this.workers.has(lang)) {
      const workerPromise = (async () => {
        const worker = await createWorker(lang, 1, {
          workerPath: workerUrl,
          corePath: coreUrl,
          workerBlobURL: false,
          logger: (m) => {
            if (onProgress && m.status && typeof m.progress === "number") {
              onProgress({ status: m.status, progress: m.progress });
            }
          },
        });
        return worker;
      })();

      this.workers.set(lang, workerPromise);
      workerPromise.catch(() => {
        if (this.workers.get(lang) === workerPromise) {
          this.workers.delete(lang);
        }
      });
    }

    return this.workers.get(lang)!;
  }

  /**
   * Resolves orientation from explicit choice or bounding box aspect ratio.
   */
  public resolveOrientation(
    orientation: OcrOrientation,
    width?: number,
    height?: number
  ): "vertical" | "horizontal" {
    if (orientation === "vertical") return "vertical";
    if (orientation === "horizontal") return "horizontal";

    // Auto-detect based on bounding box aspect ratio
    if (width && height && height > width * 1.15) {
      return "vertical";
    }
    return "horizontal";
  }

  /**
   * Cleans and post-processes raw OCR output for Japanese text.
   * - Strips spaces accidentally inserted between CJK characters
   * - Normalizes vertical punctuation to standard horizontal forms
   * - Normalizes full-width alphanumeric chars and repeated noise
   */
  public cleanOcrText(rawText: string): string {
    if (!rawText) return "";

    let text = rawText.trim();

    // 1. Normalize vertical punctuation variants to standard Japanese characters
    const vertPunctuationMap: Record<string, string> = {
      "︱": "ー",
      "︳": "ー",
      "︴": "〜",
      "︰": "…",
      "︙": "…",
      "︐": "、",
      "︑": "、",
      "︒": "。",
      "﹁": "「",
      "﹂": "」",
      "﹃": "『",
      "﹄": "』",
      "︵": "（",
      "︶": "）",
      "︷": "｛",
      "︸": "｝",
      "︹": "【",
      "︺": "】",
      "︻": "〔",
      "︼": "〕",
      "｜": "ー",
      "|": "ー",
    };

    text = text.replace(/[\uFE10-\uFE19\uFE30-\uFE4F|｜]/g, (char) => vertPunctuationMap[char] || char);

    // 2. Remove line breaks within sentences while preserving paragraph separations
    text = text.replace(/([^\n])\n([^\n])/g, "$1$2");

    // 3. Remove spaces between Japanese characters (Kanji, Hiragana, Katakana, CJK punctuation)
    const cjkPattern = "[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF00-\uFFEF]";
    const spaceRegex = new RegExp(`(${cjkPattern})\\s+(${cjkPattern})`, "g");

    // Apply regex repeatedly to handle multi-space consecutive CJK tokens
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(spaceRegex, "$1$2");
    }

    // 4. Remove surrounding stray quotes and artifacts
    text = text
      .replace(/^[\s`'"]+|[\s`'"]+$/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  }

  /**
   * Executes OCR on an image data URL or Blob.
   */
  public async recognize(
    imageDataUrl: string,
    options: {
      orientation?: OcrOrientation;
      boxWidth?: number;
      boxHeight?: number;
      onProgress?: OcrProgressCallback;
    } = {}
  ): Promise<OcrExecutionResult> {
    const resolvedOrientation = this.resolveOrientation(
      options.orientation || "auto",
      options.boxWidth,
      options.boxHeight
    );

    const lang = resolvedOrientation === "vertical" ? "jpn_vert" : "jpn";

    try {
      const worker = await this.getWorker(lang, options.onProgress);
      const result = await worker.recognize(imageDataUrl);

      const rawText = result?.data?.text || "";
      const confidence = result?.data?.confidence || 0;
      const cleanedText = this.cleanOcrText(rawText);

      return {
        text: cleanedText,
        confidence,
        orientation: resolvedOrientation,
      };
    } catch (err) {
      console.error(`[Hakkutsu OCR] Recognition failed with lang ${lang}:`, err);
      // Fallback: If vertical failed, attempt horizontal fallback
      if (lang === "jpn_vert") {
        try {
          const fallbackWorker = await this.getWorker("jpn", options.onProgress);
          const fallbackResult = await fallbackWorker.recognize(imageDataUrl);
          return {
            text: this.cleanOcrText(fallbackResult?.data?.text || ""),
            confidence: fallbackResult?.data?.confidence || 0,
            orientation: "horizontal",
          };
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Terminates active workers to free memory when necessary.
   */
  public async terminate(): Promise<void> {
    for (const [lang, workerPromise] of this.workers.entries()) {
      try {
        const worker = await workerPromise;
        await worker.terminate();
      } catch (e) {
        console.warn(`[Hakkutsu OCR] Error terminating worker ${lang}:`, e);
      }
    }
    this.workers.clear();
  }
}

export const ocrEngine = new OcrEngineService();
