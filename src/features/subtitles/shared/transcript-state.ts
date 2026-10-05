import type { SubtitleFetchResult } from "~/features/subtitles/shared/types";
import type { TranscriptSnapshot } from "~/features/subtitles/shared/transcript-panel";

function reuseTrack(previous?: SubtitleFetchResult | null, next?: SubtitleFetchResult | null) {
  if (!previous || !next || previous.language !== next.language || previous.trackName !== next.trackName ||
    previous.segments.length !== next.segments.length) return next;
  return next.segments.every((cue, index) => {
    const old = previous.segments[index];
    return old.start === cue.start && old.duration === cue.duration && old.text === cue.text;
  }) ? previous : next;
}

/** Structured messages clone tracks. Preserve equal tracks so status/cue updates
 * don't reset the reader's search, scroll position, or open lookup. */
export function mergeTranscriptSnapshot(previous: TranscriptSnapshot | null, next: TranscriptSnapshot): TranscriptSnapshot {
  if (previous?.sourceUrl !== next.sourceUrl) return next;
  return { ...next, subtitleData: reuseTrack(previous.subtitleData, next.subtitleData)!,
    secondaryData: reuseTrack(previous.secondaryData, next.secondaryData) };
}
