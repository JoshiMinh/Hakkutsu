import type { OcrCropItem, OcrFragment } from "./ocr-engine";

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

export function mapCropFragments(lines: OcrFragment[], crop: OcrCropItem): OcrFragment[] {
  const { originX, originY, scale, padding } = crop.transform || {
    originX: crop.bbox.x0, originY: crop.bbox.y0, scale: 1, padding: 0,
  };
  return lines.flatMap(line => {
    const original = {
      x0: originX + (line.bbox.x0 - padding) / scale,
      y0: originY + (line.bbox.y0 - padding) / scale,
      x1: originX + (line.bbox.x1 - padding) / scale,
      y1: originY + (line.bbox.y1 - padding) / scale,
    };
    const bbox = {
      x0: Math.max(crop.bbox.x0, original.x0), y0: Math.max(crop.bbox.y0, original.y0),
      x1: Math.min(crop.bbox.x1, original.x1), y1: Math.min(crop.bbox.y1, original.y1),
    };
    // Guesses mainly in the added border must not turn into tiny text slivers.
    const retained = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0) /
      ((original.x1 - original.x0) * (original.y1 - original.y0));
    return bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0 && retained >= .8 ? [{ ...line, bbox,
      lineId: `${crop.id}:${line.lineId}`, paragraphId: `${crop.id}:${line.paragraphId}`,
    }] : [];
  });
}

export function overlapFraction(a: Bounds, b: Bounds): number {
  const area = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return area / Math.max(1e-9, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)));
}

/** Keep crop geometry, but allow a substantially more confident, similarly
 * bounded recovery fragment to correct it. Uncovered columns are always added. */
export function mergeOcrFragments(primary: OcrFragment[], recovered: OcrFragment[]): OcrFragment[] {
  const retained = [...primary];
  const additions: OcrFragment[] = [];
  const characterCount = (text: string) => [...text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
  for (const candidate of recovered) {
    // Words from the same Tesseract pass can legitimately share column/line
    // bounds. Compare only across passes, never against recovery additions.
    const matches = primary.filter(fragment => overlapFraction(fragment.bbox, candidate.bbox) > .5);
    if (!matches.length) { additions.push(candidate); continue; }
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
      additions.push(candidate);
    }
  }
  return [...retained, ...additions];
}
