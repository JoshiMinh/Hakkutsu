import type { PlasmoCSConfig } from "plasmo";
import { useEffect, useState, useRef } from "react";
import { containsJapanese } from "~lib/japanese";
import type { AnalyzeResponse, TokenAnalysis, AnkiExportData } from "~types";
import { DefinitionCard } from "~components/DefinitionCard";
import { TokenDisplay } from "~components/TokenDisplay";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true,
};

import cssText from "data-text:~style.css";

export const getStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText;
  return style;
};

export const getRootContainer = () => {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const rootContainer = document.createElement("div");
      rootContainer.id = "hakkutsu-inline-dictionary";
      document.body.appendChild(rootContainer);
      clearInterval(checkInterval);
      resolve(rootContainer);
    }, 137);
  });
};

const InlineDictionary = () => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedToken, setSelectedToken] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ankiConnected, setAnkiConnected] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "CHECK_ANKI" })
      .then((response) => {
        if (response?.type === "ANKI_STATUS") {
          setAnkiConnected(response.payload.connected);
        }
      })
      .catch(() => setAnkiConnected(false));
  }, []);

  useEffect(() => {
    const handleSelection = (e: MouseEvent, isDoubleClick: boolean) => {
      // Don't trigger if they clicked inside the dictionary itself
      if (containerRef.current && e.target instanceof Node && containerRef.current.contains(e.target)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        if (position) setPosition(null);
        return;
      }

      // Trigger only on Alt + Highlight OR Double Click
      if (!e.altKey && !isDoubleClick) return;

      const selectedText = selection.toString().trim();
      if (!selectedText || !containsJapanese(selectedText)) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setPosition({
        x: rect.left + window.scrollX,
        y: rect.bottom + window.scrollY + 8, // 8px below the selection
      });
      setInputText(selectedText);
      analyzeText(selectedText);
    };

    const onMouseUp = (e: MouseEvent) => handleSelection(e, false);
    const onDoubleClick = (e: MouseEvent) => handleSelection(e, true);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPosition(null);
    };

    const onCustomAnalyze = (e: any) => {
      if (e.detail?.text) {
        setPosition({
          x: e.detail.x + window.scrollX,
          y: e.detail.y + window.scrollY + 8,
        });
        setInputText(e.detail.text);
        analyzeText(e.detail.text);
      }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("dblclick", onDoubleClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("hakkutsu:analyze", onCustomAnalyze);

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hakkutsu:analyze", onCustomAnalyze);
    };
  }, [position]);

  const analyzeText = async (text: string) => {
    setLoading(true);
    setError(null);
    setSelectedToken(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_TEXT",
        payload: { text, include_definitions: true },
      });
      
      if (response?.type === "ERROR") {
        throw new Error(response.payload.error);
      }
      
      if (response?.type === "ANALYZE_RESULT") {
        const analyzeResponse = response.payload as AnalyzeResponse;
        setResult(analyzeResponse);
        
        // Auto-select the first Japanese token if available
        const firstJpIndex = analyzeResponse.tokens.findIndex((t) => t.is_japanese);
        if (firstJpIndex !== -1) {
          setSelectedToken(firstJpIndex);
        }
      } else {
        throw new Error("Invalid response from background script");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (data: AnkiExportData) => {
    try {
      await chrome.runtime.sendMessage({
        type: "EXPORT_ANKI",
        payload: data,
      });
    } catch (e) {
      console.error("Export failed", e);
    }
  };

  const handleSrsAdd = async () => {
    if (!selectedTokenData) return;
    const meanings = selectedTokenData.definitions
      .flatMap((d) => d.glosses)
      .join("; ");
      
    try {
      await chrome.runtime.sendMessage({
        type: "ADD_SRS_CARD",
        payload: {
          word: selectedTokenData.dictionary_form,
          reading: selectedTokenData.reading.hiragana,
          meaning: meanings || "—",
          sentence: result?.text,
        },
      });
      // Optionally show a success toast here
    } catch (e) {
      console.error("SRS Add failed", e);
    }
  };

  if (!position) return null;

  const selectedTokenData =
    result && selectedToken !== null ? result.tokens[selectedToken] : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        zIndex: 2147483647,
        background: "var(--hk-bg, #1a1a2e)",
        color: "var(--hk-text, #f3f4f6)",
        borderRadius: "12px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        border: "1px solid var(--hk-border, #2a2a40)",
        padding: "16px",
        width: "350px",
        fontFamily: "var(--hk-font-jp, sans-serif)",
        pointerEvents: "auto",
      }}
      onMouseUp={(e) => e.stopPropagation()} // Prevent selection within closing it immediately
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "14px", color: "var(--hk-text-muted, #9ca3af)" }}>Hakkutsu Dictionary</h3>
        <button 
          onClick={() => setPosition(null)}
          style={{ background: "none", border: "none", color: "var(--hk-text-muted)", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "20px" }}>⏳ Analyzing...</div>}
      {error && <div style={{ color: "#ef4444", fontSize: "12px" }}>{error}</div>}
      
      {result && !loading && (
        <>
          <TokenDisplay
            tokens={result.tokens}
            selectedIndex={selectedToken}
            onSelect={setSelectedToken}
          />

          <div style={{ marginTop: "16px" }}>
            {selectedTokenData && selectedTokenData.is_japanese ? (
              <DefinitionCard
                token={selectedTokenData}
                onExport={handleExport}
                ankiConnected={ankiConnected}
                originalText={result.text}
                sentenceReading={result.sentence_reading}
                onSrsAdd={handleSrsAdd}
              />
            ) : (
              <div style={{ fontSize: "12px", color: "var(--hk-text-muted)", textAlign: "center", padding: "10px" }}>
                Select a Japanese word to see its definition.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default InlineDictionary;
