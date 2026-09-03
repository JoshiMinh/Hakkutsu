import { Database, Film, GraduationCap, Languages, Settings as SettingsIcon } from "lucide-react";
import type { ExtensionSettings } from "~lib/types";
import { t } from "~lib/languages/locales";
import { SUPPORTED_LANGUAGES } from "~lib/languages";
import ankiSvg from "data-base64:~assets/logo/anki.svg";
import kofiSvg from "data-base64:~assets/logo/kofi.svg";
import usFlag from "data-base64:~assets/language/en.png";
import vnFlag from "data-base64:~assets/language/vi.png";

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
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <SettingsIcon size={22} style={{ color: "var(--hk-accent-light, #c084fc)" }} />
          <h2 className="hk-settings-title" style={{ margin: 0 }}>{t("settings_title", currentLang)}</h2>
        </div>
        <p className="hk-settings-subtitle">{t("settings_subtitle", currentLang)}</p>
      </div>
      
      <form className="hk-settings-form" onSubmit={(e) => e.preventDefault()}>
        
        {/* Language Selection Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <Languages size={18} />
            </div>
            <h3 className="hk-settings-card__title">{t("settings_lang_section", currentLang)}</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div style={{ padding: "16px 18px" }}>
              <label className="hk-settings-row__label" style={{ marginBottom: "4px", display: "block" }}>
                {t("settings_lang_label", currentLang)}
              </label>
              <div className="hk-settings-row__desc" style={{ marginBottom: "14px" }}>
                {t("settings_lang_desc", currentLang)}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
                  const isSelected = currentLang === lang.code;
                  const flagImg = lang.code === "vi" ? vnFlag : usFlag;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => onUpdate({ targetLanguage: lang.code as "vi" | "en" })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "14px 16px",
                        borderRadius: "10px",
                        border: isSelected ? "2px solid var(--hk-accent-primary)" : "1px solid var(--hk-border)",
                        background: isSelected ? "rgba(168, 85, 247, 0.14)" : "var(--hk-bg-tertiary)",
                        color: "var(--hk-text-primary)",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        boxShadow: isSelected ? "0 4px 16px rgba(168, 85, 247, 0.25)" : "none",
                        textAlign: "left"
                      }}
                    >
                      <img 
                        src={flagImg} 
                        alt={lang.code} 
                        style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0 }} 
                      />
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 700 }}>{lang.nativeName}</div>
                        <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "2px" }}>
                          {lang.dictionaryName}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(255, 255, 255, 0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <label htmlFor="showHanViet" className="hk-settings-row__label" style={{ cursor: "pointer" }}>
                    {t("settings_hanviet", currentLang)}
                  </label>
                  <div className="hk-settings-row__desc">
                    {t("settings_hanviet_desc", currentLang)}
                  </div>
                </div>
                <label className="hk-toggle" htmlFor="showHanViet">
                  <input
                    id="showHanViet"
                    type="checkbox"
                    checked={settings.showHanViet !== false}
                    onChange={(e) => onUpdate({ showHanViet: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>
          </div>
        </section>





        {/* Immersion & Study Preferences Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <GraduationCap size={18} />
            </div>
            <h3 className="hk-settings-card__title">{t("settings_study_section", currentLang)}</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="srsEnabled" className="hk-settings-row__label">{t("settings_srs", currentLang)}</label>
                <div id="srsEnabled-desc" className="hk-settings-row__desc">{t("settings_srs_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="srsEnabled">
                  <input
                    id="srsEnabled"
                    aria-describedby="srsEnabled-desc"
                    type="checkbox"
                    checked={settings.srsEnabled !== false}
                    onChange={(e) => onUpdate({ srsEnabled: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="autoDetect" className="hk-settings-row__label">{t("settings_autodetect", currentLang)}</label>
                <div id="autoDetect-desc" className="hk-settings-row__desc">{t("settings_autodetect_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="autoDetect">
                  <input
                    id="autoDetect"
                    aria-describedby="autoDetect-desc"
                    type="checkbox"
                    checked={!!settings.autoDetect}
                    onChange={(e) => onUpdate({ autoDetect: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="showFurigana" className="hk-settings-row__label">{t("settings_furigana", currentLang)}</label>
                <div id="showFurigana-desc" className="hk-settings-row__desc">{t("settings_furigana_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="showFurigana">
                  <input
                    id="showFurigana"
                    aria-describedby="showFurigana-desc"
                    type="checkbox"
                    checked={settings.showFurigana !== false}
                    onChange={(e) => onUpdate({ showFurigana: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="showJlptColors" className="hk-settings-row__label">{t("settings_jlpt_colors", currentLang)}</label>
                <div id="showJlptColors-desc" className="hk-settings-row__desc">{t("settings_jlpt_colors_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="showJlptColors">
                  <input
                    id="showJlptColors"
                    aria-describedby="showJlptColors-desc"
                    type="checkbox"
                    checked={settings.showJlptColors !== false}
                    onChange={(e) => onUpdate({ showJlptColors: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* Subtitles & Immersion Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Film size={18} />
            </div>
            <h3 className="hk-settings-card__title">{t("settings_video_section", currentLang)}</h3>
          </header>

          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="subtitlesEnabled" className="hk-settings-row__label">
                  {t("settings_autofetch_sub", currentLang) || "Enable Video Subtitles"}
                </label>
                <div id="subtitlesEnabled-desc" className="hk-settings-row__desc">
                  {t("settings_autofetch_sub_desc", currentLang) || "Enable interactive Japanese subtitles on YouTube and Netflix"}
                </div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="subtitlesEnabled">
                  <input
                    id="subtitlesEnabled"
                    aria-describedby="subtitlesEnabled-desc"
                    type="checkbox"
                    checked={settings.subtitlesEnabled !== false}
                    onChange={(e) => onUpdate({ subtitlesEnabled: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="subtitlesSecondary" className="hk-settings-row__label">
                  {t("sub_modal_track_secondary", currentLang) || "Secondary Subtitles (Dual Translation)"}
                </label>
                <div id="subtitlesSecondary-desc" className="hk-settings-row__desc">
                  Display secondary translated or native subtitle line beneath Japanese text
                </div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="subtitlesSecondary">
                  <input
                    id="subtitlesSecondary"
                    aria-describedby="subtitlesSecondary-desc"
                    type="checkbox"
                    checked={settings.subtitlesSecondaryEnabled !== false}
                    onChange={(e) => onUpdate({ subtitlesSecondaryEnabled: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="subtitlesAutoPause" className="hk-settings-row__label">
                  {t("settings_sub_autopause", currentLang) || "Auto-Pause Playback"}
                </label>
                <div id="subtitlesAutoPause-desc" className="hk-settings-row__desc">
                  {t("settings_sub_autopause_desc", currentLang) || "Automatically pause playback after each subtitle line for study"}
                </div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="subtitlesAutoPause">
                  <input
                    id="subtitlesAutoPause"
                    aria-describedby="subtitlesAutoPause-desc"
                    type="checkbox"
                    checked={Boolean(settings.subtitlesAutoPause)}
                    onChange={(e) => onUpdate({ subtitlesAutoPause: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="subtitlesFontSize" className="hk-settings-row__label">
                  {t("settings_sub_fontsize", currentLang) || "Subtitle Font Size"} ({settings.subtitlesFontSize || 26}px)
                </label>
                <div id="subtitlesFontSize-desc" className="hk-settings-row__desc">
                  {t("settings_sub_fontsize_desc", currentLang) || "Adjust subtitle text scale on video player overlays"}
                </div>
              </div>
              <div className="hk-settings-row__control" style={{ width: "160px" }}>
                <input
                  id="subtitlesFontSize"
                  aria-describedby="subtitlesFontSize-desc"
                  type="range"
                  min="18"
                  max="38"
                  value={settings.subtitlesFontSize || 26}
                  onChange={(e) => onUpdate({ subtitlesFontSize: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: "var(--hk-accent-primary)" }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Anki Integration Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src={ankiSvg} alt="Anki" style={{ width: 17, height: 17 }} />
            </div>
            <h3 className="hk-settings-card__title">{t("settings_anki_section", currentLang)}</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="ankiDeck" className="hk-settings-row__label">{t("settings_anki_deck", currentLang)}</label>
                <div id="ankiDeck-desc" className="hk-settings-row__desc">{t("settings_anki_deck_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="ankiDeck"
                  aria-describedby="ankiDeck-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="text"
                  value={settings.ankiDeck || ""}
                  onChange={(e) => onUpdate({ ankiDeck: e.target.value })}
                />
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="ankiModel" className="hk-settings-row__label">{t("settings_anki_model", currentLang)}</label>
                <div id="ankiModel-desc" className="hk-settings-row__desc">{t("settings_anki_model_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="ankiModel"
                  aria-describedby="ankiModel-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="text"
                  value={settings.ankiModel || ""}
                  onChange={(e) => onUpdate({ ankiModel: e.target.value })}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Ko-fi Support Card */}
        <section className="hk-settings-card" style={{ border: "1px solid rgba(255, 94, 91, 0.3)", background: "rgba(255, 94, 91, 0.06)" }}>
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#ff5e5b" }}>Support Hakkutsu Development</h3>
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--hk-text-muted)" }}>If you enjoy using Hakkutsu, consider buying me a coffee on Ko-fi!</p>
            </div>
            <a
              href="https://ko-fi.com/joshiminh"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                background: "#ff5e5b",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "12px",
                textDecoration: "none",
                flexShrink: 0,
                boxShadow: "0 4px 12px rgba(255, 94, 91, 0.3)"
              }}
            >
              <img src={kofiSvg} alt="Ko-fi" style={{ width: 16, height: 16, objectFit: "contain" }} />
              Support on Ko-fi
            </a>
          </div>
        </section>

      </form>

      <div className="hk-settings-footer">
        <strong className="hk-settings-footer__title">Hakkutsu v0.1.3</strong>
        <p className="hk-settings-footer__desc">
          {t("settings_footer_built", currentLang)}<br />
          Built with Plasmo, React, TypeScript. • <a href="https://ko-fi.com/joshiminh" target="_blank" rel="noopener noreferrer" style={{ color: "#ff5e5b", textDecoration: "none" }}>Support on Ko-fi</a>
        </p>
      </div>
    </div>
  );
}

export default SettingsView;

