import { useState, useEffect } from "react";
import { localSrs } from "~/features/srs/local-srs";
import type { SrsCard } from "~/features/srs/local-srs";
import { lookupWord } from "~/features/dictionary/dictionary-lookup";
import type { useTranslation } from "~/shared/locales";

export function useVocabularyCards(
  userId: string,
  lang: ReturnType<typeof useTranslation>["lang"],
) {
  const [cards, setCards] = useState<SrsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCards();
  }, [userId, lang]);

  const loadCards = async () => {
    try {
      setLoading(true);
      const data = await localSrs.getAllSrsCards();

      const updatedData = [...data];
      await Promise.all(
        updatedData.map(async (c, idx) => {
          let updated = false;
          const patch: Partial<SrsCard> = {};

          if (
            !c.meaning ||
            c.meaning.trim() === "" ||
            c.meaning === "—" ||
            !c.reading
          ) {
            const info = await lookupWord(c.word, lang);
            if (info.meaning) {
              patch.meaning = info.meaning;
              patch.reading = c.reading || info.reading;
              patch.jlpt = c.jlpt || info.jlpt;
              if (
                typeof info.frequency_rank === "number" &&
                !c.frequency_rank
              ) {
                patch.frequency_rank = info.frequency_rank;
              }
              updated = true;
            }
          }

          if (!c.word_furigana && c.reading) {
            patch.word_furigana = `${c.word}[${c.reading}]`;
            updated = true;
          }

          if (updated) {
            updatedData[idx] = { ...c, ...patch };
            localSrs.updateSrsCard(c.id, patch).catch(() => {});
          }
        }),
      );

      setCards(updatedData);
    } catch (err: any) {
      setError(err.message || "Failed to load vocabulary");
    } finally {
      setLoading(false);
    }
  };

  return { cards, setCards, loading, error, loadCards };
}
