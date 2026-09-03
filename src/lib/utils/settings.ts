import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import type { ExtensionSettings } from "~lib/types";
import { DEFAULT_SETTINGS } from "~lib/types";

interface SettingsState {
  settings: ExtensionSettings;
  isHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  updateSettings: (patch: Partial<ExtensionSettings>) => void;
}

const chromeStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const result = await chrome.storage.sync.get(name);
      return result[name] || null;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await chrome.storage.sync.set({ [name]: value });
  },
  removeItem: async (name: string): Promise<void> => {
    await chrome.storage.sync.remove(name);
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      isHydrated: false,
      setHasHydrated: (state) => set({ isHydrated: state }),
      updateSettings: (patch) =>
        set((state) => ({
          settings: { ...state.settings, ...patch },
        })),
    }),
    {
      name: "hakkutsu_settings",
      storage: createJSONStorage(() => chromeStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Sync state across different extension contexts (e.g. options page, popup, background)
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes["hakkutsu_settings"]) {
      // Trigger a rehydrate if it was changed in another context
      useSettingsStore.persist.rehydrate();
    }
  });
}
