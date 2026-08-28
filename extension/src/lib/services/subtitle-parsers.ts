/**
 * Subtitle file and cue parsers (YouTube srv3/json3, Netflix IMSC TTML, SRT, WebVTT, ASS/SSA, HTML5 TextTrack).
 * Inspired by ASBPlayer's subtitle parsing architecture.
 */

import type { SubtitleSegment, SubtitleFetchResult } from "~lib/types";

// ── Time Converters ──────────────────────────────────────────────────────────

/** Parse SRT/VTT/TTML timestamp (HH:MM:SS.mmm, MM:SS.mmm, or HH:MM:SS:frames) into seconds */
export function parseTimestamp(timeStr: string, frameRate: number = 24): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(",", ".");

  // Check if offset in seconds directly e.g. "12.34s" or "12.34"
  if (cleaned.endsWith("s")) {
    return parseFloat(cleaned.slice(0, -1)) || 0;
  }

  // Ticks format e.g. "1000t"
  if (cleaned.endsWith("t")) {
    return (parseFloat(cleaned.slice(0, -1)) || 0) / 1000;
  }

  const parts = cleaned.split(":");
  if (parts.length === 4) {
    // HH:MM:SS:FF (frames)
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    const frames = parseFloat(parts[3]) || 0;
    return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
  } else if (parts.length === 3) {
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

/** Clean HTML, ASS tags, and formatting codes from subtitle text */
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
    // Decode HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Normalize extra whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ── YouTube SRV3 (XML) & JSON3 Parsers ────────────────────────────────────────

/**
 * Parse YouTube's srv3 / XML timedtext format.
 * Structure: <timedtext format="3"><body><p t="1234" d="2500"><s>Hello</s></p></body></timedtext>
 * or legacy format: <transcript><text start="1.23" dur="2.5">Hello</text></transcript>
 */
export function parseYouTubeTimedTextXml(xmlContent: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  if (!xmlContent) return segments;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, "text/xml");

    // Check for srv3 / format 3 <p> tags
    const pElements = doc.querySelectorAll("p");
    if (pElements.length > 0) {
      pElements.forEach((p) => {
        const t = p.getAttribute("t");
        const d = p.getAttribute("d");
        if (t === null) return;

        const start = parseInt(t, 10) / 1000;
        const duration = d !== null ? Math.max(0.1, parseInt(d, 10) / 1000) : 2;

        // In srv3, <p> can have child <s> tags representing segments
        const sElements = p.querySelectorAll("s");
        let rawText = "";
        if (sElements.length > 0) {
          sElements.forEach((s) => {
            rawText += s.textContent || "";
          });
        } else {
          rawText = p.textContent || "";
        }

        const text = cleanSubtitleText(rawText);
        if (text) {
          segments.push({ text, start, duration });
        }
      });
      return segments.sort((a, b) => a.start - b.start);
    }

    // Check for legacy <text start="..." dur="..."> tags
    const textElements = doc.querySelectorAll("text");
    if (textElements.length > 0) {
      textElements.forEach((el) => {
        const startAttr = el.getAttribute("start");
        const durAttr = el.getAttribute("dur");
        if (!startAttr) return;

        const start = parseFloat(startAttr) || 0;
        const duration = Math.max(0.1, parseFloat(durAttr || "2") || 2);
        const text = cleanSubtitleText(el.textContent || "");

        if (text) {
          segments.push({ text, start, duration });
        }
      });
      return segments.sort((a, b) => a.start - b.start);
    }
  } catch (err) {
    console.warn("Failed to parse YouTube TimedText XML with DOMParser:", err);
  }

  // Regex fallback if DOMParser fails
  const pRegex = /<p\s+[^>]*t="(\d+)"[^>]*(?:d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xmlContent)) !== null) {
    const start = parseInt(match[1], 10) / 1000;
    const duration = match[2] ? Math.max(0.1, parseInt(match[2], 10) / 1000) : 2;
    const text = cleanSubtitleText(match[3]);
    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

/**
 * Parse YouTube's json3 timedtext format.
 */
export function parseYouTubeJson3(jsonContent: string | object): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  try {
    const data = typeof jsonContent === "string" ? JSON.parse(jsonContent) : jsonContent;
    const events = data?.events;
    if (!Array.isArray(events)) return segments;

    for (const ev of events) {
      if (typeof ev.tStartMs !== "number") continue;
      const start = ev.tStartMs / 1000;
      const duration = Math.max(0.1, (ev.dDurationMs || 2000) / 1000);

      let text = "";
      if (Array.isArray(ev.segs)) {
        text = ev.segs.map((s: any) => s.utf8 || "").join("");
      } else if (ev.segs) {
        text = String(ev.segs);
      }

      const cleaned = cleanSubtitleText(text);
      if (cleaned) {
        segments.push({ text: cleaned, start, duration });
      }
    }
  } catch (err) {
    console.warn("Failed to parse YouTube JSON3 subtitles:", err);
  }

  return segments.sort((a, b) => a.start - b.start);
}

// ── Netflix IMSC 1.1 TTML (XML) Parser ───────────────────────────────────────

/**
 * Parse Netflix's IMSC 1.1 TTML (Timed Text Markup Language) XML format.
 * Structure: <tt><body><div><p begin="00:01:23.456" end="00:01:25.789"><span>Text</span></p></div></body></tt>
 */
export function parseNetflixTtml(ttmlContent: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  if (!ttmlContent) return segments;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlContent, "text/xml");
    const pElements = doc.querySelectorAll("p");

    pElements.forEach((p) => {
      const beginAttr = p.getAttribute("begin");
      const endAttr = p.getAttribute("end");
      const durAttr = p.getAttribute("dur");

      if (!beginAttr) return;

      const start = parseTimestamp(beginAttr);
      let duration = 2;

      if (endAttr) {
        const end = parseTimestamp(endAttr);
        duration = Math.max(0.1, end - start);
      } else if (durAttr) {
        duration = Math.max(0.1, parseTimestamp(durAttr));
      }

      // Extract all text inside <p>, replacing <br> with space
      let rawText = "";
      p.childNodes.forEach((node) => {
        if (node.nodeName.toLowerCase() === "br") {
          rawText += " ";
        } else {
          rawText += node.textContent || "";
        }
      });

      const text = cleanSubtitleText(rawText);
      if (text) {
        segments.push({ text, start, duration });
      }
    });

    if (segments.length > 0) {
      return segments.sort((a, b) => a.start - b.start);
    }
  } catch (err) {
    console.warn("Failed to parse Netflix TTML with DOMParser:", err);
  }

  // Regex fallback for TTML
  const pRegex = /<p\s+[^>]*begin="([^"]+)"[^>]*(?:end="([^"]+)")?[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(ttmlContent)) !== null) {
    const start = parseTimestamp(match[1]);
    let duration = 2;
    if (match[2]) {
      duration = Math.max(0.1, parseTimestamp(match[2]) - start);
    }
    const text = cleanSubtitleText(match[3]);
    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

// ── SRT Parser ───────────────────────────────────────────────────────────────

export function parseSrt(srtContent: string): SubtitleSegment[] {
  const normalized = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const segments: SubtitleSegment[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

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

// ── Universal Subtitle Content Detector & Loader ─────────────────────────────

export interface ParsedSubtitleFile {
  fileName: string;
  format: "srv3" | "ttml" | "json3" | "srt" | "vtt" | "ass" | "unknown";
  segments: SubtitleSegment[];
  fullText: string;
}

export function parseSubtitleContent(content: string, fileName: string = ""): ParsedSubtitleFile {
  const lowerName = fileName.toLowerCase();
  let format: ParsedSubtitleFile["format"] = "unknown";
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
  } else if (lowerName.endsWith(".xml") || lowerName.endsWith(".ttml")) {
    if (content.includes("<tt ") || content.includes("<tt>") || content.includes("http://www.w3.org/ns/ttml")) {
      format = "ttml";
      segments = parseNetflixTtml(content);
    } else {
      format = "srv3";
      segments = parseYouTubeTimedTextXml(content);
    }
  } else {
    // Content sniffing
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"events"')) {
      format = "json3";
      segments = parseYouTubeJson3(content);
    } else if (trimmed.includes("<timedtext") || (trimmed.includes("<transcript>") && trimmed.includes("<text"))) {
      format = "srv3";
      segments = parseYouTubeTimedTextXml(content);
    } else if (trimmed.includes("<tt") && (trimmed.includes("ttp:") || trimmed.includes("ttml"))) {
      format = "ttml";
      segments = parseNetflixTtml(content);
    } else if (trimmed.includes("[Events]") && trimmed.includes("Dialogue:")) {
      format = "ass";
      segments = parseAss(content);
    } else if (trimmed.startsWith("WEBVTT") || trimmed.includes("-->")) {
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
    language: "ja",
    trackName: parsed.fileName || `Local ${parsed.format.toUpperCase()} file`,
    segments: parsed.segments,
    fullText: parsed.fullText,
    isAutoGenerated: false,
    source: "player",
  };
}
