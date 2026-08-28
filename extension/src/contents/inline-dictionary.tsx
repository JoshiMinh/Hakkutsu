import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef } from "react";
import { X, Loader2, Sparkles, Languages, Zap, Check, BookmarkPlus } from "lucide-react";
import { containsJapanese } from "~lib/utils/japanese";
import type { AnalyzeResponse, PhraseAnalyzeResponse, TokenAnalysis, AnkiExportData } from "~lib/types";
import { DefinitionCard } from "~components/definition-card";
import { TokenDisplay } from "~components/token-display";
import { GrammarExplanations } from "~components/grammar-explanations";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/languages/locales";
import logoUrl from "data-base64:~assets/icon/icon-rounded.png";

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
    /* Modern sleek custom dark scrollbar */
    .hk-popup *::-webkit-scrollbar,
    ::-webkit-scrollbar {
      width: 5px !important;
      height: 5px !important;
    }
    .hk-popup *::-webkit-scrollbar-track,
    ::-webkit-scrollbar-track {
      background: transparent !important;
    }
    .hk-popup *::-webkit-scrollbar-thumb,
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.18) !important;
      border-radius: 9999px !important;
    }
    .hk-popup *::-webkit-scrollbar-thumb:hover,
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(192, 132, 252, 0.5) !important;
    }
    * {
      scrollbar-width: thin !important;
      scrollbar-color: rgba(255, 255, 255, 0.18) transparent !important;
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

function getWordAtPoint(x: number, y: number): { text: string; rect: DOMRect } | null {
  let range: Range | null = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if ((document as any).caretPositionFromPoint) {
    const pos = (document as any).caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }

  if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const textNode = range.startContainer;
  const content = textNode.textContent || "";
  const offset = range.startOffset;

  if (!content || offset < 0 || offset >= content.length) return null;

  let start = offset;
  let end = offset;

  while (start > 0 && containsJapanese(content[start - 1])) {
    start--;
  }
  while (end < content.length && containsJapanese(content[end])) {
    end++;
  }

  const word = content.substring(start, end).trim();
  if (!word || !containsJapanese(word)) return null;

  const wordRange = document.createRange();
  wordRange.setStart(textNode, start);
  wordRange.setEnd(textNode, end);
  const rect = wordRange.getBoundingClientRect();

  return { text: word, rect };
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
  const [srsAdded, setSrsAdded] = useState(false);
  const { settings, isHydrated } = useSettingsStore();
  const { t, isVietnamese, lang } = useTranslation();

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

  const lastHoverWordRef = useRef<string | null>(null);
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

    const checkModifierKey = (e: MouseEvent, keyMode: string): boolean => {
      if (keyMode === "alt") return e.altKey;
      if (keyMode === "ctrl") return e.ctrlKey;
      if (keyMode === "shift") return e.shiftKey;
      if (keyMode === "meta") return e.metaKey;
      return false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isClickInsidePopup(e)) return;
      if (isHydratedRef.current && settingsRef.current.textAnalysisEnabled === false) return;

      const keyMode = settingsRef.current.hoverModifierKey || "alt";
      if (keyMode === "none") return;

      if (checkModifierKey(e, keyMode)) {
        const res = getWordAtPoint(e.clientX, e.clientY);
        if (res && res.text) {
          if (lastHoverWordRef.current === res.text && positionRef.current) {
            return;
          }
          lastHoverWordRef.current = res.text;

          const rect = res.rect;
          const x = Math.max(16, Math.min(rect.left, window.innerWidth - 340));
          const targetY = rect.bottom + 8;
          const placeAbove = window.innerHeight - rect.bottom < 360 && rect.top > 360;
          const y = placeAbove ? Math.max(16, rect.top - 368) : targetY;

          setPosition({
            x,
            y: Math.max(16, y),
            placement: "anchor",
          });
          setInputText(res.text);
          setPhraseMode(false);
          setSentenceMode(false);
          setTransientMode(true);
          analyzeText(res.text, false, true);
        }
      } else {
        lastHoverWordRef.current = null;
      }
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

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("hakkutsu:analyze", onCustomAnalyze);
    window.addEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
    window.addEventListener("hakkutsu:token-hover", onTokenHover);

    return () => {
      document.removeEventListener("mousemove", onMouseMove, true);
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
          throw new Error(isVietnamese ? "Backend trả kết quả của một câu khác. Vui lòng thử lại." : "Analysis result text mismatch. Please retry.");
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
      setSrsAdded(true);
      setTimeout(() => setSrsAdded(false), 2000);
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
  const cardWidth = Math.min(420, Math.max(320, window.innerWidth - 32));
  const usePlayerOverlay = position.placement === "player-overlay";

  // Center horizontally directly over the hovered/clicked word
  const panelLeft = Math.max(
    16,
    Math.min(window.innerWidth - cardWidth - 16, position.x - cardWidth / 2)
  );

  // Position vertically:
  // For subtitles or if the word is in the lower half of viewport,
  // float the definition card directly ABOVE the word!
  const estimatedHeight = 340;
  const isLower = position.y > window.innerHeight * 0.42;
  const placeAbove = usePlayerOverlay || isLower;

  const panelTop = placeAbove
    ? Math.max(16, position.y - estimatedHeight - 12)
    : Math.min(window.innerHeight - estimatedHeight - 16, position.y + 16);

  const panelMaxHeight = Math.min(window.innerHeight - 32, 540);

  return (
    <div
      ref={containerRef}
      className="hk-popup hk-fade-in"
      style={{
        position: "fixed",
        top: `${panelTop}px`,
        left: `${panelLeft}px`,
        width: `${cardWidth}px`,
        maxHeight: "min(380px, calc(100vh - 40px))",
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column"
      }}
    >
      {/* Header */}
      <header className="hk-header">
        <div className="hk-header__logo">
          <img src={logoUrl} alt="Hakkutsu" style={{ width: 18, height: 18, borderRadius: "4px" }} />
          <h2 className="hk-header__title">Hakkutsu Lookup</h2>
        </div>
        <button
          className="hk-btn-icon-subtle"
          onClick={() => setPosition(null)}
          title={t("dict_btn_close")}
          style={{ width: "24px", height: "24px" }}
        >
          <X size={15} />
        </button>
      </header>

      {/* Main Scrollable Content */}
      <div className="hk-content" style={{ overflowY: "auto", flex: 1 }}>
        {loading && (
          <div className="hk-loading">
            <Loader2 className="hk-spin" size={20} style={{ color: "#a855f7", margin: "0 auto 8px" }} />
            <div style={{ color: "#a1a1aa", fontSize: "13px" }}>
              {phraseMode
                ? t("dict_loading_phrase")
                : t("dict_loading_syntax")}
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
                    {t("dict_label_original")}
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
                      <Sparkles size={12} /> {t("dict_btn_deep_ai")}
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
                <div className="hk-dict-label" style={{ color: "#14b8a6", display: "flex", alignItems: "center", gap: "5px" }}>
                  <Languages size={13} />
                  {t("dict_label_translation")}
                </div>
                <div className="hk-translation-text">
                  {phraseTranslation}
                </div>
              </div>
            )}

            {/* Selected Token Definition Card (Without trapped action button) */}
            <div>
              {selectedTokenData && selectedTokenData.is_japanese ? (
                <DefinitionCard
                  token={selectedTokenData}
                  onExport={transientMode ? undefined : handleExport}
                  ankiConnected={ankiConnected}
                  originalText={result.text}
                  sentenceReading={result.sentence_reading}
                  onSrsAdd={transientMode ? undefined : handleSrsAdd}
                  hideBottomAction={true}
                />
              ) : (
                <div className="hk-empty">
                  <p className="hk-empty__text">
                    {transientMode
                      ? t("dict_empty_transient")
                      : t("dict_empty_select")}
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

      {/* Pinned Bottom Footer Action (Outside the meaning scroll container) */}
      {selectedTokenData && selectedTokenData.is_japanese && !transientMode && (
        <div className="hk-popup__footer" style={{
          padding: "10px 14px",
          background: "#141418",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          flexShrink: 0
        }}>
          <button
            className={`hk-btn ${srsAdded ? "hk-btn--success" : "hk-btn--primary"}`}
            onClick={handleSrsAdd}
            title={srsAdded ? t("def_btn_added_library") : t("def_btn_add_library")}
            style={{ width: "100%", justifyContent: "center", padding: "8px 16px", fontSize: "13px", fontWeight: 600, borderRadius: "8px", gap: "6px" }}
          >
            {srsAdded ? (
              <>
                <Check size={14} /> {t("def_btn_added_library")}
              </>
            ) : (
              <>
                <BookmarkPlus size={14} /> {t("def_btn_add_library")}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default InlineDictionary;
