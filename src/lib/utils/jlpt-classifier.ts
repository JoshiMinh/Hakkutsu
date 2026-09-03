/**
 * Local JLPT classifier (Rule-based / Dictionary matcher)
 * Replaces the backend ML classifier.
 */

// A small dictionary of common words to JLPT levels for demonstration.
// In a full implementation, this could load a JSON dictionary file.
const JLPT_DICT: Record<string, string> = {
  "食べる": "N5",
  "飲む": "N5",
  "行く": "N5",
  "来る": "N5",
  "学校": "N5",
  "勉強": "N5",
  "日本": "N5",
  "語彙": "N3",
  "文法": "N3",
  "読解": "N3",
  "聴解": "N3",
  "試験": "N4",
  "合格": "N3",
  "失敗": "N3",
};

const JAPANESE_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;

/**
 * Predicts the JLPT level (N1-N5) for a given Japanese text.
 * Falls back to dictionary lookup.
 */
export function predictJlpt(text: string): string | null {
  if (!text || !JAPANESE_PATTERN.test(text)) {
    return null;
  }

  // Exact match
  if (JLPT_DICT[text]) {
    return JLPT_DICT[text];
  }

  // Substring matching for a very crude fallback
  for (const [word, level] of Object.entries(JLPT_DICT)) {
    if (text.includes(word)) {
      return level;
    }
  }

  return null;
}
