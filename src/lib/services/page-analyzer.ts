import { isKanji, isJapanese, hasKanji, containsJapanese } from "~lib/utils/japanese";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import type { PageDensityAnalysis } from "~lib/utils/types";
import { localSrs } from "./local-srs";

const IGNORED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
  "CODE", "PRE", "SVG", "CANVAS", "AUDIO", "VIDEO", "IFRAME", "RUBY", "RT"
]);

/**
 * Scan webpage text nodes and calculate Japanese difficulty density breakdown.
 */
export async function analyzePageDensity(root: Element = document.body): Promise<PageDensityAnalysis> {
  const textNodes: Text[] = [];
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
        if (!containsJapanese(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  let totalJapaneseChars = 0;
  let totalKanji = 0;
  const kanjiSet = new Set<string>();
  const jlptCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 };

  // Fetch user's learned cards to identify unlearned vocabulary
  let learnedWords = new Set<string>();
  try {
    const allCards = await localSrs.getAllSrsCards();
    learnedWords = new Set(
      allCards
        .filter((c) => c.interval >= 21 || c.repetition >= 2)
        .map((c) => c.word.trim().toLowerCase())
    );
  } catch {}

  let unlearnedCount = 0;

  for (const node of textNodes) {
    const text = node.nodeValue || "";
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (isJapanese(char)) {
        totalJapaneseChars += 1;
        if (isKanji(char)) {
          totalKanji += 1;
          kanjiSet.add(char);

          const lvl = predictJlpt(char);
          if (lvl === "N5") jlptCounts.N5 += 1;
          else if (lvl === "N4") jlptCounts.N4 += 1;
          else if (lvl === "N3") jlptCounts.N3 += 1;
          else if (lvl === "N2") jlptCounts.N2 += 1;
          else if (lvl === "N1") jlptCounts.N1 += 1;
          else jlptCounts.unranked += 1;

          if (!learnedWords.has(char.toLowerCase())) {
            unlearnedCount += 1;
          }
        }
      }
    }
  }

  const kanjiTotal = Math.max(1, totalKanji);
  const percentages = {
    N5: Math.round((jlptCounts.N5 / kanjiTotal) * 100),
    N4: Math.round((jlptCounts.N4 / kanjiTotal) * 100),
    N3: Math.round((jlptCounts.N3 / kanjiTotal) * 100),
    N2: Math.round((jlptCounts.N2 / kanjiTotal) * 100),
    N1: Math.round((jlptCounts.N1 / kanjiTotal) * 100),
    unranked: Math.round((jlptCounts.unranked / kanjiTotal) * 100),
  };

  // Determine dominant level
  const levels = ["N5", "N4", "N3", "N2", "N1"] as const;
  let dominantLevel = "N3";
  let maxCount = -1;
  for (const lvl of levels) {
    if (jlptCounts[lvl] > maxCount && jlptCounts[lvl] > 0) {
      maxCount = jlptCounts[lvl];
      dominantLevel = lvl;
    }
  }
  if (maxCount === -1 && totalKanji > 0) {
    dominantLevel = "Unranked";
  }

  // Immersion score: proportion of Japanese content + kanji density (0-100)
  const immersionScore = Math.min(
    100,
    Math.round(
      (totalJapaneseChars > 50 ? 40 : totalJapaneseChars * 0.8) +
      Math.min(60, (totalKanji / Math.max(1, totalJapaneseChars)) * 120)
    )
  );

  return {
    url: window.location.href,
    totalJapaneseChars,
    totalKanji,
    uniqueKanji: kanjiSet.size,
    jlptDistribution: jlptCounts,
    percentages,
    dominantLevel,
    unlearnedCount,
    immersionScore,
  };
}

