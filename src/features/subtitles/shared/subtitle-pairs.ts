import type { SubtitleSegment } from "./types";
import { cleanSubtitleText } from "./subtitle-parsers";

/** Align native translations with primary cue boundaries, including split target cues. */
export function pairSubtitleTracks(primary: SubtitleSegment[], secondary: SubtitleSegment[]): Map<SubtitleSegment, string> {
  const pairs = new Map<SubtitleSegment, string>();
  let first = 0;
  for (const cue of primary) {
    const end = cue.start + Math.max(0.1, cue.duration);
    while (first < secondary.length && secondary[first].start + Math.max(0.1, secondary[first].duration) <= cue.start) first++;
    const parts = new Set<string>();
    for (let i = first; i < secondary.length && secondary[i].start < end; i++) {
      if (secondary[i].start + Math.max(0.1, secondary[i].duration) <= cue.start) continue;
      const text = cleanSubtitleText(secondary[i].text);
      if (text) parts.add(text);
    }
    pairs.set(cue, [...parts].join(" "));
  }
  return pairs;
}
