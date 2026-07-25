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

/** Part of speech abbreviation map */
export const POS_LABELS: Record<string, string> = {
  "名詞": "Danh từ",
  "動詞": "Động từ",
  "形容詞": "Tính từ -i",
  "形状詞": "Tính từ -na",
  "副詞": "Phó từ",
  "助詞": "Trợ từ",
  "助動詞": "Trợ động từ",
  "接続詞": "Liên từ",
  "感動詞": "Thán từ",
  "連体詞": "Từ bổ nghĩa",
  "記号": "Ký hiệu",
  "補助記号": "Dấu câu",
  "空白": "Khoảng trắng",
  "unknown": "Không xác định",
};
