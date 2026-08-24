import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef } from "react";
import { X, Loader2, Sparkles, Languages, Zap } from "lucide-react";
import { containsJapanese } from "~lib/utils/japanese";
import type { AnalyzeResponse, PhraseAnalyzeResponse, TokenAnalysis, AnkiExportData } from "~lib/types";
import { DefinitionCard } from "~components/definition-card";
import { TokenDisplay } from "~components/token-display";
import { GrammarExplanations } from "~components/grammar-explanations";
import { useSettingsStore } from "~lib/utils/settings";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: ["*://*.saucenao.com/*", "*://saucenao.com/*"],
  all_frames: true,
};

import cssText from "data-text:~style.css";

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + `
    :host {
      all: initial;
      z-index: 2147483647;
    }
    .hk-popup {
      background: #0d0d11 !important;
      border: 1px solid rgba(255, 255, 255, 0.14) !important;
      border-radius: 12px !important;
      box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
      color: #f4f4f5 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
    }
    .hk-popup *, .hk-popup *::before, .hk-popup *::after {
      box-sizing: border-box !important;
    }
    .hk-header {
      background: #141418 !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      padding: 10px 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      flex-shrink: 0 !important;
    }
    .hk-header__logo {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
    }
    .hk-header__title {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #f4f4f5 !important;
      margin: 0 !important;
      line-height: 1.2 !important;
    }
    .hk-content {
      padding: 14px !important;
      overflow-y: auto !important;
      flex: 1 !important;
      background: #0d0d11 !important;
    }
  `;
  return style;
};

function cleanJapaneseText(raw: string): string {
  return raw
    .trim()
    .replace(
      /^[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f\u300c\u300d\u300e\u300f()（）\[\]【】"'\-—~〜…・]+|[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f\u300c\u300d\u300e\u300f()（）\[\]【】"'\-—~〜…・]+$/g,
      ""
    )
    .trim();
}

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
  const { settings, isHydrated } = useSettingsStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const analysisRequestRef = useRef(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const isHydratedRef = useRef(isHydrated);
  isHydratedRef.current = isHydrated;

  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: "CHECK_ANKI" })
      .then((response) => {
        if (response?.type === "ANKI_STATUS") {
          setAnkiConnected(response.payload.connected);
        }
      })
      .catch(() => setAnkiConnected(false));
  }, []);

  const selectionTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const isClickInsidePopup = (e: MouseEvent): boolean => {
      const path = (e.composedPath && e.composedPath()) || [];
      if (
        containerRef.current &&
        (containerRef.current.contains(e.target as Node) ||
          path.includes(containerRef.current))
      ) {
        return true;
      }
      return path.some(
        (el: any) =>
          el?.id === "hakkutsu-inline-dictionary" ||
          el?.classList?.contains?.("hk-popup")
      );
    };

    const handleSelection = (e: MouseEvent, isDoubleClick: boolean) => {
      if (isClickInsidePopup(e)) {
        return;
      }

      if (
        isHydratedRef.current &&
        settingsRef.current.textAnalysisEnabled === false
      ) {
        return;
      }

      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }

      const clientX = e.clientX;
      const clientY = e.clientY;

      const processSelection = () => {
        let rawSelectedText = "";
        let rect: DOMRect | null = null;

        const activeEl = document.activeElement;
        if (
          activeEl &&
          (activeEl instanceof HTMLInputElement ||
            activeEl instanceof HTMLTextAreaElement) &&
          typeof activeEl.selectionStart === "number" &&
          typeof activeEl.selectionEnd === "number" &&
          activeEl.selectionStart !== activeEl.selectionEnd
        ) {
          rawSelectedText = activeEl.value.substring(
            activeEl.selectionStart,
            activeEl.selectionEnd
          );
          rect = activeEl.getBoundingClientRect();
        } else {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) {
            rawSelectedText = selection.toString();
            if (selection.rangeCount > 0) {
              rect = selection.getRangeAt(0).getBoundingClientRect();
            }
          }
        }

        const selectedText = cleanJapaneseText(rawSelectedText);

        if (!selectedText || !containsJapanese(selectedText)) {
          if (!isDoubleClick && positionRef.current) {
            setPosition(null);
            window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
          }
          return;
        }

        const hasValidRect = rect && (rect.width > 0 || rect.height > 0);
        const x = hasValidRect ? rect.left : clientX;

        // Position smartly: place below selection by default, or above if near bottom of viewport
        const estimatedPanelHeight = 360;
        const targetY = hasValidRect ? rect.bottom + 8 : clientY + 12;
        const placeAbove =
          hasValidRect &&
          window.innerHeight - rect.bottom < estimatedPanelHeight &&
          rect.top > estimatedPanelHeight;
        const y = placeAbove
          ? Math.max(16, rect.top - estimatedPanelHeight - 8)
          : targetY;

        setPosition({
          x: Math.max(16, Math.min(x, window.innerWidth - 340)),
          y: Math.max(16, y),
          placement: "anchor",
        });
        setInputText(selectedText);
        setPhraseMode(false);
        setSentenceMode(false);
        analyzeText(selectedText, false, true);
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-opened"));
      };

      if (isDoubleClick) {
        // Immediate processing for double click
        processSelection();
      } else {
        // Slight debounce on normal mouseup to allow drag-selection or double-click to resolve
        selectionTimerRef.current = setTimeout(processSelection, 120);
      }
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
        const x = Number.isFinite(e.detail.x)
          ? e.detail.x
          : window.innerWidth / 2;
        const y = Number.isFinite(e.detail.y)
          ? e.detail.y
          : window.innerHeight / 2;
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

    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("hakkutsu:analyze", onCustomAnalyze);
    window.addEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
    window.addEventListener("hakkutsu:token-hover", onTokenHover);

    return () => {
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
      }
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("dblclick", onDoubleClick, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hakkutsu:analyze", onCustomAnalyze);
      window.removeEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
      window.removeEventListener("hakkutsu:token-hover", onTokenHover);
    };
  }, []);

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
          word: selectedTokenData.dictionary_form || selectedTokenData.surface,
          reading: selectedTokenData.reading.hiragana,
          word_furigana: `${selectedTokenData.dictionary_form || selectedTokenData.surface}[${selectedTokenData.reading.hiragana}]`,
          meaning: meanings || "—",
          sentence: result?.text,
          sentence_furigana: result?.sentence_reading,
          sentence_meaning: phraseTranslation,
          vietnamese_sound: selectedTokenData.vietnamese_sound,
          jlpt: selectedTokenData.jlpt_level,
        },
      });
    } catch (e) {
      console.error("SRS Add failed", e);
    }
  };

  if (!position) return null;

  const selectedTokenData =
    result && selectedToken !== null ? result.tokens[selectedToken] : null;
  const phraseTranslation =
    result && "translation" in result
      ? String((result as any).translation || "").trim()
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
  const panelWidth = Math.min(460, Math.max(320, window.innerWidth - 24));
  const usePlayerOverlay = position.placement === "player-overlay";
  const playerRect = document
    .querySelector("#movie_player")
    ?.getBoundingClientRect();
  const playerPanelWidth = playerRect
    ? Math.min(panelWidth, Math.max(340, playerRect.width * 0.42))
    : panelWidth;

  // Position nicely relative to the click coordinates or subtitle bar
  const panelLeft = usePlayerOverlay
    ? Math.max(
        16,
        Math.min(
          window.innerWidth - playerPanelWidth - 16,
          position.x > window.innerWidth / 2
            ? (playerRect?.right ?? window.innerWidth) - playerPanelWidth - 20
            : Math.max(16, (playerRect?.left ?? 16) + 20)
        )
      )
    : Math.max(16, Math.min(position.x, window.innerWidth - panelWidth - 16));

  const panelTop = usePlayerOverlay
    ? Math.max(
        16,
        Math.min(
          window.innerHeight - 480,
          position.y > 480
            ? position.y - 450
            : (playerRect ? Math.max(16, Math.min(window.innerHeight - 480, playerRect.top + 24)) : 24)
        )
      )
    : Math.max(16, Math.min(position.y, window.innerHeight - 120));

  const panelMaxHeight = Math.min(window.innerHeight - 32, 540);

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
      }}
      onMouseUp={(e) => e.stopPropagation()}
    >
      {/* Sleek Header */}
      <div className="hk-header">
        <div className="hk-header__logo">
          <Sparkles size={16} style={{ color: "#c084fc" }} />
          <h1 className="hk-header__title">
            {sentenceMode
              ? phraseMode
                ? "Hakkutsu AI"
                : "Hakkutsu"
              : "Hakkutsu · Từ điển"}
          </h1>
          {phraseMode ? (
            <span className="hk-header__badge hk-header__badge--ai">✨ Gemini</span>
          ) : sentenceMode ? (
            <span className="hk-header__badge hk-header__badge--fast">⚡ Sudachi</span>
          ) : null}
          {transientMode && (
            <span className="hk-header__subtitle">
              (giữ Ctrl)
            </span>
          )}
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
            title="Đóng (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="hk-content">
        {loading && (
          <div className="hk-loading">
            <Loader2 className="hk-spin" size={20} style={{ color: "#a855f7", margin: "0 auto 8px" }} />
            <div style={{ color: "#a1a1aa", fontSize: "13px" }}>
              {phraseMode
                ? "Gemini đang phân tích sâu..."
                : "Đang phân tích cú pháp..."}
            </div>
          </div>
        )}
        
        {error && (
          <div className="hk-error-box">
            {error}
          </div>
        )}
        
        {result && !loading && (
          <>
            {/* Show sentence context when analyzing a phrase/sentence */}
            {result.tokens.length > 1 && (
              <div className="hk-dict-section">
                <div className="hk-dict-label-row">
                  <span className="hk-dict-label">
                    {settings.targetLanguage === "en" ? "ORIGINAL SENTENCE (CLICK TO INSPECT)" : "CÂU GỐC (BẤM TỪ ĐỂ TRA CỤ THỂ)"}
                  </span>
                  {sentenceMode && !phraseMode && !transientMode && (
                    <button
                      className="hk-btn hk-btn--primary hk-btn--sm"
                      onClick={() => {
                        setPhraseMode(true);
                        analyzeText(inputText, true, true);
                      }}
                      style={{ padding: "3px 8px", fontSize: "11px" }}
                    >
                      <Sparkles size={12} /> {settings.targetLanguage === "en" ? "Deep AI Breakdown" : "AI phân tích sâu"}
                    </button>
                  )}
                </div>

                <TokenDisplay
                  tokens={result.tokens}
                  selectedIndex={selectedToken}
                  onSelect={handleTokenSelect}
                />
              </div>
            )}

            {/* Target Language sentence translation */}
            {phraseTranslation && (
              <div className="hk-dict-section hk-dict-section--highlight">
                <div className="hk-dict-label" style={{ color: "#14b8a6" }}>
                  <Languages size={12} style={{ display: "inline-block", marginRight: "4px" }} />
                  {settings.targetLanguage === "en" ? "ENGLISH TRANSLATION" : "BẢN DỊCH TIẾNG VIỆT"}
                </div>
                <div className="hk-translation-text">
                  {phraseTranslation}
                </div>
              </div>
            )}

            {/* Selected Token Definition Card */}
            <div>
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
                    {transientMode
                      ? (settings.targetLanguage === "en" ? "Hover over a word in the subtitles to inspect." : "Rê chuột qua một từ trong phụ đề để xem chi tiết.")
                      : (settings.targetLanguage === "en" ? "Select a Japanese word from the sentence to inspect." : "Chọn một từ tiếng Nhật trong câu để tra từ điển.")}
                  </p>
                </div>
              )}
            </div>

            {/* Grammar Patterns */}
            {result.grammar_patterns && result.grammar_patterns.length > 0 && (
              <GrammarExplanations patterns={result.grammar_patterns} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default InlineDictionary;
