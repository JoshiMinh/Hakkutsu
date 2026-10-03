import type { OcrFragment } from "./ocr-engine";
import { findBubbleMembership, findTextInkSupport } from "./ocr-bubbles";

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
  manual?: boolean;
  automatic?: boolean;
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
export function separated(a: Bounds, b: Bounds, axis: "x" | "y", pixels?: OcrRegionOptions["pixels"]): boolean {
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
  let valid = fragments.filter(({ text, bbox: b }) => text.trim() &&
    Object.values(b).every(Number.isFinite) && b.x1 > b.x0 && b.y1 > b.y0);
  // Estimate body size from plausible text only; dense artwork guesses must
  // not raise the minimum size and hide the page's real dialogue.
  const bodySizes = valid.filter(f => {
    const count = [...f.text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
    const across = f.orientation === "vertical" ? "x" : "y";
    const along = f.orientation === "vertical" ? "y" : "x";
    return count >= 2 && span(f.bbox, along) >= span(f.bbox, across) * count * .4;
  }).map(f => span(f.bbox, f.orientation === "vertical" ? "x" : "y")).sort((a, b) => a - b);
  const referenceSize = bodySizes.length ? bodySizes[Math.floor((bodySizes.length - 1) / 2)] : 0;
  const minimumBodySize = Math.max(6, referenceSize * .6);
  if (options.automatic && options.pixels) {
    const support = findTextInkSupport(valid, options.pixels, referenceSize || 12);
    valid = valid.filter(f => {
      const japanese = [...f.text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c)).length;
      const latin = [...f.text].filter(c => /[A-Za-z]/u.test(c)).length;
      // Keep supported low-confidence columns for the region-level decision.
      // Mixed Latin noise must not hitchhike on nearby Japanese dialogue.
      return (support.get(f) || 0) >= .6 && (!japanese || japanese / (japanese + latin) >= .6);
    });
  }
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
      const supplement = /^[\p{N}\p{P}\p{S}A-Za-z]+$/u.test(fragment.text);
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
          Math.max(typical, size) / Math.min(typical, size) <= (supplement ? 4 : 1.8) &&
          gap(line.bbox, fragment.bbox, along) <= Math.min(typical, size) * (sameBubble(line.fragments, [fragment]) ? 3 : 1.8) &&
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
          gap(line.bbox, neighbor.bbox, across) <= Math.min(size, neighborSize) * (sameParagraph ? 1.5 : 1.2) &&
          overlap(line.bbox, neighbor.bbox, along) >= Math.min(span(line.bbox, along), span(neighbor.bbox, along)) * .4 &&
          !separated(line.bbox, neighbor.bbox, across, options.pixels);
      }));
      if (group) group.push(line); else groups.push([line]);
    }
    for (const group of groups) {
      group.sort((a, b) => orientation === "vertical" ? b.bbox.x0 - a.bbox.x0 : a.bbox.y0 - b.bbox.y0);
      const members = group.flatMap(line => line.fragments.sort((a, b) => start(a.bbox, along) - start(b.bbox, along)));
      const text = normalizeRegionText(members.map(f => f.text.trim()).join(""), orientation);
      if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) continue;
      // Tesseract confidently mistakes eyes, hair and screentones for single
      // kana/kanji. They must not become clickable boxes all over the artwork.
      const characterCount = [...text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
      const bodyBounds = members.reduce((b, f) => union(b, f.bbox), members[0].bbox);
      if (!options.manual && options.pixels && ((characterCount < 2 && !members.some(f => bubbles.has(f))) ||
        (characterCount <= 3 && !members.some(f => bubbles.has(f)) &&
          Math.max(span(bodyBounds, "x"), span(bodyBounds, "y")) < Math.min(span(bodyBounds, "x"), span(bodyBounds, "y")) * 1.8))) continue;
      const confidence = members.reduce((sum, f) => sum + (f.confidence || 0) * [...f.text].length, 0) /
        Math.max(1, members.reduce((sum, f) => sum + [...f.text].length, 0));
      // A few plausible kana on windows/hair are weak evidence outside a
      // bubble. Require stronger recognition for short borderless candidates.
      if (options.automatic && options.pixels && characterCount <= 5 &&
        !members.some(f => bubbles.has(f)) && confidence < 65) continue;
      const latinCount = [...text].filter(c => /[A-Za-z]/u.test(c)).length;
      const typicalSize = median(members.map(f => span(f.bbox, across)));
      const implausibleFragment = members.some(f => {
        const count = [...f.text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
        return count >= 2 && span(f.bbox, along) < span(f.bbox, across) * count * .4;
      });
      if (options.automatic && (implausibleFragment || typicalSize < minimumBodySize || characterCount < 2 || confidence < 45 ||
        characterCount / Math.max(1, characterCount + latinCount) < .6 ||
        span(bodyBounds, along) > typicalSize * Math.max(2, characterCount) * 2.5)) continue;
      const withAnnotations = [...members, ...[...annotations].filter(([, body]) => members.includes(body)).map(([reading]) => reading)];
      regions.push({ text, orientation, fragments: withAnnotations, bbox: withAnnotations.reduce((b, f) => union(b, f.bbox), members[0].bbox) });
    }
  }
  return regions.sort((a, b) => a.bbox.y0 - b.bbox.y0 || b.bbox.x0 - a.bbox.x0);
}

/** Repair only isolated sound-mark confusions inside a vertical Katakana phrase.
 * Numeric runs and terminal numbers (レベル1, 第12回) remain intact. */
export function normalizeRegionText(text: string, orientation: Orientation): string {
  if (orientation !== "vertical") return text;
  return text.replace(/([\u30a1-\u30fa\u30fc])(?:[1lI]|ー)(?=[\u30a1-\u30fa])/g, "$1ー")
    .replace(/([\u30a1-\u30fa])ーー+(?=[\u30a1-\u30fa])/g, "$1ー");
}


const regionArea = (region: OcrTextRegion) => span(region.bbox, "x") * span(region.bbox, "y");
const bodyCount = (text: string) => [...text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c) && !/[ー・]/u.test(c)).length;
const regionConfidence = (region: OcrTextRegion) => region.fragments.reduce((sum, f) => sum + (f.confidence || 0) * Math.max(1, bodyCount(f.text)), 0) /
  Math.max(1, region.fragments.reduce((sum, f) => sum + Math.max(1, bodyCount(f.text)), 0));
const intersects = (a: OcrTextRegion, b: OcrTextRegion) => overlap(a.bbox, b.bbox, "x") > 0 && overlap(a.bbox, b.bbox, "y") > 0;

/** Recovery may replace a comparable complete reading, but must not insert
 * partial alternative readings inside an already accepted dialogue region. */
export function mergeOcrRegionPasses(primary: OcrTextRegion[], recovered: OcrTextRegion[]): OcrTextRegion[] {
  const accepted = [...primary];
  const additions: OcrTextRegion[] = [];
  for (const candidate of recovered) {
    const matches = primary.filter(region => intersects(region, candidate));
    if (!matches.length) { additions.push(candidate); continue; }
    if (matches.length !== 1) continue;
    const previous = matches[0];
    const ratio = regionArea(candidate) / regionArea(previous);
    if (candidate.orientation === previous.orientation && ratio > .67 && ratio < 1.5 &&
      bodyCount(candidate.text) >= bodyCount(previous.text) * .8 && regionConfidence(candidate) >= regionConfidence(previous) + 5) {
      const index = accepted.indexOf(previous);
      if (index >= 0) accepted.splice(index, 1);
      additions.push(candidate);
    }
  }
  return [...accepted, ...additions];
}

/** Resolve conflicts at the clickable-region level, after column assembly.
 * Fragment boxes may overlap within one phrase; distinct clickable boxes may not. */
export function resolveOcrRegionOverlaps(regions: OcrTextRegion[]): OcrTextRegion[] {
  const quality = (region: OcrTextRegion) => {
    const count = bodyCount(region.text);
    const latin = [...region.text].filter(c => /[A-Za-z]/u.test(c)).length;
    const across = region.orientation === "vertical" ? "x" : "y";
    const along = region.orientation === "vertical" ? "y" : "x";
    const size = region.fragments.length ? median(region.fragments.map(f =>
      Math.min(span(f.bbox, across), span(f.bbox, along) / Math.max(1, bodyCount(f.text))))) : 12;
    const density = Math.min(1, size * size * Math.max(1, count) / Math.max(1, regionArea(region)));
    return regionConfidence(region) * count / Math.max(1, count + latin) * Math.sqrt(density) * (1 + Math.log1p(count) * .1);
  };
  const accepted: OcrTextRegion[] = [];
  for (const candidate of [...regions].sort((a, b) => quality(b) - quality(a) || regionArea(a) - regionArea(b))) {
    if (!accepted.some(previous => intersects(previous, candidate))) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.bbox.y0 - b.bbox.y0 || b.bbox.x0 - a.bbox.x0);
}
