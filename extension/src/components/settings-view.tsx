import { Bot, Database, Film, GraduationCap, Languages, Sparkles, Settings as SettingsIcon } from "lucide-react";
import type { ExtensionSettings } from "~lib/types";
import { t } from "~lib/languages/locales";
import { SUPPORTED_LANGUAGES } from "~lib/languages";
import geminiSvg from "data-base64:~assets/logo/gemini.svg";
import openaiSvg from "data-base64:~assets/logo/openai.svg";
import ankiSvg from "data-base64:~assets/logo/anki.svg";
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

        {/* Translation LLM Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <Bot size={18} />
            </div>
            <h3 className="hk-settings-card__title">{t("settings_llm_section", currentLang)}</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
              <label className="hk-settings-row__label" style={{ marginBottom: "4px", display: "block" }}>
                {t("settings_llm_provider", currentLang)}
              </label>
              <div className="hk-settings-row__desc" style={{ marginBottom: "14px" }}>
                {t("settings_llm_provider_desc", currentLang)}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                {/* Google Gemini */}
                <button
                  type="button"
                  onClick={() => onUpdate({ llmProvider: "gemini" })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "14px 12px",
                    borderRadius: "10px",
                    border: settings.llmProvider === "gemini" ? "2px solid #a855f7" : "1px solid var(--hk-border)",
                    background: settings.llmProvider === "gemini" ? "rgba(168, 85, 247, 0.14)" : "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: settings.llmProvider === "gemini" ? "0 4px 16px rgba(168, 85, 247, 0.25)" : "none"
                  }}
                >
                  <img src={geminiSvg} alt="Gemini" style={{ width: 22, height: 22, marginBottom: "6px" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 700 }}>Google Gemini</div>
                    <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "2px" }}>Flash 2.0 / 1.5</div>
                  </div>
                </button>

                {/* OpenAI */}
                <button
                  type="button"
                  onClick={() => onUpdate({ llmProvider: "openai" })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "14px 12px",
                    borderRadius: "10px",
                    border: settings.llmProvider === "openai" ? "2px solid #10a37f" : "1px solid var(--hk-border)",
                    background: settings.llmProvider === "openai" ? "rgba(16, 163, 127, 0.14)" : "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: settings.llmProvider === "openai" ? "0 4px 16px rgba(16, 163, 127, 0.25)" : "none"
                  }}
                >
                  <img src={openaiSvg} alt="OpenAI" style={{ width: 22, height: 22, marginBottom: "6px" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 700 }}>OpenAI</div>
                    <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "2px" }}>GPT-4o / mini</div>
                  </div>
                </button>

                {/* Custom */}
                <button
                  type="button"
                  onClick={() => onUpdate({ llmProvider: "custom" })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "14px 12px",
                    borderRadius: "10px",
                    border: settings.llmProvider === "custom" ? "2px solid #3b82f6" : "1px solid var(--hk-border)",
                    background: settings.llmProvider === "custom" ? "rgba(59, 130, 246, 0.14)" : "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: settings.llmProvider === "custom" ? "0 4px 16px rgba(59, 130, 246, 0.25)" : "none"
                  }}
                >
                  <Sparkles size={20} style={{ color: "#3b82f6", marginBottom: "6px" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 700 }}>Custom API</div>
                    <div style={{ fontSize: "11px", color: "var(--hk-text-muted)", marginTop: "2px" }}>OpenRouter / Ollama</div>
                  </div>
                </button>
              </div>
            </div>

            {settings.llmProvider === "custom" && (
              <div className="hk-settings-row">
                <div className="hk-settings-row__info">
                  <label htmlFor="llmCustomUrl" className="hk-settings-row__label">{t("settings_llm_custom_url", currentLang)}</label>
                  <div id="llmCustomUrl-desc" className="hk-settings-row__desc">{t("settings_llm_custom_url_desc", currentLang)}</div>
                </div>
                <div className="hk-settings-row__control">
                  <input
                    id="llmCustomUrl"
                    aria-describedby="llmCustomUrl-desc"
                    className="hk-settings-input hk-settings-input--text"
                    type="text"
                    placeholder="https://openrouter.ai/api/v1"
                    value={settings.llmCustomUrl || ""}
                    onChange={(e) => onUpdate({ llmCustomUrl: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="llmApiKey" className="hk-settings-row__label">{t("settings_llm_key", currentLang)}</label>
                <div id="llmApiKey-desc" className="hk-settings-row__desc">{t("settings_llm_key_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="llmApiKey"
                  aria-describedby="llmApiKey-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="password"
                  placeholder="AIzaSy... or sk-..."
                  value={settings.llmApiKey || ""}
                  onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Video & Subtitles Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header">
            <div className="hk-settings-card__icon">
              <Film size={18} />
            </div>
            <h3 className="hk-settings-card__title">{t("settings_video_section", currentLang)}</h3>
          </header>
          
          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="autoFetchJapaneseSubtitles" className="hk-settings-row__label">{t("settings_autofetch_sub", currentLang)}</label>
                <div id="autoFetchJapaneseSubtitles-desc" className="hk-settings-row__desc">{t("settings_autofetch_sub_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="autoFetchJapaneseSubtitles">
                  <input
                    id="autoFetchJapaneseSubtitles"
                    aria-describedby="autoFetchJapaneseSubtitles-desc"
                    type="checkbox"
                    checked={settings.autoFetchJapaneseSubtitles !== false}
                    onChange={(e) => onUpdate({ autoFetchJapaneseSubtitles: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="universalVideoEnabled" className="hk-settings-row__label">{t("settings_universal_video", currentLang)}</label>
                <div id="universalVideoEnabled-desc" className="hk-settings-row__desc">{t("settings_universal_video_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="universalVideoEnabled">
                  <input
                    id="universalVideoEnabled"
                    aria-describedby="universalVideoEnabled-desc"
                    type="checkbox"
                    checked={settings.universalVideoEnabled !== false}
                    onChange={(e) => onUpdate({ universalVideoEnabled: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="autoPauseSubtitles" className="hk-settings-row__label">{t("settings_sub_autopause", currentLang)}</label>
                <div id="autoPauseSubtitles-desc" className="hk-settings-row__desc">{t("settings_sub_autopause_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="autoPauseSubtitles">
                  <input
                    id="autoPauseSubtitles"
                    aria-describedby="autoPauseSubtitles-desc"
                    type="checkbox"
                    checked={!!settings.autoPauseSubtitles}
                    onChange={(e) => onUpdate({ autoPauseSubtitles: e.target.checked })}
                  />
                  <span className="hk-toggle__slider" />
                </label>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="subtitleFontSize" className="hk-settings-row__label">{t("settings_sub_fontsize", currentLang)}</label>
                <div id="subtitleFontSize-desc" className="hk-settings-row__desc">{t("settings_sub_fontsize_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <select
                  id="subtitleFontSize"
                  className="hk-settings-input hk-settings-select"
                  value={settings.subtitleFontSize || "medium"}
                  onChange={(e) => onUpdate({ subtitleFontSize: e.target.value as "small" | "medium" | "large" })}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--hk-bg-tertiary)",
                    color: "var(--hk-text-primary)",
                    border: "1px solid var(--hk-border)",
                    cursor: "pointer"
                  }}
                >
                  <option value="small">Small (80%)</option>
                  <option value="medium">Medium (100%)</option>
                  <option value="large">Large (125%)</option>
                </select>
              </div>
            </div>

            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="jimakuApiKey" className="hk-settings-row__label">{t("settings_jimaku_key", currentLang)}</label>
                <div id="jimakuApiKey-desc" className="hk-settings-row__desc">{t("settings_jimaku_key_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <input
                  id="jimakuApiKey"
                  aria-describedby="jimakuApiKey-desc"
                  className="hk-settings-input hk-settings-input--text"
                  type="password"
                  placeholder="Bearer or user token..."
                  value={settings.jimakuApiKey || ""}
                  onChange={(e) => onUpdate({ jimakuApiKey: e.target.value })}
                />
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
                <label htmlFor="localOcrEnabled" className="hk-settings-row__label">{t("settings_ocr", currentLang)}</label>
                <div id="localOcrEnabled-desc" className="hk-settings-row__desc">{t("settings_ocr_desc", currentLang)}</div>
              </div>
              <div className="hk-settings-row__control">
                <label className="hk-toggle" htmlFor="localOcrEnabled">
                  <input
                    id="localOcrEnabled"
                    aria-describedby="localOcrEnabled-desc"
                    type="checkbox"
                    checked={!!settings.localOcrEnabled}
                    onChange={(e) => onUpdate({ localOcrEnabled: e.target.checked })}
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

      </form>

      <div className="hk-settings-footer">
        <strong className="hk-settings-footer__title">Hakkutsu v0.1.2</strong>
        <p className="hk-settings-footer__desc">
          {t("settings_footer_built", currentLang)}<br />
          Built with Plasmo, React, TypeScript.
        </p>
      </div>
    </div>
  );
}
