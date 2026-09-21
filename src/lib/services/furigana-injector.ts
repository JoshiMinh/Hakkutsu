import { isKanji, containsJapanese, hasKanji, distributeFurigana } from "~lib/utils/japanese";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import type { SelectiveFuriganaMode } from "~lib/utils/types";
import { localSrs } from "./local-srs";
import { searchDictionary } from "./local-lookup";

const SELECTIVE_RUBY_CLASS = "hk-selective-ruby";
const SELECTIVE_RT_CLASS = "hk-selective-rt";

const IGNORED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "BUTTON",
  "CODE", "PRE", "SVG", "CANVAS", "AUDIO", "VIDEO", "IFRAME", "RUBY", "RT"
]);

interface FuriganaTarget {
  node: Text;
  text: string;
}

let isInjecting = false;
let abortController: AbortController | null = null;

/**
 * Remove all previously injected selective furigana from the DOM
 */
export function removeSelectiveFurigana(root: Element = document.body): number {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isInjecting = false;

  const rubies = Array.from(root.querySelectorAll<HTMLElement>(`.${SELECTIVE_RUBY_CLASS}`));
  let count = 0;

  for (const ruby of rubies) {
    const parent = ruby.parentNode;
    if (!parent) continue;

    // Extract text content from ruby (ignoring rt)
    let originalText = "";
    for (const child of Array.from(ruby.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        originalText += child.nodeValue || "";
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toUpperCase() !== "RT") {
        originalText += child.textContent || "";
      }
    }

    const textNode = document.createTextNode(originalText || ruby.textContent || "");
    parent.replaceChild(textNode, ruby);
    parent.normalize();
    count += 1;
  }

  return count;
}

/**
 * Check if a word/kanji qualifies for selective furigana based on selected mode
 */
function shouldInjectForMode(
  surface: string,
  jlpt: string | null,
  mode: SelectiveFuriganaMode,
  learnedKanjiOrWords: Set<string>
): boolean {
  if (!hasKanji(surface)) return false;

  if (mode === "all") return true;

  if (mode === "unlearned") {
    // Show furigana if any kanji character or the word itself is NOT learned in SRS
    const isWordLearned = learnedKanjiOrWords.has(surface.toLowerCase());
    if (isWordLearned) return false;

    for (const char of surface) {
      if (isKanji(char) && !learnedKanjiOrWords.has(char.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  const lvl = (jlpt || predictJlpt(surface) || "unranked").toUpperCase().replace("JLPT-", "");

  if (mode === "n3_plus") {
    return ["N3", "N2", "N1", "UNRANKED"].includes(lvl);
  }
  if (mode === "n2_plus") {
    return ["N2", "N1", "UNRANKED"].includes(lvl);
  }
  if (mode === "n1_only") {
    return ["N1", "UNRANKED"].includes(lvl);
  }

  return true;
}

/**
 * Selectively injects <ruby> tags into text nodes for unlearned/high-level kanji.
 * Uses requestAnimationFrame batching and scheduler.yield() to prevent main thread lag.
 */
export async function injectSelectiveFurigana(
  mode: SelectiveFuriganaMode = "unlearned",
  root: Element = document.body
): Promise<{ processedNodes: number; injectedRubies: number; charactersRead: number }> {
  if (isInjecting) {
    removeSelectiveFurigana(root);
  }

  isInjecting = true;
  abortController = new AbortController();
  const signal = abortController.signal;

  // Clean existing rubies first
  removeSelectiveFurigana(root);

  // Fetch user's mastered SRS vocabulary for unlearned checking
  const allCards = await localSrs.getAllSrsCards().catch(() => []);
  const learnedSet = new Set<string>();
  for (const card of allCards) {
    if (card.interval >= 21 || card.repetition >= 2) {
      learnedSet.add(card.word.trim().toLowerCase());
      for (const char of card.word) {
        if (isKanji(char)) learnedSet.add(char.toLowerCase());
      }
    }
  }

  // Walk through text nodes
  const textNodes: FuriganaTarget[] = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (IGNORED_TAGS.has(parent.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".hk-popup, .hk-ruby, .hk-density-badge, #hakkutsu-inline-dictionary-host, [contenteditable='true']")) {
          return NodeFilter.FILTER_REJECT;
        }
        const text = node.nodeValue || "";
        if (!hasKanji(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let current = walker.nextNode();
  while (current) {
    textNodes.push({ node: current as Text, text: current.nodeValue || "" });
    current = walker.nextNode();
  }

  let injectedRubies = 0;
  let totalCharsProcessed = 0;
  const BATCH_SIZE = 20;

  for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
    if (signal.aborted) break;

    const batch = textNodes.slice(i, i + BATCH_SIZE);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(async () => {
        for (const item of batch) {
          if (signal.aborted || !item.node.parentNode) continue;

          const text = item.text;
          totalCharsProcessed += text.length;

          // Segment words with Intl.Segmenter or regex
          let words: string[] = [];
          if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
            const segmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
            words = Array.from(segmenter.segment(text)).map((s: any) => s.segment);
          } else {
            words = text.split(/([\s\u3000、。！？!?…]+)/).filter(Boolean);
          }

          let hasModifications = false;
          const fragment = document.createDocumentFragment();

          for (const word of words) {
            if (hasKanji(word)) {
              const jlpt = predictJlpt(word);
              if (shouldInjectForMode(word, jlpt, mode, learnedSet)) {
                // Find reading for this word or its kanji components
                let reading: string | undefined;
                try {
                  const dictEntries = await searchDictionary(word);
                  if (dictEntries && dictEntries.length > 0) {
                    reading = dictEntries[0].readingElements?.[0];
                  }
                } catch {}

                if (!reading) {
                  // Fallback to predicting per-kanji reading if available
                  reading = undefined;
                }

                if (reading && reading !== word) {
                  const segments = distributeFurigana(word, reading);
                  for (const seg of segments) {
                    if (seg.ruby) {
                      const ruby = document.createElement("ruby");
                      ruby.className = SELECTIVE_RUBY_CLASS;
                      ruby.style.rubyPosition = "over";

                      const rb = document.createTextNode(seg.text);
                      const rt = document.createElement("rt");
                      rt.className = SELECTIVE_RT_CLASS;
                      rt.style.fontSize = "0.62em";
                      rt.style.color = "var(--hk-accent-light, #c084fc)";
                      rt.style.userSelect = "none";
                      rt.textContent = seg.ruby;

                      ruby.appendChild(rb);
                      ruby.appendChild(rt);
                      fragment.appendChild(ruby);
                      injectedRubies += 1;
                      hasModifications = true;
                    } else {
                      fragment.appendChild(document.createTextNode(seg.text));
                    }
                  }
                  continue;
                }
              }
            }

            fragment.appendChild(document.createTextNode(word));
          }

          if (hasModifications && item.node.parentNode) {
            item.node.parentNode.replaceChild(fragment, item.node);
          }
        }
        resolve();
      });
    });

    if (typeof (globalThis as any).scheduler?.yield === "function") {
      await (globalThis as any).scheduler.yield();
    }
  }

  isInjecting = false;

  // Track characters read to analytics
  if (totalCharsProcessed > 0 && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "TRACK_CHARACTERS_READ",
      payload: { count: totalCharsProcessed },
    }).catch(() => {});
  }

  return {
    processedNodes: textNodes.length,
    injectedRubies,
    charactersRead: totalCharsProcessed,
  };
}

