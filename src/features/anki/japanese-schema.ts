import type { SrsCard } from "~/features/srs/local-srs";
import { distributeFurigana } from "~/shared/japanese/japanese";

export const JAPANESE_FIELDS = {
  Word: "word", "Word Reading": "reading", "Word Furigana": "word_furigana",
  "Word Meaning": "meaning", "Word Audio": "word_audio", "Vietnamese Sound": "vietnamese_sound",
  Sentence: "sentence", "Sentence Furigana": "sentence_furigana", "Sentence Meaning": "sentence_meaning",
  "Sentence Audio": "sentence_audio", JLPT: "jlpt", Notes: "notes", Picture: "picture",
} as const;
export type JapaneseField = keyof typeof JAPANESE_FIELDS;
export type JapaneseValues = Record<JapaneseField, string>;
export const JAPANESE_PRESET = {
  Word: "word", "Word Reading": "reading", "Word Furigana": "wordFurigana", "Word Meaning": "meaning",
  "Word Audio": "audio", "Vietnamese Sound": "vietnameseSound", Sentence: "sentence",
  "Sentence Furigana": "sentenceFurigana", "Sentence Meaning": "sentenceMeaning", "Sentence Audio": "sentenceAudio",
  JLPT: "jlptLevel", Notes: "notes", Picture: "imageUrl",
};
export const japaneseFieldNames = Object.keys(JAPANESE_FIELDS) as JapaneseField[];

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Text for matching/search only. Original field HTML is retained separately. */
export function plainText(value: string): string {
  return value.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "").replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g,
      entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " })[entity] || entity);
}

export function normalizeJlpt(value: string): string {
  const match = value.trim().match(/^(?:JLPT[- :]*|N)?([1-5])$/i);
  return match ? `N${match[1]}` : "";
}

/** New content allows semantic formatting; imported HTML is never rewritten by this function. */
export function richText(value: string): string {
  return value.split(/(<\/?(?:b|i|u|strong|em|ruby|rt|rp|br|ul|ol|li|span)\s*\/?>)/gi)
    .map(part => /^<\/?(?:b|i|u|strong|em|ruby|rt|rp|br|ul|ol|li|span)\s*\/?>$/i.test(part)
      ? part : escapeHtml(plainText(part))).join("");
}

export function furiganaHtml(value: string, reading?: string): string {
  if (/<ruby[\s>]/i.test(value)) return richText(value);
  const render = (text: string, kana?: string) => distributeFurigana(text, kana).map(segment =>
    segment.ruby ? `<ruby>${escapeHtml(segment.text)}<rt>${escapeHtml(segment.ruby)}</rt></ruby>` : escapeHtml(segment.text)).join("");
  if (reading && !/<[^>]+>/.test(value) && !value.includes("[")) return render(value, reading);
  return value.split(/(<\/?b>)/gi).map(part => /^<\/?b>$/i.test(part) ? part : render(part)).join("");
}

export function localValues(card: SrsCard): JapaneseValues {
  return Object.fromEntries(japaneseFieldNames.map(field => [field, String(card[JAPANESE_FIELDS[field]] || "")])) as JapaneseValues;
}

export function fieldsForCard(card: SrsCard): JapaneseValues {
  const values = localValues(card);
  return Object.fromEntries(japaneseFieldNames.map(field => {
    const original = card.anki?.baseline[field];
    if (original !== undefined && values[field] === card.anki?.localBaseline[field]) return [field, original];
    const value = values[field];
    if (field === "JLPT") return [field, normalizeJlpt(value).slice(1)];
    if (field === "Word Furigana") return [field, furiganaHtml(value || card.word, !value || value === card.word ? card.reading : undefined)];
    if (field === "Sentence Furigana") return [field, furiganaHtml(value || card.sentence || "")];
    if (field === "Picture") return [field, value || (card.image_url ? `<img src="${escapeHtml(card.image_url)}">` : "")];
    if (field === "Word Audio" || field === "Sentence Audio") return [field, value];
    return [field, richText(value)];
  })) as JapaneseValues;
}

export function cardContent(fields: JapaneseValues): Partial<SrsCard> {
  const content = Object.fromEntries(japaneseFieldNames.map(field => [JAPANESE_FIELDS[field], fields[field]])) as Partial<SrsCard>;
  content.word = plainText(fields.Word).trim();
  content.reading = plainText(fields["Word Reading"]);
  content.jlpt = normalizeJlpt(fields.JLPT);
  return content;
}
