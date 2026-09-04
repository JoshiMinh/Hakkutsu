import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Database, Film, GraduationCap, Languages, Settings as SettingsIcon } from "lucide-react";
import type { ExtensionSettings } from "~lib/utils/types";
import { t } from "~lib/locales";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "~lib/locales";
import ankiSvg from "data-base64:../../assets/logo/anki.png";
import kofiSvg from "data-base64:../../assets/logo/kofi.png";
import usFlag from "data-base64:../../assets/language/en.png";
import vnFlag from "data-base64:../../assets/language/vi.png";
import zhFlag from "data-base64:../../assets/language/zh.png";
import jaFlag from "data-base64:../../assets/language/ja.png";
import koFlag from "data-base64:../../assets/language/ko.png";

const FLAG_MAP: Record<string, string> = {
  vi: vnFlag,
  en: usFlag,
  zh: zhFlag,
  ja: jaFlag,
  ko: koFlag,
};

function CustomLanguageDropdown({
  value,
  onChange,
}: {
  value: SupportedLanguageCode;
  onChange: (code: SupportedLanguageCode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLangObj = SUPPORTED_LANGUAGES[value] || SUPPORTED_LANGUAGES.vi;

  return (
    <div ref={containerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "#18181c",
          border: "1.5px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "10px",
          padding: "8px 12px",
          color: "#fff",
          fontSize: "13px",
          fontWeight: 700,
          cursor: "pointer",
          outline: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          transition: "all 0.2s ease",
        }}
      >
        <img
          src={FLAG_MAP[value] || FLAG_MAP.vi}
          alt={value}
          style={{ width: "20px", height: "20px", objectFit: "contain", borderRadius: "2px" }}
        />
        <span>{currentLangObj.nativeName}</span>
        <ChevronDown
          size={14}
          style={{
            color: "#a1a1aa",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 1000,
            minWidth: "160px",
            backgroundColor: "#18181c",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "12px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            padding: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            backdropFilter: "blur(12px)",
          }}
        >
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = lang.code === value;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onChange(lang.code as SupportedLanguageCode);
                  setIsOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: isSelected ? "rgba(192, 132, 252, 0.12)" : "transparent",
                  color: isSelected ? "#c084fc" : "#e4e4e7",
                  fontSize: "13px",
                  fontWeight: isSelected ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <img
                    src={FLAG_MAP[lang.code] || FLAG_MAP.vi}
                    alt={lang.code}
                    style={{ width: "20px", height: "20px", objectFit: "contain", borderRadius: "2px" }}
                  />
                  <span>{lang.nativeName}</span>
                </div>
                {isSelected && <Check size={14} style={{ color: "#c084fc", marginLeft: "8px" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label className="hk-settings-row__label">
                  {t("settings_lang_label", currentLang)}
                </label>
                <div className="hk-settings-row__desc">
                  {t("settings_lang_desc", currentLang)}
                </div>
              </div>
              <div className="hk-settings-row__control">
                <CustomLanguageDropdown
                  value={currentLang}
                  onChange={(code) => onUpdate({ targetLanguage: code })}
                />
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="showHanViet" className="hk-settings-row__label">
                  {t("settings_hanviet", currentLang)}
                </label>
                <div id="showHanViet-desc" className="hk-settings-row__desc">
                  {t("settings_hanviet_desc", currentLang)}
                </div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="showHanViet">
                  <input
                    id="showHanViet"
                    aria-describedby="showHanViet-desc"
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
                <label htmlFor="showFuriganaSub" className="hk-settings-row__label">
                  {t("settings_furigana", currentLang)}
                </label>
                <div id="showFuriganaSub-desc" className="hk-settings-row__desc">
                  {t("settings_furigana_desc", currentLang)}
                </div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="showFuriganaSub">
                  <input
                    id="showFuriganaSub"
                    aria-describedby="showFuriganaSub-desc"
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

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="subtitlesOffset" className="hk-settings-row__label">
                  {t("sub_modal_sync_offset", currentLang)} ({settings.subtitlesOffset ? (settings.subtitlesOffset > 0 ? `+${settings.subtitlesOffset.toFixed(1)}s` : `${settings.subtitlesOffset.toFixed(1)}s`) : "0.0s"})
                </label>
                <div id="subtitlesOffset-desc" className="hk-settings-row__desc">
                  Adjust subtitle timing delay or advance to sync with audio
                </div>
              </div>
              <div className="hk-settings-row__control" style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => onUpdate({ subtitlesOffset: Number(((settings.subtitlesOffset || 0) - 0.5).toFixed(1)) })}
                  style={{ padding: "5px 9px", borderRadius: "6px", background: "var(--hk-bg-tertiary, #18181c)", border: "1px solid var(--hk-border, rgba(255, 255, 255, 0.14))", color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
                >
                  -500ms
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ subtitlesOffset: Number(((settings.subtitlesOffset || 0) - 0.1).toFixed(1)) })}
                  style={{ padding: "5px 9px", borderRadius: "6px", background: "var(--hk-bg-tertiary, #18181c)", border: "1px solid var(--hk-border, rgba(255, 255, 255, 0.14))", color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
                >
                  -100ms
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ subtitlesOffset: 0 })}
                  style={{ padding: "5px 9px", borderRadius: "6px", background: "var(--hk-bg-tertiary, #18181c)", border: "1px solid var(--hk-border, rgba(255, 255, 255, 0.14))", color: settings.subtitlesOffset ? "#c084fc" : "#a1a1aa", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
                >
                  {t("sub_modal_reset", currentLang)}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ subtitlesOffset: Number(((settings.subtitlesOffset || 0) + 0.1).toFixed(1)) })}
                  style={{ padding: "5px 9px", borderRadius: "6px", background: "var(--hk-bg-tertiary, #18181c)", border: "1px solid var(--hk-border, rgba(255, 255, 255, 0.14))", color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
                >
                  +100ms
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ subtitlesOffset: Number(((settings.subtitlesOffset || 0) + 0.5).toFixed(1)) })}
                  style={{ padding: "5px 9px", borderRadius: "6px", background: "var(--hk-bg-tertiary, #18181c)", border: "1px solid var(--hk-border, rgba(255, 255, 255, 0.14))", color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
                >
                  +500ms
                </button>
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

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="includeImages" className="hk-settings-row__label">Include Illustrations & Images</label>
                <div id="includeImages-desc" className="hk-settings-row__desc">Automatically attach Irasutoya illustration images to cards and Anki exports</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="includeImages">
                  <input
                    id="includeImages"
                    aria-describedby="includeImages-desc"
                    type="checkbox"
                    checked={settings.includeImages !== false}
                    onChange={(e) => onUpdate({ includeImages: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="ankiImageField" className="hk-settings-row__label">Anki Image Field Name</label>
                <div id="ankiImageField-desc" className="hk-settings-row__desc">Name of the Anki card field to store illustration image tag</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="ankiImageField"
                  aria-describedby="ankiImageField-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="text"
                  value={settings.ankiImageField || "Image"}
                  onChange={(e) => onUpdate({ ankiImageField: e.target.value })}
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

