import type { OcrFragment } from "./ocr-engine";
import { mergeOcrFragments, overlapFraction } from "./ocr-geometry";
import { groupOcrRegions, resolveOcrRegionOverlaps, validateOcrFragments, type OcrRegionOptions } from "./ocr-regions";

/** Shared by extension scans and the offline fixture runner. Both passes are
 * validated against original pixels before competing readings are reconciled. */
export function assembleOcrRegions(primary: OcrFragment[], recovered: OcrFragment[], options: OcrRegionOptions = {}) {
  const validatedCrop = validateOcrFragments(primary, options);
  const validatedPage = validateOcrFragments(recovered, options);
  const annotations = validatedCrop.flatMap(fragment => (fragment.evidence?.annotationBounds || []).map(bbox => ({ bbox, body: fragment.bbox })));
  const bodyReading = (fragment: OcrFragment) => {
    const b = fragment.bbox;
    const annotation = annotations.some(({ bbox, body }) => b.x1 - b.x0 < (body.x1 - body.x0) * .6 &&
      b.x0 >= bbox.x0 - 1 && b.y0 >= bbox.y0 - 1 && b.x1 <= bbox.x1 + 1 && b.y1 <= bbox.y1 + 1 && overlapFraction(b, bbox) >= .7);
    if (annotation) options.diagnostics?.({ stage: "validation", reason: "detected-reading-annotation", fragment });
    return !annotation;
  };
  const crop = validatedCrop.filter(bodyReading);
  const page = validatedPage.filter(bodyReading);
  const lines = new Map<string, OcrFragment[]>();
  for (const fragment of [...crop, ...page]) if (fragment.lineId && fragment.evidence) {
    const key = `${fragment.evidence.passId}:${fragment.lineId}`;
    lines.set(key, [...(lines.get(key) || []), fragment]);
  }
  const coherence = (members: OcrFragment[], orientation: OcrFragment["orientation"]) => {
    const count = Math.max(1, members.reduce((sum, fragment) => sum + [...fragment.text].filter(c => /[\u3040-\u30ff\u3400-\u9fff]/u.test(c)).length, 0));
    const width = Math.max(...members.map(f => f.bbox.x1)) - Math.min(...members.map(f => f.bbox.x0));
    const height = Math.max(...members.map(f => f.bbox.y1)) - Math.min(...members.map(f => f.bbox.y0));
    const across = orientation === "vertical" ? width : height, along = orientation === "vertical" ? height : width;
    return Math.min(1, along / (across * count * .6), across * count * 1.6 / along);
  };
  const score = (fragment: OcrFragment) => {
    const members = fragment.evidence && fragment.lineId ? lines.get(`${fragment.evidence.passId}:${fragment.lineId}`) : undefined;
    // Some horizontal word bounds span the entire line. A coherent line of
    // supported words must outrank a wrong-direction singleton on those pixels.
    return (fragment.confidence || 0) * Math.max(coherence([fragment], fragment.orientation),
      members ? coherence(members, fragment.orientation) : 0);
  };
  // A validated crop of one detected column has explicit reading direction.
  // Whole-bubble/page singletons can be more confident yet describe the same
  // pixels in horizontal rows, or cover only the last glyph of that column.
  const columnReading = (fragment: OcrFragment) => Boolean(fragment.evidence?.textColumn && coherence([fragment], fragment.orientation) >= .8);
  const rank = (a: OcrFragment, b: OcrFragment) => Number(columnReading(b)) - Number(columnReading(a)) || score(b) - score(a) ||
    (b.confidence || 0) - (a.confidence || 0) || a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0;
  crop.sort(rank);
  page.sort(rank);
  const fragments = mergeOcrFragments(mergeOcrFragments([], crop, options.diagnostics), page, options.diagnostics);
  return resolveOcrRegionOverlaps(groupOcrRegions(fragments, { ...options, validated: true }), options);
}

/** Empty output is not proof that the detector found no speech bubbles. */
export function classifyOcrFailure(detectedCount: number, recognizedText: boolean): "ocr_rejected_text" | "ocr_unreadable_text" | "ocr_no_text_hint" {
  return recognizedText ? "ocr_rejected_text" : detectedCount ? "ocr_unreadable_text" : "ocr_no_text_hint";
}
