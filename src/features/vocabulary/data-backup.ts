import type { SrsCard } from "~/features/srs/local-srs";
import { localSrs, validateSrsCards } from "~/features/srs/local-srs";

const BACKUP_KIND = "hakkutsu-vocabulary-backup";
const BACKUP_VERSION = 1;
const LEGACY_VOCABULARY_KEY = "hakkutsu_vocabulary";

export interface HakkutsuBackup {
  kind: typeof BACKUP_KIND;
  formatVersion: typeof BACKUP_VERSION;
  extensionVersion: string;
  exportedAt: string;
  cards: SrsCard[];
  legacyVocabulary: unknown[];
}

export interface RestoreResult {
  cards: number;
  legacyVocabulary: number;
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

export async function createVocabularyBackup(): Promise<HakkutsuBackup> {
  const [cards, stored] = await Promise.all([
    localSrs.getAllSrsCards(),
    chrome.storage.local.get(LEGACY_VOCABULARY_KEY),
  ]);
  return {
    kind: BACKUP_KIND,
    formatVersion: BACKUP_VERSION,
    extensionVersion: extensionVersion(),
    exportedAt: new Date().toISOString(),
    cards,
    legacyVocabulary: Array.isArray(stored[LEGACY_VOCABULARY_KEY])
      ? stored[LEGACY_VOCABULARY_KEY]
      : [],
  };
}

export function downloadVocabularyBackup(backup: HakkutsuBackup): void {
  const date = backup.exportedAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `hakkutsu-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isBackup(value: unknown): value is HakkutsuBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<HakkutsuBackup>;
  return (
    backup.kind === BACKUP_KIND &&
    backup.formatVersion === BACKUP_VERSION &&
    Array.isArray(backup.cards) &&
    Array.isArray(backup.legacyVocabulary)
  );
}

export async function restoreVocabularyBackup(file: File): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isBackup(parsed)) {
    throw new Error("This is not a supported Hakkutsu backup file.");
  }

  validateSrsCards(parsed.cards);
  for (const [index, entry] of parsed.legacyVocabulary.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Backup vocabulary entry ${index + 1} is invalid.`);
    const item = entry as { id?: unknown; word?: unknown };
    if (typeof item.word !== "string" || !item.word.trim() ||
      (item.id !== undefined && (typeof item.id !== "string" || !item.id.trim()))) {
      throw new Error(`Backup vocabulary entry ${index + 1} has an invalid word or ID.`);
    }
    const record = entry as Record<string, unknown>;
    for (const field of ["reading", "meaning", "context", "sourceUrl", "imageUrl"]) {
      if (record[field] !== undefined && typeof record[field] !== "string") throw new Error(`Backup vocabulary entry ${index + 1} has an invalid ${field}.`);
    }
    if ((record.addedAt !== undefined && !Number.isFinite(record.addedAt)) ||
      (record.exported !== undefined && typeof record.exported !== "boolean")) throw new Error(`Backup vocabulary entry ${index + 1} has invalid metadata.`);
    if (record.jlptLevel !== undefined && record.jlptLevel !== null && typeof record.jlptLevel !== "string") {
      throw new Error(`Backup vocabulary entry ${index + 1} has an invalid JLPT level.`);
    }
  }
  // Read both stores before making any changes; a denied storage read must not
  // leave half of a backup restored.
  const current = await chrome.storage.local.get(LEGACY_VOCABULARY_KEY);
  const existing = Array.isArray(current[LEGACY_VOCABULARY_KEY])
    ? current[LEGACY_VOCABULARY_KEY]
    : [];
  const merged = new Map<string, Record<string, unknown>>();
  const usedIds = new Set<string>();
  for (const entry of [...existing, ...parsed.legacyVocabulary]) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.word !== "string" || !item.word.trim()) continue;
    const key = item.word.trim().toLocaleLowerCase();
    const saved = merged.get(key);
    let id = saved?.id as string || (typeof item.id === "string" && item.id ? item.id : crypto.randomUUID());
    while (!saved && usedIds.has(id)) id = crypto.randomUUID();
    // Legacy history has no update timestamp. Preserve saved fields and fill
    // missing information from the backup, including its exported status.
    merged.set(key, { ...item, ...saved, id, word: saved?.word || item.word.trim(),
      exported: saved?.exported === true || item.exported === true });
    usedIds.add(id);
  }
  const cards = await localSrs.restoreSrsCards(parsed.cards);
  try {
    await chrome.storage.local.set({ [LEGACY_VOCABULARY_KEY]: Array.from(merged.values()).map(item => ({
      reading: "", meaning: "", context: "", sourceUrl: "", jlptLevel: null, addedAt: Date.now(), ...item,
    })) });
  } catch {
    throw new Error("Cards were restored, but vocabulary history could not be saved. Retry this backup to finish restoring it.");
  }

  return { cards, legacyVocabulary: new Set(parsed.legacyVocabulary.map(entry => {
    const item = entry as { id?: string; word: string };
    return item.word.trim().toLocaleLowerCase();
  })).size };
}
