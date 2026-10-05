import type { VocabularyEntry } from "~/features/vocabulary/types";

const VOCAB_KEY = "hakkutsu_vocabulary";

/** Get vocabulary history from chrome.storage.local */
export async function getVocabulary(): Promise<VocabularyEntry[]> {
  try {
    const result = await chrome.storage.local.get(VOCAB_KEY);
    return result[VOCAB_KEY] || [];
  } catch {
    return [];
  }
}

/** Add a vocabulary entry to local storage */
export async function addVocabulary(
  entry: Omit<VocabularyEntry, "id" | "addedAt">
): Promise<VocabularyEntry> {
  const vocab = await getVocabulary();
  const newEntry: VocabularyEntry = {
    ...entry,
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    exported: false,
  };

  vocab.unshift(newEntry);

  // Keep last 1000 entries
  const trimmed = vocab.slice(0, 1000);
  await chrome.storage.local.set({ [VOCAB_KEY]: trimmed });

  return newEntry;
}

/** Remove a vocabulary entry by ID */
export async function removeVocabulary(id: string): Promise<void> {
  const vocab = await getVocabulary();
  const filtered = vocab.filter((v) => v.id !== id);
  await chrome.storage.local.set({ [VOCAB_KEY]: filtered });
}

/** Mark a vocabulary entry as exported to Anki */
export async function markExported(id: string): Promise<void> {
  const vocab = await getVocabulary();
  const updated = vocab.map((v) =>
    v.id === id ? { ...v, exported: true } : v
  );
  await chrome.storage.local.set({ [VOCAB_KEY]: updated });
}
