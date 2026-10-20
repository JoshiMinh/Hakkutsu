import { hasKanji } from "~/shared/japanese/japanese";

// Check ancestors, not just the immediate parent: native ruby often contains rb/span.
const EXCLUDED = "script, style, noscript, textarea, input, select, button, code, pre, svg, canvas, audio, video, iframe, rt, rp, [hidden], [aria-hidden='true'], [contenteditable]:not([contenteditable='false']), .hk-popup, .hk-density-badge, hakkutsu-inline-dictionary-host, #hakkutsu-inline-dictionary-host";

export function eligiblePageText(node: Node, includeRuby = false): node is Text {
  return node.nodeType === Node.TEXT_NODE && !!node.parentElement &&
    !node.parentElement.closest(includeRuby ? EXCLUDED : `${EXCLUDED}, ruby`);
}

export function pageTextWalker(root: Node, includeRuby = false): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).matches(includeRuby ? EXCLUDED : `${EXCLUDED}, ruby`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return eligiblePageText(node, includeRuby) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
}

export function learnedVocabulary(cards: Array<{ word: string; interval: number; repetition: number }>): string[] {
  const learned = new Set<string>();
  for (const card of cards) {
    if (card.interval < 21 && card.repetition < 2) continue;
    learned.add(card.word.trim().toLowerCase());
    for (const char of card.word) if (hasKanji(char)) learned.add(char);
  }
  return [...learned];
}

let lastTimerYield = 0;

export async function yieldToPage(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  // Scheduler continuations have boosted priority. Periodically yield through a
  // timer as well, so timers and lower-priority tasks cannot starve on long pages.
  if (!scheduler?.yield || performance.now() - lastTimerYield >= 12) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    lastTimerYield = performance.now();
  } else await scheduler.yield();
}
