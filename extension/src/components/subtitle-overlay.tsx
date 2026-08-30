import React, { useEffect, useState, useRef, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import type {
  SubtitleSegment,
  SubtitleFetchResult,
  AnalyzeResponse,
  TokenAnalysis,
  AnkiExportData,
} from "~lib/types";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/languages/locales";
import { SelectSubtitlesModal } from "./select-subtitles-modal";
import type { SubtitleTrackOption } from "./select-subtitles-modal";
import { smartCueEnd } from "~lib/services/smart-cue";
import { deduplicateCueText } from "~lib/services/subtitle-parsers";
import { distributeFurigana, containsJapanese } from "~lib/utils/japanese";
import { predictJlpt } from "~lib/utils/jlpt-classifier";

// ── In-Memory Caches ─────────────────────────────────────────────────────────

const tokenCache = new Map<string, TokenAnalysis[]>();
const translationCache = new Map<string, string>();

function createImmediateTokens(text: string): TokenAnalysis[] {
  try {
    if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
      const segmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
      const segments = Array.from(segmenter.segment(text)) as any[];
      return segments.map((s) => {
        const segText = s.segment;
        const isJp = containsJapanese(segText);
        return {
          surface: segText,
          dictionary_form: segText,
          pos: s.isWordLike ? "Word" : "Punctuation",
          pos_detail: [],
          reading: { hiragana: "", romaji: "" },
          is_japanese: isJp,
          jlpt_level: isJp ? predictJlpt(segText) : null,
          frequency_rank: null,
          definitions: [],
        };
      });
    }
  } catch {}

  const parts = text.match(/[\u4e00-\u9faf]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[a-zA-Z0-9]+|[^\s\w]/g) || [text];
  return parts.map((part) => {
    const isJp = containsJapanese(part);
    return {
      surface: part,
      dictionary_form: part,
      pos: isJp ? "Word" : "Other",
      pos_detail: [],
      reading: { hiragana: "", romaji: "" },
      is_japanese: isJp,
      jlpt_level: isJp ? predictJlpt(part) : null,
      frequency_rank: null,
      definitions: [],
    };
  });
}

// ── Props ───────────────────────────────────────────────────────────────────

export interface SubtitleOverlayProps {
  isEnabled: boolean;
  loading: boolean;
  error: string | null;
  subtitleData: SubtitleFetchResult | null;
  currentSegment: SubtitleSegment | null;
  secondarySegment?: SubtitleSegment | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  currentUrl: string;
  videoTitle?: string;
  availableTracks?: SubtitleTrackOption[];
  currentTrackId?: string;
  secondaryTrackId?: string;
  offset?: number;
  onToggleEnabled: () => void;
  onOffsetChange?: (offset: number) => void;
  onSelectTrack?: (track: SubtitleTrackOption) => Promise<void> | void;
  onSelectSecondaryTrack?: (track: SubtitleTrackOption | null) => Promise<void> | void;
  onLoadCustomSubtitles?: (result: SubtitleFetchResult) => void;
  onSeekToCue?: (cue: SubtitleSegment) => void;
  onOpenModal?: () => void;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  isEnabled,
  loading,
  error,
  subtitleData,
  currentSegment,
  secondarySegment,
  videoRef,
  currentUrl,
  videoTitle = "",
  availableTracks = [],
  currentTrackId,
  secondaryTrackId,
  offset = 0,
  onToggleEnabled,
  onOffsetChange,
  onSelectTrack,
  onSelectSecondaryTrack,
  onLoadCustomSubtitles,
  onSeekToCue,
  onOpenModal,
}) => {
  const { settings, updateSettings } = useSettingsStore();
  const { t, isVietnamese } = useTranslation();

  const [analyzedTokens, setAnalyzedTokens] = useState<TokenAnalysis[] | null>(null);
  const [translatedText, setTranslatedText] = useState<string>("");
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [offsetToast, setOffsetToast] = useState<string | null>(null);
  const [ankiSaved, setAnkiSaved] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const autoPauseLockedCueRef = useRef<SubtitleSegment | null>(null);

  // ── 1. Tokenize Current Subtitle Cue ───────────────────────────────────────

  useEffect(() => {
    if (!currentSegment?.text || !isEnabled) {
      setAnalyzedTokens(null);
      return;
    }

    const text = deduplicateCueText(currentSegment.text);
    if (!text) {
      setAnalyzedTokens(null);
      return;
    }

    if (tokenCache.has(text)) {
      setAnalyzedTokens(tokenCache.get(text)!);
      return;
    }

    // Immediately provide instant tokens on frame 0 so hover lookup works right away
    const immediateTokens = createImmediateTokens(text);
    if (immediateTokens.length > 0) {
      setAnalyzedTokens(immediateTokens);
    }

    let isMounted = true;
    chrome.runtime
      .sendMessage({
        type: "ANALYZE_TEXT",
        payload: { text, include_definitions: false },
      })
      .then((res) => {
        if (!isMounted) return;
        if (res?.type === "ANALYZE_RESULT" && res.payload?.tokens) {
          const tokens = res.payload.tokens as TokenAnalysis[];
          tokenCache.set(text, tokens);
          setAnalyzedTokens(tokens);
        }
      })
      .catch((err) => console.warn("[Hakkutsu Subtitles] Tokenize error:", err));

    return () => {
      isMounted = false;
    };
  }, [currentSegment?.text, isEnabled]);

  // ── 2. Handle Secondary Subtitle / Auto-Translation ─────────────────────────

  useEffect(() => {
    if (!currentSegment?.text || !isEnabled || settings.subtitlesSecondaryEnabled === false) {
      setTranslatedText("");
      return;
    }

    // If disabled or empty secondary selection, clear
    if (!secondaryTrackId) {
      setTranslatedText("");
      return;
    }

    // If a native secondary segment is provided, use it directly
    if (secondarySegment?.text) {
      setTranslatedText(deduplicateCueText(secondarySegment.text));
      return;
    }

    // Determine target translation language
    let targetLang: string = settings.targetLanguage || "vi";
    if (secondaryTrackId !== "__auto_translate__" && availableTracks.length > 0) {
      const match = availableTracks.find((t) => t.id === secondaryTrackId);
      if (match?.languageCode) {
        targetLang = match.languageCode.startsWith("vi") ? "vi" : match.languageCode.startsWith("en") ? "en" : match.languageCode;
      }
    }

    const text = currentSegment.text.trim();
    const cacheKey = `${targetLang}:${text}`;

    if (translationCache.has(cacheKey)) {
      setTranslatedText(deduplicateCueText(translationCache.get(cacheKey)!));
      return;
    }

    let isMounted = true;
    chrome.runtime
      .sendMessage({
        type: "TRANSLATE_TEXT",
        payload: { text, targetLang },
      })
      .then((res) => {
        if (!isMounted) return;
        if (res?.type === "TRANSLATE_RESULT" && res.payload?.translation) {
          const trans = deduplicateCueText(String(res.payload.translation));
          translationCache.set(cacheKey, trans);
          setTranslatedText(trans);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [
    currentSegment?.text,
    secondarySegment?.text,
    secondaryTrackId,
    availableTracks,
    isEnabled,
    settings.subtitlesSecondaryEnabled,
    settings.targetLanguage,
  ]);

  // ── 3. Auto-Pause Handling ──────────────────────────────────────────────────

  useEffect(() => {
    if (!settings.subtitlesAutoPause || !currentSegment || !videoRef.current) return;
    const video = videoRef.current;

    const checkAutoPause = () => {
      if (video.paused) return;
      const adjustedTime = video.currentTime - offset;
      const cueEnd = currentSegment.start + currentSegment.duration;

      // When near the end of the active cue (within 100ms)
      if (adjustedTime >= cueEnd - 0.08 && adjustedTime <= cueEnd + 0.15) {
        if (autoPauseLockedCueRef.current !== currentSegment) {
          autoPauseLockedCueRef.current = currentSegment;
          video.pause();
        }
      }
    };

    const interval = setInterval(checkAutoPause, 50);
    return () => clearInterval(interval);
  }, [currentSegment, settings.subtitlesAutoPause, offset, videoRef]);

  // ── 4. Replay / Cue Navigation ─────────────────────────────────────────────

  const replayCurrentCue = useCallback(() => {
    if (!videoRef.current) return;
    if (currentSegment) {
      videoRef.current.currentTime = Math.max(0, currentSegment.start + offset);
      if (videoRef.current.paused) {
        void videoRef.current.play();
      }
    } else if (subtitleData && subtitleData.segments.length > 0) {
      // If between cues, replay previous cue
      const currentTime = videoRef.current.currentTime - offset;
      const prevCue = [...subtitleData.segments].reverse().find((s) => s.start <= currentTime);
      if (prevCue) {
        videoRef.current.currentTime = Math.max(0, prevCue.start + offset);
        if (videoRef.current.paused) {
          void videoRef.current.play();
        }
      }
    }
  }, [currentSegment, offset, subtitleData, videoRef]);

  const seekPreviousCue = useCallback(() => {
    if (!videoRef.current) return;
    if (subtitleData && subtitleData.segments.length > 0) {
      const currentTime = videoRef.current.currentTime - offset;
      const prevCues = subtitleData.segments.filter((s) => s.start < currentTime - 0.3);
      if (prevCues.length > 0) {
        const target = prevCues[prevCues.length - 1];
        videoRef.current.currentTime = Math.max(0, target.start + offset);
        if (onSeekToCue) onSeekToCue(target);
        return;
      }
    }
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 2.5);
  }, [offset, subtitleData, videoRef, onSeekToCue]);

  const seekNextCue = useCallback(() => {
    if (!videoRef.current) return;
    if (subtitleData && subtitleData.segments.length > 0) {
      const currentTime = videoRef.current.currentTime - offset;
      const nextCue = subtitleData.segments.find((s) => s.start > currentTime + 0.1);
      if (nextCue) {
        videoRef.current.currentTime = Math.max(0, nextCue.start + offset);
        if (onSeekToCue) onSeekToCue(nextCue);
        return;
      }
    }
    videoRef.current.currentTime = Math.min(
      videoRef.current.duration || 999999,
      videoRef.current.currentTime + 2.5
    );
  }, [offset, subtitleData, videoRef, onSeekToCue]);

  // ── 5. Offset Adjustments & Toast ──────────────────────────────────────────

  const showOffsetNotification = useCallback((newOffset: number) => {
    const formatted = `${newOffset >= 0 ? "+" : ""}${(newOffset * 1000).toFixed(0)} ms`;
    setOffsetToast(`Subtitle Sync: ${formatted}`);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1500);
  }, []);

  const adjustOffset = useCallback(
    (deltaSec: number) => {
      const newOffset = Math.round((offset + deltaSec) * 100) / 100;
      if (onOffsetChange) onOffsetChange(newOffset);
      updateSettings({ subtitlesOffset: newOffset });
      showOffsetNotification(newOffset);
    },
    [offset, onOffsetChange, updateSettings, showOffsetNotification]
  );

  // ── 6. Anki Card Mining ─────────────────────────────────────────────────────

  const captureVideoScreenshot = (): string | undefined => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return undefined;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      // May fail on DRM-protected content (Netflix) or cross-origin video
      return undefined;
    }
  };

  const handleMineToAnki = async (e: React.MouseEvent, token?: TokenAnalysis) => {
    e.stopPropagation();
    if (!currentSegment) return;

    const video = videoRef.current;
    const currentTime = video ? Math.floor(video.currentTime) : 0;
    const screenshot = captureVideoScreenshot();

    // Construct timestamped video URL
    let sourceUrl = currentUrl;
    try {
      const urlObj = new URL(currentUrl);
      if (urlObj.hostname.includes("youtube.com")) {
        urlObj.searchParams.set("t", `${currentTime}s`);
        sourceUrl = urlObj.toString();
      }
    } catch {
      // keep currentUrl
    }

    const word = token ? token.dictionary_form || token.surface : currentSegment.text.trim();
    const reading = token?.reading?.hiragana || "";
    const meaning = token?.definitions?.[0]?.glosses?.join("; ") || translatedText || "";

    const exportData: AnkiExportData = {
      word,
      reading,
      meaning,
      sentence: currentSegment.text.trim(),
      sentenceReading: "",
      jlptLevel: token?.jlpt_level || "",
      pos: token?.pos || "Sentence",
      screenshot,
      sourceUrl,
    };

    try {
      const response = await chrome.runtime.sendMessage({
        type: "EXPORT_ANKI",
        payload: { note: exportData },
      });

      if (response?.type === "ANKI_RESULT" && response.payload?.noteId) {
        setAnkiSaved(true);
        setTimeout(() => setAnkiSaved(false), 2000);
      } else {
        alert("Could not connect to AnkiConnect on localhost:8765. Make sure Anki is running.");
      }
    } catch (err) {
      console.error("[Hakkutsu Subtitles] Anki export error:", err);
    }
  };

  // ── 7. Token Click / Hover Handler ──────────────────────────────────────────

  const lookupDismissTimerRef = useRef<number | null>(null);

  const handleTokenClick = (e: React.MouseEvent, token: TokenAnalysis, index: number) => {
    e.stopPropagation();
    if (lookupDismissTimerRef.current) {
      window.clearTimeout(lookupDismissTimerRef.current);
      lookupDismissTimerRef.current = null;
    }

    if (videoRef.current && !videoRef.current.paused) {
      try {
        videoRef.current.pause();
      } catch {}
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;

    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.surface,
          x,
          y,
          placement: "player-overlay",
          mode: "dictionary",
          transient: false,
        },
      })
    );
  };

  const handleTokenMouseEnter = (e: React.MouseEvent, token: TokenAnalysis, index: number) => {
    if (!token?.surface || !token.surface.trim()) return;
    // Don't trigger lookup on punctuation or non-word symbols
    if (!token.is_japanese && /^[\s.,!?。！？、…:;\-–—/\\()[\]{}""''「」『』【】（）]+$/.test(token.surface)) {
      return;
    }

    if (lookupDismissTimerRef.current) {
      window.clearTimeout(lookupDismissTimerRef.current);
      lookupDismissTimerRef.current = null;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;

    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.surface,
          x,
          y,
          placement: "player-overlay",
          mode: "dictionary",
          transient: true,
        },
      })
    );
  };

  const handleTokenMouseLeave = (e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const shadowHost = document.getElementById("hakkutsu-inline-dictionary-host");
    if (
      relatedTarget &&
      (relatedTarget.closest?.(".hk-popup") ||
       relatedTarget.id === "hakkutsu-inline-dictionary-host" ||
       relatedTarget === shadowHost ||
       shadowHost?.contains(relatedTarget))
    ) {
      return;
    }

    if (lookupDismissTimerRef.current) window.clearTimeout(lookupDismissTimerRef.current);
    lookupDismissTimerRef.current = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss"));
    }, 600);
  };

  // ── 8. Immersion Keyboard Shortcuts ─────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled) return;

    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || Boolean(el?.isContentEditable);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Replay cue: 'R'
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        replayCurrentCue();
        return;
      }

      // Previous cue: 'A'
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        seekPreviousCue();
        return;
      }

      // Next cue: 'D'
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        seekNextCue();
        return;
      }

      // Toggle auto-pause: 'E'
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        const next = !settings.subtitlesAutoPause;
        updateSettings({ subtitlesAutoPause: next });
        showOffsetNotification(next ? 1 : 0);
        setOffsetToast(`Auto-Pause: ${next ? "ON" : "OFF"}`);
        return;
      }

      // Open Select Subtitles / Settings Modal: 'C'
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        if (onOpenModal) {
          onOpenModal();
        } else {
          setShowSelectModal(true);
        }
        return;
      }

      // Toggle Kanji Furigana: 'F' or 'W'
      if (e.key === "f" || e.key === "F" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        const next = settings.showFurigana === false;
        updateSettings({ showFurigana: next });
        showOffsetNotification(next ? 1 : 0);
        setOffsetToast(`Furigana: ${next ? "ON" : "OFF"}`);
        return;
      }

      // Toggle secondary subtitles: 'V'
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        const next = settings.subtitlesSecondaryEnabled === false ? true : false;
        updateSettings({ subtitlesSecondaryEnabled: next });
        showOffsetNotification(next ? 1 : 0);
        setOffsetToast(`Secondary Subtitles: ${next ? "ON" : "OFF"}`);
        return;
      }

      // Toggle subtitle visibility: 'S'
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        onToggleEnabled();
        return;
      }

      // Timing offset shortcuts: 'Z' / 'X'
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        adjustOffset(e.shiftKey ? -0.5 : -0.1);
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        adjustOffset(e.shiftKey ? +0.5 : +0.1);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, replayCurrentCue, seekPreviousCue, seekNextCue, adjustOffset, onToggleEnabled, settings.subtitlesAutoPause, updateSettings, showOffsetNotification]);

  // ── 9. Drag & Drop Local Subtitles ──────────────────────────────────────────

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types?.includes("Files")) {
        setIsDraggingFile(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0 && onLoadCustomSubtitles) {
        const file = files[0];
        try {
          const { readSubtitleFile, parsedToSubtitleFetchResult } = await import("~lib/services/subtitle-parsers");
          const parsed = await readSubtitleFile(file);
          onLoadCustomSubtitles(parsedToSubtitleFetchResult(parsed, currentUrl));
        } catch (err) {
          console.error("Failed to parse dropped subtitle file:", err);
        }
      }
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [currentUrl, onLoadCustomSubtitles]);

  if (!isEnabled) return null;

  const fontSize = settings.subtitlesFontSize || 26;

  return (
    <>
      {/* Toast Notification (Offset / AutoPause) */}
      {offsetToast && (
        <div
          style={{
            position: "absolute",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "rgba(17, 17, 20, 0.92)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(168, 85, 247, 0.4)",
            color: "#f4f4f5",
            padding: "8px 18px",
            borderRadius: "9999px",
            fontSize: "13px",
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            zIndex: 10000,
            pointerEvents: "none",
            animation: "hk-sub-fade-in 0.15s ease-out",
          }}
        >
          {offsetToast}
        </div>
      )}

      {/* Drag & Drop Overlay */}
      {isDraggingFile && (
        <div
          style={{
            position: "absolute",
            inset: "16px",
            border: "2px dashed #a855f7",
            borderRadius: "16px",
            backgroundColor: "rgba(168, 85, 247, 0.15)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            color: "#fff",
            zIndex: 10000,
            pointerEvents: "none",
          }}
        >
          <FolderOpen size={48} color="#c084fc" />
          <div style={{ fontSize: "18px", fontWeight: 700 }}>Drop Subtitle File (.srt, .vtt, .ass)</div>
          <div style={{ fontSize: "13px", color: "#e4e4e7" }}>Instant sync with current video</div>
        </div>
      )}

      {/* Main Subtitle Container */}
      <div className={`hk-sub__container ${!currentSegment ? "hk-sub__container--hidden" : ""}`} ref={containerRef}>
        {currentSegment && (
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", pointerEvents: "auto" }}>
            {/* Primary Subtitle Bar */}
            <div className="hk-sub__bar" style={{ fontSize: `${fontSize}px` }}>
              {analyzedTokens && analyzedTokens.length > 0 ? (
                analyzedTokens.map((token, idx) => {
                  const isKanji = /[\u4e00-\u9faf]/.test(token.surface);
                  const showRuby =
                    settings.showFurigana !== false &&
                    isKanji &&
                    Boolean(token.reading?.hiragana) &&
                    token.reading!.hiragana !== token.surface;
                  const jlptClass = token.jlpt_level && settings.showJlptColors ? `hk-sub__token--${token.jlpt_level.toLowerCase()}` : "";
                  const rubySegments = showRuby
                    ? distributeFurigana(token.surface, token.reading?.hiragana)
                    : [{ text: token.surface }];

                  return (
                    <span
                      key={idx}
                      className={`hk-sub__token ${jlptClass}`}
                      onClick={(e) => handleTokenClick(e, token, idx)}
                      onMouseEnter={(e) => handleTokenMouseEnter(e, token, idx)}
                      onMouseLeave={handleTokenMouseLeave}
                      title={token.definitions?.[0]?.glosses?.join("; ") || token.reading?.hiragana || token.surface}
                    >
                      {showRuby && rubySegments.some((s) => s.ruby) ? (
                        rubySegments.map((seg, sIdx) =>
                          seg.ruby ? (
                            <ruby key={sIdx}>
                              <span className="hk-sub__surface">{seg.text}</span>
                              <rt className="hk-sub__furigana">{seg.ruby}</rt>
                            </ruby>
                          ) : (
                            <span key={sIdx} className="hk-sub__surface">{seg.text}</span>
                          )
                        )
                      ) : (
                        <span className="hk-sub__surface">{token.surface}</span>
                      )}
                    </span>
                  );
                })
              ) : (
                <span>{deduplicateCueText(currentSegment.text)}</span>
              )}
            </div>

            {/* Secondary Subtitle Bar (Bilingual / Translation) */}
            {settings.subtitlesSecondaryEnabled !== false && (secondarySegment?.text || translatedText) && (
              <div
                className="hk-sub__secondary-bar"
                style={{
                  fontSize: `${Math.max(15, Math.round(fontSize * 0.65))}px`,
                  maxWidth: "92vw",
                  textAlign: "center",
                  wordBreak: "break-word",
                  lineHeight: 1.4,
                }}
              >
                {deduplicateCueText(secondarySegment?.text || translatedText)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Select Subtitles Modal */}
      <SelectSubtitlesModal
        isOpen={showSelectModal}
        onClose={() => setShowSelectModal(false)}
        videoTitle={videoTitle}
        availableTracks={availableTracks}
        currentTrackId={currentTrackId}
        secondaryTrackId={secondaryTrackId}
        offset={offset}
        onOffsetChange={(newOffset) => {
          if (onOffsetChange) onOffsetChange(newOffset);
          updateSettings({ subtitlesOffset: newOffset });
        }}
        autoPause={settings.subtitlesAutoPause}
        onAutoPauseChange={(ap) => updateSettings({ subtitlesAutoPause: ap })}
        showFurigana={settings.showFurigana !== false}
        onFuriganaChange={(fg) => updateSettings({ showFurigana: fg })}
        fontSize={fontSize}
        onFontSizeChange={(size) => updateSettings({ subtitlesFontSize: size })}
        onSelectTrack={(track) => {
          if (onSelectTrack) void onSelectTrack(track);
        }}
        onSelectSecondaryTrack={(track) => {
          if (onSelectSecondaryTrack) void onSelectSecondaryTrack(track);
        }}
        onCustomSubtitleLoaded={(result) => {
          if (onLoadCustomSubtitles) onLoadCustomSubtitles(result);
        }}
      />
    </>
  );
};
