import type { SubtitleSegment } from "./types";

/** TextTrack APIs and DOM fallback readers allocate cues on every video frame. */
export function retainSubtitleCue(previous: SubtitleSegment | null, next: SubtitleSegment | null): SubtitleSegment | null {
  if (previous === next) return previous;
  if (previous && next && previous.text === next.text && previous.start === next.start &&
    previous.duration === next.duration && previous.words === next.words && previous.append === next.append) return previous;
  return next;
}
