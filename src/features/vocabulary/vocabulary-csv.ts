import type { SrsCard } from "~/features/srs/local-srs";
import { getHanViet } from "~/shared/japanese/hanviet-dict";

/** UTF-8 CSV with Excel's encoding marker, quoted cells and portable line endings. */
export function createVocabularyCsv(cards: SrsCard[], showHanViet: boolean, now = Date.now()): string {
  const quote = (value?: string) => `"${(value || "").replace(/"/g, '""')}"`;
  const date = (timestamp: number) => Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
    ? new Date(timestamp).toISOString() : "";
  const headers = ["Word", "Furigana", "Word Meaning", ...(showHanViet ? ["Han Viet"] : []),
    "Example Sentence", "JLPT", "Frequency Rank", "Status", "Date Added", "Date Updated", "Tags"];
  const rows = cards.map(card => {
    const status = card.repetition === 0 ? "New" : card.due_date <= now ? "Due" :
      card.interval >= 21 ? `Graduated (${card.interval}d)` : `Learning (${card.interval}d)`;
    return [card.word, card.reading, card.meaning, ...(showHanViet ? [card.vietnamese_sound || getHanViet(card.word)] : []),
      card.sentence, card.jlpt, card.frequency_rank ? `#${card.frequency_rank}` : "", status,
      date(card.created_at), date(card.updated_at), (card.tags || []).join("; ")].map(quote).join(",");
  });
  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
}
