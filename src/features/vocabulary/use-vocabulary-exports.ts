import { useState, useRef } from "react";
import type { ChangeEvent } from "react";
import type { SrsCard } from "~/features/srs/local-srs";
import type { useTranslation } from "~/shared/locales";
import { ankiClient } from "~/features/anki/anki-connect";
import { createVocabularyCsv } from "~/features/vocabulary/vocabulary-csv";
import {
  createVocabularyBackup,
  downloadVocabularyBackup,
  restoreVocabularyBackup,
} from "~/features/vocabulary/data-backup";
import type { ExtensionSettings } from "~/features/settings/types";

interface VocabularyExportOptions {
  cards: SrsCard[];
  selectedIds: Set<string>;
  settings: ExtensionSettings;
  showHanViet: boolean;
  isVietnamese: boolean;
  t: ReturnType<typeof useTranslation>["t"];
  loadCards: () => Promise<void>;
}

export function useVocabularyExports({
  cards,
  selectedIds,
  settings,
  showHanViet,
  isVietnamese,
  t,
  loadCards,
}: VocabularyExportOptions) {
  const [ankiExporting, setAnkiExporting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const handleExportCSV = (specificCards?: SrsCard[]) => {
    const targetCards =
      specificCards ||
      (selectedIds.size > 0
        ? cards.filter((c) => selectedIds.has(c.id))
        : cards);
    if (targetCards.length === 0) return;

    const csvContent = createVocabularyCsv(targetCards, showHanViet);

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `hakkutsu-vocabulary-${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleBackup = async () => {
    try {
      setBackupBusy(true);
      const backup = await createVocabularyBackup();
      downloadVocabularyBackup(backup);
    } catch (err) {
      console.error("Vocabulary backup failed:", err);
      alert(
        isVietnamese
          ? "Không thể tạo bản sao lưu."
          : "Could not create the backup.",
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setBackupBusy(true);
      const result = await restoreVocabularyBackup(file);
      await loadCards();
      alert(
        isVietnamese
          ? `Đã khôi phục ${result.cards} thẻ. Dữ liệu hiện có được giữ lại.`
          : `Restored ${result.cards} cards. Existing data was kept.`,
      );
    } catch (err) {
      console.error("Vocabulary restore failed:", err);
      alert(
        err instanceof Error ? err.message : "Could not restore this backup.",
      );
    } finally {
      event.target.value = "";
      setBackupBusy(false);
    }
  };

  const handleExportAnki = async (specificCards?: SrsCard[]) => {
    const targetCards =
      specificCards ||
      (selectedIds.size > 0
        ? cards.filter((c) => selectedIds.has(c.id))
        : cards);
    if (targetCards.length === 0) return;

    try {
      setAnkiExporting(true);
      const connected = await ankiClient.isConnected();
      if (!connected) {
        alert(
          t("vocab_anki_not_connected") ||
            "AnkiConnect is not connected. Please ensure Anki app is running with AnkiConnect enabled.",
        );
        return;
      }

      let count = 0;
      const errors: string[] = [];

      for (const card of targetCards) {
        try {
          await ankiClient.exportVocabulary(
            {
              word: card.word,
              reading: card.reading || "",
              meaning: card.meaning || "",
              sentence: card.sentence || "",
              wordFurigana: card.word_furigana,
              sentenceFurigana: card.sentence_furigana,
              sentenceMeaning: card.sentence_meaning,
              vietnameseSound: card.vietnamese_sound,
              sourceUrl: card.source_url,
              jlptLevel: card.jlpt || "",
              pos: "Word",
              imageUrl: card.image_url,
            },
            settings.ankiDeck,
            settings.ankiModel,
            settings.ankiFieldMap,
          );
          count++;
        } catch (cardErr: any) {
          console.error(`Anki export error for "${card.word}":`, cardErr);
          errors.push(`"${card.word}": ${cardErr.message || cardErr}`);
        }
      }

      if (errors.length > 0) {
        if (count > 0) {
          alert(
            isVietnamese
              ? `Đã xuất ${count}/${targetCards.length} từ sang Anki.\n\nMột số từ bị lỗi:\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\nvà ${errors.length - 5} lỗi khác...` : ""}`
              : `Exported ${count}/${targetCards.length} cards to Anki.\n\nFailed items:\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\nand ${errors.length - 5} more errors...` : ""}`,
          );
        } else {
          alert(
            isVietnamese
              ? `Xuất sang Anki thất bại:\n${errors.slice(0, 5).join("\n")}`
              : `Failed to export to Anki:\n${errors.slice(0, 5).join("\n")}`,
          );
        }
      } else {
        alert(
          isVietnamese
            ? `Đã xuất ${count} từ sang Anki thành công!`
            : `Exported ${count} cards to Anki successfully!`,
        );
      }
    } catch (e: any) {
      console.error("Anki export error:", e);
      alert(e.message || "Failed to export to Anki");
    } finally {
      setAnkiExporting(false);
    }
  };

  return {
    ankiExporting,
    backupBusy,
    backupInputRef,
    handleExportCSV,
    handleBackup,
    handleRestore,
    handleExportAnki,
  };
}
