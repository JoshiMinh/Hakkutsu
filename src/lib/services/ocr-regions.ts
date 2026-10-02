import type { OcrFragment } from "./ocr-engine";
import { findBubbleMembership } from "./ocr-bubbles";

type Bounds = OcrFragment["bbox"];
type Orientation = "vertical" | "horizontal";
export type OcrTextRegion = {
  text: string;
  orientation: Orientation;
  fragments: OcrFragment[];
  bbox: Bounds;
};
export type OcrRegionOptions = {
  // The image used for OCR, in the same pixel coordinates as fragment bounds.
  pixels?: { data: Uint8ClampedArray; width: number; height: number };
};

const union = (a: Bounds, b: Bounds): Bounds => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
});
const span = (b: Bounds, axis: "x" | "y") => axis === "x" ? b.x1 - b.x0 : b.y1 - b.y0;
const start = (b: Bounds, axis: "x" | "y") => axis === "x" ? b.x0 : b.y0;
const end = (b: Bounds, axis: "x" | "y") => axis === "x" ? b.x1 : b.y1;
const overlap = (a: Bounds, b: Bounds, axis: "x" | "y") => Math.max(0, Math.min(end(a, axis), end(b, axis)) - Math.max(start(a, axis), start(b, axis)));
const gap = (a: Bounds, b: Bounds, axis: "x" | "y") => Math.max(0, Math.max(start(a, axis), start(b, axis)) - Math.min(end(a, axis), end(b, axis)));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// A dark divider through the space between text boxes is evidence of a bubble
// outline or panel border. Inspect original OCR pixels, never screen coordinates.
function separated(a: Bounds, b: Bounds, axis: "x" | "y", pixels?: OcrRegionOptions["pixels"]): boolean {
  if (!pixels || gap(a, b, axis) < 2) return false;
  const other = axis === "x" ? "y" : "x";
  const from = Math.ceil(Math.min(end(a, axis), end(b, axis)) + 1);
  const to = Math.floor(Math.max(start(a, axis), start(b, axis)) - 1);
  const low = Math.max(0, Math.ceil(Math.max(start(a, other), start(b, other))));
  const high = Math.min((other === "x" ? pixels.width : pixels.height) - 1, Math.floor(Math.min(end(a, other), end(b, other))));
  if (high - low < 4) return false;
  const crossed = new Uint8Array(high - low + 1);
  for (let p = from; p <= to; p++) {
    let dark = 0;
    for (let q = low; q <= high; q++) {
      const x = axis === "x" ? p : q;
      const y = axis === "x" ? q : p;
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue;
      const i = (y * pixels.width + x) * 4;
      if (pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114 < 100) {
        dark++;
        crossed[q - low] = 1;
      }
    }
    if (dark / (high - low + 1) >= .6) return true;
  }
  // Curved bubble edges need not stay in one pixel column/row.
  return crossed.reduce((count, value) => count + value, 0) / crossed.length >= .8;
}

/** Group text geometrically; OCR paragraphs alone can span multiple speakers. */
export function groupOcrRegions(fragments: OcrFragment[], options: OcrRegionOptions = {}): OcrTextRegion[] {
  const valid = fragments.filter(({ text, bbox: b }) => text.trim() &&
    Object.values(b).every(Number.isFinite) && b.x1 > b.x0 && b.y1 > b.y0);
  const bubbles = findBubbleMembership(valid, options.pixels);
  const directionScores = new Map<number, { vertical: number; horizontal: number }>();
  for (const fragment of valid) {
    const bubble = bubbles.get(fragment);
    if (bubble === undefined) continue;
    const scores = directionScores.get(bubble) || { vertical: 0, horizontal: 0 };
    scores[fragment.orientation || "horizontal"] += [...fragment.text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c)).length;
    directionScores.set(bubble, scores);
  }
  const sameBubble = (a: OcrFragment[], b: OcrFragment[]) => a.some(x => b.some(y => bubbles.has(x) && bubbles.get(x) === bubbles.get(y)));
  const differentBubbles = (a: OcrFragment[], b: OcrFragment[]) => a.some(x => b.some(y => bubbles.has(x) && bubbles.has(y) && bubbles.get(x) !== bubbles.get(y)));
  const regions: OcrTextRegion[] = [];
  for (const orientation of ["vertical", "horizontal"] as const) {
    const along = orientation === "vertical" ? "y" : "x";
    const across = orientation === "vertical" ? "x" : "y";
    const candidates = valid.filter(f => {
      if ((f.orientation || "horizontal") !== orientation) return false;
      const bubble = bubbles.get(f);
      const scores = bubble === undefined ? undefined : directionScores.get(bubble);
      const other = orientation === "vertical" ? "horizontal" : "vertical";
      // A stray guess from the other OCR pass must not add a second box inside
      // an otherwise consistently vertical/horizontal speech bubble.
      return !scores || scores[other] < Math.max(3, scores[orientation] * 3);
    });
    const ordered = [...candidates].sort((a, b) => start(a.bbox, across) - start(b.bbox, across) || start(a.bbox, along) - start(b.bbox, along));
    const lines: OcrTextRegion[] = [];
    const annotations = new Map<OcrFragment, OcrFragment>();
    for (const fragment of ordered) {
      // Smaller reading annotations attach to the main text later, without
      // inserting their pronunciation into the recognized sentence.
      const size = span(fragment.bbox, across);
      const annotation = candidates.find(body => body !== fragment &&
        /[\u3400-\u9fff]/u.test(body.text) && /^[\u3040-\u30ff]+$/u.test(fragment.text) &&
        span(body.bbox, across) > size * 1.7 && overlap(body.bbox, fragment.bbox, along) > span(fragment.bbox, along) * .7 &&
        gap(body.bbox, fragment.bbox, across) < span(body.bbox, across) * .5 &&
        !separated(body.bbox, fragment.bbox, across, options.pixels));
      if (annotation) { annotations.set(fragment, annotation); continue; }
      const line = lines.find(line => {
        const typical = median(line.fragments.map(f => span(f.bbox, across)));
        if (differentBubbles(line.fragments, [fragment])) return false;
        return overlap(line.bbox, fragment.bbox, across) >= Math.min(typical, size) * .55 &&
          Math.max(typical, size) / Math.min(typical, size) <= 1.8 &&
          gap(line.bbox, fragment.bbox, along) <= Math.max(typical, size) * (sameBubble(line.fragments, [fragment]) ? 3 : 1.2) &&
          !separated(line.bbox, fragment.bbox, along, options.pixels);
      });
      if (line) { line.fragments.push(fragment); line.bbox = union(line.bbox, fragment.bbox); }
      else lines.push({ text: "", orientation, fragments: [fragment], bbox: { ...fragment.bbox } });
    }
    const groups: OcrTextRegion[][] = [];
    for (const line of lines) {
      const size = median(line.fragments.map(f => span(f.bbox, across)));
      const group = groups.find(group => group.some(neighbor => {
        const neighborSize = median(neighbor.fragments.map(f => span(f.bbox, across)));
        const sameParagraph = line.fragments.some(a => neighbor.fragments.some(b => a.paragraphId && a.paragraphId === b.paragraphId));
        if (differentBubbles(line.fragments, neighbor.fragments)) return false;
        if (sameBubble(line.fragments, neighbor.fragments)) return true;
        return Math.max(size, neighborSize) / Math.min(size, neighborSize) <= 1.6 &&
          gap(line.bbox, neighbor.bbox, across) <= Math.min(size, neighborSize) * (sameParagraph ? 1 : .8) &&
          overlap(line.bbox, neighbor.bbox, along) >= Math.min(span(line.bbox, along), span(neighbor.bbox, along)) * .4 &&
          !separated(line.bbox, neighbor.bbox, across, options.pixels);
      }));
      if (group) group.push(line); else groups.push([line]);
    }
    for (const group of groups) {
      group.sort((a, b) => orientation === "vertical" ? b.bbox.x0 - a.bbox.x0 : a.bbox.y0 - b.bbox.y0);
      const members = group.flatMap(line => line.fragments.sort((a, b) => start(a.bbox, along) - start(b.bbox, along)));
      const text = members.map(f => f.text.trim()).join("");
      if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) continue;
      // Tesseract confidently mistakes eyes, hair and screentones for single
      // kana/kanji. They must not become clickable boxes all over the artwork.
      const characterCount = [...text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c)).length;
      const bodyBounds = members.reduce((b, f) => union(b, f.bbox), members[0].bbox);
      if (options.pixels && ((characterCount < 2 && !members.some(f => bubbles.has(f))) ||
        (characterCount <= 3 && !members.some(f => bubbles.has(f)) &&
          Math.max(span(bodyBounds, "x"), span(bodyBounds, "y")) < Math.min(span(bodyBounds, "x"), span(bodyBounds, "y")) * 1.4))) continue;
      const withAnnotations = [...members, ...[...annotations].filter(([, body]) => members.includes(body)).map(([reading]) => reading)];
      regions.push({ text, orientation, fragments: withAnnotations, bbox: withAnnotations.reduce((b, f) => union(b, f.bbox), members[0].bbox) });
    }
  }
  return regions.sort((a, b) => a.bbox.y0 - b.bbox.y0 || b.bbox.x0 - a.bbox.x0);
}
