/**
 * YouTube transcript-panel fallback.
 *
 * The fallback strategy extracts transcript data directly from YouTube's
 * in-page transcript panel and HTML5 media player when direct timedtext
 * requests are blocked by PO-tokens or botguard restrictions.
 */

import type { SubtitleFetchResult, SubtitleSegment } from "~lib/types";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function timestampToSeconds(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => Number.isNaN(part))
  ) {
    return null;
  }
  const seconds = parts.pop()!;
  const minutes = parts.pop()!;
  const hours = parts.pop() || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function transcriptRoot(): HTMLElement | null {
  const selectors = [
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    "#engagement-panel-searchable-transcript",
    "ytd-transcript-search-panel-renderer",
    "ytd-transcript-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id*='transcript']",
  ];
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getAttribute("visibility") !== "HIDDEN" &&
    !element.hidden
  );
}

function rowTimestamp(row: Element): number | null {
  const candidates = [
    row.querySelector(".segment-timestamp"),
    row.querySelector('[class*="segment-timestamp"]'),
    row.querySelector('[class*="timestamp"]'),
    row.querySelector("button"),
  ].filter((item): item is Element => Boolean(item));

  for (const element of candidates) {
    const match = (element.textContent || "").trim().match(
      /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/
    );
    if (match) return timestampToSeconds(match[0]);
  }
  const inline = (row.textContent || "")
    .trim()
    .match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+/);
  return inline ? timestampToSeconds(inline[1]) : null;
}

function rowText(row: Element): string {
  const element =
    row.querySelector(".segment-text") ||
    row.querySelector('[class*="segment-text"]') ||
    row.querySelector(".yt-core-attributed-string") ||
    row.querySelector("yt-formatted-string");
  const direct = (element?.textContent || "").replace(/\s+/g, " ").trim();
  if (direct && !/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(direct)) {
    return direct;
  }
  return (row.textContent || "")
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleRows(root: HTMLElement): Element[] {
  const selectors = [
    "ytd-transcript-segment-renderer",
    "transcript-segment-view-model",
    "#segments-container > *",
    ".ytd-transcript-search-panel-renderer #body ytd-transcript-segment-renderer",
  ];
  const rows = new Set<Element>();
  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach((row) => rows.add(row));
  }
  return [...rows];
}

function collectRows(root: HTMLElement, collected: Map<string, SubtitleSegment>) {
  for (const row of visibleRows(root)) {
    const start = rowTimestamp(row);
    const text = rowText(row);
    if (start == null || !text) continue;
    collected.set(`${start}|${text}`, { start, duration: 0, text });
  }
}

function finalizeSegments(collected: Map<string, SubtitleSegment>): SubtitleSegment[] {
  const segments = [...collected.values()].sort((a, b) => a.start - b.start);
  for (let index = 0; index < segments.length; index += 1) {
    const next = segments[index + 1];
    segments[index].duration = next
      ? Math.max(0.1, next.start - segments[index].start)
      : 4;
  }
  return segments;
}

/** Check if text matches any transcript button keywords across common languages */
function isTranscriptKeyword(raw: string): boolean {
  const s = raw.toLowerCase().trim();
  return (
    s.includes("transcript") ||
    s.includes("bản ghi") ||
    s.includes("bản chép lời") ||
    s.includes("chép lời") ||
    s.includes("phụ đề") ||
    s.includes("文字起こし") ||
    s.includes("字幕") ||
    s.includes("transcripción") ||
    s.includes("transcription") ||
    s.includes("transkription")
  );
}

async function openTranscriptPanel(): Promise<{ root: HTMLElement; opened: boolean }> {
  const existing = transcriptRoot();
  if (existing && isVisible(existing) && visibleRows(existing).length > 0) {
    return { root: existing, opened: false };
  }

  // 1. Expand video description if needed
  const expand = document.querySelector<HTMLElement>(
    "ytd-watch-metadata #expand, ytd-text-inline-expander #expand, #description #expand, #expand-sizer #expand"
  );
  if (expand && isVisible(expand)) {
    expand.click();
    await delay(250);
  }

  // 2. Look for transcript section button inside description
  const descriptionButtons = [
    ...document.querySelectorAll<HTMLElement>(
      "ytd-video-description-transcript-section-renderer button, ytd-structured-description-content-renderer button, #structured-description button"
    ),
  ];
  const descTranscriptBtn = descriptionButtons.find((btn) => {
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const text = (btn.textContent || "").toLowerCase();
    return isTranscriptKeyword(label) || isTranscriptKeyword(text);
  }) || document.querySelector<HTMLElement>("ytd-video-description-transcript-section-renderer");

  if (descTranscriptBtn) {
    descTranscriptBtn.click();
  } else {
    // 3. Look for direct transcript buttons anywhere in watch metadata
    const directButtons = [...document.querySelectorAll<HTMLElement>("ytd-watch-metadata button, #top-level-buttons-computed button, ytd-menu-renderer button")];
    const direct = directButtons.find((button) => {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      const text = (button.textContent || "").toLowerCase();
      return isTranscriptKeyword(label) || isTranscriptKeyword(text);
    });

    if (direct) {
      direct.click();
    } else {
      // 4. Look in the "..." More actions menu
      const moreButton = document.querySelector<HTMLElement>(
        'ytd-watch-metadata button[aria-label*="More"], ytd-watch-metadata button[aria-label*="Thêm"], ytd-watch-metadata button[aria-label*="その他"], ytd-watch-metadata ytd-menu-renderer button'
      );
      if (moreButton) {
        moreButton.click();
        await delay(300);
        const menuItems = [
          ...document.querySelectorAll<HTMLElement>(
            "ytd-menu-service-item-renderer, tp-yt-paper-item, ytd-menu-navigation-item-renderer"
          ),
        ];
        const transcriptItem = menuItems.find((item) => {
          const text = (item.textContent || "").toLowerCase();
          const html = item.outerHTML;
          return (
            html.includes("getTranscriptEndpoint") ||
            html.includes("searchable-transcript") ||
            isTranscriptKeyword(text)
          );
        });
        if (transcriptItem) {
          transcriptItem.click();
        } else {
          // Close menu if transcript not found
          document.body.click();
        }
      }
    }
  }

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const root = transcriptRoot();
    if (root && isVisible(root) && visibleRows(root).length > 0) {
      return { root, opened: true };
    }
    await delay(150);
  }
  throw new Error("Không thể mở Transcript trên trang YouTube hoặc video không có transcript.");
}

async function closeTranscriptPanel(root: HTMLElement) {
  const closeButton =
    root.querySelector<HTMLElement>("#visibility-button button") ||
    root.querySelector<HTMLElement>('button[aria-label*="Close"]') ||
    root.querySelector<HTMLElement>('button[aria-label*="Đóng"]') ||
    root.querySelector<HTMLElement>('button[aria-label*="閉じる"]');
  closeButton?.click();
}

/**
 * Extract subtitles from the HTML5 media player's text tracks if active.
 */
export function tryExtractFromVideoTextTracks(videoId: string): SubtitleFetchResult | null {
  const video = document.querySelector("video");
  if (!video || !video.textTracks || video.textTracks.length === 0) return null;

  for (let i = 0; i < video.textTracks.length; i++) {
    const track = video.textTracks[i];
    if (track.cues && track.cues.length > 0) {
      const segments: SubtitleSegment[] = [];
      for (let j = 0; j < track.cues.length; j++) {
        const cue = track.cues[j] as VTTCue;
        if (cue && cue.text && cue.text.trim()) {
          segments.push({
            start: cue.startTime,
            duration: Math.max(0.1, cue.endTime - cue.startTime),
            text: cue.text.trim(),
          });
        }
      }
      if (segments.length > 0) {
        return {
          videoId,
          language: track.language || "ja",
          trackName: track.label || track.language || "Native Player CC",
          segments,
          fullText: segments.map((s) => s.text).join(" "),
          isAutoGenerated: false,
          source: "player",
        };
      }
    }
  }
  return null;
}

export async function fetchTranscriptPanelSubtitles(
  videoId: string
): Promise<SubtitleFetchResult> {
  // First try extracting from active video text tracks if available
  const textTrackResult = tryExtractFromVideoTextTracks(videoId);
  if (textTrackResult && textTrackResult.segments.length > 0) {
    return textTrackResult;
  }

  const { root, opened } = await openTranscriptPanel();
  const collected = new Map<string, SubtitleSegment>();
  const scrollContainer =
    root.querySelector<HTMLElement>("#segments-container") ||
    root.querySelector<HTMLElement>("#content") ||
    root;
  const originalScrollTop = scrollContainer.scrollTop;

  try {
    let unchangedPasses = 0;
    let previousSize = -1;
    for (let pass = 0; pass < 50; pass += 1) {
      collectRows(root, collected);
      unchangedPasses = collected.size === previousSize ? unchangedPasses + 1 : 0;
      previousSize = collected.size;

      const atBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 4;
      if (atBottom && unchangedPasses >= 2) break;

      scrollContainer.scrollTop = Math.min(
        scrollContainer.scrollHeight,
        scrollContainer.scrollTop + Math.max(220, scrollContainer.clientHeight * 0.8)
      );
      await delay(120);
    }
    collectRows(root, collected);
  } finally {
    scrollContainer.scrollTop = originalScrollTop;
    if (opened) await closeTranscriptPanel(root);
  }

  const segments = finalizeSegments(collected);
  if (segments.length === 0) {
    throw new Error("Transcript panel đã mở nhưng không đọc được dòng phụ đề nào.");
  }
  return {
    videoId,
    language: "ja",
    segments,
    fullText: segments.map((segment) => segment.text).join(" "),
    trackName: "YouTube Transcript",
    isAutoGenerated: false,
    source: "transcript_panel",
  };
}

export const transcriptDomTestables = {
  finalizeSegments,
  timestampToSeconds,
};

