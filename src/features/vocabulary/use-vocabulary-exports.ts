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
  t: ReturnType<typeof useTranslation>["t"];
  loadCards: () => Promise<void>;
}

export function useVocabularyExports({
  cards,
  selectedIds,
  settings,
  showHanViet,
  t,
  loadCards,
}: VocabularyExportOptions) {
  const [ankiExporting, setAnkiExporting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [operationError, setOperationError] = useState<unknown>();
  const [operationMessage, setOperationMessage] = useState("");
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
      setOperationError(undefined); setOperationMessage("");
      const backup = await createVocabularyBackup();
      downloadVocabularyBackup(backup);
    } catch (err) {
      console.error("Vocabulary backup failed:", err);
      setOperationError(err);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setBackupBusy(true);
      setOperationError(undefined); setOperationMessage("");
      const result = await restoreVocabularyBackup(file);
      await loadCards();
      setOperationMessage(`${t("anki_restored")}: ${result.cards}`);
    } catch (err) {
      console.error("Vocabulary restore failed:", err);
      setOperationError(err);
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
      setOperationError(undefined); setOperationMessage("");
      const connected = await ankiClient.isConnected();
      if (!connected) {
        setOperationError(new Error("AnkiConnect not connected"));
        return;
      }

      let count = 0;
      const errors: string[] = [];

      for (const card of targetCards) {
        try {
          if (card.anki) throw new Error("Use Sync with Anki to update linked vocabulary.");
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
              audio: card.word_audio,
              sentenceAudio: card.sentence_audio,
              notes: card.notes,
              picture: card.picture,
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

      setOperationMessage(`${t("anki_completed")}: ${count} · ${t("anki_failed")}: ${errors.length}`);
      if (errors.length) setOperationError(new Error(errors.join("\n")));
    } catch (e: any) {
      console.error("Anki export error:", e);
      setOperationError(e);
    } finally {
      setAnkiExporting(false);
    }
  };

  return {
    ankiExporting,
    backupBusy,
    backupInputRef,
    operationError,
    operationMessage,
    handleExportCSV,
    handleBackup,
    handleRestore,
    handleExportAnki,
  };
}
