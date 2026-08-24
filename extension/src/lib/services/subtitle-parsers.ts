/**
 * Subtitle file and cue parsers (SRT, WebVTT, ASS/SSA, HTML5 TextTrack).
 * Inspired by asbplayer's subtitle parsing architecture.
 */

import type { SubtitleSegment, SubtitleFetchResult } from "~lib/types";

// ── Time Converters ──────────────────────────────────────────────────────────

/** Parse SRT/VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm or HH:MM:SS,mmm) into seconds */
export function parseTimestamp(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(",", ".");
  const parts = cleaned.split(":");
  
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(cleaned) || 0;
}

/** Parse ASS/SSA timestamp (H:MM:SS.cc) into seconds */
export function parseAssTimestamp(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(":");
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return parseFloat(timeStr) || 0;
}

/** Clean HTML and styling tags from subtitle text */
export function cleanSubtitleText(text: string): string {
  if (!text) return "";
  return text
    // Replace ASS line breaks \N or \n
    .replace(/\\N/gi, " ")
    .replace(/\\n/gi, " ")
    .replace(/\\h/gi, " ")
    // Remove ASS style overrides like {\pos(100,200)}, {\k50}, {\b1}, etc.
    .replace(/\{[^}]*\}/g, "")
    // Remove HTML tags <i>, <b>, <font>, <ruby>, <rt>
    .replace(/<rt>[^<]*<\/rt>/gi, "") // remove ruby pronunciation if present in raw markup
    .replace(/<\/?[^>]+(>|$)/g, "")
    // Normalize extra whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ── SRT Parser ───────────────────────────────────────────────────────────────

export function parseSrt(srtContent: string): SubtitleSegment[] {
  const normalized = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const segments: SubtitleSegment[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    // Find the timestamp line (e.g. 00:00:20,000 --> 00:00:24,400)
    let timeIndex = 0;
    if (/^\d+$/.test(lines[0].trim()) && lines.length > 1 && lines[1].includes("-->")) {
      timeIndex = 1;
    } else if (!lines[0].includes("-->")) {
      continue;
    }

    const timeLine = lines[timeIndex];
    const match = timeLine.match(/([\d:,.]+)\s*-->\s*([\d:,.]+)/);
    if (!match) continue;

    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    const duration = Math.max(0.1, end - start);

    const rawText = lines.slice(timeIndex + 1).join(" ");
    const text = cleanSubtitleText(rawText);

    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

// ── WebVTT Parser ────────────────────────────────────────────────────────────

export function parseVtt(vttContent: string): SubtitleSegment[] {
  const normalized = vttContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const segments: SubtitleSegment[] = [];

  let i = 0;
  // Skip WEBVTT header
  while (i < lines.length && !lines[i].includes("-->")) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes("-->")) {
      const match = line.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
      if (match) {
        const start = parseTimestamp(match[1]);
        const end = parseTimestamp(match[2]);
        const duration = Math.max(0.1, end - start);

        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("-->")) {
          // If the next line is a cue ID (numeric or identifier right before a timestamp)
          if (i + 1 < lines.length && lines[i + 1].includes("-->")) {
            break;
          }
          textLines.push(lines[i]);
          i++;
        }

        const text = cleanSubtitleText(textLines.join(" "));
        if (text) {
          segments.push({ text, start, duration });
        }
        continue;
      }
    }
    i++;
  }

  return segments.sort((a, b) => a.start - b.start);
}

// ── ASS / SSA Parser ─────────────────────────────────────────────────────────

export function parseAss(assContent: string): SubtitleSegment[] {
  const normalized = assContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const segments: SubtitleSegment[] = [];

  let inEvents = false;
  let formatFields: string[] = [];
  let startIndex = 1;
  let endIndex = 2;
  let textIndex = 9;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";")) continue;

    if (trimmed.startsWith("[Events]")) {
      inEvents = true;
      continue;
    } else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inEvents = false;
      continue;
    }

    if (inEvents) {
      if (trimmed.startsWith("Format:")) {
        formatFields = trimmed
          .substring(7)
          .split(",")
          .map((f) => f.trim().toLowerCase());
        startIndex = formatFields.indexOf("start");
        endIndex = formatFields.indexOf("end");
        textIndex = formatFields.indexOf("text");
        if (startIndex === -1) startIndex = 1;
        if (endIndex === -1) endIndex = 2;
        if (textIndex === -1) textIndex = 9;
      } else if (trimmed.startsWith("Dialogue:")) {
        const parts = trimmed.substring(9).split(",");
        if (parts.length >= formatFields.length && formatFields.length > 0) {
          const startStr = parts[startIndex]?.trim() || "";
          const endStr = parts[endIndex]?.trim() || "";
          // Text might contain commas, so slice from textIndex to end
          const rawText = parts.slice(textIndex).join(",");

          const start = parseAssTimestamp(startStr);
          const end = parseAssTimestamp(endStr);
          const duration = Math.max(0.1, end - start);
          const text = cleanSubtitleText(rawText);

          if (text) {
            segments.push({ text, start, duration });
          }
        }
      }
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

// ── HTML5 TextTrack Parser ───────────────────────────────────────────────────

export function parseTextTrack(track: TextTrack): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  if (!track.cues) return segments;

  for (let i = 0; i < track.cues.length; i++) {
    const cue = track.cues[i] as VTTCue | TextTrackCue;
    if (!cue) continue;

    const start = cue.startTime;
    const duration = Math.max(0.1, cue.endTime - cue.startTime);
    const rawText = "text" in cue ? (cue as VTTCue).text : "";
    const text = cleanSubtitleText(rawText);

    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

// ── Universal Subtitle File Loader ──────────────────────────────────────────

export interface ParsedSubtitleFile {
  fileName: string;
  format: "srt" | "vtt" | "ass" | "unknown";
  segments: SubtitleSegment[];
  fullText: string;
}

export function parseSubtitleContent(content: string, fileName: string = ""): ParsedSubtitleFile {
  const lowerName = fileName.toLowerCase();
  let format: "srt" | "vtt" | "ass" | "unknown" = "unknown";
  let segments: SubtitleSegment[] = [];

  if (lowerName.endsWith(".srt")) {
    format = "srt";
    segments = parseSrt(content);
  } else if (lowerName.endsWith(".vtt")) {
    format = "vtt";
    segments = parseVtt(content);
  } else if (lowerName.endsWith(".ass") || lowerName.endsWith(".ssa")) {
    format = "ass";
    segments = parseAss(content);
  } else {
    // Auto-detect based on content
    if (content.includes("[Events]") && content.includes("Dialogue:")) {
      format = "ass";
      segments = parseAss(content);
    } else if (content.startsWith("WEBVTT") || content.includes("-->")) {
      format = "vtt";
      segments = parseVtt(content);
    } else {
      format = "srt";
      segments = parseSrt(content);
    }
  }

  const fullText = segments.map((s) => s.text).join(" ");
  return {
    fileName,
    format,
    segments,
    fullText,
  };
}

export async function readSubtitleFile(file: File): Promise<ParsedSubtitleFile> {
  const content = await file.text();
  return parseSubtitleContent(content, file.name);
}

/** Convert parsed subtitle file into SubtitleFetchResult format */
export function parsedToSubtitleFetchResult(
  parsed: ParsedSubtitleFile,
  videoId: string = "local_file"
): SubtitleFetchResult {
  return {
    videoId,
    language: "ja", // Treated as target immersion track
    trackName: parsed.fileName || `Local ${parsed.format.toUpperCase()} file`,
    segments: parsed.segments,
    fullText: parsed.fullText,
    isAutoGenerated: false,
    source: "player",
  };
}
