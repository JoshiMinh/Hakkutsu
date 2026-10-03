import type { OcrFragment } from "./ocr-engine";
import { mergeOcrFragments } from "./ocr-geometry";
import { groupOcrRegions, resolveOcrRegionOverlaps, validateOcrFragments, type OcrRegionOptions } from "./ocr-regions";

/** Shared by extension scans and the offline fixture runner. Both passes are
 * validated against original pixels before competing readings are reconciled. */
export function assembleOcrRegions(primary: OcrFragment[], recovered: OcrFragment[], options: OcrRegionOptions = {}) {
  const crop = validateOcrFragments(primary, options);
  const page = validateOcrFragments(recovered, options);
  const lines = new Map<string, OcrFragment[]>();
  for (const fragment of page) if (fragment.lineId && fragment.evidence) {
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
  page.sort((a, b) => score(b) - score(a) ||
    (b.confidence || 0) - (a.confidence || 0) || a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const fragments = mergeOcrFragments(crop, page, options.diagnostics);
  return resolveOcrRegionOverlaps(groupOcrRegions(fragments, { ...options, validated: true }), options);
}
