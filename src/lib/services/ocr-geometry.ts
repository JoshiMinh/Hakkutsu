import type { OcrCropItem, OcrFragment } from "./ocr-engine";
import type { OcrDiagnosticCollector } from "./ocr-diagnostics";

export type Bounds = OcrFragment["bbox"];
export type ImageMapping = {
  // The source canvas represents this normalized portion of the displayed image.
  x: number; y: number; width: number; height: number;
  canvasWidth: number; canvasHeight: number;
};

export function canvasToImage(b: Bounds, m: ImageMapping) {
  return {
    x: m.x + b.x0 / m.canvasWidth * m.width,
    y: m.y + b.y0 / m.canvasHeight * m.height,
    width: (b.x1 - b.x0) / m.canvasWidth * m.width,
    height: (b.y1 - b.y0) / m.canvasHeight * m.height,
  };
}

export function imageToCanvas(b: Bounds, m: ImageMapping): Bounds | null {
  const x0 = Math.max(0, Math.floor((b.x0 - m.x) / m.width * m.canvasWidth));
  const y0 = Math.max(0, Math.floor((b.y0 - m.y) / m.height * m.canvasHeight));
  const x1 = Math.min(m.canvasWidth, Math.ceil((b.x1 - m.x) / m.width * m.canvasWidth));
  const y1 = Math.min(m.canvasHeight, Math.ceil((b.y1 - m.y) / m.height * m.canvasHeight));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/** Transform supported evidence together with its enclosing fragment. Raw
 * recognition bounds deliberately stay in recognition coordinates. */
export function transformOcrFragment(fragment: OcrFragment, transform: (bounds: Bounds) => Bounds): OcrFragment {
  return { ...fragment, bbox: transform(fragment.bbox), evidence: fragment.evidence && { ...fragment.evidence,
    words: fragment.evidence.words.map(word => ({ ...word, bbox: transform(word.bbox) })),
    glyphs: fragment.evidence.glyphs.map(glyph => ({ ...glyph, bbox: transform(glyph.bbox) })),
  } };
}

export function mapCropFragments(lines: OcrFragment[], crop: OcrCropItem, diagnostics?: OcrDiagnosticCollector): OcrFragment[] {
  const { originX, originY, scale, padding } = crop.transform || {
    originX: crop.bbox.x0, originY: crop.bbox.y0, scale: 1, padding: 0,
  };
  const transform = (b: Bounds) => ({ x0: originX + (b.x0 - padding) / scale, y0: originY + (b.y0 - padding) / scale,
    x1: originX + (b.x1 - padding) / scale, y1: originY + (b.y1 - padding) / scale });
  return lines.flatMap(line => {
    const original = transform(line.bbox);
    const bbox = {
      x0: Math.max(crop.bbox.x0, original.x0), y0: Math.max(crop.bbox.y0, original.y0),
      x1: Math.min(crop.bbox.x1, original.x1), y1: Math.min(crop.bbox.y1, original.y1),
    };
    // Guesses mainly in the added border must not turn into tiny text slivers.
    const retained = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0) /
      ((original.x1 - original.x0) * (original.y1 - original.y0));
    if (!(bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0 && retained >= .8)) {
      diagnostics?.({ stage: "mapping", reason: "crop-padding-or-clipping", fragment: line, details: { cropId: crop.id, original, retained } });
      return [];
    }
    const mapped = { ...transformOcrFragment(line, transform), bbox,
      lineId: `${crop.id}:${line.lineId}`, paragraphId: `${crop.id}:${line.paragraphId}`,
    };
    diagnostics?.({ stage: "mapping", reason: "mapped-to-source", fragment: mapped, details: { cropId: crop.id, transform: crop.transform } });
    return [mapped];
  });
}

export function overlapFraction(a: Bounds, b: Bounds): number {
  const area = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return area / Math.max(1e-9, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)));
}

/** Split only when the recognizer supplied a complete, non-overlapping reading.
 * Vertical Tesseract words often repeat entire column bounds; those are not
 * character positions and cannot be used to splice a partial transcription. */
export function splitOcrFragment(fragment: OcrFragment): OcrFragment[] {
  for (const units of [fragment.evidence?.glyphs, fragment.evidence?.words]) {
    if (!units || units.length < 2 || units.map(unit => unit.text.trim()).join("") !== fragment.text.trim()) continue;
    if (units.some((unit, i) => !Object.values(unit.bbox).every(Number.isFinite) || unit.bbox.x1 <= unit.bbox.x0 || unit.bbox.y1 <= unit.bbox.y0 ||
      unit.bbox.x0 < fragment.bbox.x0 || unit.bbox.y0 < fragment.bbox.y0 || unit.bbox.x1 > fragment.bbox.x1 || unit.bbox.y1 > fragment.bbox.y1 ||
      (unit.confidence ?? fragment.confidence ?? 0) < 20 ||
      (() => {
        const count = [...unit.text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
        const across = fragment.orientation === "vertical" ? unit.bbox.x1 - unit.bbox.x0 : unit.bbox.y1 - unit.bbox.y0;
        const along = fragment.orientation === "vertical" ? unit.bbox.y1 - unit.bbox.y0 : unit.bbox.x1 - unit.bbox.x0;
        return count > 0 && along < across * count * .4;
      })() || units.slice(i + 1).some(other => overlapFraction(unit.bbox, other.bbox) > .2))) continue;
    return units.map((unit, i) => ({ ...fragment, ...unit, confidence: unit.confidence ?? fragment.confidence,
      lineId: fragment.lineId, evidence: fragment.evidence && { ...fragment.evidence, words: [unit], glyphs: [],
        rawBounds: fragment.evidence.rawBounds }, paragraphId: fragment.paragraphId }));
  }
  return [fragment];
}

/** Reconcile readings before passage assembly, rather than treating whitespace
 * inside a passage rectangle as already recognized text. */
export function mergeOcrFragments(primary: OcrFragment[], recovered: OcrFragment[], diagnostics?: OcrDiagnosticCollector): OcrFragment[] {
  const retained = primary.flatMap(splitOcrFragment);
  const protectedReadings = new Set(retained);
  const characterCount = (text: string) => [...text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
  for (const candidate of recovered.flatMap(splitOcrFragment)) {
    const matches = retained.filter(fragment => {
      const samePass = fragment.evidence && candidate.evidence && fragment.evidence.passId === candidate.evidence.passId;
      if (!protectedReadings.has(fragment) && samePass && fragment.text !== candidate.text) return false;
      // Legacy fragments without pass metadata still preserve words belonging
      // to this recovery batch. Their alternatives are resolved after grouping.
      if (!protectedReadings.has(fragment) && !fragment.evidence && !candidate.evidence && fragment.text !== candidate.text) return false;
      return overlapFraction(fragment.bbox, candidate.bbox) > .2;
    });
    if (!matches.length) {
      retained.push(candidate);
      diagnostics?.({ stage: "recovery", reason: "uncovered-text", fragment: candidate });
      continue;
    }
    const b = candidate.bbox;
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (characterCount(candidate.text) >= matches.reduce((sum, f) => sum + characterCount(f.text), 0) * .7 && matches.every(fragment => {
      const a = fragment.bbox;
      const otherArea = (a.x1 - a.x0) * (a.y1 - a.y0);
      return fragment.orientation === candidate.orientation && Math.max(area, otherArea) / Math.min(area, otherArea) < 1.8 &&
        (candidate.confidence || 0) >= (fragment.confidence || 0) + 5;
    })) {
      for (const fragment of matches) {
        const index = retained.indexOf(fragment);
        if (index >= 0) retained.splice(index, 1);
      }
      retained.push(candidate);
      protectedReadings.add(candidate);
      diagnostics?.({ stage: "recovery", reason: "replaced-competing-reading", fragment: candidate, details: { replaced: matches } });
    } else {
      diagnostics?.({ stage: "recovery", reason: "covered-or-broad-alternative", fragment: candidate, details: { retained: matches } });
    }
  }
  return retained;
}
