import type { SrsCard } from "./local-srs";
import { localSrs } from "./local-srs";

const BACKUP_KIND = "hakkutsu-vocabulary-backup";
const BACKUP_VERSION = 1;
const LEGACY_VOCABULARY_KEY = "hakkutsu_vocabulary";

interface HakkutsuBackup {
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
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isBackup(parsed)) {
    throw new Error("This is not a supported Hakkutsu backup file.");
  }

  const cards = await localSrs.restoreSrsCards(parsed.cards);
  const current = await chrome.storage.local.get(LEGACY_VOCABULARY_KEY);
  const existing = Array.isArray(current[LEGACY_VOCABULARY_KEY])
    ? current[LEGACY_VOCABULARY_KEY]
    : [];
  const merged = new Map<string, unknown>();
  for (const entry of [...existing, ...parsed.legacyVocabulary]) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { id?: string; word?: string };
    const key = item.id || item.word?.trim().toLocaleLowerCase();
    if (key) merged.set(key, entry);
  }
  await chrome.storage.local.set({ [LEGACY_VOCABULARY_KEY]: Array.from(merged.values()) });

  return { cards, legacyVocabulary: parsed.legacyVocabulary.length };
}
