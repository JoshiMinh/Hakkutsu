/**
 * Constants used throughout the extension.
 */

/** Backend API base URL (configurable via settings) */
export const DEFAULT_API_URL = "http://127.0.0.1:8000";

/** API version prefix */
export const API_V1 = "/api/v1";

/** AnkiConnect default endpoint */
export const ANKI_CONNECT_URL = "http://localhost:8765";
export const ANKI_CONNECT_VERSION = 6;

/** Japanese Unicode ranges for text detection */
export const UNICODE_RANGES = {
  hiragana: { start: 0x3040, end: 0x309f },
  katakana: { start: 0x30a0, end: 0x30ff },
  cjk: { start: 0x4e00, end: 0x9fff },
  cjkExtA: { start: 0x3400, end: 0x4dbf },
  fullWidth: { start: 0xff00, end: 0xffef },
  punctuation: { start: 0x3000, end: 0x303f },
} as const;

/** JLPT level colors for UI badges */
export const JLPT_COLORS: Record<string, { bg: string; text: string }> = {
  N5: { bg: "#22c55e", text: "#ffffff" },
  N4: { bg: "#3b82f6", text: "#ffffff" },
  N3: { bg: "#f59e0b", text: "#1a1a2e" },
  N2: { bg: "#ef4444", text: "#ffffff" },
  N1: { bg: "#a855f7", text: "#ffffff" },
};

/** Part of speech abbreviation map for Vietnamese */
export const POS_LABELS_VI: Record<string, string> = {
  "noun": "Danh từ",
  "nouns": "Danh từ",
  "名詞": "Danh từ",
  "verb": "Động từ",
  "verbs": "Động từ",
  "動詞": "Động từ",
  "adjective": "Tính từ",
  "adjectives": "Tính từ",
  "adj-i": "Tính từ (-i)",
  "adj-na": "Tính từ (-na)",
  "形容詞": "Tính từ (-i)",
  "形状詞": "Tính từ (-na)",
  "adverb": "Phó từ",
  "副詞": "Phó từ",
  "particle": "Trợ từ",
  "助詞": "Trợ từ",
  "auxiliary": "Trợ động từ",
  "助動詞": "Trợ động từ",
  "conjunction": "Liên từ",
  "接続詞": "Liên từ",
  "interjection": "Thán từ",
  "感動詞": "Thán từ",
  "expression": "Cụm từ",
  "phrases": "Cụm từ",
  "慣用語": "Cụm từ",
  "counter": "Từ đếm",
  "助数詞": "Từ đếm",
  "pronoun": "Đại từ",
  "代名詞": "Đại từ",
  "prefix": "Tiền tố",
  "接頭辞": "Tiền tố",
  "接頭詞": "Tiền tố",
  "suffix": "Hậu tố",
  "接尾辞": "Hậu tố",
  "接尾詞": "Hậu tố",
  "連体詞": "Từ bổ nghĩa",
  "word": "Từ vựng",
  "Word": "Từ vựng",
  "記号": "Ký hiệu",
  "補助記号": "Dấu câu",
  "空白": "Khoảng trắng",
  "unknown": "Không xác định",
};

/** Part of speech abbreviation map for English */
export const POS_LABELS_EN: Record<string, string> = {
  "noun": "Noun",
  "nouns": "Noun",
  "名詞": "Noun",
  "verb": "Verb",
  "verbs": "Verb",
  "動詞": "Verb",
  "adjective": "Adjective",
  "adjectives": "Adjective",
  "adj-i": "Adjective (-i)",
  "adj-na": "Adjective (-na)",
  "形容詞": "Adjective (-i)",
  "形状詞": "Adjective (-na)",
  "adverb": "Adverb",
  "副詞": "Adverb",
  "particle": "Particle",
  "助詞": "Particle",
  "auxiliary": "Aux. Verb",
  "助動詞": "Aux. Verb",
  "conjunction": "Conjunction",
  "接続詞": "Conjunction",
  "interjection": "Interjection",
  "感動詞": "Interjection",
  "expression": "Expression",
  "phrases": "Expression",
  "慣用語": "Expression",
  "counter": "Counter",
  "助数詞": "Counter",
  "pronoun": "Pronoun",
  "代名詞": "Pronoun",
  "prefix": "Prefix",
  "接頭辞": "Prefix",
  "接頭詞": "Prefix",
  "suffix": "Suffix",
  "接尾辞": "Suffix",
  "接尾詞": "Suffix",
  "連体詞": "Pre-noun Adj.",
  "word": "Word",
  "Word": "Word",
  "記号": "Symbol",
  "補助記号": "Punctuation",
  "空白": "Space",
  "unknown": "Unknown",
};

/** Backward-compatible default export */
export const POS_LABELS = POS_LABELS_VI;

export function formatPosLabel(pos: string | null | undefined, lang: "en" | "vi" = "en"): string {
  if (!pos) return "";
  const clean = pos.trim().toLowerCase();
  const map = lang === "vi" ? POS_LABELS_VI : POS_LABELS_EN;

  // Direct lookup
  if (map[pos]) return map[pos];
  if (map[clean]) return map[clean];

  // Base key (e.g. 名詞-一般 -> 名詞)
  const baseKey = pos.split("-")[0].trim();
  if (map[baseKey]) return map[baseKey];
  if (map[baseKey.toLowerCase()]) return map[baseKey.toLowerCase()];

  // Common pattern matches
  if (/noun|名詞/i.test(pos)) return map["noun"];
  if (/verb|動詞/i.test(pos)) return map["verb"];
  if (/adj|形容/i.test(pos)) return /na/i.test(pos) ? map["adj-na"] : map["adj-i"];
  if (/adverb|副詞/i.test(pos)) return map["adverb"];
  if (/particle|助詞/i.test(pos)) return map["particle"];
  if (/expression|exp|phrase/i.test(pos)) return map["expression"];

  // Capitalize nicely if not mapped
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
