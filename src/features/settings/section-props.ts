import type { ExtensionSettings } from "~/features/settings/types";

export interface SettingsSectionProps {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}
