import type { TranslationKey } from "~/shared/locales";

export const ANKI_MAPPING_LABELS: Record<string, TranslationKey> = {
  none: "anki_map_none", word: "vocab_label_word", reading: "vocab_label_reading", wordFurigana: "vocab_label_word_furigana",
  meaning: "vocab_label_meaning", vietnameseSound: "vocab_label_hanviet", sentence: "vocab_label_sentence",
  sentenceFurigana: "vocab_label_sentence_furigana", sentenceReading: "anki_map_sentence_reading", sentenceMeaning: "vocab_label_sentence_meaning",
  jlptLevel: "vocab_label_jlpt", pos: "anki_map_pos", imageUrl: "anki_field_picture", screenshot: "anki_map_screenshot",
  sourceUrl: "anki_map_source", audio: "anki_field_word_audio", sentenceAudio: "anki_field_sentence_audio", notes: "anki_field_notes",
  frontHtml: "anki_map_front", backHtml: "anki_map_back",
};
const FIELDS: Record<string, TranslationKey> = {
  Word: "vocab_label_word", "Word Reading": "vocab_label_reading", "Word Furigana": "vocab_label_word_furigana",
  "Word Meaning": "vocab_label_meaning", "Vietnamese Sound": "vocab_label_hanviet", Sentence: "vocab_label_sentence",
  "Sentence Furigana": "vocab_label_sentence_furigana", "Sentence Meaning": "vocab_label_sentence_meaning", JLPT: "vocab_label_jlpt",
  "Word Audio": "anki_field_word_audio", "Sentence Audio": "anki_field_sentence_audio", Notes: "anki_field_notes", Picture: "anki_field_picture",
};
export function ankiFieldLabel(field: string, t: (key: TranslationKey) => string): string { return FIELDS[field] ? t(FIELDS[field]) : field; }
