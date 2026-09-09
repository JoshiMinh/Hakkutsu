import React, { useEffect, useState, useRef, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import type {
  SubtitleSegment,
  SubtitleFetchResult,
  TokenAnalysis,
} from "~lib/utils/types";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";
import type { SubtitleTrackOption } from "./select-subtitles-modal";
import { deduplicateCueText, readSubtitleFile, parsedToSubtitleFetchResult } from "~lib/services/subtitle-parsers";
import { distributeFurigana, containsJapanese, sanitizeReading } from "~lib/utils/japanese";
import { predictJlpt } from "~lib/utils/jlpt-classifier";
import { subscribeToVideoTime } from "~lib/services/video-runtime";

// ── In-Memory Bounded Caches ─────────────────────────────────────────────────

const MAX_CACHE_SIZE = 100;
const tokenCache = new Map<string, TokenAnalysis[]>();
const translationCache = new Map<string, string>();

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxSize = MAX_CACHE_SIZE): void {
  if (cache.size >= maxSize) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

let cachedSegmenter: any = null;
function getJapaneseSegmenter() {
  if (cachedSegmenter) return cachedSegmenter;
  if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
    try {
      cachedSegmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
    } catch {}
  }
  return cachedSegmenter;
}

function createImmediateTokens(text: string): TokenAnalysis[] {
  try {
    const segmenter = getJapaneseSegmenter();
    if (segmenter) {
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
  availableTracks?: SubtitleTrackOption[];
  secondaryTrackId?: string;
  offset?: number;
  onToggleEnabled: () => void;
  onOffsetChange?: (offset: number) => void;
  onLoadCustomSubtitles?: (result: SubtitleFetchResult) => void;
  onSeekTime?: (timeSec: number) => void;
  onSeekToCue?: (cue: SubtitleSegment) => void;
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
  availableTracks = [],
  secondaryTrackId,
  offset = 0,
  onToggleEnabled,
  onOffsetChange,
  onLoadCustomSubtitles,
  onSeekTime,
  onSeekToCue,
}) => {
  const { settings, updateSettings } = useSettingsStore();
  const { t, isVietnamese } = useTranslation();

  const [analyzedTokens, setAnalyzedTokens] = useState<TokenAnalysis[] | null>(null);
  const [translatedText, setTranslatedText] = useState<string>("");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [offsetToast, setOffsetToast] = useState<string | null>(null);

  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get("hakkutsu_vocabulary");
          const vocab = res["hakkutsu_vocabulary"] || [];
          const wordSet = new Set<string>();
          vocab.forEach((v: any) => {
            if (v.word) wordSet.add(v.word);
            if (v.dictionaryForm) wordSet.add(v.dictionaryForm);
          });
          setSavedWords(wordSet);
        }
      } catch {}
    };

    void loadSavedWords();

    const handleStorageChange = (changes: any, areaName: string) => {
      if (areaName === "local" && changes["hakkutsu_vocabulary"]) {
        void loadSavedWords();
      }
    };

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  }, []);

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
          setBoundedCache(tokenCache, text, tokens);
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
          setBoundedCache(translationCache, cacheKey, trans);
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

  // ── 3. Auto-Pause Handling (Event-Driven) ───────────────────────────────────

  useEffect(() => {
    if (!settings.subtitlesAutoPause || !currentSegment || !videoRef.current) return;
    const video = videoRef.current;

    const checkAutoPause = () => {
      if (video.paused) return;
      const adjustedTime = video.currentTime - offset;

      // Reset auto-pause lock if user seeks back into this cue
      if (adjustedTime < currentSegment.start + 0.3) {
        if (autoPauseLockedCueRef.current === currentSegment) {
          autoPauseLockedCueRef.current = null;
        }
      }

      const cueEnd = currentSegment.start + currentSegment.duration;

      // Pause when reaching the end of active cue
      if (adjustedTime >= cueEnd - 0.08) {
        if (autoPauseLockedCueRef.current !== currentSegment) {
          autoPauseLockedCueRef.current = currentSegment;
          video.pause();
        }
      }
    };

    return subscribeToVideoTime(video, checkAutoPause);
  }, [currentSegment, settings.subtitlesAutoPause, offset, videoRef]);

  // ── 4. Replay / Cue Navigation ─────────────────────────────────────────────

  const seekToTime = useCallback(
    (timeSec: number, cue?: SubtitleSegment) => {
      const targetSec = Math.max(0, timeSec);
      if (cue && onSeekToCue) {
        onSeekToCue(cue);
      } else if (onSeekTime) {
        onSeekTime(targetSec);
      }
      const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
      if (video) {
        try {
          video.currentTime = targetSec;
        } catch {}
      }
    },
    [onSeekToCue, onSeekTime, videoRef]
  );

  const replayCurrentCue = useCallback(() => {
    if (currentSegment) {
      seekToTime(currentSegment.start + offset, currentSegment);
      if (videoRef.current?.paused) {
        void videoRef.current.play();
      }
    } else if (subtitleData && subtitleData.segments.length > 0) {
      const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
      const currentTime = (video?.currentTime || 0) - offset;
      const prevCue = [...subtitleData.segments].reverse().find((s) => s.start <= currentTime + 0.1);
      if (prevCue) {
        seekToTime(prevCue.start + offset, prevCue);
        if (videoRef.current?.paused) {
          void videoRef.current.play();
        }
      }
    } else {
      const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
      const fallbackTime = Math.max(0, (video?.currentTime || 0) - 2.5);
      seekToTime(fallbackTime);
    }
  }, [currentSegment, offset, subtitleData, seekToTime, videoRef]);

  const seekPreviousCue = useCallback(() => {
    const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
    const currentTime = (video?.currentTime || 0) - offset;
    if (subtitleData && subtitleData.segments.length > 0) {
      const activeCue = subtitleData.segments.find(
        (s) => currentTime >= s.start - 0.1 && currentTime <= s.start + s.duration + 0.1
      );

      let target: SubtitleSegment | undefined;
      if (activeCue && currentTime > activeCue.start + 0.8) {
        target = activeCue;
      } else {
        const prevCues = subtitleData.segments.filter((s) => s.start < currentTime - 0.3);
        if (prevCues.length > 0) {
          target = prevCues[prevCues.length - 1];
        }
      }

      if (target) {
        seekToTime(target.start + offset, target);
        const preview = target.text.slice(0, 20);
        setOffsetToast(`⏮ ${preview}`);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1000);
        return;
      }
    }
    const fallbackTime = Math.max(0, (video?.currentTime || 0) - 3);
    seekToTime(fallbackTime);
    setOffsetToast(`⏮ -3s`);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1000);
  }, [offset, subtitleData, seekToTime, videoRef]);

  const seekNextCue = useCallback(() => {
    const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
    const currentTime = (video?.currentTime || 0) - offset;
    if (subtitleData && subtitleData.segments.length > 0) {
      const nextCue = subtitleData.segments.find((s) => s.start > currentTime + 0.2);
      if (nextCue) {
        seekToTime(nextCue.start + offset, nextCue);
        const preview = nextCue.text.slice(0, 20);
        setOffsetToast(`⏭ ${preview}`);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1000);
        return;
      }
    }
    const fallbackTime = Math.min(
      video?.duration || 999999,
      (video?.currentTime || 0) + 3
    );
    seekToTime(fallbackTime);
    setOffsetToast(`⏭ +3s`);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1000);
  }, [offset, subtitleData, seekToTime, videoRef]);

  // ── 5. Offset Adjustments & Toast ──────────────────────────────────────────

  const showOffsetNotification = useCallback((newOffset: number) => {
    const sign = newOffset >= 0 ? "+" : "";
    setOffsetToast(`Offset: ${sign}${newOffset.toFixed(1)}s`);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1200);
  }, []);

  const adjustOffset = useCallback(
    (delta: number) => {
      const newOffset = Math.round((offset + delta) * 10) / 10;
      onOffsetChange?.(newOffset);
      updateSettings({ subtitlesOffset: newOffset });
      showOffsetNotification(newOffset);
    },
    [offset, onOffsetChange, updateSettings, showOffsetNotification]
  );

  // ── 6. Token Click / Hover Handler ──────────────────────────────────────────

  const lookupDismissTimerRef = useRef<number | null>(null);
  const pausedByHoverRef = useRef<boolean>(false);

  useEffect(() => {
    const handleClosed = () => {
      if (pausedByHoverRef.current) {
        pausedByHoverRef.current = false;
        const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
        if (video && video.paused) {
          try {
            void video.play();
          } catch {}
        }
      }
    };
    window.addEventListener("hakkutsu:analysis-closed", handleClosed);
    return () => window.removeEventListener("hakkutsu:analysis-closed", handleClosed);
  }, [videoRef]);

  const handleTokenClick = (e: React.MouseEvent, token: TokenAnalysis, index: number) => {
    e.stopPropagation();
    if (lookupDismissTimerRef.current) {
      window.clearTimeout(lookupDismissTimerRef.current);
      lookupDismissTimerRef.current = null;
    }

    if (settings.subtitlesAutoPause) {
      if (videoRef.current && !videoRef.current.paused) {
        try {
          videoRef.current.pause();
          pausedByHoverRef.current = true;
        } catch {}
      }
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

    // Auto-pause video playback upon hover ONLY if auto-pause setting is enabled
    if (settings.subtitlesAutoPause) {
      const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
      if (video && !video.paused) {
        try {
          video.pause();
          pausedByHoverRef.current = true;
        } catch {}
      }
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
    }, 450);
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Previous cue: 'A'
      if (e.key === "a" || e.key === "A" || e.code === "KeyA") {
        e.preventDefault();
        e.stopPropagation();
        seekPreviousCue();
        return;
      }

      // Next cue: 'D'
      if (e.key === "d" || e.key === "D" || e.code === "KeyD") {
        e.preventDefault();
        e.stopPropagation();
        seekNextCue();
        return;
      }

      // Replay current cue: 'R'
      if (e.key === "r" || e.key === "R" || e.code === "KeyR") {
        e.preventDefault();
        e.stopPropagation();
        replayCurrentCue();
        return;
      }

      // Toggle auto-pause: 'E'
      if (e.key === "e" || e.key === "E" || e.code === "KeyE") {
        e.preventDefault();
        e.stopPropagation();
        const next = !settings.subtitlesAutoPause;
        updateSettings({ subtitlesAutoPause: next });
        setOffsetToast(`Auto-Pause: ${next ? "ON" : "OFF"}`);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1200);
        return;
      }

      // Toggle furigana: 'F' / 'W'
      if (e.key === "f" || e.key === "F" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        e.stopPropagation();
        const next = settings.showFurigana === false;
        updateSettings({ showFurigana: next });
        setOffsetToast(`Furigana: ${next ? "ON" : "OFF"}`);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1200);
        return;
      }

      // Toggle secondary subtitles: 'V'
      if (e.key === "v" || e.key === "V" || e.code === "KeyV") {
        e.preventDefault();
        e.stopPropagation();
        const next = settings.subtitlesSecondaryEnabled === false;
        updateSettings({ subtitlesSecondaryEnabled: next });
        setOffsetToast(`Translation: ${next ? "ON" : "OFF"}`);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1200);
        return;
      }

      // Toggle subtitle visibility: 'S'
      if (e.key === "s" || e.key === "S" || e.code === "KeyS") {
        e.preventDefault();
        e.stopPropagation();
        onToggleEnabled();
        return;
      }

      // Timing offset shortcuts: 'Z' / 'X'
      if (e.key === "z" || e.key === "Z" || e.code === "KeyZ") {
        e.preventDefault();
        e.stopPropagation();
        adjustOffset(e.shiftKey ? -0.5 : -0.1);
        return;
      }

      if (e.key === "x" || e.key === "X" || e.code === "KeyX") {
        e.preventDefault();
        e.stopPropagation();
        adjustOffset(e.shiftKey ? +0.5 : +0.1);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    isEnabled,
    seekPreviousCue,
    seekNextCue,
    replayCurrentCue,
    settings.subtitlesAutoPause,
    settings.showFurigana,
    settings.subtitlesSecondaryEnabled,
    updateSettings,
    onToggleEnabled,
    adjustOffset,
  ]);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types?.includes("Files")) {
        setIsDraggingFile(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
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
        try {
          const file = files[0];
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
      {(loading || error) && (
        <div
          role={error ? "alert" : "status"}
          aria-live="polite"
          className="hk-sub__status"
          style={{
            position: "absolute",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            padding: "8px 14px",
            borderRadius: "8px",
            background: "rgba(17, 17, 20, 0.94)",
            border: `1px solid ${error ? "rgba(248, 113, 113, 0.55)" : "rgba(192, 132, 252, 0.45)"}`,
            color: error ? "#fecaca" : "#f4f4f5",
            fontSize: "13px",
            pointerEvents: "none",
          }}
        >
          {error || "Loading subtitles…"}
        </div>
      )}

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
                  const cleanReading = sanitizeReading(token.reading?.hiragana || "", token.surface);
                  const showRuby =
                    settings.showFurigana !== false &&
                    isKanji &&
                    Boolean(cleanReading) &&
                    cleanReading !== token.surface;
                  const isSaved =
                    savedWords.has(token.surface) ||
                    Boolean(token.dictionary_form && savedWords.has(token.dictionary_form));
                  const savedClass = isSaved ? "hk-sub__token--saved" : "";
                  const rubySegments = showRuby
                    ? distributeFurigana(token.surface, cleanReading)
                    : null;
                  const hasRuby = showRuby && rubySegments !== null && rubySegments.some((s) => s.ruby);

                  return (
                    <span
                      key={idx}
                      className={`hk-sub__token ${savedClass}`}
                      onClick={(e) => handleTokenClick(e, token, idx)}
                      onMouseEnter={(e) => handleTokenMouseEnter(e, token, idx)}
                      onMouseLeave={handleTokenMouseLeave}
                      title={token.definitions?.[0]?.glosses?.join("; ") || token.reading?.hiragana || token.surface}
                    >
                      {hasRuby && rubySegments ? (
                        rubySegments.map((seg, sIdx) =>
                          seg.ruby ? (
                            <ruby key={sIdx}>
                              {seg.text}
                              <rt className="hk-sub__furigana">{seg.ruby}</rt>
                            </ruby>
                          ) : (
                            <span key={sIdx}>{seg.text}</span>
                          )
                        )
                      ) : (
                        token.surface
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

    </>
  );
};
