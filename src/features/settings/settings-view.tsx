import { Settings as SettingsIcon } from "lucide-react";
import type { ExtensionSettings } from "~/features/settings/types";
import { t } from "~/shared/locales";
import { LanguageSettings } from "./language-settings";
import { StudySettings } from "./study-settings";
import { SubtitleSettings } from "./subtitle-settings";
import { OcrSettings } from "./ocr-settings";
import { AnkiSettings } from "./anki-settings";
import { SupportSection } from "./support-section";

export function SettingsView({
  settings,
  onUpdate,
}: {
  settings: ExtensionSettings;
  onUpdate: (patch: Partial<ExtensionSettings>) => void;
}) {
  const currentLang = settings.targetLanguage || "vi";

  return (
    <div className="hk-content hk-fade-in">
      <div className="hk-settings-header">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "4px",
          }}
        >
          <SettingsIcon
            size={22}
            style={{ color: "var(--hk-accent-light, #c084fc)" }}
          />
          <h2 className="hk-settings-title" style={{ margin: 0 }}>
            {t("settings_title", currentLang)}
          </h2>
        </div>
        <p className="hk-settings-subtitle">
          {t("settings_subtitle", currentLang)}
        </p>
      </div>

      <form className="hk-settings-form" onSubmit={(e) => e.preventDefault()}>
        {/* Language Selection Card */}
        <LanguageSettings settings={settings} onUpdate={onUpdate} />

        {/* General: everyday reading and review preferences */}
        <StudySettings settings={settings} onUpdate={onUpdate} />

        {/* Immersion Card */}
        <SubtitleSettings settings={settings} onUpdate={onUpdate} />

        {/* Manga OCR image settings */}
        <OcrSettings settings={settings} onUpdate={onUpdate} />

        {/* Anki Integration Card */}
        <AnkiSettings settings={settings} onUpdate={onUpdate} />

        {/* Ko-fi Support Card */}
        <SupportSection />
      </form>
    </div>
  );
}

export default SettingsView;
