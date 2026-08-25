/**
 * YouTube subtitle extraction service.
 *
 * Extracts subtitle data from YouTube's internal player response.
 * Designed to run in the background service worker where CORS
 * restrictions don't apply due to host_permissions.
 *
 * Strategy:
 * 1. Fetch the YouTube watch page HTML
 * 2. Extract `ytInitialPlayerResponse` from the page source
 * 3. Parse caption tracks from the player response
 * 4. Fetch the selected track's subtitle data in JSON3, VTT, or XML format
 * 5. Parse into our SubtitleSegment[] format
 */

import type {
  CaptionTrack,
  SubtitleSegment,
  SubtitleFetchResult,
} from "~lib/types";

/** Extract video ID from various YouTube URL formats or raw ID */
function extractVideoId(url: string): string | null {
  const cleaned = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleaned)) {
    return cleaned;
  }

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/,
    /\/watch\/(?:[a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) return match[1];
  }

  // Fallback search anywhere in string
  const generalMatch = cleaned.match(/(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  if (generalMatch) {
    return generalMatch[1];
  }

  return null;
}

/** Extract a balanced JSON object starting at `{` from text */
function extractBalancedJson(text: string, startIndex: number): Record<string, unknown> | null {
  let openBraces = 0;
  let inString = false;
  let escape = false;
  let jsonStart = -1;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (jsonStart === -1) {
      if (char === "{") {
        jsonStart = i;
        openBraces = 1;
      }
      continue;
    }

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") {
        openBraces += 1;
      } else if (char === "}") {
        openBraces -= 1;
        if (openBraces === 0) {
          const candidate = text.substring(jsonStart, i + 1);
          try {
            return JSON.parse(candidate);
          } catch (e) {
            console.warn("Hakkutsu: Failed to parse balanced JSON candidate", e);
            return null;
          }
        }
      }
    }
  }

  return null;
}

/** Parse ytInitialPlayerResponse from YouTube page HTML */
function parsePlayerResponse(html: string): Record<string, unknown> | null {
  const markers = [
    "ytInitialPlayerResponse = ",
    'window["ytInitialPlayerResponse"] = ',
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse=",
    '{"playerResponse":',
  ];

  for (const marker of markers) {
    const startIdx = html.indexOf(marker);
    if (startIdx !== -1) {
      const parsed = extractBalancedJson(html, startIdx + marker.length - 1);
      if (parsed) {
        if ("playerResponse" in parsed && typeof parsed.playerResponse === "object" && parsed.playerResponse !== null) {
          return parsed.playerResponse as Record<string, unknown>;
        }
        return parsed;
      }
    }
  }

  // Fallback: search for captionTracks JSON array directly if full playerResponse wasn't found
  const captionMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/);
  if (captionMatch) {
    try {
      const tracks = JSON.parse(captionMatch[1]);
      return {
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: tracks,
          },
        },
      };
    } catch {
      // Ignore
    }
  }

  return null;
}

/** Normalize baseUrl so it's always an absolute HTTPS URL */
function normalizeTrackBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (!trimmed.startsWith("http")) {
    return `https://www.youtube.com${trimmed}`;
  }
  return trimmed;
}

function captionTrackName(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const text = value as {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
  return text.simpleText || text.runs?.map((run) => run.text || "").join("") || "";
}

/** Extract caption tracks from the player response */
function extractCaptionTracks(
  playerResponse: Record<string, unknown>
): CaptionTrack[] {
  const rawCaptions = (playerResponse as Record<string, any>)?.captions;
  const renderer =
    rawCaptions?.playerCaptionsTracklistRenderer ||
    rawCaptions?.playerCaptionsRenderer ||
    (playerResponse as Record<string, any>)?.playerCaptionsTracklistRenderer;

  let captionTracks: any[] = [];
  if (Array.isArray(renderer?.captionTracks)) {
    captionTracks = renderer.captionTracks;
  } else if (Array.isArray(rawCaptions?.captionTracks)) {
    captionTracks = rawCaptions.captionTracks;
  } else if (Array.isArray((playerResponse as any)?.captionTracks)) {
    captionTracks = (playerResponse as any).captionTracks;
  }

  return captionTracks.map(
    (track: Record<string, unknown>): CaptionTrack => {
      const baseUrl = normalizeTrackBaseUrl(
        (track.baseUrl as string) || (track.url as string) || ""
      );
      const vssId = String(track.vssId || "");
      const kind = String(track.kind || "");
      const isAuto = kind === "asr" || vssId.startsWith("a.") || vssId.startsWith("a:");
      const rawLang = String(track.languageCode || "");
      const langCode = (
        rawLang ||
        vssId.replace(/^\.?[a-z0-9_-]*\./i, "").replace(/^\./, "")
      ).toLowerCase();

      return {
        baseUrl,
        languageCode: langCode,
        name: captionTrackName(
          track.name || track.displayName || track.languageName || track.languageCode
        ),
        kind,
        isAutoGenerated: isAuto,
      };
    }
  );
}

/** Check if track is a Japanese caption track */
function isJapaneseTrack(track: CaptionTrack): boolean {
  const code = (track.languageCode || "").toLowerCase().replace(/^\./, "").replace(/^a\./, "");
  const name = (typeof track.name === "string" ? track.name : "").toLowerCase();
  return (
    code === "ja" ||
    code === "ja-jp" ||
    code.startsWith("ja") ||
    code === "jpn" ||
    name.includes("japanese") ||
    name.includes("japan") ||
    name.includes("日本語") ||
    name.includes("にほんご")
  );
}

/**
 * Find the best caption track from available tracks.
 * Prioritizes native Japanese tracks (manual then auto), then auto-translation to Japanese.
 */
function findCaptionTrack(
  tracks: CaptionTrack[],
  language: string = "ja"
): CaptionTrack | null {
  if (tracks.length === 0) return null;

  const normalizedLanguage = language.trim().toLowerCase();
  const wantsJapanese =
    normalizedLanguage === "ja" ||
    normalizedLanguage === "auto" ||
    normalizedLanguage === "*";

  if (wantsJapanese) {
    // 1. Manual Japanese track
    const jaManual = tracks.find((t) => isJapaneseTrack(t) && !t.isAutoGenerated);
    if (jaManual) return jaManual;

    // 2. Auto-generated Japanese track
    const jaAuto = tracks.find((t) => isJapaneseTrack(t) && t.isAutoGenerated);
    if (jaAuto) return jaAuto;

    // 3. Any Japanese matching track
    const jaAny = tracks.find((t) => isJapaneseTrack(t));
    if (jaAny) return jaAny;

    // 4. Fallback: synthesize auto-translated Japanese track from an available track
    const baseTrack = tracks.find((t) => !t.isAutoGenerated) || tracks[0];
    if (baseTrack && baseTrack.baseUrl) {
      const sep = baseTrack.baseUrl.includes("?") ? "&" : "?";
      return {
        baseUrl: `${baseTrack.baseUrl}${sep}tlang=ja`,
        languageCode: "ja",
        name: `${baseTrack.name || "Auto"} (Auto-translated to Japanese)`,
        kind: "asr",
        isAutoGenerated: true,
      };
    }
  } else {
    // Explicit other language requested
    const matchesLanguage = (track: CaptionTrack, lang: string) => {
      const code = track.languageCode.toLowerCase();
      return code === lang || code.startsWith(`${lang}-`) || code.startsWith(`${lang}_`);
    };

    const manual = tracks.find((t) => matchesLanguage(t, normalizedLanguage) && !t.isAutoGenerated);
    if (manual) return manual;

    const auto = tracks.find((t) => matchesLanguage(t, normalizedLanguage) && t.isAutoGenerated);
    if (auto) return auto;

    // Synthesize auto-translation to requested language
    const baseTrack = tracks.find((t) => !t.isAutoGenerated) || tracks[0];
    if (baseTrack && baseTrack.baseUrl) {
      const sep = baseTrack.baseUrl.includes("?") ? "&" : "?";
      return {
        baseUrl: `${baseTrack.baseUrl}${sep}tlang=${normalizedLanguage}`,
        languageCode: normalizedLanguage,
        name: `${baseTrack.name || "Auto"} (Auto-translated)`,
        kind: "asr",
        isAutoGenerated: true,
      };
    }
  }

  return tracks.find((track) => !track.isAutoGenerated) ?? tracks[0] ?? null;
}

function playerResponseVideoId(
  playerResponse: Record<string, unknown>
): string | null {
  const videoDetails = playerResponse.videoDetails as
    | { videoId?: unknown }
    | undefined;
  return typeof videoDetails?.videoId === "string"
    ? videoDetails.videoId
    : null;
}

function decodeCaptionText(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
    nbsp: " ",
  };
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (match, name) => entities[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

/** Represents a single event in YouTube's JSON3 subtitle format */
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number | boolean;
  segs?: Array<{
    utf8?: string;
    tOffsetMs?: number;
    acAsrConf?: number;
  }>;
}

/** Parse YouTube JSON3 subtitle format into SubtitleSegment[] */
function parseJson3Subtitles(json3Data: Record<string, unknown>): SubtitleSegment[] {
  const events = (json3Data as { events?: Json3Event[] }).events;
  if (!Array.isArray(events)) return [];

  const segments: SubtitleSegment[] = [];

  for (const event of events) {
    if (!event.segs || event.tStartMs == null) continue;

    const text = event.segs
      .map((seg) => seg.utf8 || "")
      .join("")
      .replace(/\n/g, " ")
      .trim();

    if (!text) continue;

    const eventStart = event.tStartMs / 1000;
    const eventDuration = (event.dDurationMs || 0) / 1000;
    const words = event.segs
      .map((seg, index) => {
        const wordText = (seg.utf8 || "").replace(/\n/g, " ");
        if (!wordText.trim()) return null;
        const offsetMs = Math.max(0, Number(seg.tOffsetMs) || 0);
        const nextOffsetMs = Math.max(
          offsetMs,
          Number(event.segs?.[index + 1]?.tOffsetMs) || event.dDurationMs || 0
        );
        return {
          text: wordText.trim(),
          start: eventStart + offsetMs / 1000,
          duration: Math.max(0, nextOffsetMs - offsetMs) / 1000,
        };
      })
      .filter((word): word is NonNullable<typeof word> => word !== null);

    segments.push({
      text,
      start: eventStart,
      duration: eventDuration,
      words: words.length > 0 ? words : undefined,
      append: Boolean(event.aAppend),
    });
  }

  return segments;
}

/** Parse both YouTube XML format 1 (<text start dur>) and format 3 / srv3 (<p t d>) */
function parseXmlSubtitles(text: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];

  // Format 3 / srv3: <p t="milliseconds" d="milliseconds"><s>text</s></p>
  const pPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pPattern.exec(text))) {
    const attrs = pMatch[1];
    const tMatch = attrs.match(/\bt="(\d+)"/i);
    const dMatch = attrs.match(/\bd="(\d+)"/i);
    if (!tMatch) continue;

    const cueText = decodeCaptionText(pMatch[2]);
    if (!cueText) continue;

    segments.push({
      text: cueText,
      start: Number(tMatch[1]) / 1000.0,
      duration: dMatch ? Number(dMatch[1]) / 1000.0 : 0,
    });
  }
  if (segments.length > 0) return segments;

  // Format 1: <text start="seconds" dur="seconds">text</text>
  const cuePattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  while ((match = cuePattern.exec(text))) {
    const attributes = match[1];
    const startMatch = attributes.match(/\bstart="([^"]+)"/i);
    const durationMatch = attributes.match(/\bdur="([^"]+)"/i);
    if (!startMatch) continue;
    const cueText = decodeCaptionText(match[2]);
    if (!cueText) continue;
    segments.push({
      text: cueText,
      start: Number(startMatch[1]) || 0,
      duration: Number(durationMatch?.[1]) || 0,
    });
  }
  return segments;
}

function parseVttTimestamp(value: string): number | null {
  const clean = value.trim();
  const match = clean.match(/(?:(\d{1,2}):)?(\d{2}):(\d{2}(?:\.\d{1,3})?)/);
  if (!match) return null;

  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseVttSubtitles(text: string): SubtitleSegment[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const segments: SubtitleSegment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;

    const [rawStart, rawEndPart] = lines[timingIndex].split("-->", 2);
    const start = parseVttTimestamp(rawStart);
    // End timestamp is before any WebVTT settings (e.g. align:start)
    const endMatch = rawEndPart.trim().match(/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?/);
    const end = endMatch ? parseVttTimestamp(endMatch[0]) : null;

    const cueText = decodeCaptionText(lines.slice(timingIndex + 1).join(" "));
    if (start == null || end == null || !cueText) continue;
    segments.push({ text: cueText, start, duration: Math.max(0, end - start) });
  }
  return segments;
}

async function fetchTrackSegments(
  track: CaptionTrack,
  videoId: string
): Promise<SubtitleSegment[]> {
  if (!track.baseUrl) {
    throw new Error("The selected YouTube caption track has no URL.");
  }

  const baseUrl = new URL(track.baseUrl);
  const trackVideoId = baseUrl.searchParams.get("v");
  if (trackVideoId && trackVideoId !== videoId) {
    throw new Error(
      `YouTube player response is stale (track ${trackVideoId}, current video ${videoId}).`
    );
  }

  const attempts: Array<{
    format: "json3" | "srv3" | "vtt" | "xml";
    url: URL;
  }> = [];

  // 1. Attempt original URL as provided first (preserves server-signed format and parameters)
  attempts.push({ format: "json3", url: baseUrl });

  const json3Url = new URL(baseUrl);
  json3Url.searchParams.set("fmt", "json3");
  json3Url.searchParams.delete("callback");
  attempts.push({ format: "json3", url: json3Url });

  const srv3Url = new URL(baseUrl);
  srv3Url.searchParams.set("fmt", "srv3");
  srv3Url.searchParams.delete("callback");
  attempts.push({ format: "srv3", url: srv3Url });

  const vttUrl = new URL(baseUrl);
  vttUrl.searchParams.set("fmt", "vtt");
  vttUrl.searchParams.delete("callback");
  attempts.push({ format: "vtt", url: vttUrl });

  const xmlUrl = new URL(baseUrl);
  xmlUrl.searchParams.delete("fmt");
  xmlUrl.searchParams.delete("callback");
  attempts.push({ format: "xml", url: xmlUrl });

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url.toString(), {
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: `https://www.youtube.com/watch?v=${videoId}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        failures.push(`${attempt.format}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (!text.trim()) {
        failures.push(`${attempt.format}: empty`);
        continue;
      }
      const segments =
        attempt.format === "json3"
          ? parseJson3Subtitles(JSON.parse(text) as Record<string, unknown>)
          : attempt.format === "vtt"
            ? parseVttSubtitles(text)
            : parseXmlSubtitles(text);
      if (segments.length > 0) return segments;
      failures.push(`${attempt.format}: no cues`);
    } catch (error) {
      failures.push(
        `${attempt.format}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const isPoToken = baseUrl.searchParams.get("exp") === "xpe" || failures.every((f) => f.includes("empty"));
  if (isPoToken) {
    throw new Error(
      `YouTube PO token required for caption track "${track.languageCode}". Direct timedtext download blocked.`
    );
  }

  throw new Error(
    `Không thể đọc dữ liệu phụ đề cho track "${track.languageCode}" (${failures.join("; ")}).`
  );
}

export async function fetchSubtitlesFromPlayerResponse(
  playerResponse: Record<string, unknown>,
  videoId: string,
  language: string = "ja"
): Promise<SubtitleFetchResult> {
  const responseVideoId = playerResponseVideoId(playerResponse);
  if (responseVideoId && responseVideoId !== videoId) {
    throw new Error(
      `YouTube player response belongs to ${responseVideoId}, not the current video ${videoId}.`
    );
  }

  const tracks = extractCaptionTracks(playerResponse);
  if (tracks.length === 0) {
    throw new Error("No caption tracks found for this video.");
  }

  const track = findCaptionTrack(tracks, language);
  if (!track) {
    const availableLanguages = tracks
      .map((t) => t.languageCode)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ");
    throw new Error(
      `No ${language} subtitles found. Available: ${availableLanguages}`
    );
  }

  const segments = await fetchTrackSegments(track, videoId);
  const fullText = segments.map((s) => s.text).join(" ");

  return {
    videoId,
    language: track.languageCode,
    segments,
    fullText,
    trackName: track.name || track.languageCode,
    isAutoGenerated: track.isAutoGenerated,
    source: "player",
  };
}

/**
 * Fetch subtitles for a YouTube video.
 *
 * Must run in the background service worker (not content scripts)
 * to avoid CORS restrictions.
 */
export async function fetchSubtitles(
  videoUrl: string,
  language: string = "ja"
): Promise<SubtitleFetchResult> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    throw new Error(`Could not extract video ID from URL: ${videoUrl}`);
  }

  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResponse = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });

  if (!pageResponse.ok) {
    throw new Error(
      `Failed to fetch YouTube page: HTTP ${pageResponse.status}`
    );
  }

  const html = await pageResponse.text();
  const playerResponse = parsePlayerResponse(html);
  if (!playerResponse) {
    throw new Error(
      "Could not find player response in YouTube page. The video may be unavailable."
    );
  }

  return fetchSubtitlesFromPlayerResponse(playerResponse, videoId, language);
}

/**
 * Get available caption tracks for a YouTube video.
 * Used for the track selector UI.
 */
export async function fetchCaptionTracks(
  videoUrl: string
): Promise<CaptionTrack[]> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return [];

  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResponse = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });

  if (!pageResponse.ok) return [];

  const html = await pageResponse.text();
  const playerResponse = parsePlayerResponse(html);
  if (!playerResponse) return [];

  return extractCaptionTracks(playerResponse);
}

export {
  extractCaptionTracks,
  extractVideoId,
  findCaptionTrack,
  isJapaneseTrack,
  parseJson3Subtitles,
  parsePlayerResponse,
  parseVttSubtitles,
  parseVttTimestamp,
  parseXmlSubtitles,
  playerResponseVideoId,
};
