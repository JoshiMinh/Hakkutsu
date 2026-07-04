/**
 * Content script — Japanese text detector.
 *
 * Detects Japanese text on webpages and sends selected
 * text to the extension popup for analysis.
 */

import type { PlasmoCSConfig } from "plasmo";
import { containsJapanese } from "~lib/japanese";
import type { ExtensionMessage, SelectionEvent } from "~types";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true,
};

/**
 * Listen for text selection events on the page.
 * When the user selects text containing Japanese characters,
 * send it to the background service worker.
 */
document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const selectedText = selection.toString().trim();
  if (!selectedText || !containsJapanese(selectedText)) return;

  // Get selection position for potential floating UI
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // Get surrounding context (parent element text)
  const anchorNode = selection.anchorNode;
  const contextElement = anchorNode?.parentElement;
  const context = contextElement?.textContent?.trim() || selectedText;

  const event: SelectionEvent = {
    text: selectedText,
    context: context.substring(0, 500), // Limit context length
    x: rect.left + rect.width / 2,
    y: rect.top,
    sourceUrl: window.location.href,
  };

  // Send to background/popup
  const message: ExtensionMessage = {
    type: "TEXT_SELECTED",
    payload: event,
  };

  chrome.runtime.sendMessage(message).catch(() => {
    // Extension might not be listening — this is fine
  });
});

/**
 * Scan the page for Japanese text and add a subtle indicator.
 * This runs once on page load.
 */
function scanForJapanese(): void {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const text = node.textContent || "";
        if (text.trim().length === 0) return NodeFilter.FILTER_SKIP;
        if (containsJapanese(text)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  let japaneseNodeCount = 0;
  while (walker.nextNode()) {
    japaneseNodeCount++;
  }

  if (japaneseNodeCount > 0) {
    // Notify the extension that Japanese text was detected
    chrome.runtime.sendMessage({
      type: "TEXT_SELECTED",
      payload: {
        text: "",
        context: `${japaneseNodeCount} Japanese text nodes detected`,
        x: 0,
        y: 0,
        sourceUrl: window.location.href,
      },
    } satisfies ExtensionMessage).catch(() => {});
  }
}

// Run scanner after DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scanForJapanese);
} else {
  scanForJapanese();
}
