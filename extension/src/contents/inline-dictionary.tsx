import type { PlasmoCSConfig } from "plasmo";
import { useEffect, useState, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import { containsJapanese } from "~lib/japanese";
import type { AnalyzeResponse, PhraseAnalyzeResponse, TokenAnalysis, AnkiExportData } from "~types";
import { DefinitionCard } from "~components/DefinitionCard";
import { TokenDisplay } from "~components/TokenDisplay";
import { GrammarExplanations } from "~components/GrammarExplanations";

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
  const [position, setPosition] = useState<{
    x: number;
    y: number;
    placement?: "anchor" | "player-overlay";
  } | null>(null);
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedToken, setSelectedToken] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [phraseMode, setPhraseMode] = useState(false);
  const [sentenceMode, setSentenceMode] = useState(false);
  const [transientMode, setTransientMode] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const analysisRequestRef = useRef(0);

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
        if (position) {
          setPosition(null);
          window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
        }
        return;
      }

      // Trigger only on Alt + Highlight OR Double Click
      if (!e.altKey && !isDoubleClick) return;

      const selectedText = selection.toString().trim();
      if (!selectedText || !containsJapanese(selectedText)) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setPosition({
        x: rect.left,
        y: rect.bottom + 8,
        placement: "anchor",
      });
      setInputText(selectedText);
      setPhraseMode(false);
      setSentenceMode(false);
      analyzeText(selectedText, false, true);
    };

    const onMouseUp = (e: MouseEvent) => handleSelection(e, false);
    const onDoubleClick = (e: MouseEvent) => handleSelection(e, true);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPosition(null);
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
      }
    };

    const onCustomAnalyze = (e: any) => {
      if (e.detail?.text) {
        const x = Number.isFinite(e.detail.x) ? e.detail.x : window.innerWidth / 2;
        const y = Number.isFinite(e.detail.y) ? e.detail.y : window.innerHeight / 2;
        setPosition({
          x,
          y: y + 8,
          placement:
            e.detail.placement === "player-overlay"
              ? "player-overlay"
              : "anchor",
        });
        setInputText(e.detail.text);
        const mode = String(e.detail.mode || "dictionary");
        const isDeepPhrase = mode === "phrase";
        const selectedIndex = Number.isInteger(e.detail.selectedIndex)
          ? Number(e.detail.selectedIndex)
          : null;
        setSentenceMode(mode === "quick" || isDeepPhrase);
        setPhraseMode(isDeepPhrase);
        setTransientMode(Boolean(e.detail.transient));
        // Dictionary clicks analyze the complete subtitle locally and merely
        // select the clicked token. This preserves conjugation context and
        // avoids invoking Qwen for every word.
        analyzeText(
          e.detail.text,
          isDeepPhrase,
          mode === "dictionary" || Boolean(e.detail.transient),
          selectedIndex,
          mode === "quick" || mode === "dictionary"
        );
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-opened"));
      }
    };
    const onTokenHover = (e: any) => {
      const index = Number(e.detail?.index);
      if (Number.isInteger(index) && index >= 0) {
        setSelectedToken(index);
      }
    };
    const onDismissAnalysis = () => {
      analysisRequestRef.current += 1;
      setPosition(null);
      setTransientMode(false);
      window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("dblclick", onDoubleClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("hakkutsu:analyze", onCustomAnalyze);
    window.addEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
    window.addEventListener("hakkutsu:token-hover", onTokenHover);

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hakkutsu:analyze", onCustomAnalyze);
      window.removeEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
      window.removeEventListener("hakkutsu:token-hover", onTokenHover);
    };
  }, [position]);

  const analyzeText = async (
    text: string,
    deepPhraseAnalysis: boolean,
    includeDefinitions = true,
    preferredTokenIndex: number | null = null,
    useJaviAnalysis = false
  ) => {
    const expectedText = text.trim();
    const requestId = ++analysisRequestRef.current;
    setLoading(true);
    setError(null);
    setSelectedToken(null);
    setResult(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: deepPhraseAnalysis
          ? "ANALYZE_PHRASE"
          : useJaviAnalysis
            ? "ANALYZE_JAVI"
            : "ANALYZE_TEXT",
        payload: { text, include_definitions: includeDefinitions },
      });
      
      if (response?.type === "ERROR") {
        throw new Error(response.payload.error);
      }
      
      if (
        response?.type === "ANALYZE_RESULT" ||
        response?.type === "ANALYZE_PHRASE_RESULT"
      ) {
        const analyzeResponse = response.payload as AnalyzeResponse | PhraseAnalyzeResponse;
        if (requestId !== analysisRequestRef.current) return;
        if (analyzeResponse.text.trim() !== expectedText) {
          throw new Error("Backend trả kết quả của một câu khác. Vui lòng thử lại.");
        }
        setResult(analyzeResponse);
        
        // Auto-select the first Japanese token if available
        const firstJpIndex = analyzeResponse.tokens.findIndex((t) => t.is_japanese);
        if (
          preferredTokenIndex !== null &&
          analyzeResponse.tokens[preferredTokenIndex]
        ) {
          setSelectedToken(preferredTokenIndex);
        } else if (includeDefinitions && firstJpIndex !== -1) {
          setSelectedToken(firstJpIndex);
        }
      } else {
        throw new Error("Invalid response from background script");
      }
    } catch (e) {
      if (requestId === analysisRequestRef.current) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      }
    } finally {
      if (requestId === analysisRequestRef.current) {
        setLoading(false);
      }
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
  const phraseTranslation =
    phraseMode && result
      ? (result as Partial<PhraseAnalyzeResponse>).translation || ""
      : "";
  const handleTokenSelect = (index: number) => {
    const token = result?.tokens[index];
    if (
      sentenceMode &&
      !phraseMode &&
      token?.is_japanese &&
      token.definitions.length === 0
    ) {
      analyzeText(result.text, false, true, index, true);
      return;
    }
    setSelectedToken(index);
  };
  const panelWidth = Math.min(480, Math.max(300, window.innerWidth - 24));
  const usePlayerOverlay = position.placement === "player-overlay";
  const playerRect = document
    .querySelector("#movie_player")
    ?.getBoundingClientRect();
  const playerPanelWidth = playerRect
    ? Math.min(panelWidth, Math.max(340, playerRect.width * 0.42))
    : panelWidth;
  const panelLeft = usePlayerOverlay
    ? Math.max(
        12,
        Math.min(
          (playerRect?.right ?? window.innerWidth) - playerPanelWidth - 16,
          window.innerWidth - playerPanelWidth - 12
        )
      )
    : Math.max(12, Math.min(position.x, window.innerWidth - panelWidth - 12));
  const panelTop = usePlayerOverlay
    ? Math.max(12, (playerRect?.top ?? 12) + 16)
    : Math.max(12, Math.min(position.y, Math.max(12, window.innerHeight - 620)));
  const panelMaxHeight = usePlayerOverlay
    ? Math.max(260, (playerRect?.height ?? window.innerHeight) - 190)
    : window.innerHeight - 24;

  return (
    <div
      ref={containerRef}
      className="hk-popup hk-fade-in-up"
      style={{
        position: "fixed",
        left: panelLeft,
        top: panelTop,
        zIndex: 2147483647,
        width: usePlayerOverlay ? playerPanelWidth : panelWidth,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: panelMaxHeight,
        minHeight: "auto",
        pointerEvents: "auto",
        background: "#09090b",
        color: "#f4f4f5",
        fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
        fontSize: "14px",
        lineHeight: 1.5,
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)",
        borderRadius: "12px",
        overflowY: "auto",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
      onMouseUp={(e) => e.stopPropagation()} // Prevent selection within closing it immediately
    >
      <div className="hk-header" style={{ padding: "12px 16px", background: "linear-gradient(135deg, #121214, #18181b)", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, zIndex: 10 }}>
        <div className="hk-header__logo">
          <h1 className="hk-header__title" style={{ fontSize: "14px" }}>
            {sentenceMode
              ? phraseMode
                ? "Hakkutsu · Phân tích sâu"
                : "Hakkutsu · Phân tích nhanh"
              : "Hakkutsu · Từ điển"}
            {transientMode && (
              <span className="hk-header__subtitle" style={{ marginLeft: 8 }}>
                giữ Ctrl
              </span>
            )}
          </h1>
        </div>
        <div className="hk-header__actions">
          <button 
            className="hk-btn hk-btn--ghost hk-btn--icon"
            onClick={() => {
              analysisRequestRef.current += 1;
              setPosition(null);
              setTransientMode(false);
              window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="hk-content" style={{ padding: "16px", background: "#09090b" }}>
        {loading && (
          <div className="hk-loading" style={{ textAlign: "center", padding: "24px 0" }}>
            <Loader2 className="hk-spin" size={16} style={{ display: "inline-block", marginRight: "8px", color: "var(--hk-accent-primary)" }} />
            <span style={{ color: "var(--hk-text-muted)", fontSize: "13px" }}>
              {phraseMode
                ? "Qwen đang phân tích sâu..."
                : "Đang phân tích local..."}
            </span>
          </div>
        )}
        
        {error && (
          <div style={{ padding: "8px 12px", background: "var(--hk-bg-tertiary)", borderLeft: "3px solid var(--hk-accent-crimson)", color: "var(--hk-text-primary)", fontSize: "13px", borderRadius: "4px", marginBottom: "16px" }}>
            {error}
          </div>
        )}
        
        {result && !loading && (
          <>
            <div className="hk-dict-section">
              <div className="hk-dict-label">
                CÂU GỐC
              </div>
              <div className="hk-original-text">
                {result.text}
              </div>
            </div>

            {phraseTranslation && (
              <div className="hk-dict-section hk-dict-section--highlight">
                <div className="hk-dict-label" style={{ color: "var(--hk-accent-teal)" }}>
                  BẢN DỊCH
                </div>
                <div className="hk-translation-text">
                  {phraseTranslation}
                </div>
              </div>
            )}

            {sentenceMode && !phraseMode && (
              <div className="hk-dict-footer">
                <span style={{ fontSize: "12px", color: "var(--hk-text-muted)" }}>
                  ⚡ Sudachi local · {transientMode ? "thả Ctrl để đóng" : "chưa gọi Qwen"}
                </span>
                {!transientMode && (
                  <button
                    className="hk-btn hk-btn--primary hk-btn--sm"
                    onClick={() => {
                      setPhraseMode(true);
                      analyzeText(inputText, true, true);
                    }}
                  >
                    AI phân tích sâu
                  </button>
                )}
              </div>
            )}

            <TokenDisplay
              tokens={result.tokens}
              selectedIndex={selectedToken}
              onSelect={handleTokenSelect}
            />

            {sentenceMode && result.tokens.some((token) => token.grammar_note_vi) && (
              <div className="hk-dict-section" style={{ borderLeft: "3px solid var(--hk-jlpt-n3)" }}>
                <div className="hk-dict-label" style={{ color: "var(--hk-jlpt-n3)" }}>
                  BIẾN ĐỔI TRONG CÂU
                </div>
                {result.tokens.filter((token) => token.grammar_note_vi).map((token, index) => (
                  <div key={`${token.surface}-${index}`} style={{ fontSize: "13px", color: "var(--hk-text-primary)", marginBottom: "4px" }}>
                    {token.grammar_note_vi}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: "16px" }}>
              {selectedTokenData && selectedTokenData.is_japanese ? (
                <DefinitionCard
                  token={selectedTokenData}
                  onExport={transientMode ? undefined : handleExport}
                  ankiConnected={ankiConnected}
                  originalText={result.text}
                  sentenceReading={result.sentence_reading}
                  onSrsAdd={transientMode ? undefined : handleSrsAdd}
                />
              ) : (
                <div className="hk-empty">
                  <p className="hk-empty__text">
                    {transientMode ? "Rê chuột qua một từ trong phụ đề để xem chi tiết." : "Chọn một từ tiếng Nhật để xem nghĩa."}
                  </p>
                </div>
              )}
            </div>

            {sentenceMode && result.grammar_patterns && (
              <GrammarExplanations patterns={result.grammar_patterns} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default InlineDictionary;
