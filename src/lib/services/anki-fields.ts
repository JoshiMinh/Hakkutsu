/** Match note field names consistently in automatic exports and the settings editor. */
export function inferAnkiFieldMapping(field: string): string {
  const lower = field.toLowerCase().replace(/[-_]/g, " ").trim();
  const sentence = /sentence|expression|example/.test(lower);
  if (/vietnamese|han.?viet|sino/.test(lower)) return "vietnameseSound";
  if (/audio|sound/.test(lower)) return sentence ? "sentenceAudio" : "audio";
  if (lower.includes("furigana")) return sentence ? "sentenceFurigana" : "wordFurigana";
  if (/reading|kana|pronunciation/.test(lower)) return sentence ? "sentenceReading" : "reading";
  if (/meaning|definition|translation|gloss/.test(lower)) return sentence ? "sentenceMeaning" : "meaning";
  if (/sentence|context|example/.test(lower)) return "sentence";
  if (lower.includes("screenshot")) return "screenshot";
  if (/image|picture|illustration/.test(lower)) return "imageUrl";
  if (/source|url|link/.test(lower)) return "sourceUrl";
  if (/jlpt|level/.test(lower)) return "jlptLevel";
  if (/pos|part of speech/.test(lower)) return "pos";
  if (lower === "front") return "frontHtml";
  if (lower === "back") return "backHtml";
  if (/word|kanji|vocab/.test(lower)) return "word";
  return "none";
}
