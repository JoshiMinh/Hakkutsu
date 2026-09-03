/**
 * Hakkutsu Popup — Main Extension Interface
 *
 * Single-view design combining Japanese text analysis, translation, and SRS reviews.
 */

import { useCallback, useEffect, useState, Suspense, lazy, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { 
  Brain, 
  Languages, 
  BookMarked, 
  ExternalLink,
  Search,
  Wifi,
  WifiOff,
  Settings as SettingsIcon,
  RefreshCw,
  Sparkles,
  Trash2,
  CornerDownLeft,
  ChevronRight,
  Volume2
} from "lucide-react";

import { apiClient } from "~lib/services/api-client";
import { ankiClient } from "~lib/services/anki-connect";
import { useSettingsStore } from "~lib/utils/settings";
import { containsJapanese } from "~lib/utils/japanese";
import { ttsService } from "~lib/services/tts-service";
import { useTranslation } from "~lib/languages/locales";
import type {
  PhraseAnalyzeResponse,
  ExtensionSettings,
  ExtensionView,
} from "~lib/types";

import "./style.css";
import appLogo from "data-base64:~assets/icon/icon-rounded.png";
import kofiSvg from "data-base64:~assets/logo/kofi.svg";

import SrsReview from "~components/srs-review";

interface PopupErrorBoundaryProps {
  children: ReactNode;
}

interface PopupErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<PopupErrorBoundaryProps, PopupErrorBoundaryState> {
  constructor(props: PopupErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PopupErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Popup Error Boundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "24px 16px", textAlign: "center", color: "#ef4444" }}>
          <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>
            View Error
          </div>
          <p style={{ fontSize: "12px", color: "#a1a1aa", marginBottom: "12px" }}>
            {this.state.error?.message || "An error occurred"}
          </p>
          <button
            type="button"
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Helper Components ───────────────────────────────────────────────

function LoadingSpinner({ text = "Analyzing..." }: { text?: string }) {
  return (
    <div className="hk-loading">
      <RefreshCw size={22} className="hk-loading__spinner hk-spin" style={{ color: "var(--hk-accent-primary)" }} />
      <span>{text}</span>
    </div>
  );
}

// ── Translate (Quick) View ──────────────────────────────────────────

function TranslateQuickView({
  ankiConnected,
}: {
  ankiConnected: boolean;
}) {
  const { t, lang, isVietnamese } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<PhraseAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    const listener = (message: { type: string; payload: { text: string } }) => {
      if (message.type === "TEXT_SELECTED" && message.payload?.text) {
        setInputText(message.payload.text);
        handleTranslate(message.payload.text);
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, []);

  const handleTranslate = async (text?: string) => {
    const textToAnalyze = text || inputText;
    if (!textToAnalyze.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setUsedFallback(false);

    try {
      const response = await apiClient.analyzePhrase({
        text: textToAnalyze,
        include_definitions: true,
      });
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("popup_error_generic"));
    } finally {
      setLoading(false);
    }
  };

  const handlePlayJapanese = () => {
    if (result?.text) {
      ttsService.playJapanese(result.text);
    } else if (inputText) {
      ttsService.playJapanese(inputText);
    }
  };

  const handlePlayTranslation = () => {
    if (result?.translation) {
      ttsService.playTargetLanguage(result.translation, lang);
    }
  };

  return (
    <div className="hk-content hk-fade-in" style={{ padding: "16px" }}>
      {/* Sleek Modern Input Card */}
      <div style={{
        background: "#141418",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "10px",
        padding: "12px 14px",
        marginBottom: "16px",
        boxShadow: "0 2px 12px rgba(0, 0, 0, 0.25)"
      }}>
        <textarea
          rows={3}
          style={{
            width: "100%",
            minHeight: "72px",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#ffffff",
            fontFamily: "var(--hk-font-jp)",
            fontSize: "14.5px",
            lineHeight: "1.6",
            padding: "0",
            boxSizing: "border-box",
            resize: "none"
          }}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={t("popup_input_placeholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleTranslate();
            }
          }}
        />

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "10px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          marginTop: "6px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{
              fontSize: "11px",
              color: "var(--hk-text-muted)",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "3px 7px",
              borderRadius: "4px",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500
            }}>
              <CornerDownLeft size={10} /> Ctrl+Enter
            </span>
            {inputText && (
              <button
                onClick={() => setInputText("")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--hk-text-muted)",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "4px"
                }}
                title="Clear text"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <button
            onClick={() => handleTranslate()}
            disabled={loading || !inputText.trim()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 16px",
              background: inputText.trim() && !loading
                ? "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)"
                : "rgba(255, 255, 255, 0.08)",
              color: inputText.trim() && !loading ? "#ffffff" : "var(--hk-text-muted)",
              border: "none",
              borderRadius: "8px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: inputText.trim() && !loading ? "pointer" : "not-allowed",
              boxShadow: inputText.trim() && !loading ? "0 4px 14px rgba(168, 85, 247, 0.35)" : "none",
              transition: "all 0.2s ease"
            }}
          >
            {loading ? <RefreshCw size={13} className="hk-spin" style={{ marginRight: "4px" }} /> : null} 
            {t("popup_btn_translate")}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 12px",
          background: "rgba(232, 93, 117, 0.1)",
          borderLeft: "3px solid var(--hk-accent-crimson)",
          color: "var(--hk-text-primary)",
          fontSize: 13,
          borderRadius: "8px",
          marginBottom: "16px"
        }}>
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "28px 0", color: "var(--hk-text-muted)" }}>
          <RefreshCw size={22} className="hk-spin" style={{ color: "var(--hk-accent-primary)", marginBottom: "8px" }} />
          <div style={{ fontSize: "13px" }}>{t("popup_analyzing")}</div>
        </div>
      )}

      {/* Structured Result Display */}
      {result && !loading && (
        <div style={{
          background: "var(--hk-bg-secondary)",
          border: "1px solid var(--hk-border)",
          borderRadius: "10px",
          padding: "14px",
          boxShadow: "var(--hk-shadow-sm)"
        }}>
          {result.sentence_reading && (
            <div style={{
              fontSize: "12px",
              color: "var(--hk-accent-primary)",
              marginBottom: "10px",
              fontFamily: "var(--hk-font-jp)",
              background: "rgba(168, 85, 247, 0.08)",
              padding: "4px 8px",
              borderRadius: "4px",
              borderLeft: "3px solid var(--hk-accent-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <span>{result.sentence_reading}</span>
              <button
                onClick={handlePlayJapanese}
                className="hk-btn-icon-subtle"
                title={t("def_play_audio_jp")}
                style={{ padding: "2px" }}
              >
                <Volume2 size={13} />
              </button>
            </div>
          )}
          
          {result.translation && (
            <div style={{
              fontSize: "14px",
              color: "var(--hk-text-primary)",
              marginBottom: "14px",
              background: "rgba(20, 184, 166, 0.08)",
              borderLeft: "3px solid #14b8a6",
              padding: "8px 12px",
              borderRadius: "4px",
              lineHeight: "1.5",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px"
            }}>
              <span>"{result.translation}"</span>
              <button
                onClick={handlePlayTranslation}
                className="hk-btn-icon-subtle"
                title={t("def_play_audio_trans")}
                style={{ flexShrink: 0, padding: "2px" }}
              >
                <Volume2 size={13} />
              </button>
            </div>
          )}
          
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
            {result.tokens.filter(t => t.is_japanese && (t.dictionary_form || t.surface)).map((token, idx) => (
              <div
                key={idx}
                style={{
                  padding: "4px 9px",
                  background: "var(--hk-bg-tertiary)",
                  border: "1px solid var(--hk-border)",
                  borderRadius: "6px",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center"
                }}
              >
                <span style={{ color: "var(--hk-text-primary)", fontWeight: 500, marginRight: "6px" }}>{token.surface}</span>
                <span style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}>{token.dictionary_form || token.surface}</span>
              </div>
            ))}
          </div>

          {result.tokens.filter(t => t.definitions && t.definitions.length > 0).length > 0 && (
            <div style={{ borderTop: "1px solid var(--hk-border)", paddingTop: "12px" }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--hk-text-muted)", fontWeight: "bold", marginBottom: "8px", letterSpacing: "0.5px" }}>
                {t("def_dict_label")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.tokens.filter(t => t.definitions && t.definitions.length > 0).slice(0, 5).map((token, idx) => (
                  <div key={idx} style={{ fontSize: "13px", display: "flex", gap: "6px", alignItems: "center" }}>
                    <strong style={{ color: "var(--hk-text-primary)", minWidth: "70px" }}>{token.dictionary_form || token.surface}</strong>
                    {isVietnamese && token.vietnamese_sound && (
                      <span style={{ fontSize: "11px", color: "#38bdf8", marginRight: "4px" }}>[{token.vietnamese_sound}]</span>
                    )}
                    <span style={{ color: "var(--hk-text-muted)" }}>—</span>
                    <span style={{ color: "var(--hk-text-secondary)", flex: 1 }}>{token.definitions?.[0]?.glosses?.slice(0, 2).join(", ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--hk-text-muted)", fontSize: "13px" }}>
          {t("popup_empty_state")}
        </div>
      )}
    </div>
  );
}

// ── Anki View ──────────────────────────────────────────────────

function AnkiView({ settings, onUpdate, ankiConnected }: { settings: ExtensionSettings, onUpdate: (patch: Partial<ExtensionSettings>) => void, ankiConnected: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="hk-content hk-fade-in">
      <div style={{ 
        padding: "16px", 
        background: "var(--hk-bg-secondary)", 
        borderRadius: "var(--hk-radius-lg)",
        marginBottom: "24px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        border: `1px solid ${ankiConnected ? 'var(--hk-jlpt-n5)' : 'var(--hk-border)'}`,
        boxShadow: "var(--hk-shadow-sm)"
      }}>
        {ankiConnected ? <Wifi size={24} color="var(--hk-jlpt-n5)" /> : <WifiOff size={24} color="var(--hk-text-muted)" />}
        <div>
          <div style={{ fontWeight: 600, fontSize: "14px", color: ankiConnected ? "var(--hk-jlpt-n5)" : "var(--hk-text-primary)" }}>
            {ankiConnected ? "AnkiConnect is running" : "AnkiConnect not detected"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--hk-text-secondary)", marginTop: "4px" }}>
            {ankiConnected ? "Ready to export flashcards." : "Please start Anki and ensure AnkiConnect is installed."}
          </div>
        </div>
      </div>

      <fieldset className="hk-settings-card">
        <legend className="hk-settings-card__title">Export Settings</legend>
        <div className="hk-settings-row">
          <div className="hk-settings-row__info">
            <label htmlFor="ankiDeck" className="hk-settings-row__label">{t("settings_anki_deck")}</label>
            <div id="ankiDeck-desc" className="hk-settings-row__desc">{t("settings_anki_deck_desc")}</div>
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
            <label htmlFor="ankiModel" className="hk-settings-row__label">{t("settings_anki_model")}</label>
            <div id="ankiModel-desc" className="hk-settings-row__desc">{t("settings_anki_model_desc")}</div>
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
      </fieldset>
      
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button
          className="hk-btn hk-btn--secondary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("tabs/app.html") })}
        >
          <ExternalLink size={16} /> Open Full App
        </button>
      </div>
    </div>
  );
}

// ── Main Popup ──────────────────────────────────────────────────────

function Popup() {
  const [activeView, setActiveView] = useState<ExtensionView>("translate");
  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();
  const [ankiConnected, setAnkiConnected] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const connected = await ankiClient.isConnected();
        setAnkiConnected(connected);
      } catch {
        setAnkiConnected(false);
      }
    };

    init();
  }, []);

  useEffect(() => {
    if (settings.srsEnabled === false && activeView === "srs") {
      setActiveView("translate");
    }
  }, [settings.srsEnabled, activeView]);

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
  };

  const tabs: Array<{ id: ExtensionView; label: string; icon: React.ReactNode }> = [
    { id: "translate", label: t("popup_tab_translate"), icon: <Languages size={15} /> },
    ...(settings.srsEnabled !== false
      ? [{ id: "srs" as ExtensionView, label: t("popup_tab_review"), icon: <Brain size={15} /> }]
      : []),
    { id: "anki", label: "Anki", icon: <BookMarked size={15} /> },
  ];

  const handleOpenAppTab = () => {
    const appUrl = chrome.runtime.getURL("tabs/app.html");
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ url: appUrl }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId) {
            chrome.windows.update(tabs[0].windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: appUrl });
        }
      });
    } else {
      window.open(appUrl, "_blank");
    }
  };

  return (
    <div className="hk-popup" style={{ width: "420px", maxWidth: "420px", minHeight: "480px", background: "#09090b", color: "#ffffff", boxSizing: "border-box", overflowX: "hidden" }}>
      <header className="hk-header" style={{ padding: "12px 14px", overflowX: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src={appLogo} alt="Hakkutsu Logo" style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }} />
          <div>
            <div className="hk-header__title" style={{ fontSize: "15px", lineHeight: "1.2", fontWeight: 700 }}>Hakkutsu</div>
            <div style={{ fontSize: "10px", color: "var(--hk-text-muted)" }}>{t("popup_subtitle")}</div>
          </div>
        </div>

        <div className="hk-header__actions" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <a 
            href="https://ko-fi.com/joshiminh"
            target="_blank"
            rel="noopener noreferrer"
            className="hk-btn hk-btn--secondary hk-btn--sm"
            title="Support on Ko-fi"
            style={{
              padding: "4px 8px",
              fontSize: "11.5px",
              background: "rgba(255, 94, 91, 0.15)",
              color: "#ff5e5b",
              border: "1px solid rgba(255, 94, 91, 0.3)",
              borderRadius: "6px",
              gap: "5px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center"
            }}
          >
            <img src={kofiSvg} alt="Ko-fi" style={{ width: 14, height: 14, objectFit: "contain" }} />
            Ko-fi
          </a>

          <button 
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={handleOpenAppTab}
            title={t("popup_btn_app")}
            style={{
              padding: "4px 8px",
              fontSize: "11.5px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px",
              gap: "4px"
            }}
          >
            <ExternalLink size={12} /> {t("popup_btn_app")}
          </button>
          
          <div 
            title={ankiConnected ? t("settings_anki_status_running") : t("settings_anki_status_disconnected")} 
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: ankiConnected ? "var(--hk-jlpt-n5)" : "var(--hk-text-muted)",
              boxShadow: ankiConnected ? "0 0 8px var(--hk-jlpt-n5)" : "none",
              marginLeft: "2px"
            }} 
          />
        </div>
      </header>

      {/* Segmented Pill Tabs */}
      <nav className="hk-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`hk-nav__tab ${activeView === tab.id ? "hk-nav__tab--active" : ""}`}
            onClick={() => setActiveView(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner text="Loading view..." />}>
          {activeView === "translate" && (
            <TranslateQuickView
              ankiConnected={ankiConnected}
            />
          )}
          {activeView === "srs" && (
            <SrsReview />
          )}
          {activeView === "anki" && (
            <AnkiView 
              settings={settings} 
              onUpdate={handleUpdateSettings}
              ankiConnected={ankiConnected}
            />
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default Popup;
