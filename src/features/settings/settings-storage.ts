import type { ExtensionSettings } from "~/features/settings/types";
import { DEFAULT_SETTINGS } from "~/features/settings/types";

const SETTINGS_KEY = "hakkutsu_settings";

/** Get extension settings from chrome.storage.sync */
export async function getSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const stored = result[SETTINGS_KEY];
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    // Zustand persists a JSON envelope; older versions stored settings directly.
    return { ...DEFAULT_SETTINGS, ...(parsed?.state?.settings ?? parsed ?? {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Save extension settings to chrome.storage.sync */
export async function saveSettings(
  settings: Partial<ExtensionSettings>
): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: JSON.stringify({ state: { settings: updated }, version: 0 }) });
}

