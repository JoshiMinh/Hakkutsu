import { useEffect, useState, useRef } from "react";
import {
  X,
  Loader2,
  Sparkles,
  Languages,
  Zap,
  Check,
  BookmarkPlus,
  AlertCircle,
  Crop,
  RefreshCw,
  Edit3,
  ArrowDownUp,
  ArrowLeftRight,
} from "lucide-react";
import { containsJapanese } from "~lib/utils/japanese";
import type {
  AnalyzeResponse,
  PhraseAnalyzeResponse,
  TokenAnalysis,
  AnkiExportData,
  BoxOcrCoordinates,
} from "~lib/utils/types";
import { DefinitionCard } from "~components/definition-card";
import { TokenDisplay } from "~components/token-display";
import { GrammarExplanations } from "~components/grammar-explanations";
import { BoxOcrOverlay } from "~components/box-ocr-overlay";
import { ocrEngine } from "~lib/services/ocr-engine";
import { cropViewportBox } from "~lib/services/image-cropper";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";

// Content scripts render inside arbitrary websites, so root-relative URLs point
// at the host page. Resolve the packaged asset against the extension origin.
const logoUrl = browser.runtime.getURL("/assets/icon.png");

function cleanJapaneseText(raw: string): string {
  return raw
    .trim()
    .replace(
      /^[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f\u300c\u300d\u300e\u300f()（）\[\]【】"'\-—~〜…・]+|[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f\u300c\u300d\u300e\u300f()（）\[\]【】"'\-—~〜…・]+$/g,
      ""
    )
    .trim();
}

interface WordPointResult {
  text: string;
  rect: DOMRect;
  rects: DOMRect[];
}

function getWordAtPoint(x: number, y: number): WordPointResult | null {
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

  let start = -1;
  let end = -1;
  let matchedWord = "";

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
    const segments = Array.from(segmenter.segment(content)) as Array<{
      segment: string;
      index: number;
      input: string;
      isWordLike?: boolean;
    }>;

    const targetSegment = segments.find(
      (s) => offset >= s.index && offset < s.index + s.segment.length
    );

    if (targetSegment && targetSegment.segment && containsJapanese(targetSegment.segment)) {
      matchedWord = targetSegment.segment.trim();
      start = targetSegment.index;
      end = targetSegment.index + targetSegment.segment.length;
    }
  }

  if (!matchedWord || start < 0 || end < 0) {
    let s = offset;
    let e = offset;
    while (s > 0 && containsJapanese(content[s - 1])) {
      s--;
    }
    while (e < content.length && containsJapanese(content[e])) {
      e++;
    }
    matchedWord = content.substring(s, e).trim();
    start = s;
    end = e;
  }

  if (!matchedWord || !containsJapanese(matchedWord)) return null;

  const wordRange = document.createRange();
  wordRange.setStart(textNode, start);
  wordRange.setEnd(textNode, end);
  const rect = wordRange.getBoundingClientRect();
  const rawRects = Array.from(wordRange.getClientRects());
  const rects = rawRects.filter((r) => r.width > 0 && r.height > 0);

  return { text: matchedWord, rect, rects: rects.length > 0 ? rects : [rect] };
}

const InlineDictionary = () => {
  const [position, setPosition] = useState<{
    x: number;
    y: number;
    placement?: "anchor" | "player-overlay";
    above?: boolean;
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
  const transientModeRef = useRef(transientMode);
  transientModeRef.current = transientMode;
  const isMouseOverPopupRef = useRef(false);
  const [srsAdded, setSrsAdded] = useState(false);
  const [srsError, setSrsError] = useState<string | null>(null);
  const [hoverHighlightRects, setHoverHighlightRects] = useState<DOMRect[] | null>(null);
  const [isOcrSelecting, setIsOcrSelecting] = useState(false);
  const [ocrCroppedImage, setOcrCroppedImage] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrOrientation, setOcrOrientation] = useState<"auto" | "vertical" | "horizontal">("auto");
  const [isEditingOcrText, setIsEditingOcrText] = useState(false);
  const [editedOcrText, setEditedOcrText] = useState("");
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

  // Listen for runtime messages (e.g. from background context menu or keyboard shortcut)
  useEffect(() => {
    const handleRuntimeMessage = (message: any, _sender: any, sendResponse: any) => {
      if (message?.type === "TRIGGER_BOX_OCR") {
        setIsOcrSelecting(true);
        setPosition(null);
        setHoverHighlightRects(null);
        sendResponse?.({ success: true });
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, []);

  // Ensure shadow host is placed inside the active fullscreen or player element
  useEffect(() => {
    const syncHostPlacement = () => {
      const host = document.getElementById("hakkutsu-inline-dictionary-host");
      if (!host) return;

      const fsEl = document.fullscreenElement as HTMLElement | null;
      if (fsEl) {
        if (!fsEl.contains(host)) {
          fsEl.appendChild(host);
        }
      } else {
        const netflixPlayer = document.querySelector<HTMLElement>(".watch-video");
        const ytPlayer = document.querySelector<HTMLElement>("#movie_player");
        const target = netflixPlayer || ytPlayer || document.body;
        if (target && !target.contains(host)) {
          target.appendChild(host);
        }
      }
    };

    document.addEventListener("fullscreenchange", syncHostPlacement);
    window.addEventListener("hakkutsu:analyze", syncHostPlacement);
    window.addEventListener("hakkutsu:start-box-ocr", () => setIsOcrSelecting(true));
    syncHostPlacement();

    return () => {
      document.removeEventListener("fullscreenchange", syncHostPlacement);
      window.removeEventListener("hakkutsu:analyze", syncHostPlacement);
      window.removeEventListener("hakkutsu:start-box-ocr", () => setIsOcrSelecting(true));
    };
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
          el?.id === "hakkutsu-inline-dictionary-host" ||
          el?.id === "hakkutsu-box-ocr-overlay" ||
          el?.classList?.contains?.("hk-popup") ||
          el?.classList?.contains?.("hk-sub-token")
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
          setHoverHighlightRects(res.rects);
          if (lastHoverWordRef.current === res.text && positionRef.current) {
            return;
          }
          lastHoverWordRef.current = res.text;

          const rect = res.rect;
          const x = Math.max(16, Math.min(rect.left, window.innerWidth - 340));
          const placeAbove = window.innerHeight - rect.bottom < 360 && rect.top > 360;

          setPosition({
            x,
            y: placeAbove ? rect.top : rect.bottom,
            placement: "anchor",
            above: placeAbove,
          });
          setInputText(res.text);
          setSentenceMode(false);
          setTransientMode(true);
          setOcrCroppedImage(null);
          analyzeText(res.text, false, true);
        } else {
          lastHoverWordRef.current = null;
          setHoverHighlightRects(null);
        }
      } else {
        lastHoverWordRef.current = null;
        setHoverHighlightRects(null);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const keyMode = settingsRef.current.hoverModifierKey || "alt";
      if (keyMode === "none") return;

      const isMatchingKey =
        (keyMode === "alt" && e.key === "Alt") ||
        (keyMode === "ctrl" && e.key === "Control") ||
        (keyMode === "shift" && e.key === "Shift") ||
        (keyMode === "meta" && e.key === "Meta");

      if (isMatchingKey) {
        lastHoverWordRef.current = null;
        setHoverHighlightRects(null);
      }
    };

    const onScroll = () => {
      setHoverHighlightRects(null);
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

        const hasValidRect = Boolean(rect && (rect.width > 0 || rect.height > 0));
        const x = hasValidRect && rect ? rect.left : clientX;

        const estimatedPanelHeight = 360;
        const y = hasValidRect && rect ? rect.bottom : clientY + 12;
        const placeAbove = Boolean(
          hasValidRect &&
          rect &&
          window.innerHeight - rect.bottom < estimatedPanelHeight &&
          rect.top > estimatedPanelHeight
        );
        setPosition({
          x: Math.max(16, Math.min(x, window.innerWidth - 340)),
          y: placeAbove && rect ? rect.top : y,
          placement: "anchor",
          above: placeAbove,
        });
        setInputText(selectedText);
        setOcrCroppedImage(null);
        analyzeText(selectedText, false, true);
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-opened"));
      };

      if (isDoubleClick) {
        selectionTimerRef.current = setTimeout(processSelection, 120);
      }
    };

    const onMouseUp = (e: MouseEvent) => handleSelection(e, false);
    const onDoubleClick = (e: MouseEvent) => handleSelection(e, true);

    const onKeyDown = (e: KeyboardEvent) => {
      // Toggle Box OCR using Alt+S shortcut
      if (e.altKey && (e.key === "s" || e.key === "S" || e.code === "KeyS")) {
        const activeEl = document.activeElement;
        const isInputFocused =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.getAttribute("contenteditable") === "true";
        if (!isInputFocused && settingsRef.current.ocrEnabled !== false) {
          e.preventDefault();
          e.stopPropagation();
          setIsOcrSelecting((prev) => !prev);
          setPosition(null);
          return;
        }
      }

      if (e.key === "Escape") {
        setIsOcrSelecting(false);
        setPosition(null);
        setHoverHighlightRects(null);
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
      }
    };

    const onCustomAnalyze = (e: any) => {
      if (e.detail?.text) {
        const video = document.querySelector<HTMLVideoElement>("video");
        if (video && !video.paused) {
          try {
            video.pause();
          } catch {}
        }

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
        setOcrCroppedImage(null);
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
    const onDismissAnalysis = (e?: any) => {
      if (isMouseOverPopupRef.current && !e?.detail?.force) {
        return;
      }
      if (!transientModeRef.current && !e?.detail?.force) {
        return;
      }
      analysisRequestRef.current += 1;
      setPosition(null);
      setHoverHighlightRects(null);
      setTransientMode(false);
      window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
    };

    const onDocumentPointerDown = (e: MouseEvent) => {
      if (!positionRef.current) return;
      if (!isClickInsidePopup(e)) {
        analysisRequestRef.current += 1;
        setPosition(null);
        setHoverHighlightRects(null);
        setTransientMode(false);
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-closed"));
      }
    };

    document.addEventListener("mousedown", onDocumentPointerDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("hakkutsu:analyze", onCustomAnalyze);
    window.addEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
    window.addEventListener("hakkutsu:token-hover", onTokenHover);

    return () => {
      document.removeEventListener("mousedown", onDocumentPointerDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("dblclick", onDoubleClick, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("hakkutsu:analyze", onCustomAnalyze);
      window.removeEventListener("hakkutsu:analysis-dismiss", onDismissAnalysis);
      window.removeEventListener("hakkutsu:token-hover", onTokenHover);
    };
  }, []);

  // Handle Box OCR Bounding Selection Complete
  const handleBoxOcrComplete = async (
    box: BoxOcrCoordinates,
    selectedOrientation: "auto" | "vertical" | "horizontal"
  ) => {
    setIsOcrSelecting(false);
    setOcrLoading(true);
    setError(null);
    setOcrCroppedImage(null);
    setOcrConfidence(null);
    setOcrOrientation(selectedOrientation);
    setIsEditingOcrText(false);

    // Position popup adjacent to the bounding box
    const x = Math.max(16, Math.min(box.x, window.innerWidth - 340));
    const placeAbove = window.innerHeight - (box.y + box.height) < 360 && box.y > 360;
    setPosition({
      x,
      y: placeAbove ? box.y : box.y + box.height,
      placement: "anchor",
      above: placeAbove,
    });
    setSentenceMode(true);
    setTransientMode(false);

    try {
      // 1. Capture viewport screenshot via background service
      const screenshotResponse = await chrome.runtime.sendMessage({
        type: "CAPTURE_SCREENSHOT",
      });
      if (screenshotResponse?.type === "ERROR" || !screenshotResponse?.payload?.dataUrl) {
        throw new Error(screenshotResponse?.payload?.error || "Failed to capture viewport screenshot");
      }

      const screenshotDataUrl = screenshotResponse.payload.dataUrl as string;

      // 2. Crop bounding box with high-DPI scaling and optional manga pre-processing
      const croppedDataUrl = await cropViewportBox(
        screenshotDataUrl,
        box,
        settingsRef.current.ocrPreprocessEnabled !== false
      );
      setOcrCroppedImage(croppedDataUrl);

      // 3. Execute client-side WebAssembly OCR
      const ocrResult = await ocrEngine.recognize(croppedDataUrl, {
        orientation:
          selectedOrientation === "auto"
            ? (settingsRef.current.ocrDefaultOrientation || "auto")
            : selectedOrientation,
        boxWidth: box.width,
        boxHeight: box.height,
      });

      if (!ocrResult.text || !containsJapanese(ocrResult.text)) {
        if (ocrResult.text) {
          setInputText(ocrResult.text);
          setEditedOcrText(ocrResult.text);
          analyzeText(ocrResult.text, false, true);
        } else {
          setError(t("ocr_no_text") || "No Japanese text detected in selected box. Try adjusting box or contrast.");
        }
      } else {
        setInputText(ocrResult.text);
        setEditedOcrText(ocrResult.text);
        setOcrConfidence(ocrResult.confidence);
        analyzeText(ocrResult.text, false, true);
      }
    } catch (err: any) {
      console.error("[Hakkutsu Box OCR] Recognition error:", err);
      setError(err?.message || "Box OCR recognition failed. Please retry.");
    } finally {
      setOcrLoading(false);
    }
  };

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
          throw new Error(
            isVietnamese
              ? "Backend trả kết quả của một câu khác. Vui lòng thử lại."
              : "Analysis result text mismatch. Please retry."
          );
        }
        setResult(analyzeResponse);

        // Prefer selecting token matching expectedText if present, or first Japanese token
        const matchingTokenIndex = analyzeResponse.tokens.findIndex(
          (t) => t.surface === expectedText || t.dictionary_form === expectedText
        );
        const firstJpIndex = analyzeResponse.tokens.findIndex((t) => t.is_japanese);

        if (
          preferredTokenIndex !== null &&
          analyzeResponse.tokens[preferredTokenIndex]
        ) {
          setSelectedToken(preferredTokenIndex);
        } else if (matchingTokenIndex !== -1) {
          setSelectedToken(matchingTokenIndex);
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
        payload: {
          ...data,
          screenshot: ocrCroppedImage || data.screenshot,
          imageUrl: ocrCroppedImage || data.imageUrl,
        },
      });
    } catch (e) {
      console.error("Export failed", e);
    }
  };

  const handleSrsAdd = async (selectedImageUrl?: string) => {
    if (!selectedTokenData) return;
    const word = selectedTokenData.dictionary_form || selectedTokenData.surface;
    if (!word) return;

    if (srsAdded) {
      try {
        await chrome.runtime.sendMessage({
          type: "REMOVE_SRS_CARD",
          payload: { word },
        });
        setSrsAdded(false);
        setSrsError(null);
      } catch (e: any) {
        console.error("Remove card failed", e);
      }
    } else {
      const meanings = selectedTokenData.definitions
        .flatMap((d) => d.glosses)
        .join("; ");

      try {
        await chrome.runtime.sendMessage({
          type: "ADD_SRS_CARD",
          payload: {
            word,
            reading: selectedTokenData.reading.hiragana,
            word_furigana: `${word}[${selectedTokenData.reading.hiragana}]`,
            meaning: meanings || "—",
            sentence: result?.text,
            sentence_furigana: result?.sentence_reading,
            sentence_meaning: phraseTranslation,
            vietnamese_sound: selectedTokenData.vietnamese_sound,
            jlpt: selectedTokenData.jlpt_level,
            image_url: selectedImageUrl || ocrCroppedImage || undefined,
          },
        });
        setSrsAdded(true);
        setSrsError(null);
      } catch (e: any) {
        console.error("SRS Add failed", e);
      }
    }
  };

  const selectedTokenData =
    result && selectedToken !== null ? result.tokens?.[selectedToken] : null;

  useEffect(() => {
    if (!selectedTokenData || !selectedTokenData.is_japanese) {
      setSrsAdded(false);
      return;
    }
    const word = selectedTokenData.dictionary_form || selectedTokenData.surface;
    if (!word) return;

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime
        .sendMessage({
          type: "CHECK_CARD_EXISTS",
          payload: { word },
        })
        .then((res) => {
          if (res && res.type === "CARD_EXISTS_RESULT" && res.payload?.exists) {
            setSrsAdded(true);
          } else {
            setSrsAdded(false);
          }
        })
        .catch(() => {});
    }
  }, [selectedTokenData]);

  const phraseTranslation =
    result && "translation" in result
      ? String((result as any).translation || "").trim()
      : "";

  const handleTokenSelect = (index: number) => {
    const token = result?.tokens[index];
    if (
      result &&
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
  const usePlayerOverlay = position?.placement === "player-overlay";

  const panelLeft = position
    ? Math.max(16, Math.min(window.innerWidth - cardWidth - 16, position.x - cardWidth / 2))
    : 0;

  const isLower = position ? position.y > window.innerHeight * 0.42 : false;
  const placeAbove = usePlayerOverlay || (position?.above ?? isLower);

  const aboveOffset = usePlayerOverlay ? 40 : 24;
  const availableHeightAbove = position ? Math.max(160, position.y - aboveOffset - 16) : 380;
  const availableHeightBelow = position ? Math.max(160, window.innerHeight - position.y - 24) : 380;
  const computedMaxHeight = position
    ? placeAbove
      ? Math.min(420, availableHeightAbove)
      : Math.min(420, availableHeightBelow)
    : 380;

  const popupStyle: React.CSSProperties = position
    ? placeAbove
      ? {
          position: "fixed",
          bottom: `${Math.max(16, window.innerHeight - position.y + aboveOffset)}px`,
          left: `${panelLeft}px`,
          width: `${cardWidth}px`,
          maxHeight: `${computedMaxHeight}px`,
          zIndex: 2147483647,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }
      : {
          position: "fixed",
          top: `${Math.max(16, position.y + 8)}px`,
          left: `${panelLeft}px`,
          width: `${cardWidth}px`,
          maxHeight: `${computedMaxHeight}px`,
          zIndex: 2147483647,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }
    : {};

  return (
    <>
      {/* Box OCR Interactive Drag Selection Overlay */}
      {isOcrSelecting && (
        <BoxOcrOverlay
          onComplete={handleBoxOcrComplete}
          onCancel={() => setIsOcrSelecting(false)}
        />
      )}

      {/* Yomichan-style soft blue hover highlight overlay */}
      {hoverHighlightRects &&
        hoverHighlightRects.map((rect, idx) => (
          <div
            key={idx}
            style={{
              position: "fixed",
              top: `${rect.top}px`,
              left: `${rect.left}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              backgroundColor: "rgba(59, 130, 246, 0.3)",
              border: "1px solid rgba(59, 130, 246, 0.6)",
              borderRadius: "3px",
              pointerEvents: "none",
              zIndex: 2147483646,
              boxSizing: "border-box",
              transition: "all 0.05s ease-out",
            }}
          />
        ))}

      {position && (
        <div
          ref={containerRef}
          className="hk-popup hk-fade-in"
          style={popupStyle}
          onMouseEnter={() => {
            isMouseOverPopupRef.current = true;
          }}
          onMouseLeave={() => {
            isMouseOverPopupRef.current = false;
            if (transientModeRef.current) {
              window.setTimeout(() => {
                if (!isMouseOverPopupRef.current) {
                  window.dispatchEvent(
                    new CustomEvent("hakkutsu:analysis-dismiss", { detail: { force: true } })
                  );
                }
              }, 250);
            }
          }}
        >
          {/* Header */}
          <header className="hk-header">
            <div className="hk-header__logo">
              <img src={logoUrl} alt="Hakkutsu" style={{ width: 18, height: 18, borderRadius: "4px" }} />
              <h2 className="hk-header__title hk-brand-title">
                {ocrCroppedImage ? "Hakkutsu Box OCR" : "Hakkutsu Lookup"}
              </h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {/* Trigger Box OCR Button */}
              <button
                type="button"
                className="hk-btn-icon-subtle"
                onClick={() => {
                  setPosition(null);
                  setIsOcrSelecting(true);
                }}
                title={t("ocr_btn_trigger") || "Box OCR (Alt+S)"}
                style={{ width: "24px", height: "24px", color: isOcrSelecting ? "#38bdf8" : undefined }}
              >
                <Crop size={14} />
              </button>

              {/* Close Button */}
              <button
                type="button"
                className="hk-btn-icon-subtle"
                onClick={() => {
                  setPosition(null);
                  setHoverHighlightRects(null);
                  setOcrCroppedImage(null);
                }}
                title={t("dict_btn_close")}
                style={{ width: "24px", height: "24px" }}
              >
                <X size={15} />
              </button>
            </div>
          </header>

          {/* Main Scrollable Content */}
          <div className="hk-content" style={{ overflowY: "auto", flex: 1 }}>
            {/* Box OCR Cropped Snippet & Editable Text Area */}
            {ocrCroppedImage && (
              <div
                style={{
                  margin: "8px 12px 10px 12px",
                  padding: "10px",
                  backgroundColor: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <img
                    src={ocrCroppedImage}
                    alt="Manga Snippet"
                    style={{
                      maxHeight: "56px",
                      maxWidth: "100px",
                      objectFit: "contain",
                      borderRadius: "6px",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      backgroundColor: "#000",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                      }}
                    >
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "#38bdf8" }}>
                        {t("ocr_title") || "Manga OCR"}
                      </span>
                      {ocrConfidence !== null && (
                        <span style={{ fontSize: "10px", color: "var(--hk-text-muted)" }}>
                          {Math.round(ocrConfidence)}% confidence
                        </span>
                      )}
                    </div>
                    {isEditingOcrText ? (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="text"
                          value={editedOcrText}
                          onChange={(e) => setEditedOcrText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setInputText(editedOcrText);
                              setIsEditingOcrText(false);
                              analyzeText(editedOcrText, false, true);
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: "4px 8px",
                            backgroundColor: "rgba(0, 0, 0, 0.5)",
                            border: "1px solid #38bdf8",
                            borderRadius: "6px",
                            color: "#fff",
                            fontSize: "12px",
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setInputText(editedOcrText);
                            setIsEditingOcrText(false);
                            analyzeText(editedOcrText, false, true);
                          }}
                          style={{
                            padding: "4px 8px",
                            backgroundColor: "#38bdf8",
                            border: "none",
                            borderRadius: "6px",
                            color: "#0f172a",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          OK
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "6px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#f8fafc",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {inputText || "—"}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditedOcrText(inputText);
                            setIsEditingOcrText(true);
                          }}
                          title={t("ocr_edit_hint") || "Edit text"}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--hk-text-muted)",
                            cursor: "pointer",
                            padding: "2px",
                          }}
                        >
                          <Edit3 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* OCR / Translation Loading State */}
            {(loading || ocrLoading) && (
              <div className="hk-loading">
                <Loader2
                  className="hk-spin"
                  size={20}
                  style={{ color: "#38bdf8", margin: "0 auto 8px" }}
                />
                <div style={{ color: "#a1a1aa", fontSize: "13px" }}>
                  {ocrLoading
                    ? t("ocr_recognizing") || "Recognizing Japanese text..."
                    : phraseMode
                      ? t("dict_loading_phrase")
                      : t("dict_loading_syntax")}
                </div>
              </div>
            )}

            {/* Error Box */}
            {error && <div className="hk-error-box">{error}</div>}

            {result && !loading && !ocrLoading && (
              <>
                {/* Target Language sentence translation */}
                {phraseTranslation && (
                  <div className="hk-dict-section hk-dict-section--highlight">
                    <div
                      className="hk-dict-label"
                      style={{ color: "#14b8a6", display: "flex", alignItems: "center", gap: "5px" }}
                    >
                      <Languages size={13} />
                      {t("dict_label_translation")}
                    </div>
                    <div className="hk-translation-text">{phraseTranslation}</div>
                  </div>
                )}

                {/* Selected Token Definition Card */}
                <div>
                  {selectedTokenData && selectedTokenData.is_japanese ? (
                    <DefinitionCard
                      token={selectedTokenData}
                      onExport={handleExport}
                      ankiConnected={ankiConnected}
                      originalText={result.text}
                      sentenceReading={result.sentence_reading}
                      onSrsAdd={handleSrsAdd}
                      hideBottomAction={true}
                    />
                  ) : (
                    <div className="hk-empty">
                      <p className="hk-empty__text">
                        {transientMode ? t("dict_empty_transient") : t("dict_empty_select")}
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

          {/* Pinned Bottom Footer Action */}
          {selectedTokenData && selectedTokenData.is_japanese && (
            <div
              className="hk-popup__footer"
              style={{
                padding: "10px 14px",
                background: "#141418",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                flexShrink: 0,
              }}
            >
              <button
                className={`hk-btn ${
                  srsError ? "hk-btn--danger" : srsAdded ? "hk-btn--success" : "hk-btn--primary"
                }`}
                onClick={() => handleSrsAdd(ocrCroppedImage || undefined)}
                title={srsError || (srsAdded ? t("def_btn_added_library") : t("def_btn_add_library"))}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  gap: "6px",
                  backgroundColor: srsError ? "#ef4444" : undefined,
                  borderColor: srsError ? "#ef4444" : undefined,
                  color: srsError ? "#ffffff" : undefined,
                }}
              >
                {srsError ? (
                  <>
                    <AlertCircle size={14} /> {srsError}
                  </>
                ) : srsAdded ? (
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
      )}
    </>
  );
};

export default InlineDictionary;
