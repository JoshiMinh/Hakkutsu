/**
 * YouTube transcript-panel fallback.
 *
 * The fallback strategy is based on the MIT-licensed SubtideX project:
 * https://github.com/yniijia/SubtideX
 *
 * It intentionally runs only after direct player caption URLs fail. This
 * avoids depending on YouTube's UI selectors in the normal path while still
 * handling token-gated timedtext URLs.
 */

import type { SubtitleFetchResult, SubtitleSegment } from "~types";

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

async function openTranscriptPanel(): Promise<{ root: HTMLElement; opened: boolean }> {
  const existing = transcriptRoot();
  if (existing && isVisible(existing)) return { root: existing, opened: false };

  const expand = document.querySelector<HTMLElement>(
    "ytd-watch-metadata #expand, ytd-text-inline-expander #expand"
  );
  if (expand) {
    expand.click();
    await delay(250);
  }

  const descriptionEntry = document.querySelector<HTMLElement>(
    "ytd-video-description-transcript-section-renderer"
  );
  if (descriptionEntry) {
    descriptionEntry.click();
  } else {
    const directButtons = [...document.querySelectorAll<HTMLElement>("button")];
    const direct = directButtons.find((button) => {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      return (
        label.includes("transcript") ||
        label.includes("bản ghi") ||
        label.includes("phụ đề") ||
        label.includes("字幕")
      );
    });
    if (direct) {
      direct.click();
    } else {
      const moreButton = document.querySelector<HTMLElement>(
        'ytd-watch-metadata button[aria-label*="More"], ytd-watch-metadata ytd-menu-renderer button'
      );
      if (moreButton) {
        moreButton.click();
        await delay(300);
        const menuItems = [
          ...document.querySelectorAll<HTMLElement>(
            "ytd-menu-service-item-renderer, tp-yt-paper-item"
          ),
        ];
        const transcriptItem = menuItems.find((item) => {
          const text = (item.textContent || "").toLowerCase();
          const html = item.outerHTML;
          return (
            html.includes("getTranscriptEndpoint") ||
            html.includes("searchable-transcript") ||
            text.includes("transcript") ||
            text.includes("bản ghi") ||
            text.includes("phụ đề") ||
            text.includes("字幕")
          );
        });
        transcriptItem?.click();
      }
    }
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const root = transcriptRoot();
    if (root && isVisible(root) && visibleRows(root).length > 0) {
      return { root, opened: true };
    }
    await delay(160);
  }
  throw new Error("YouTube không mở được Transcript panel hoặc video không có transcript");
}

async function closeTranscriptPanel(root: HTMLElement) {
  const closeButton =
    root.querySelector<HTMLElement>("#visibility-button button") ||
    root.querySelector<HTMLElement>('button[aria-label*="Close"]') ||
    root.querySelector<HTMLElement>('button[aria-label*="Đóng"]');
  closeButton?.click();
}

export async function fetchTranscriptPanelSubtitles(
  videoId: string
): Promise<SubtitleFetchResult> {
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
      await delay(130);
    }
    collectRows(root, collected);
  } finally {
    scrollContainer.scrollTop = originalScrollTop;
    if (opened) await closeTranscriptPanel(root);
  }

  const segments = finalizeSegments(collected);
  if (segments.length === 0) {
    throw new Error("Transcript panel đã mở nhưng không đọc được dòng phụ đề nào");
  }
  return {
    videoId,
    language: "auto",
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
