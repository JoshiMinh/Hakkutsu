/**
 * Hakkutsu Popup — Main Extension Interface
 *
 * Single-view design combining text analysis and SRS reviews.
 */

import { useCallback, useEffect, useState, Suspense, lazy } from "react";
import { 
  Brain, 
  Languages, 
  BookMarked, 
  Scissors, 
  ExternalLink,
  Search,
  Wifi,
  WifiOff,
  Settings as SettingsIcon,
  RefreshCw,
  Sparkles,
  Trash2,
  CornerDownLeft,
  ChevronRight
} from "lucide-react";

import { apiClient } from "~lib/services/api-client";
import { ankiClient } from "~lib/services/anki-connect";
import { useSettingsStore } from "~lib/utils/settings";
import { containsJapanese } from "~lib/utils/japanese";
import logoUrl from "url:../assets/icon.png";
import type {
  AnalyzeResponse,
  PhraseAnalyzeResponse,
  ExtensionSettings,
  ExtensionView,
  AnkiExportData,
} from "~lib/types";
import { DEFAULT_SETTINGS } from "~lib/types";

import { JlptBadge } from "~components/badges";
import { TokenDisplay } from "~components/token-display";
import { DefinitionCard } from "~components/definition-card";

const GrammarExplanations = lazy(() => import("~components/grammar-explanations").then(m => ({ default: m.GrammarExplanations })));
const KanjiBreakdown = lazy(() => import("~components/kanji-breakdown").then(m => ({ default: m.KanjiBreakdown })));
const SrsReview = lazy(() => import("~components/srs-review").then(m => ({ default: m.SrsReview })));

import "./style.css";

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
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<PhraseAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const { settings } = useSettingsStore();

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
    if (!containsJapanese(textToAnalyze)) {
      setError("Please enter Japanese text.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setUsedFallback(false);

    try {
      // Try direct LLM API if key is present
      const response = await apiClient.analyzePhrase({
        text: textToAnalyze,
        include_definitions: true,
      });
      setResult(response);
    } catch (e) {
      // Fallback via background script (Jisho / local tokenizer)
      try {
        const bgResponse = await chrome.runtime.sendMessage({
          type: "ANALYZE_PHRASE",
          payload: { text: textToAnalyze, include_definitions: true }
        });

        if (bgResponse?.payload) {
          setResult(bgResponse.payload);
          setUsedFallback(true);
          return;
        }
      } catch {
        // Fallthrough
      }
      setError(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hk-content hk-fade-in" style={{ padding: "16px" }}>
      {/* Sleek Input Container */}
      <div style={{
        background: "linear-gradient(180deg, #18181c 0%, #121215 100%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "12px",
        padding: "12px",
        marginBottom: "16px",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)"
      }}>
        <textarea
          className="hk-input__textarea"
          rows={3}
          style={{
            width: "100%",
            minHeight: "76px",
            maxHeight: "140px",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--hk-text-primary)",
            fontFamily: "var(--hk-font-jp)",
            fontSize: "15px",
            lineHeight: "1.6",
            padding: "0",
            boxSizing: "border-box",
            resize: "vertical",
            overflowY: "auto"
          }}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Enter Japanese text to analyze & translate..."
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
          paddingTop: "8px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          marginTop: "6px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{
              fontSize: "11px",
              color: "var(--hk-text-muted)",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "2px 6px",
              borderRadius: "4px",
              display: "inline-flex",
              alignItems: "center",
              gap: "3px"
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
                  padding: "2px",
                  display: "flex",
                  alignItems: "center"
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
              padding: "7px 14px",
              background: inputText.trim() && !loading
                ? "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)"
                : "rgba(255, 255, 255, 0.08)",
              color: inputText.trim() && !loading ? "#ffffff" : "var(--hk-text-muted)",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: inputText.trim() && !loading ? "pointer" : "not-allowed",
              boxShadow: inputText.trim() && !loading ? "0 4px 14px rgba(168, 85, 247, 0.35)" : "none",
              transition: "all 0.2s ease"
            }}
          >
            {loading ? <RefreshCw size={14} className="hk-spin" /> : <Languages size={14} />} 
            Translate
          </button>
        </div>
      </div>

      {/* Fallback Info Banner */}
      {usedFallback && (
        <div style={{
          padding: "8px 12px",
          background: "rgba(168, 85, 247, 0.08)",
          border: "1px solid rgba(168, 85, 247, 0.2)",
          borderRadius: "8px",
          color: "var(--hk-text-secondary)",
          fontSize: "12px",
          marginBottom: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={13} color="#a855f7" /> Jisho dictionary used. Set API Key for full AI sentences.
          </span>
          <button
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })}
            style={{
              background: "transparent",
              border: "none",
              color: "#a855f7",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center"
            }}
          >
            Settings <ChevronRight size={12} />
          </button>
        </div>
      )}

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
          {error.toLowerCase().includes("api key") && (
            <button
              onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--hk-accent-purple)",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
                marginTop: "6px",
                fontSize: "12px",
                display: "block"
              }}
            >
              Open Settings to configure API key →
            </button>
          )}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "28px 0", color: "var(--hk-text-muted)" }}>
          <RefreshCw size={22} className="hk-spin" style={{ color: "var(--hk-accent-primary)", marginBottom: "8px" }} />
          <div style={{ fontSize: "13px" }}>Analyzing Japanese text...</div>
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
              borderLeft: "3px solid var(--hk-accent-primary)"
            }}>
              {result.sentence_reading}
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
              lineHeight: "1.5"
            }}>
              "{result.translation}"
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
                Quick Definitions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.tokens.filter(t => t.definitions && t.definitions.length > 0).slice(0, 5).map((token, idx) => (
                  <div key={idx} style={{ fontSize: "13px", display: "flex", gap: "6px" }}>
                    <strong style={{ color: "var(--hk-text-primary)", minWidth: "70px" }}>{token.dictionary_form || token.surface}</strong>
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
          Ready to translate.
        </div>
      )}
    </div>
  );
}

// ── Anki View ──────────────────────────────────────────────────

function AnkiView({ settings, onUpdate, ankiConnected }: { settings: ExtensionSettings, onUpdate: (patch: Partial<ExtensionSettings>) => void, ankiConnected: boolean }) {
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
            <label htmlFor="ankiDeck" className="hk-settings-row__label">Anki Deck Name</label>
            <div id="ankiDeck-desc" className="hk-settings-row__desc">Default deck for exports</div>
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
            <label htmlFor="ankiModel" className="hk-settings-row__label">Anki Note Type</label>
            <div id="ankiModel-desc" className="hk-settings-row__desc">Card model for exports</div>
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
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })}
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

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
  };

  const tabs: Array<{ id: ExtensionView; label: string; icon: React.ReactNode }> = [
    { id: "translate", label: "Translate", icon: <Languages size={15} /> },
    { id: "srs", label: "Reviews", icon: <Brain size={15} /> },
    { id: "anki", label: "Anki", icon: <BookMarked size={15} /> },
  ];

function HakkutsuLogo({ size = 32 }: { size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.28),
      background: "linear-gradient(135deg, rgba(168, 85, 247, 0.3) 0%, rgba(99, 102, 241, 0.3) 100%)",
      border: "1px solid rgba(168, 85, 247, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      boxShadow: "0 0 14px rgba(168, 85, 247, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.25)",
      overflow: "hidden",
      flexShrink: 0
    }}>
      <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(circle at 30% 30%, rgba(192, 132, 252, 0.4), transparent 70%)"
      }} />
      <span style={{
        position: "relative",
        zIndex: 1,
        fontFamily: "var(--hk-font-jp), sans-serif",
        fontSize: Math.round(size * 0.54),
        fontWeight: 800,
        background: "linear-gradient(135deg, #ffffff 0%, #e9d5ff 50%, #c084fc 100%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        letterSpacing: "-0.5px",
        filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))"
      }}>
        発
      </span>
    </div>
  );
}

  return (
    <div className="hk-popup">
      <header className="hk-header">
        <div className="hk-header__logo" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <HakkutsuLogo size={32} />
          <div>
            <div className="hk-header__title" style={{ fontSize: "15px", lineHeight: "1.2", fontWeight: 700 }}>Hakkutsu</div>
            <div style={{ fontSize: "10px", color: "var(--hk-text-muted)" }}>Japanese Immersion</div>
          </div>
        </div>

        <div className="hk-header__actions" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button 
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={() => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                  chrome.tabs.sendMessage(tabs[0].id, { type: "START_SCREENSHOT_FLOW" });
                  window.close();
                }
              });
            }}
            title="Extract text from screen"
            style={{
              padding: "5px 10px",
              fontSize: "12px",
              background: "rgba(168, 85, 247, 0.12)",
              color: "#d8b4fe",
              border: "1px solid rgba(168, 85, 247, 0.25)",
              borderRadius: "6px"
            }}
          >
            <Scissors size={13} /> OCR
          </button>

          <button 
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })}
            title="Open App Dashboard"
            style={{
              padding: "5px 10px",
              fontSize: "12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--hk-border)",
              borderRadius: "6px"
            }}
          >
            <ExternalLink size={13} /> App
          </button>
          
          <div 
            title={ankiConnected ? "Anki connected" : "Anki disconnected"} 
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: ankiConnected ? "var(--hk-jlpt-n5)" : "var(--hk-text-muted)",
              boxShadow: ankiConnected ? "0 0 8px var(--hk-jlpt-n5)" : "none",
              marginLeft: "4px"
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
    </div>
  );
}

export default Popup;

