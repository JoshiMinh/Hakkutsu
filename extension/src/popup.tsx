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
  Server,
  Settings as SettingsIcon,
  RefreshCw
} from "lucide-react";

import { apiClient } from "~services/api-client";
import { ankiClient } from "~services/anki-connect";
import { useSettingsStore } from "~store/settings";
import { containsJapanese } from "~lib/japanese";
import logoUrl from "url:../assets/icon.png";
import type {
  AnalyzeResponse,
  PhraseAnalyzeResponse,
  ExtensionSettings,
  ExtensionView,
  AnkiExportData,
} from "~types";
import { DEFAULT_SETTINGS } from "~types";

import { JlptBadge } from "~components/Badges";
import { TokenDisplay } from "~components/TokenDisplay";
import { DefinitionCard } from "~components/DefinitionCard";

const GrammarExplanations = lazy(() => import("~components/GrammarExplanations").then(m => ({ default: m.GrammarExplanations })));
const KanjiBreakdown = lazy(() => import("~components/KanjiBreakdown").then(m => ({ default: m.KanjiBreakdown })));
const SrsReview = lazy(() => import("~components/SrsReview").then(m => ({ default: m.SrsReview })));

import "./style.css";

// ── Helper Components ───────────────────────────────────────────────

function LoadingSpinner({ text = "Analyzing..." }: { text?: string }) {
  return (
    <div className="hk-loading">
      <RefreshCw size={24} className="hk-loading__spinner hk-spin" style={{ color: "var(--hk-accent-primary)" }} />
      <span>{text}</span>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="hk-empty">
      <div className="hk-empty__icon" style={{ color: "var(--hk-text-muted)", marginBottom: 12 }}>{icon}</div>
      <p className="hk-empty__text">{text}</p>
    </div>
  );
}

function DifficultyMeter({ label, score }: { label: string | null; score: number | null }) {
  if (!label || score === null) return null;
  const percentage = (score * 100).toFixed(1);
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 14px",
      background: "var(--hk-bg-secondary)",
      borderLeft: "4px solid var(--hk-accent-primary)",
      borderRadius: "6px",
      marginBottom: "16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: 13, color: "var(--hk-text-muted)", fontWeight: "bold" }}>JLPT Level</span>
        <JlptBadge level={label} />
      </div>
      <div style={{ fontSize: 12, color: "var(--hk-text-secondary)" }}>
        AI Confidence: <strong>{percentage}%</strong>
      </div>
    </div>
  );
}

// ── Translate (Quick) View ──────────────────────────────────────────

function TranslateQuickView({
  ankiConnected,
  backendConnected,
}: {
  ankiConnected: boolean;
  backendConnected: boolean;
}) {
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<PhraseAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    try {
      const response = await apiClient.analyzePhrase({
        text: textToAnalyze,
        include_definitions: true,
      });
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hk-content hk-fade-in" style={{ padding: "16px" }}>
      <div className="hk-input" style={{ marginBottom: "16px" }}>
        <textarea
          className="hk-input__textarea"
          style={{ minHeight: "60px", fontSize: "14px", padding: "10px" }}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Enter Japanese to translate..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              handleTranslate();
            }
          }}
        />
        <div className="hk-input__actions" style={{ marginTop: "8px" }}>
          <button
            className="hk-btn hk-btn--primary hk-btn--sm"
            onClick={() => handleTranslate()}
            disabled={loading || !inputText.trim() || !backendConnected}
            style={{ borderRadius: "4px" }}
          >
            {loading ? <RefreshCw size={14} className="hk-spin" /> : <Languages size={14} />} 
            Translate
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "var(--hk-bg-tertiary)", borderLeft: "3px solid var(--hk-accent-crimson)", color: "var(--hk-text-primary)", fontSize: 13, borderRadius: "4px" }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "24px", color: "var(--hk-text-muted)" }}>
          <RefreshCw size={20} className="hk-spin" style={{ color: "var(--hk-accent-primary)", marginBottom: "8px" }} />
          <div style={{ fontSize: "13px" }}>Translating...</div>
        </div>
      )}

      {result && !loading && (
        <div style={{ background: "var(--hk-bg-secondary)", border: "1px solid var(--hk-border)", borderRadius: "6px", padding: "12px" }}>
          {result.sentence_reading && (
            <div style={{ fontSize: "12px", color: "var(--hk-accent-primary)", marginBottom: "8px", fontFamily: "var(--hk-font-jp)" }}>
              {result.sentence_reading}
            </div>
          )}
          
          {result.translation && (
            <div style={{ fontSize: "14px", color: "var(--hk-text-primary)", marginBottom: "12px", fontStyle: "italic" }}>
              "{result.translation}"
            </div>
          )}
          
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "16px" }}>
            {result.tokens.filter(t => t.is_japanese && t.dictionary_form).map((token, idx) => (
              <div key={idx} style={{ padding: "4px 8px", background: "var(--hk-bg-tertiary)", borderRadius: "4px", fontSize: "13px" }}>
                <span style={{ color: "var(--hk-text-primary)", fontWeight: 500, marginRight: "6px" }}>{token.surface}</span>
                <span style={{ color: "var(--hk-text-muted)", fontSize: "11px" }}>{token.dictionary_form}</span>
              </div>
            ))}
          </div>

          {result.tokens.filter(t => t.definitions && t.definitions.length > 0).length > 0 && (
            <div style={{ borderTop: "1px solid var(--hk-border)", paddingTop: "12px" }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--hk-text-muted)", fontWeight: "bold", marginBottom: "8px" }}>Quick Definitions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.tokens.filter(t => t.definitions && t.definitions.length > 0).slice(0, 5).map((token, idx) => (
                  <div key={idx} style={{ fontSize: "13px" }}>
                    <strong style={{ color: "var(--hk-text-primary)" }}>{token.dictionary_form}</strong>
                    <span style={{ color: "var(--hk-text-muted)", margin: "0 4px" }}>—</span>
                    <span style={{ color: "var(--hk-text-secondary)" }}>{token.definitions?.[0]?.glosses?.slice(0, 2).join(", ")}</span>
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
              value={settings.ankiDeck}
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
              value={settings.ankiModel}
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
  const [backendConnected, setBackendConnected] = useState(false);
  const [ankiConnected, setAnkiConnected] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (settings.backendUrl) {
        apiClient.setBaseUrl(settings.backendUrl);
      }

      try {
        await apiClient.healthCheck();
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }

      try {
        const connected = await ankiClient.isConnected();
        setAnkiConnected(connected);
      } catch {
        setAnkiConnected(false);
      }
    };

    init();
  }, [settings.backendUrl]);

  const handleUpdateSettings = (patch: Partial<ExtensionSettings>) => {
    updateSettings(patch);
    if (patch.backendUrl) {
      apiClient.setBaseUrl(patch.backendUrl);
    }
  };

  const tabs: Array<{ id: ExtensionView; label: string; icon: React.ReactNode }> = [
    { id: "translate", label: "Translate", icon: <Languages size={16} /> },
    { id: "srs", label: "Reviews", icon: <Brain size={16} /> },
    { id: "anki", label: "Anki", icon: <BookMarked size={16} /> },
  ];

  return (
    <div className="hk-popup">
      <header className="hk-header" style={{ padding: "12px 16px" }}>
        <div className="hk-header__logo" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img src={logoUrl} alt="Hakkutsu Logo" style={{ width: 24, height: 24, borderRadius: 6 }} />
          <div className="hk-header__title" style={{ fontSize: "16px" }}>Hakkutsu</div>
        </div>
        <div className="hk-header__actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
            style={{ padding: "4px 8px" }}
          >
            <Scissors size={14} /> OCR
          </button>
          <button 
            className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("tabs/app.html") })}
            title="Open App"
            style={{ padding: "4px 8px" }}
          >
            <ExternalLink size={14} /> App
          </button>
          
          <div className="hk-status" title={ankiConnected ? "Anki connected" : "Anki disconnected"} style={{ display: "flex", alignItems: "center" }}>
            <BookMarked size={14} color={ankiConnected ? "var(--hk-jlpt-n5)" : "var(--hk-text-muted)"} style={{ filter: ankiConnected ? "drop-shadow(0 0 4px var(--hk-jlpt-n5))" : "none" }} />
          </div>
          <div className="hk-status" title={backendConnected ? "Backend connected" : "Backend disconnected"} style={{ display: "flex", alignItems: "center" }}>
            <Server size={14} color={backendConnected ? "var(--hk-jlpt-n5)" : "var(--hk-text-muted)"} style={{ filter: backendConnected ? "drop-shadow(0 0 4px var(--hk-jlpt-n5))" : "none" }} />
          </div>
        </div>
      </header>

      <nav className="hk-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`hk-nav__tab ${activeView === tab.id ? "hk-nav__tab--active" : ""}`}
            onClick={() => setActiveView(tab.id)}
            style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <Suspense fallback={<LoadingSpinner text="Loading view..." />}>
        {activeView === "translate" && (
          <TranslateQuickView
            ankiConnected={ankiConnected}
            backendConnected={backendConnected}
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
