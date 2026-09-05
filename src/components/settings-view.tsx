import { useState, useRef, useEffect, useCallback } from "react";
import { Check, ChevronDown, Database, Film, GraduationCap, Languages, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import type { ExtensionSettings } from "~lib/utils/types";
import { t } from "~lib/locales";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "~lib/locales";
import { ankiClient } from "~lib/services/anki-connect";
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

export interface CustomSelectOption {
  value: string;
  label: string;
  group?: string;
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  width = "260px",
}: {
  value: string;
  onChange: (val: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  width?: string;
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

  const selectedOption = options.find((opt) => opt.value === value);
  const groups = Array.from(new Set(options.map((o) => o.group).filter(Boolean))) as string[];

  return (
    <div ref={containerRef} style={{ position: "relative", width, flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          backgroundColor: "#18181c",
          border: "1.5px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "10px",
          padding: "8px 12px",
          color: selectedOption ? "#ffffff" : "#a1a1aa",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          outline: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          transition: "all 0.2s ease",
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "8px" }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: "#a1a1aa",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
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
            width: "100%",
            minWidth: "260px",
            maxHeight: "320px",
            overflowY: "auto",
            backgroundColor: "#18181c",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "12px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            padding: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            backdropFilter: "blur(14px)",
          }}
        >
          {groups.length > 0 ? (
            groups.map((groupName) => {
              const groupOptions = options.filter((o) => o.group === groupName);
              return (
                <div key={groupName} style={{ marginBottom: "6px" }}>
                  <div
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      color: "#c084fc",
                      letterSpacing: "0.6px",
                      padding: "6px 8px 3px",
                      borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                    }}
                  >
                    {groupName}
                  </div>
                  {groupOptions.map((opt) => (
                    <OptionButton
                      key={opt.value}
                      opt={opt}
                      isSelected={opt.value === value}
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                    />
                  ))}
                </div>
              );
            })
          ) : (
            options.map((opt) => (
              <OptionButton
                key={opt.value}
                opt={opt}
                isSelected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function OptionButton({
  opt,
  isSelected,
  onClick,
}: {
  opt: CustomSelectOption;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "7px 10px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: isSelected ? "rgba(192, 132, 252, 0.14)" : "transparent",
        color: isSelected ? "#c084fc" : "#e4e4e7",
        fontSize: "12.5px",
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
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
      {isSelected && <Check size={14} style={{ color: "#c084fc", marginLeft: "8px", flexShrink: 0 }} />}
    </button>
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

  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [ankiConnected, setAnkiConnected] = useState<boolean>(false);
  const [loadingAnki, setLoadingAnki] = useState<boolean>(false);

  const fetchAnkiData = useCallback(async (selectedModel?: string) => {
    setLoadingAnki(true);
    try {
      const connected = await ankiClient.isConnected();
      setAnkiConnected(connected);
      if (connected) {
        const [dList, mList] = await Promise.all([
          ankiClient.getDecks().catch(() => [] as string[]),
          ankiClient.getModels().catch(() => [] as string[]),
        ]);
        setDecks(dList);
        setModels(mList);

        const currentModel = selectedModel || settings.ankiModel || (mList.length > 0 ? mList[0] : "");
        if (currentModel) {
          const fList = await ankiClient.getModelFields(currentModel).catch(() => [] as string[]);
          setFields(fList);
        } else {
          setFields([]);
        }
      } else {
        setDecks([]);
        setModels([]);
        setFields([]);
      }
    } catch (e) {
      console.error("Anki data load error:", e);
      setAnkiConnected(false);
    } finally {
      setLoadingAnki(false);
    }
  }, [settings.ankiModel]);

  useEffect(() => {
    fetchAnkiData();
  }, []);

  const inferDefaultMapping = (fieldName: string): string => {
    const lower = fieldName.toLowerCase().replace(/[-_]/g, " ");

    // 1. Audio / Sound
    if (lower.includes("audio") || lower.includes("sound")) {
      if (lower.includes("sentence") || lower.includes("expression") || lower.includes("example")) return "sentenceAudio";
      return "audio";
    }

    // 2. Furigana
    if (lower.includes("furigana")) {
      if (lower.includes("sentence") || lower.includes("expression") || lower.includes("example")) return "sentenceFurigana";
      return "wordFurigana";
    }

    // 3. Reading / Pronunciation / Kana
    if (lower.includes("reading") || lower.includes("kana") || lower.includes("pronunciation")) {
      if (lower.includes("sentence") || lower.includes("expression") || lower.includes("example")) return "sentenceReading";
      return "reading";
    }

    // 4. Meaning / Definition / Translation / Gloss
    if (lower.includes("meaning") || lower.includes("definition") || lower.includes("translation") || lower.includes("gloss")) {
      if (lower.includes("sentence") || lower.includes("expression") || lower.includes("example")) return "sentenceMeaning";
      return "meaning";
    }

    // 5. Sino-Vietnamese / Han-Viet / Vietnamese
    if (lower.includes("vietnamese") || lower.includes("hanviet") || lower.includes("sino")) {
      return "vietnameseSound";
    }

    // 6. Sentence / Context / Example
    if (lower.includes("sentence") || lower.includes("context") || lower.includes("example")) {
      return "sentence";
    }

    // 7. Image / Picture / Illustration
    if (lower.includes("image") || lower.includes("picture") || lower.includes("illustration")) {
      return "imageUrl";
    }

    // 8. Screenshot
    if (lower.includes("screenshot")) {
      return "screenshot";
    }

    // 9. JLPT
    if (lower.includes("jlpt") || lower.includes("level")) {
      return "jlptLevel";
    }

    // 10. POS / Part of speech
    if (lower.includes("pos") || lower.includes("part of speech")) {
      return "pos";
    }

    // 11. Front / Back HTML
    if (lower === "front") return "frontHtml";
    if (lower === "back") return "backHtml";

    // 12. Word / Kanji / Vocabulary
    if (lower.includes("word") || lower.includes("kanji") || lower.includes("vocab")) {
      return "word";
    }

    return "none";
  };

  const handleModelChange = async (newModel: string) => {
    onUpdate({ ankiModel: newModel });
    setLoadingAnki(true);
    try {
      const fList = await ankiClient.getModelFields(newModel).catch(() => [] as string[]);
      setFields(fList);

      const existingMap = { ...(settings.ankiFieldMap || {}) };
      let updated = false;
      for (const f of fList) {
        if (!existingMap[f]) {
          existingMap[f] = inferDefaultMapping(f);
          updated = true;
        }
      }
      if (updated) {
        onUpdate({ ankiModel: newModel, ankiFieldMap: existingMap });
      }
    } catch {
      setFields([]);
    } finally {
      setLoadingAnki(false);
    }
  };

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

        {/* General Card */}
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
          </div>
        </section>

        {/* Immersion Card */}
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
          </div>
        </section>

        {/* Anki Integration Card */}
        <section className="hk-settings-card">
          <header className="hk-settings-card__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div className="hk-settings-card__icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={ankiSvg} alt="Anki" style={{ width: 17, height: 17 }} />
              </div>
              <h3 className="hk-settings-card__title">{t("settings_anki_section", currentLang)}</h3>
            </div>
            
            <button
              type="button"
              onClick={() => fetchAnkiData()}
              disabled={loadingAnki}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 10px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                color: "#e4e4e7",
                fontSize: "12px",
                fontWeight: 600,
                cursor: loadingAnki ? "not-allowed" : "pointer"
              }}
            >
              <RefreshCw size={13} className={loadingAnki ? "hk-spin" : ""} />
              {loadingAnki ? "Refreshing..." : "Refresh Anki"}
            </button>
          </header>
          
          <div className="hk-settings-card__body">
            <div className="hk-settings-row">
              <div className="hk-settings-row__info">
                <label htmlFor="ankiModel" className="hk-settings-row__label">{t("settings_anki_model", currentLang)}</label>
                <div id="ankiModel-desc" className="hk-settings-row__desc">Select Anki Note Type model from AnkiConnect</div>
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
                <label htmlFor="ankiDeck" className="hk-settings-row__label">{t("settings_anki_deck", currentLang)}</label>
                <div id="ankiDeck-desc" className="hk-settings-row__desc">{t("settings_anki_deck_desc", currentLang)}</div>
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
                <div style={{ padding: "0 18px 12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                  <div>
                    <h4 style={{ fontSize: "14px", fontWeight: 700, color: "#c084fc", margin: "0 0 4px 0" }}>
                      Note Field Mappings ({settings.ankiModel})
                    </h4>
                    <p style={{ fontSize: "12px", color: "var(--hk-text-muted)", margin: 0 }}>
                      Map each field of your Anki note type to the corresponding Hakkutsu data option
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const newMap: Record<string, string> = { ...(settings.ankiFieldMap || {}) };
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
                      whiteSpace: "nowrap"
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
                          borderBottom: idx === fields.length - 1 ? "none" : "1px solid rgba(255, 255, 255, 0.06)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between"
                        }}
                      >
                        <div className="hk-settings-row__info">
                          <label className="hk-settings-row__label" style={{ fontSize: "13.5px", fontWeight: 600 }}>
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
              <div style={{ margin: "12px 18px 0 18px", fontSize: "12px", color: "#f59e0b" }}>
                ⚠️ AnkiConnect not detected. Ensure Anki app is running with AnkiConnect add-on enabled, then click "Refresh Anki".
              </div>
            )}
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
    </div>
  );
}

export default SettingsView;

