/**
 * Local WebAssembly OCR Engine for Hakkutsu.
 *
 * Wraps Tesseract.js WASM for client-side Japanese text extraction
 * Supporting both horizontal (jpn) and vertical (jpn_vert) text orientations.
 */

import { createWorker, PSM, type Worker, type Page } from "tesseract.js";

const extensionAssetUrl = (path: string) => browser.runtime.getURL(path as never);
const workerUrl = extensionAssetUrl("/ocr/worker.min.js");
const coreUrl = extensionAssetUrl("/ocr/tesseract-core-simd-lstm.js");
const langUrl = extensionAssetUrl("/ocr");

export type OcrOrientation = "auto" | "vertical" | "horizontal";

export type OcrFragment = {
  text: string;
  confidence?: number;
  orientation?: "vertical" | "horizontal";
  lineId?: string;
  paragraphId?: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export interface OcrExecutionResult {
  text: string;
  confidence: number;
  orientation: "vertical" | "horizontal";
  lines: OcrFragment[];
}

export interface OcrProgressCallback {
  (progress: { status: string; progress: number }): void;
}

class OcrEngineService {
  private workers: Map<string, Promise<Worker>> = new Map();
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Initializes or reuses a cached Tesseract worker for the requested language/orientation.
   */
  private async getWorker(lang: "jpn" | "jpn_vert", onProgress?: OcrProgressCallback): Promise<Worker> {
    if (!this.workers.has(lang)) {
      const workerPromise = (async () => {
        const worker = await createWorker(lang, 1, {
          workerPath: workerUrl,
          corePath: coreUrl,
          langPath: langUrl,
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
   * Chooses the first pass; auto mode also tests the other text direction.
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
  public recognize(
    imageDataUrl: string,
    options: {
      orientation?: OcrOrientation;
      boxWidth?: number;
      boxHeight?: number;
      onProgress?: OcrProgressCallback;
    } = {}
  ): Promise<OcrExecutionResult> {
    // Parameter changes and recognition must not interleave on cached workers.
    const task = this.queue.then(() => this.recognizeImage(imageDataUrl, options));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private extractRegions(page: Page, orientation: "vertical" | "horizontal"): OcrExecutionResult["lines"] {
    // Horizontal lines can span several speech bubbles and their artwork.
    // Use word bounds there, and tight column bounds for vertical dialogue.
    return (page.blocks || []).flatMap((block, blockIndex) =>
      block.paragraphs.flatMap((paragraph, paragraphIndex) => paragraph.lines.flatMap((line, lineIndex) => {
        const paragraphId = `${orientation}:${blockIndex}:${paragraphIndex}`;
        const lineId = `${paragraphId}:${lineIndex}`;
        // jpn_vert word boxes can overlap the entire column. Keep a correctly
        // segmented vertical column as one readable phrase instead.
        const bounds = line.bbox;
        const orderedWords = [...(line.words || [])].sort((a, b) => a.bbox.y0 - b.bbox.y0);
        const hasLargeGap = orderedWords.some((word, index) => index > 0 &&
          word.bbox.y0 - orderedWords[index - 1].bbox.y1 > (bounds.x1 - bounds.x0) * 1.5);
        if (orientation === "vertical" && line.confidence >= 45 &&
          !hasLargeGap &&
          bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.5) {
          const text = this.cleanOcrText(line.text);
          if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text) &&
            Object.values(bounds).every(Number.isFinite) && bounds.x1 > bounds.x0 && bounds.y1 > bounds.y0) {
            return [{ text, confidence: line.confidence, bbox: bounds, orientation, lineId, paragraphId }];
          }
        }
        return (line.words || []).flatMap((word) => {
          const text = this.cleanOcrText(word.text);
          const { x0, y0, x1, y1 } = word.bbox;
          const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
          const punctuationOrNumber = /^[\p{N}\p{P}\p{S}]+$/u.test(text);
          return word.confidence >= 45 && (japanese || punctuationOrNumber)
            && [x0, y0, x1, y1].every(Number.isFinite) && x1 > x0 && y1 > y0
            && (punctuationOrNumber || (orientation === "horizontal" ? y1 - y0 <= (x1 - x0) * 2 : x1 - x0 <= (y1 - y0) * 2))
            ? [{ text, confidence: word.confidence, bbox: word.bbox, orientation, lineId, paragraphId }] : [];
        });
      }))
    );
  }

  private async recognizeImage(
    imageDataUrl: string,
    options: { orientation?: OcrOrientation; boxWidth?: number; boxHeight?: number; onProgress?: OcrProgressCallback }
  ): Promise<OcrExecutionResult> {
    const resolvedOrientation = this.resolveOrientation(
      options.orientation || "auto",
      options.boxWidth,
      options.boxHeight
    );

    const lang = resolvedOrientation === "vertical" ? "jpn_vert" : "jpn";

    try {
      const worker = await this.getWorker(lang, options.onProgress);
      await worker.setParameters({
        // A manga page has multiple independent bubbles, not one text block.
        tessedit_pageseg_mode: resolvedOrientation === "vertical" ? PSM.AUTO : PSM.SPARSE_TEXT,
        textord_tabfind_force_vertical_text: resolvedOrientation === "vertical" ? "1" : "0",
        user_defined_dpi: "300",
      });
      const result = await worker.recognize(imageDataUrl, {}, { blocks: true });

      const rawText = result?.data?.text || "";
      const confidence = result?.data?.confidence || 0;
      const cleanedText = this.cleanOcrText(rawText);

      const primary: OcrExecutionResult = {
        text: cleanedText,
        confidence,
        orientation: resolvedOrientation,
        lines: this.extractRegions(result.data, resolvedOrientation),
      };
      if (options.orientation && options.orientation !== "auto") return primary;

      // Page shape does not identify text direction. Manga pages contain both
      // vertical dialogue and horizontal headings, so try both in auto mode.
      const otherOrientation = resolvedOrientation === "vertical" ? "horizontal" : "vertical";
      let other: OcrExecutionResult;
      try {
        other = await this.recognizeImage(imageDataUrl, { ...options, orientation: otherOrientation });
      } catch {
        return primary;
      }
      const candidates = [...primary.lines, ...other.lines].sort((a, b) =>
        (b.confidence || 0) - (a.confidence || 0) || (a.orientation === "horizontal" ? -1 : 1));
      const lines: OcrExecutionResult["lines"] = [];
      for (const candidate of candidates) {
        const a = candidate.bbox;
        if (lines.some(({ bbox: b, text, orientation }) => {
          // Japanese word boxes from the same pass can legitimately overlap.
          if (orientation === candidate.orientation && text !== candidate.text) return false;
          const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
            * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
          return overlap / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
            > (text === candidate.text ? 0.25 : 0.5);
        })) continue;
        lines.push(candidate);
      }
      lines.sort((a, b) => {
        const overlapY = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
        if (overlapY > Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) / 2) {
          return a.orientation === "vertical" && b.orientation === "vertical"
            ? b.bbox.x0 - a.bbox.x0 : a.bbox.x0 - b.bbox.x0;
        }
        return a.bbox.y0 - b.bbox.y0;
      });
      return { ...primary, lines, text: lines.map((line) => line.text).join("\n") };
    } catch (err) {
      console.error(`[Hakkutsu OCR] Recognition failed with lang ${lang}:`, err);
      // Fallback: If vertical failed, attempt horizontal fallback
      if (lang === "jpn_vert") {
        try {
          const fallbackWorker = await this.getWorker("jpn", options.onProgress);
          await fallbackWorker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, textord_tabfind_force_vertical_text: "0" });
          const fallbackResult = await fallbackWorker.recognize(imageDataUrl, {}, { blocks: true });
          return {
            text: this.cleanOcrText(fallbackResult?.data?.text || ""),
            confidence: fallbackResult?.data?.confidence || 0,
            orientation: "horizontal",
            lines: this.extractRegions(fallbackResult.data, "horizontal"),
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
