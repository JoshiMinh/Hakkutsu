import { RefreshCw } from "lucide-react";
import { t } from "~/shared/locales";
import type { SettingsSectionProps } from "./section-props";
import { CustomSelect, FeatureSwitch } from "./controls";
import { useAnkiSettings } from "./use-anki-settings";
const ankiSvg = "/assets/logo/anki.png";

export function AnkiSettings({ settings, onUpdate }: SettingsSectionProps) {
  const currentLang = settings.targetLanguage || "vi";
  const {
    decks,
    models,
    fields,
    ankiConnected,
    loadingAnki,
    fetchAnkiData,
    handleModelChange,
    inferDefaultMapping,
  } = useAnkiSettings(settings, onUpdate);
  const FIELD_OPTIONS = [
    { value: "none", label: "-- None (Leave Empty) --" },
    { value: "word", label: "Word (Kanji / Base)" },
    { value: "reading", label: "Word Reading (Hiragana / Kana)" },
    { value: "wordFurigana", label: "Word Furigana (HTML Ruby)" },
    { value: "meaning", label: "Word Meaning (Definition)" },
    { value: "vietnameseSound", label: "Sino-Vietnamese Sound (Hán-Việt)" },
    { value: "sentence", label: "Example Sentence (Japanese)" },
    { value: "sentenceFurigana", label: "Sentence Furigana (HTML Ruby)" },
    { value: "sentenceReading", label: "Sentence Reading (Hiragana)" },
    { value: "sentenceMeaning", label: "Sentence Meaning / Translation" },
    { value: "jlptLevel", label: "JLPT Level (N5-N1)" },
    { value: "pos", label: "Part of Speech" },
    { value: "imageUrl", label: "Illustration Image" },
    { value: "screenshot", label: "Video Screenshot" },
    { value: "sourceUrl", label: "Video Context Link" },
    { value: "audio", label: "Word Audio" },
    { value: "sentenceAudio", label: "Sentence Audio" },
    { value: "frontHtml", label: "Formatted Front Card (Default HTML)" },
    { value: "backHtml", label: "Formatted Back Card (Default HTML)" },
  ];
  return (
    <section className="hk-settings-card">
      <header className="hk-settings-card__header hk-anki-header">
        <div className="hk-anki-header__title">
          <div
            className="hk-settings-card__icon"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img src={ankiSvg} alt="Anki" style={{ width: 17, height: 17 }} />
          </div>
          <h3 className="hk-settings-card__title">
            {t("settings_anki_section", currentLang)}
          </h3>
          <button
            type="button"
            onClick={() => fetchAnkiData()}
            disabled={loadingAnki || settings.ankiEnabled === false}
            className="hk-anki-refresh"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              color: "#e4e4e7",
              cursor: loadingAnki ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={13} className={loadingAnki ? "hk-spin" : ""} />
            {loadingAnki ? "Refreshing..." : "Refresh Anki"}
          </button>
        </div>

        <FeatureSwitch
          label={t("settings_anki_section", currentLang)}
          checked={settings.ankiEnabled !== false}
          onChange={(enabled) => onUpdate({ ankiEnabled: enabled })}
        />
      </header>

      <fieldset
        className="hk-settings-card__body hk-feature-body"
        disabled={settings.ankiEnabled === false}
      >
        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label htmlFor="ankiModel" className="hk-settings-row__label">
              {t("settings_anki_model", currentLang)}
            </label>
            <div id="ankiModel-desc" className="hk-settings-row__desc">
              Select Anki Note Type model from AnkiConnect
            </div>
          </div>
          <div className="hk-settings-row__control">
            {models.length > 0 ? (
              <CustomSelect
                value={settings.ankiModel || ""}
                onChange={(val) => handleModelChange(val)}
                options={models.map((m) => ({ value: m, label: m }))}
                width="260px"
              />
            ) : (
              <input
                id="ankiModel"
                aria-describedby="ankiModel-desc"
                className="hk-settings-input hk-settings-input--text"
                type="text"
                value={settings.ankiModel || ""}
                onChange={(e) => handleModelChange(e.target.value)}
                placeholder="e.g. Basic"
              />
            )}
          </div>
        </div>

        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label htmlFor="ankiDeck" className="hk-settings-row__label">
              {t("settings_anki_deck", currentLang)}
            </label>
            <div id="ankiDeck-desc" className="hk-settings-row__desc">
              {t("settings_anki_deck_desc", currentLang)}
            </div>
          </div>
          <div className="hk-settings-row__control">
            {decks.length > 0 ? (
              <CustomSelect
                value={settings.ankiDeck || ""}
                onChange={(val) => onUpdate({ ankiDeck: val })}
                options={decks.map((d) => ({ value: d, label: d }))}
                width="260px"
              />
            ) : (
              <input
                id="ankiDeck"
                aria-describedby="ankiDeck-desc"
                className="hk-settings-input hk-settings-input--text"
                type="text"
                value={settings.ankiDeck || ""}
                onChange={(e) => onUpdate({ ankiDeck: e.target.value })}
                placeholder="e.g. Hakkutsu"
              />
            )}
          </div>
        </div>

        {/* Note Type Field Mappings */}
        {fields.length > 0 && (
          <div style={{ paddingTop: "16px" }}>
            <div
              style={{
                padding: "0 18px 12px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div>
                <h4
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#c084fc",
                    margin: "0 0 4px 0",
                  }}
                >
                  Note Field Mappings ({settings.ankiModel})
                </h4>
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--hk-text-muted)",
                    margin: 0,
                  }}
                >
                  Map each field of your Anki note type to the corresponding
                  Hakkutsu data option
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const newMap: Record<string, string> = {};
                  for (const f of fields) {
                    newMap[f] = inferDefaultMapping(f);
                  }
                  onUpdate({ ankiFieldMap: newMap });
                }}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  background: "rgba(192, 132, 252, 0.12)",
                  border: "1px solid rgba(192, 132, 252, 0.3)",
                  color: "#c084fc",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title="Auto-assign default mapping options to all fields based on field names"
              >
                Auto-Assign Mappings
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {fields.map((field, idx) => {
                const currentMapping =
                  (settings.ankiFieldMap && settings.ankiFieldMap[field]) ||
                  inferDefaultMapping(field);

                return (
                  <div
                    key={field}
                    className="hk-settings-row"
                    style={{
                      padding: "12px 18px",
                      borderBottom:
                        idx === fields.length - 1
                          ? "none"
                          : "1px solid rgba(255, 255, 255, 0.06)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div className="hk-settings-row__info">
                      <label
                        className="hk-settings-row__label"
                        style={{ fontSize: "13.5px", fontWeight: 600 }}
                      >
                        {field}
                      </label>
                    </div>

                    <div className="hk-settings-row__control">
                      <CustomSelect
                        value={currentMapping}
                        onChange={(val) => {
                          const updatedMap = {
                            ...(settings.ankiFieldMap || {}),
                            [field]: val,
                          };
                          onUpdate({ ankiFieldMap: updatedMap });
                        }}
                        options={FIELD_OPTIONS}
                        width="260px"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!ankiConnected && (
          <div
            style={{
              margin: "12px 18px 0 18px",
              fontSize: "12px",
              color: "#f59e0b",
            }}
          >
            ⚠️ AnkiConnect not detected. Ensure Anki app is running with
            AnkiConnect add-on enabled, then click "Refresh Anki".
          </div>
        )}
      </fieldset>
    </section>
  );
}
