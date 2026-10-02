/**
 * Hakkutsu Popup — Main Extension Interface
 *
 * Single-view design combining Japanese text analysis, translation, and SRS reviews.
 */

import { useCallback, useEffect, useRef, useState, Suspense, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { 
  Brain, 
  Languages, 
  ExternalLink,
  RefreshCw,
  Trash2,
  CornerDownLeft,
  Volume2, Settings, PanelRight
} from "lucide-react";

import { apiClient } from "~lib/services/api-client";
import { useSettingsStore } from "~lib/utils/settings";
import { ttsService } from "~lib/services/tts-service";
import { useTranslation } from "~lib/locales";
import type {
  PhraseAnalyzeResponse,
  ExtensionView,
} from "~lib/utils/types";

import "./style.css";
import SrsReview from "~components/srs-review";

const appLogo = "/assets/icon.png";
const kofiSvg = "/assets/logo/kofi.png";

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

function TranslateQuickView() {
  const { t, lang, isVietnamese } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<PhraseAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const handleTranslate = useCallback(async (text?: string) => {
    const textToAnalyze = (text ?? inputText).trim();
    if (!textToAnalyze) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.analyzePhrase({
        text: textToAnalyze,
        include_definitions: true,
      });
      if (requestId === requestIdRef.current) setResult(response);
    } catch (e) {
      if (requestId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : t("popup_error_generic"));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [inputText, t]);

  useEffect(() => {
    const listener = (message: { type: string; payload: { text: string } }) => {
      if (message.type === "TEXT_SELECTED" && message.payload?.text) {
        setInputText(message.payload.text);
        void handleTranslate(message.payload.text);
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, [handleTranslate]);

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
    <div className="hk-content hk-fade-in hk-translate-view">
      <div className="hk-translate-editor">
        <label className="hk-translate-editor__label" htmlFor="popup-text">{t("popup_tab_translate")}</label>
        <textarea id="popup-text" rows={4} className="hk-translate-editor__input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={t("popup_input_placeholder")}
          aria-label={t("popup_input_placeholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleTranslate();
            }
          }}
        />

        <div className="hk-translate-editor__actions">
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
                type="button"
                onClick={() => {
                  requestIdRef.current += 1;
                  setInputText("");
                  setResult(null);
                  setError(null);
                  setLoading(false);
                }}
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
                aria-label="Clear text"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleTranslate()}
            disabled={loading || !inputText.trim()}
            className="hk-btn hk-btn--primary hk-btn--sm"
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
        }} role="alert">
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div role="status" aria-live="polite" style={{ textAlign: "center", padding: "28px 0", color: "var(--hk-text-muted)" }}>
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
        <div className="hk-popup-empty">
          <Languages size={28} aria-hidden="true" />
          {t("popup_empty_state")}
        </div>
      )}
    </div>
  );
}

// ── Main Popup ──────────────────────────────────────────────────────

function Popup() {
  const [activeView, setActiveView] = useState<ExtensionView>("translate");
  const { settings } = useSettingsStore();
  const { t } = useTranslation();
  useEffect(() => {
    if (settings.srsEnabled === false && activeView === "srs") {
      setActiveView("translate");
    }
  }, [settings.srsEnabled, activeView]);

  const tabs: Array<{ id: ExtensionView; label: string; icon: React.ReactNode }> = [
    { id: "translate", label: t("popup_tab_translate"), icon: <Languages size={15} /> },
    ...(settings.srsEnabled !== false
      ? [{ id: "srs" as ExtensionView, label: t("popup_tab_review"), icon: <Brain size={15} /> }]
      : []),
  ];

  const handleOpenAppTab = () => {
    const appUrl = chrome.runtime.getURL("options.html");
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

  const handleOpenTranscript = () => {
    const opened = browser.sidebarAction?.open
      ? browser.sidebarAction.open()
      : chrome.windows.getCurrent().then((current) => chrome.sidePanel.open({ windowId: current.id! }));
    void opened.then(() => window.close()).catch((error) => window.alert(error.message));
  };

  return (
    <div className="hk-popup">
      <header className="hk-popup-header">
        <div className="hk-popup-brand">
          <img src={appLogo} alt="" width={28} height={28} />
          <div><div className="hk-brand-title">Hakkutsu</div><div className="hk-popup-brand__subtitle">{t("popup_subtitle")}</div></div>
        </div>
        <div className="hk-popup-header__actions">
          <button type="button" className="hk-popup-icon" onClick={handleOpenTranscript}
            aria-label={t("drawer_title")} title={t("drawer_title")}><PanelRight size={17} /></button>
          <a className="hk-popup-icon" href="https://ko-fi.com/joshiminh" target="_blank" rel="noopener noreferrer" aria-label="Support on Ko-fi" title="Support on Ko-fi">
            <img src={kofiSvg} alt="" width={18} height={18} />
          </a>
          <button type="button" className="hk-popup-icon" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html?tab=settings") })}
            aria-label={t("nav_settings")} title={t("nav_settings")}><Settings size={17} /></button>
          <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" onClick={handleOpenAppTab}>
            {t("popup_btn_app")} <ExternalLink size={13} />
          </button>
        </div>
      </header>

      {/* Segmented Pill Tabs — rendered only when multiple views are active */}
      {tabs.length > 1 && (
        <nav className="hk-nav hk-popup-nav" role="tablist" aria-label="Popup views">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`hk-nav__tab ${activeView === tab.id ? "hk-nav__tab--active" : ""}`}
              onClick={() => setActiveView(tab.id)}
              role="tab"
              id={`popup-tab-${tab.id}`}
              aria-controls="popup-panel"
              tabIndex={activeView === tab.id ? 0 : -1}
              onKeyDown={(event) => {
                const index = tabs.findIndex((item) => item.id === activeView);
                const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                setActiveView(tabs[next].id);
                document.getElementById(`popup-tab-${tabs[next].id}`)?.focus();
              }}
              aria-selected={activeView === tab.id}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div id="popup-panel" className="hk-popup-panel" role="tabpanel" aria-labelledby={tabs.length > 1 ? `popup-tab-${activeView}` : undefined} aria-label={tabs.length === 1 ? tabs[0].label : undefined}>
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner text="Loading view..." />}>
          {activeView === "translate" && (
            <TranslateQuickView />
          )}
          {activeView === "srs" && (
            <SrsReview compact />
          )}
        </Suspense>
      </ErrorBoundary>
      </div>
    </div>
  );
}

export default Popup;
