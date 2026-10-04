/**
 * Local WebAssembly OCR Engine for Hakkutsu.
 *
 * Wraps Tesseract.js WASM for client-side Japanese text extraction
 * Supporting both horizontal (jpn) and vertical (jpn_vert) text orientations.
 */

import { createWorker, PSM, type Worker, type Page } from "tesseract.js";
import type { OcrDiagnosticCollector } from "./ocr-diagnostics";

const extensionAssetUrl = (path: string) => browser.runtime.getURL(path as never);
const workerUrl = extensionAssetUrl("/ocr/worker.min.js");
const coreUrl = extensionAssetUrl("/ocr/tesseract-core-simd-lstm.js");
const langUrl = extensionAssetUrl("/ocr");

export type OcrOrientation = "auto" | "vertical" | "horizontal";
export type OcrBounds = { x0: number; y0: number; x1: number; y1: number };
export type OcrTextBounds = { text: string; confidence?: number; bbox: OcrBounds };

export type OcrFragment = {
  text: string;
  confidence?: number;
  orientation?: "vertical" | "horizontal";
  lineId?: string;
  paragraphId?: string;
  bbox: OcrBounds;
  evidence?: {
    source: "page" | "crop";
    passId: string;
    cropId?: string;
    textColumn?: boolean;
    rawBounds: OcrBounds;
    words: OcrTextBounds[];
    glyphs: OcrTextBounds[];
    transform?: OcrCropItem["transform"];
  };
};

export interface OcrCropItem {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  orientation?: OcrOrientation;
  orientationHint?: "vertical" | "horizontal";
  adaptiveThreshold?: boolean;
  textColumn?: boolean;
  // Maps recognition pixels (including padding) into source-canvas pixels.
  transform?: { originX: number; originY: number; scale: number; padding: number };
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrCropResult {
  error?: string;
  lines: OcrFragment[];
  transform?: OcrCropItem["transform"];
  id: string;
  text: string;
  confidence: number;
  orientation: "vertical" | "horizontal";
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrExecutionResult {
  text: string;
  confidence: number;
  orientation: "vertical" | "horizontal";
  lines: OcrFragment[];
}

export interface OcrProgressCallback {
  (progress: { status: string; progress: number }): void;
}

function cropReadingOrientation(crop: OcrCropItem | undefined, modelOrientation: "vertical" | "horizontal") {
  return crop?.textColumn && (!crop.orientation || crop.orientation === "auto")
    ? crop.orientationHint || modelOrientation : modelOrientation;
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
  public cleanOcrText(rawText: string, repairSoundMarks = true): string {
    if (!rawText) return "";

    let text = rawText.trim();

    // 0. Normalize CRLF / CR to standard LF
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

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
      "丨": "ー",
    };

    text = text.replace(/[\uFE10-\uFE19\uFE30-\uFE4F|｜丨]/g, (char) => vertPunctuationMap[char] || char);

    // 2. Normalize Katakana prolonged sound mark (ー / chōonpu) misrecognized as 1, l, I, | in vertical text
    // E.g. "ゲー1ム" -> "ゲーム", "セ1ラー" -> "セーラー", "センタ1" -> "センター"
    const kataChar = "[\u30A1-\u30FA\u30FC]";
    const kataInterpRegex1 = new RegExp(`(${kataChar})\\s*[1lI|!丨]\\s*(${kataChar})`, "g");
    const kataInterpRegex2 = new RegExp(`(${kataChar})\\s*[1lI|丨](?=[\\s、。！？「」『』（）…・\\n]|$)`, "g");
    if (repairSoundMarks) {
      text = text.replace(kataInterpRegex1, "$1ー$2");
      text = text.replace(kataInterpRegex2, "$1ー");
    }

    // Handle when 1 or | is on its own isolated line between Katakana lines:
    // e.g. "ゲー\n1\nム" -> "ゲーム"
    if (repairSoundMarks) text = text.replace(/([\u30A1-\u30FA\u30FC])\s*\n\s*[1lI|!丨]\s*\n\s*([\u30A1-\u30FA\u30FC])/g, "$1ー$2");

    // 3. Remove line breaks within Japanese text while preserving distinct paragraphs
    const cjkPattern = "[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF00-\uFFEF]";
    const jpNewlineRegex = new RegExp(`(${cjkPattern})\\s*\\n+\\s*(${cjkPattern})`, "g");
    let prevText = "";
    while (prevText !== text) {
      prevText = text;
      text = text.replace(jpNewlineRegex, "$1$2");
    }

    // Secondary pass for Katakana prolonged mark after newlines were joined
    if (repairSoundMarks) {
      text = text.replace(kataInterpRegex1, "$1ー$2");
      text = text.replace(kataInterpRegex2, "$1ー");
    }

    // Collapse duplicate Katakana prolonged sound marks caused by OCR artifacting (e.g. ゲーーム -> ゲーム)
    text = text.replace(/([\u30A1-\u30FA])ーー+(?=[\u30A1-\u30FA])/g, "$1ー");

    // 4. Remove spaces between Japanese characters (Kanji, Hiragana, Katakana, CJK punctuation)
    const spaceRegex = new RegExp(`(${cjkPattern})\\s+(${cjkPattern})`, "g");

    // Apply regex repeatedly to handle multi-space consecutive CJK tokens
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(spaceRegex, "$1$2");
    }

    // 5. Remove surrounding stray quotes and artifacts
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
      diagnostics?: OcrDiagnosticCollector;
    } = {}
  ): Promise<OcrExecutionResult> {
    // Parameter changes and recognition must not interleave on cached workers.
    const task = this.queue.then(() => this.recognizeImage(imageDataUrl, options));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private extractRegions(page: Page, orientation: "vertical" | "horizontal", crop?: OcrCropItem, diagnostics?: OcrDiagnosticCollector): OcrExecutionResult["lines"] {
    const validBounds = (b: OcrBounds) => Object.values(b).every(Number.isFinite) && b.x1 > b.x0 && b.y1 > b.y0;
    // The horizontal language model can correctly read individual glyphs in a
    // vertical column. Its model direction must not split that known column
    // into horizontal snippets. Retain the actual model in pass provenance.
    const readingOrientation = cropReadingOrientation(crop, orientation);
    const makeFragment = (text: string, confidence: number, bbox: OcrBounds, lineId: string, paragraphId: string, words: OcrTextBounds[], glyphs: OcrTextBounds[]): OcrFragment => {
      const fragment: OcrFragment = { text, confidence, bbox, orientation: readingOrientation, lineId, paragraphId,
        evidence: { source: crop ? "crop" : "page", passId: `${crop?.id || "page"}:${orientation}`,
          cropId: crop?.id, textColumn: crop?.textColumn, rawBounds: { ...bbox }, words, glyphs, transform: crop?.transform } };
      diagnostics?.({ stage: "recognition", reason: "extracted", fragment });
      return fragment;
    };
    // Horizontal lines can span several speech bubbles and their artwork.
    // Use word bounds there, and tight column bounds for vertical dialogue.
    return (page.blocks || []).flatMap((block, blockIndex) =>
      block.paragraphs.flatMap((paragraph, paragraphIndex) => paragraph.lines.flatMap((line, lineIndex) => {
        const paragraphId = `${orientation}:${blockIndex}:${paragraphIndex}`;
        const lineId = `${paragraphId}:${lineIndex}`;
        diagnostics?.({ stage: "recognition", reason: "raw-line", details: { text: line.text, confidence: line.confidence, bbox: line.bbox,
          words: (line.words || []).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })), orientation, cropId: crop?.id, lineId } });
        const retainedWords = (line.words || []).filter(word => {
          const text = this.cleanOcrText(word.text, false);
          const competing = paragraph.lines.some(otherLine => (otherLine.words || []).some(other => other !== word && other.confidence >= word.confidence + 20 &&
            (this.cleanOcrText(other.text, false).includes(text) || (otherLine !== line && word.confidence < 35)) &&
            word.bbox.x0 >= other.bbox.x0 && word.bbox.y0 >= other.bbox.y0 && word.bbox.x1 <= other.bbox.x1 && word.bbox.y1 <= other.bbox.y1));
          if (competing) diagnostics?.({ stage: "recognition", reason: "nested-word-alternative", details: { word: { text, confidence: word.confidence, bbox: word.bbox }, orientation, cropId: crop?.id, lineId } });
          return !competing;
        });
        const words = retainedWords.filter(w => validBounds(w.bbox)).map(w => ({ text: this.cleanOcrText(w.text, false), confidence: w.confidence, bbox: w.bbox }));
        const glyphs = retainedWords.flatMap(w => (w.symbols || []).flatMap(symbol => {
          if (!validBounds(symbol.bbox) || symbol.bbox.x0 < w.bbox.x0 - 2 || symbol.bbox.y0 < w.bbox.y0 - 2 ||
            symbol.bbox.x1 > w.bbox.x1 + 2 || symbol.bbox.y1 > w.bbox.y1 + 2) {
            diagnostics?.({ stage: "recognition", reason: "invalid-symbol-bounds", details: { symbol, orientation, cropId: crop?.id, lineId } });
            return [];
          }
          return [{ text: symbol.text, confidence: symbol.confidence, bbox: symbol.bbox }];
        }));
        // jpn_vert word boxes can overlap the entire column. Keep a correctly
        // segmented vertical column as one readable phrase instead.
        const bounds = retainedWords.length && retainedWords.length < (line.words || []).length && retainedWords.every(word => validBounds(word.bbox)) ? {
          x0: Math.min(...retainedWords.map(word => word.bbox.x0)), y0: Math.min(...retainedWords.map(word => word.bbox.y0)),
          x1: Math.max(...retainedWords.map(word => word.bbox.x1)), y1: Math.max(...retainedWords.map(word => word.bbox.y1)),
        } : line.bbox;
        const orderedWords = [...retainedWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
        const hasLargeGap = orderedWords.some((word, index) => index > 0 &&
          word.bbox.y0 - orderedWords[index - 1].bbox.y1 > (bounds.x1 - bounds.x0) * 3);
        if (orientation === "vertical" && line.confidence >= 25 &&
          !hasLargeGap &&
          bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.5) {
          const raw = this.cleanOcrText(line.text, false);
          const text = retainedWords.length < (line.words || []).length &&
            (line.words || []).map(word => this.cleanOcrText(word.text, false)).join("") === raw
            ? words.map(word => word.text).join("") : raw;
          if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text) &&
            Object.values(bounds).every(Number.isFinite) && bounds.x1 > bounds.x0 && bounds.y1 > bounds.y0) {
            return [makeFragment(text, line.confidence, bounds, lineId, paragraphId, words, glyphs)];
          }
        }
        return retainedWords.flatMap((word) => {
          const text = this.cleanOcrText(word.text, false);
          const { x0, y0, x1, y1 } = word.bbox;
          const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
          const punctuationOrNumber = /^[\p{N}\p{P}\p{S}]+$/u.test(text) || /^[A-Za-z]$/.test(text);
          const passesConfidence = japanese ? word.confidence >= 20 : word.confidence >= 45;
          const accepted = passesConfidence && (japanese || punctuationOrNumber)
            && [x0, y0, x1, y1].every(Number.isFinite) && x1 > x0 && y1 > y0
            && (punctuationOrNumber || (orientation === "horizontal" ? y1 - y0 <= (x1 - x0) * 2 : x1 - x0 <= (y1 - y0) * 2))
            ;
          if (accepted) return [makeFragment(text, word.confidence, word.bbox, lineId, paragraphId,
            [{ text, confidence: word.confidence, bbox: word.bbox }], glyphs.filter(g => g.bbox.x0 >= x0 && g.bbox.y0 >= y0 && g.bbox.x1 <= x1 && g.bbox.y1 <= y1))];
          diagnostics?.({ stage: "recognition", reason: !validBounds(word.bbox) ? "invalid-word-bounds" : !passesConfidence ? "low-word-confidence" : "unsupported-word",
            fragment: { text, confidence: word.confidence, bbox: word.bbox, orientation, lineId, paragraphId }, details: { cropId: crop?.id } });
          return [];
        });
      }))
    );
  }

  private async recognizeImage(
    imageDataUrl: string,
    options: { orientation?: OcrOrientation; boxWidth?: number; boxHeight?: number; onProgress?: OcrProgressCallback; diagnostics?: OcrDiagnosticCollector }
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
        thresholding_method: "0",
      });
      const result = await worker.recognize(imageDataUrl, {}, { blocks: true });

      const rawText = result?.data?.text || "";
      const confidence = result?.data?.confidence || 0;
      const cleanedText = this.cleanOcrText(rawText);

      const primary: OcrExecutionResult = {
        text: cleanedText,
        confidence,
        orientation: resolvedOrientation,
        lines: this.extractRegions(result.data, resolvedOrientation, undefined, options.diagnostics),
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
      // Keep both passes until original-pixel validation. Confidence alone
      // cannot decide whether an overlapping reading is dialogue or artwork.
      const lines = [...primary.lines, ...other.lines].sort((a, b) =>
        (b.confidence || 0) - (a.confidence || 0) || (a.orientation === "horizontal" ? -1 : 1));
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
      if (lang === "jpn_vert" && (!options.orientation || options.orientation === "auto")) {
        try {
          const fallbackWorker = await this.getWorker("jpn", options.onProgress);
          await fallbackWorker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, textord_tabfind_force_vertical_text: "0", thresholding_method: "0" });
          const fallbackResult = await fallbackWorker.recognize(imageDataUrl, {}, { blocks: true });
          return {
            text: this.cleanOcrText(fallbackResult?.data?.text || ""),
            confidence: fallbackResult?.data?.confidence || 0,
            orientation: "horizontal",
            lines: this.extractRegions(fallbackResult.data, "horizontal", undefined, options.diagnostics),
          };
        } catch {}
      }
      throw err;
    }
  }

  /** Crop results retain local fragments; the caller maps and groups them. */
  private async executeRecognizeCrop(crop: OcrCropItem, diagnostics?: OcrDiagnosticCollector): Promise<OcrCropResult> {
    const explicit = crop.orientation && crop.orientation !== "auto";
    const direction = explicit ? crop.orientation as "vertical" | "horizontal"
      : crop.orientationHint || this.resolveOrientation("auto", crop.width, crop.height);
    const attempts: OcrCropResult[] = [];
    let lastError: unknown;
    const run = async (orientation: "vertical" | "horizontal", adaptive = false): Promise<OcrCropResult> => {
      const worker = await this.getWorker(orientation === "vertical" ? "jpn_vert" : "jpn");
      await worker.setParameters({
        tessedit_pageseg_mode: orientation === "vertical" ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_BLOCK,
        textord_tabfind_force_vertical_text: orientation === "vertical" ? "1" : "0",
        user_defined_dpi: "300",
        thresholding_method: adaptive ? "2" : "0",
      });
      const { data } = await worker.recognize(crop.dataUrl, {}, { blocks: true });
      const lines = this.extractRegions(data, orientation, crop, diagnostics);
      if (adaptive) for (const line of lines) {
        if (line.evidence) line.evidence.passId += ":adaptive";
        line.lineId += ":adaptive";
        line.paragraphId += ":adaptive";
      }
      const result: OcrCropResult = {
        id: crop.id, bbox: crop.bbox, transform: crop.transform, orientation: cropReadingOrientation(crop, orientation), lines,
        text: this.cleanOcrText(data.text || "", false), confidence: data.confidence || 0,
      };
      attempts.push(result);
      return result;
    };
    const score = (result: OcrCropResult) => {
      const count = (text: string) => [...text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
      const japanese = count(result.text);
      const groups = new Map<string, OcrFragment[]>();
      result.lines.forEach((fragment, index) => {
        const key = crop.textColumn && result.orientation === crop.orientationHint ? crop.id : fragment.lineId || String(index);
        groups.set(key, [...(groups.get(key) || []), fragment]);
      });
      let supported = 0;
      for (const fragments of groups.values()) {
        const characters = fragments.reduce((sum, f) => sum + count(f.text), 0);
        const x0 = Math.min(...fragments.map(f => f.bbox.x0)), y0 = Math.min(...fragments.map(f => f.bbox.y0));
        const x1 = Math.max(...fragments.map(f => f.bbox.x1)), y1 = Math.max(...fragments.map(f => f.bbox.y1));
        const along = result.orientation === "vertical" ? y1 - y0 : x1 - x0;
        const across = result.orientation === "vertical" ? x1 - x0 : y1 - y0;
        if (characters >= 2 && along >= across * characters * .4 && along <= across * characters * 2.5) supported += characters;
      }
      const fragmentConfidence = result.lines.reduce((sum, f) => sum + (f.confidence || 0) * count(f.text), 0) /
        Math.max(1, result.lines.reduce((sum, f) => sum + count(f.text), 0));
      return japanese && supported ? Math.min(result.confidence, fragmentConfidence) * Math.min(1, supported / japanese) : -1;
    };
    let primary: OcrCropResult | undefined;
    try { primary = await run(direction); } catch (error) {
      lastError = error;
      console.warn(`[Hakkutsu OCR] Crop ${crop.id} failed in ${direction}:`, error);
    }
    if (!explicit && (!primary || score(primary) < 60 || !crop.orientationHint)) {
      try {
        const other = await run(direction === "vertical" ? "horizontal" : "vertical");
        if (!primary || score(other) > score(primary)) primary = other;
      } catch (error) {
        lastError = error;
        console.warn(`[Hakkutsu OCR] Crop ${crop.id} alternative failed:`, error);
      }
    }
    // Retry uneven colored backgrounds only when the ordinary crop reading is
    // weak. This changes Tesseract's local thresholding, not source geometry.
    if (crop.adaptiveThreshold && (!primary || score(primary) < 60)) {
      for (const orientation of explicit ? [direction] : [direction, direction === "vertical" ? "horizontal" as const : "vertical" as const]) {
        try {
          const result = await run(orientation, true);
          if (!primary || score(result) > score(primary)) primary = result;
        } catch (error) { lastError = error; }
      }
    }
    diagnostics?.({ stage: "recognition", reason: "chosen-crop-orientation", details: { cropId: crop.id, orientation: primary?.orientation || direction, confidence: primary?.confidence || 0 } });
    // Preserve every attempted fragment for validation against original pixels.
    // The chosen text remains useful for an editable manual fallback.
    if (primary) return { ...primary, lines: attempts.flatMap(result => result.lines) };
    return {
      id: crop.id, bbox: crop.bbox, transform: crop.transform,
      text: "", confidence: 0, orientation: direction, lines: [],
      error: lastError instanceof Error ? lastError.message : String(lastError || "Recognition failed"),
    };
  }

  /**
   * Recognizes a single cropped speech bubble through the serialized task queue.
   */
  public recognizeCrop(crop: OcrCropItem, diagnostics?: OcrDiagnosticCollector): Promise<OcrCropResult> {
    const task = this.queue.then(() => this.executeRecognizeCrop(crop, diagnostics));
    this.queue = task.catch(() => undefined);
    return task as Promise<OcrCropResult>;
  }

  /**
   * Recognizes a batch of cropped dialogue regions through the serialized task queue.
   */
  public recognizeBatch(
    crops: OcrCropItem[],
    onProgress?: (current: number, total: number) => void,
    diagnostics?: OcrDiagnosticCollector
  ): Promise<OcrCropResult[]> {
    const task = this.queue.then(async () => {
      const results: OcrCropResult[] = [];
      for (let i = 0; i < crops.length; i++) {
        const crop = crops[i];
        try {
          const res = await this.executeRecognizeCrop(crop, diagnostics);
          if (res.error || (res.text && /[\u3040-\u30ff\u3400-\u9fff]/u.test(res.text)) || res.lines.length) {
            results.push(res);
          }
        } catch (err) {
          console.warn(`[Hakkutsu OCR] Batch crop ${crop.id} error:`, err);
        }
        onProgress?.(i + 1, crops.length);
      }
      return results;
    });
    this.queue = task.catch(() => undefined);
    return task as Promise<OcrCropResult[]>;
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
