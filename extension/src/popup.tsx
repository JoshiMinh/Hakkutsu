/**
 * Hakkutsu Popup — Main Extension Interface
 *
 * Single-view design combining text analysis, subtitle extraction,
 * and settings in a tabbed layout.
 */

import { useCallback, useEffect, useState } from "react";

import { apiClient } from "~services/api-client";
import { ankiClient } from "~services/anki-connect";
import { getSettings, saveSettings } from "~services/storage";
import { POS_LABELS } from "~lib/constants";
import { containsJapanese } from "~lib/japanese";
import type {
  AnalyzeResponse,
  TokenAnalysis,
  ExtensionSettings,
  ExtensionView,
  SubtitleResponse,
  SubtitleSegment,
  AnkiExportData,
} from "~types";
import { DEFAULT_SETTINGS } from "~types";
import { YoutubeTranscript } from "youtube-transcript";

import { JlptBadge, PosBadge } from "~components/Badges";
import { TokenDisplay } from "~components/TokenDisplay";
import { DefinitionCard } from "~components/DefinitionCard";
import { SettingsView } from "~components/SettingsView";
import { GrammarExplanations } from "~components/GrammarExplanations";
import { KanjiBreakdown } from "~components/KanjiBreakdown";

import "./style.css";

// ── Helper Components ───────────────────────────────────────────────



function StatusDot({ connected }: { connected: boolean }) {
  const cls = connected
    ? "hk-status__dot hk-status__dot--connected"
    : "hk-status__dot hk-status__dot--disconnected";
  return <span className={cls} />;
}

function LoadingSpinner({ text = "Analyzing..." }: { text?: string }) {
  return (
    <div className="hk-loading">
      <div className="hk-loading__spinner" />
      <span>{text}</span>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="hk-empty">
      <div className="hk-empty__icon">{icon}</div>
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
      borderLeft: "4px solid var(--hk-accent-crimson)",
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



// ── Analysis View ───────────────────────────────────────────────────

function AnalysisView({
  ankiConnected,
  backendConnected,
}: {
  ankiConnected: boolean;
  backendConnected: boolean;
}) {
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedToken, setSelectedToken] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Listen for text selections from content script
  useEffect(() => {
    const listener = (message: { type: string; payload: { text: string } }) => {
      if (message.type === "TEXT_SELECTED" && message.payload?.text) {
        setInputText(message.payload.text);
        handleAnalyze(message.payload.text);
      }
    };

    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, []);

  const handleAnalyze = useCallback(
    async (text?: string) => {
      const textToAnalyze = text || inputText;
      if (!textToAnalyze.trim()) return;
      if (!containsJapanese(textToAnalyze)) {
        setError("No Japanese text detected. Please enter Japanese text.");
        return;
      }

      setLoading(true);
      setError(null);
      setSelectedToken(null);

      try {
        const response = await apiClient.analyzeText({
          text: textToAnalyze,
          include_definitions: true,
        });
        setResult(response);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Analysis failed";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [inputText]
  );

  const handleExport = async (data: AnkiExportData) => {
    try {
      setExportStatus("Exporting...");
      await ankiClient.exportVocabulary(data);
      setExportStatus("✓ Exported!");
      setTimeout(() => setExportStatus(null), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setExportStatus(`✗ ${msg}`);
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  const selectedTokenData =
    result && selectedToken !== null ? result.tokens[selectedToken] : null;

  return (
    <div className="hk-content hk-fade-in">
      {/* Input */}
      <div className="hk-input">
        <textarea
          className="hk-input__textarea"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="日本語を入力してください…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              handleAnalyze();
            }
          }}
        />
        <div className="hk-input__actions">
          {exportStatus && (
            <span style={{ fontSize: 12, color: "var(--hk-accent-teal)", alignSelf: "center" }}>
              {exportStatus}
            </span>
          )}
          <button
            className="hk-btn hk-btn--primary"
            onClick={() => handleAnalyze()}
            disabled={loading || !inputText.trim() || !backendConnected}
          >
            {loading ? "⏳" : "🔍"} Analyze
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(232, 93, 117, 0.1)",
            border: "1px solid rgba(232, 93, 117, 0.3)",
            borderRadius: 8,
            color: "var(--hk-accent-crimson)",
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && <LoadingSpinner />}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Difficulty Meter */}
          <DifficultyMeter label={result.difficulty_label} score={result.difficulty_score} />

          {/* Sentence reading */}
          {result.sentence_reading && (
            <div
              style={{
                fontSize: 12,
                color: "var(--hk-text-muted)",
                fontFamily: "var(--hk-font-jp)",
                marginBottom: 12,
                padding: "6px 12px",
                background: "var(--hk-bg-secondary)",
                borderRadius: 6,
              }}
            >
              {result.sentence_reading}
            </div>
          )}

          {/* Token display */}
          <TokenDisplay
            tokens={result.tokens}
            selectedIndex={selectedToken}
            onSelect={setSelectedToken}
          />

          {/* Selected token definition */}
          {selectedTokenData && selectedTokenData.is_japanese && (
            <>
              <DefinitionCard
                token={selectedTokenData}
                onExport={handleExport}
                ankiConnected={ankiConnected}
                originalText={result.text}
                sentenceReading={result.sentence_reading}
              />
              
              <div style={{ marginTop: 16 }}>
                {Array.from(new Set(Array.from(selectedTokenData.dictionary_form).filter(c => /[\u4e00-\u9faf]/.test(c)))).map((kanji, i) => (
                  <KanjiBreakdown key={`${kanji}-${i}`} kanji={kanji} />
                ))}
              </div>
            </>
          )}

          {/* Grammar Patterns */}
          {result.grammar_patterns && result.grammar_patterns.length > 0 && (
            <GrammarExplanations patterns={result.grammar_patterns} />
          )}

          {/* Prompt to select a token */}
          {selectedToken === null && (
            <EmptyState
              icon="👆"
              text="Click on a token above to see its definition, JLPT level, and export to Anki."
            />
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <EmptyState
          icon="🔍"
          text="Enter Japanese text above or select text on any webpage to start analyzing."
        />
      )}
    </div>
  );
}

// ── Subtitles View ──────────────────────────────────────────────────

function SubtitlesView({ backendConnected }: { backendConnected: boolean }) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<SubtitleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const transcripts = await YoutubeTranscript.fetchTranscript(url, { lang: "ja" });
      
      if (!transcripts || transcripts.length === 0) {
        throw new Error("No Japanese subtitles found");
      }

      const segments: SubtitleSegment[] = transcripts.map(t => ({
        text: t.text,
        start: t.offset / 1000,
        duration: t.duration / 1000
      }));

      const full_text = segments.map(s => s.text).join(" ");

      setResult({
        video_id: new URL(url).searchParams.get("v") || "",
        language: "ja",
        segments,
        full_text
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch subtitles";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="hk-content hk-fade-in">
      <div className="hk-subtitle__input-group">
        <input
          className="hk-subtitle__url-input"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="YouTube URL..."
          onKeyDown={(e) => {
            if (e.key === "Enter") handleFetch();
          }}
        />
        <button
          className="hk-btn hk-btn--primary"
          onClick={handleFetch}
          disabled={loading || !url.trim()}
        >
          {loading ? "⏳" : "📺"} Fetch
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(232, 93, 117, 0.1)",
            border: "1px solid rgba(232, 93, 117, 0.3)",
            borderRadius: 8,
            color: "var(--hk-accent-crimson)",
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading && <LoadingSpinner text="Fetching subtitles..." />}

      {result && !loading && (
        <>
          {result.segments.length === 0 ? (
            <EmptyState icon="📺" text="No Japanese subtitles found for this video." />
          ) : (
            <div>
              <div style={{ fontSize: 12, color: "var(--hk-text-muted)", marginBottom: 12 }}>
                {result.segments.length} segments · {result.language}
              </div>
              {result.segments.map((seg: SubtitleSegment, i: number) => (
                <div key={i} className="hk-subtitle__segment">
                  <div className="hk-subtitle__time">{formatTime(seg.start)}</div>
                  <div className="hk-subtitle__text">{seg.text}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <EmptyState
          icon="📺"
          text="Paste a YouTube URL to extract Japanese subtitles for analysis."
        />
      )}
    </div>
  );
}



// ── Main Popup ──────────────────────────────────────────────────────

function Popup() {
  const [activeView, setActiveView] = useState<ExtensionView>("analysis");
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [backendConnected, setBackendConnected] = useState(false);
  const [ankiConnected, setAnkiConnected] = useState(false);

  // Load settings and check connections on mount
  useEffect(() => {
    const init = async () => {
      const stored = await getSettings();
      setSettings(stored);
      apiClient.setBaseUrl(stored.backendUrl);

      // Check backend connectivity
      try {
        await apiClient.healthCheck();
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }

      // Check AnkiConnect
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
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(patch);

    if (patch.backendUrl) {
      apiClient.setBaseUrl(patch.backendUrl);
    }
  };

  const tabs: Array<{ id: ExtensionView; label: string; icon: string }> = [
    { id: "analysis", label: "Analyze", icon: "🔍" },
    { id: "subtitles", label: "Subtitles", icon: "📺" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="hk-popup">
      {/* Header */}
      <header className="hk-header">
        <div className="hk-header__logo">
          <div>
            <div className="hk-header__title">発掘 Hakkutsu</div>
            <div className="hk-header__subtitle">Japanese Immersion</div>
          </div>
        </div>
        <div className="hk-header__actions">
          <div className="hk-status" title={backendConnected ? "Backend connected" : "Backend disconnected"}>
            <StatusDot connected={backendConnected} />
            <span>API</span>
          </div>
          <div className="hk-status" title={ankiConnected ? "Anki connected" : "Anki disconnected"}>
            <StatusDot connected={ankiConnected} />
            <span>Anki</span>
          </div>
        </div>
      </header>

      {/* Navigation */}
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

      {/* Views */}
      {activeView === "analysis" && (
        <AnalysisView
          ankiConnected={ankiConnected}
          backendConnected={backendConnected}
        />
      )}
      {activeView === "subtitles" && (
        <SubtitlesView backendConnected={backendConnected} />
      )}
      {activeView === "settings" && (
        <>
          <SettingsView settings={settings} onUpdate={handleUpdateSettings} />
          <div style={{ padding: "0 16px 16px" }}>
            <button
              className="hk-btn hk-btn--secondary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              ⚙️ Open Full Settings Page
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Popup;
