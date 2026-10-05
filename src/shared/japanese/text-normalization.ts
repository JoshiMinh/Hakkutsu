/** Removes repeated caption and translation text without changing the existing normalization rules. */
export function deduplicateCueText(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  // 1. Remove exact full repetition e.g. "X X" or "X. X." or "X. X" or Japanese "XYZXYZ"
  const mid = Math.floor(cleaned.length / 2);
  for (let len = mid; len >= 2; len--) {
    const sub = cleaned.slice(0, len).trim();
    const rest = cleaned.slice(len).trim();

    const subNorm = sub
      .replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "")
      .trim();
    const restNorm = rest
      .replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "")
      .trim();

    if (
      subNorm &&
      restNorm &&
      (subNorm === restNorm ||
        rest.startsWith(sub + " ") ||
        rest === sub ||
        rest.startsWith(subNorm))
    ) {
      cleaned = sub;
      break;
    }
  }

  // 2. Sentence-level deduplication e.g. "Sentence A. Sentence A."
  const sentences = cleaned.split(/(?<=[.!?。！？])\s+/);
  if (sentences.length > 1) {
    const uniqueSentences: string[] = [];
    const seen = new Set<string>();
    for (const s of sentences) {
      const norm = s
        .trim()
        .toLowerCase()
        .replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "");
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        uniqueSentences.push(s.trim());
      }
    }
    if (uniqueSentences.length < sentences.length) {
      cleaned = uniqueSentences.join(" ");
    }
  }

  // 3. Token-based adjacent duplicate sequence removal e.g. "Directly behind Directly behind"
  let words = cleaned.split(" ");
  let changed = true;
  while (changed && words.length >= 2) {
    changed = false;
    const maxLen = Math.floor(words.length / 2);
    for (let k = maxLen; k >= 1; k--) {
      const leftPart = words.slice(0, k).join(" ");
      const rightPart = words.slice(k, k * 2).join(" ");
      const leftNorm = leftPart
        .toLowerCase()
        .replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "");
      const rightNorm = rightPart
        .toLowerCase()
        .replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "");
      if (leftNorm && rightNorm && leftNorm === rightNorm) {
        words = [...words.slice(0, k), ...words.slice(k * 2)];
        changed = true;
        break;
      }
    }
  }
  cleaned = words.join(" ");

  return cleaned;
}
