import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Copy, RotateCcw, Brain, Download, Upload, Plus, Minus, XCircle, Layers } from "lucide-react";
import type { SubtitleSegment, SubtitleFetchResult, AnalyzeResponse, TokenAnalysis } from "~lib/types";
import { readSubtitleFile, parsedToSubtitleFetchResult } from "~lib/services/subtitle-parsers";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/languages/locales";
import { SelectSubtitlesModal, type SubtitleTrackOption } from "./select-subtitles-modal";

// ── Cache ───────────────────────────────────────────────────────────────────

const analysisCache = new Map<string, TokenAnalysis[]>();

// ── Settings Interface ──────────────────────────────────────────────────────

export interface SubtitleSettings {
  showFurigana: boolean;
  showJlptColors: boolean;
  showTranscript: boolean;
  autoPause: boolean;
  fontSize?: "small" | "medium" | "large";
}

const DEFAULT_SUB_SETTINGS: SubtitleSettings = {
  showFurigana: true,
  showJlptColors: true,
  showTranscript: false,
  autoPause: false,
  fontSize: "medium",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function findSegmentIndex(
  segments: SubtitleSegment[],
  time: number,
  offset: number = 0
): number {
  const adjustedTime = time - offset;
  let bestIdx = -1;
  let minDiff = Infinity;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const segEnd = s.start + s.duration;
    if (adjustedTime >= s.start && adjustedTime <= segEnd) {
      return i;
    }
    const dist = Math.abs(s.start - adjustedTime);
    if (dist < minDiff && dist < 0.2) {
      minDiff = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function getJlptClass(token: TokenAnalysis): string {
  if (!token.jlpt_level) return "";
  return `hk-sub__token--${token.jlpt_level.toLowerCase()}`;
}

function isParticleToken(token: TokenAnalysis): boolean {
  return token.pos === "助詞" || token.pos === "助動詞";
}

export interface SubtitleOverlayProps {
  isEnabled: boolean;
  loading: boolean;
  error: string | null;
  requiresPageReload?: boolean;
  subtitleData: SubtitleFetchResult | null;
  currentSegment: SubtitleSegment | null;
  secondarySegment?: SubtitleSegment | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  currentUrl: string;
  toolbarContainer: Element | null;
  onToggleEnabled: () => void;
  onSettingsChange?: (settings: SubtitleSettings) => void;
  offset?: number;
  onOffsetChange?: (offset: number) => void;
  onLoadCustomSubtitles?: (result: SubtitleFetchResult) => void;
  onUnloadCustomSubtitles?: () => void;
  isFloatingButton?: boolean;
  videoTitle?: string;
  availableTracks?: SubtitleTrackOption[];
  currentTrackId?: string;
  secondaryTrackId?: string;
  onSelectTrack?: (track: SubtitleTrackOption) => Promise<void> | void;
  onSelectSecondaryTrack?: (track: SubtitleTrackOption | null) => Promise<void> | void;
}

export const SubtitleOverlay = ({
  isEnabled,
  loading,
  error,
  requiresPageReload = false,
  subtitleData,
  currentSegment,
  secondarySegment,
  videoRef,
  currentUrl,
  toolbarContainer,
  onToggleEnabled,
  onSettingsChange,
  offset = 0,
  onOffsetChange,
  onLoadCustomSubtitles,
  onUnloadCustomSubtitles,
  isFloatingButton = false,
  videoTitle = "",
  availableTracks = [],
  currentTrackId,
  secondaryTrackId,
  onSelectTrack,
  onSelectSecondaryTrack,
}: SubtitleOverlayProps) => {
  const globalSettings = useSettingsStore((state) => state.settings);
  const { t } = useTranslation();
  const [analyzedTokens, setAnalyzedTokens] = useState<TokenAnalysis[] | null>(null);
  const [settings, setSettings] = useState<SubtitleSettings>({
    showFurigana: globalSettings.showFurigana !== false,
    showJlptColors: globalSettings.showJlptColors !== false,
    showTranscript: false,
    autoPause: !!globalSettings.autoPauseSubtitles,
    fontSize: globalSettings.subtitleFontSize || "medium",
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [offsetToast, setOffsetToast] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wasPlayingRef = useRef(false);
  const analysisOpenRef = useRef(false);
  const ctrlShortcutArmedRef = useRef(false);
  const ctrlPeekOpenRef = useRef(false);
  const ctrlHoldTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Sync settings when global settings hydrate/change
  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      showFurigana: globalSettings.showFurigana !== false,
      showJlptColors: globalSettings.showJlptColors !== false,
      autoPause: !!globalSettings.autoPauseSubtitles,
      fontSize: globalSettings.subtitleFontSize || prev.fontSize || "medium",
    }));
  }, [
    globalSettings.showFurigana,
    globalSettings.showJlptColors,
    globalSettings.autoPauseSubtitles,
    globalSettings.subtitleFontSize,
  ]);

  // ── Prefetch Analysis ─────────────────────────────────────────────────

  const prefetchAnalysis = useCallback((segment: SubtitleSegment) => {
    if (analysisCache.has(segment.text)) return;
    analysisCache.set(segment.text, []);

    chrome.runtime
      .sendMessage({
        type: "ANALYZE_JAVI",
        payload: { text: segment.text, include_definitions: false },
      })
      .then((response) => {
        if (response?.type === "ANALYZE_RESULT") {
          analysisCache.set(segment.text, (response.payload as AnalyzeResponse).tokens);
          if (currentSegment?.text === segment.text) {
            setAnalyzedTokens(analysisCache.get(segment.text)!);
          }
        } else {
          analysisCache.delete(segment.text);
        }
      })
      .catch(() => {
        analysisCache.delete(segment.text);
      });
  }, [currentSegment]);

  // Notify parent of settings change
  useEffect(() => {
    if (onSettingsChange) {
      onSettingsChange(settings);
    }
  }, [settings, onSettingsChange]);

  // ── Load Analysis for Current Segment ─────────────────────────────────

  useEffect(() => {
    if (!currentSegment || !isEnabled) {
      setAnalyzedTokens(null);
      return;
    }

    const text = currentSegment.text;
    const cached = analysisCache.get(text);

    if (cached && cached.length > 0) {
      setAnalyzedTokens(cached);
    } else {
      prefetchAnalysis(currentSegment);
    }

    if (subtitleData) {
      const idx = subtitleData.segments.findIndex((s) => s.start === currentSegment.start);
      if (idx >= 0 && idx + 1 < subtitleData.segments.length) {
        prefetchAnalysis(subtitleData.segments[idx + 1]);
      }
    }
  }, [currentSegment, isEnabled, prefetchAnalysis, subtitleData]);

  // ── Auto-scroll Transcript ────────────────────────────────────────────

  useEffect(() => {
    if (!settings.showTranscript || !transcriptRef.current || !currentSegment) return;
    const activeItem = transcriptRef.current.querySelector(".hk-sub__transcript-item--active");
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentSegment, settings.showTranscript]);

  // ── Show Offset Toast ─────────────────────────────────────────────────

  const showOffsetNotification = useCallback((newOffset: number) => {
    const formatted = `${newOffset >= 0 ? "+" : ""}${(newOffset * 1000).toFixed(0)} ms`;
    setOffsetToast(`Subtitle Sync: ${formatted}`);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setOffsetToast(null), 1500);
  }, []);

  const adjustOffset = useCallback(
    (deltaSec: number) => {
      const newOffset = Math.round((offset + deltaSec) * 100) / 100;
      if (onOffsetChange) {
        onOffsetChange(newOffset);
      }
      showOffsetNotification(newOffset);
    },
    [offset, onOffsetChange, showOffsetNotification]
  );

  // ── Drag & Drop Subtitle Files ────────────────────────────────────────

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
      // Only dismiss if leaving window/container
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".srt") || lower.endsWith(".vtt") || lower.endsWith(".ass") || lower.endsWith(".ssa")) {
          try {
            const parsed = await readSubtitleFile(file);
            const subResult = parsedToSubtitleFetchResult(parsed, currentUrl);
            if (onLoadCustomSubtitles) {
              onLoadCustomSubtitles(subResult);
            }
          } catch (err) {
            console.error("Hakkutsu: Failed to parse dropped subtitle file", err);
          }
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

  // ── File Input Picker Handler ─────────────────────────────────────────

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const parsed = await readSubtitleFile(file);
        const subResult = parsedToSubtitleFetchResult(parsed, currentUrl);
        if (onLoadCustomSubtitles) {
          onLoadCustomSubtitles(subResult);
        }
      } catch (err) {
        console.error("Hakkutsu: Failed to parse chosen subtitle file", err);
      }
    }
    // reset input so the same file can be selected again
    e.target.value = "";
  };

  // ── asbplayer Keyboard Navigation & Shortcuts ─────────────────────────

  useEffect(() => {
    if (!isEnabled) return;

    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return (
        element?.tagName === "INPUT" ||
        element?.tagName === "TEXTAREA" ||
        Boolean(element?.isContentEditable)
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Ctrl Hold to Quick Peek Analysis
      if (e.key === "Control") {
        if (e.repeat || ctrlShortcutArmedRef.current) return;
        ctrlShortcutArmedRef.current = true;
        ctrlHoldTimerRef.current = window.setTimeout(() => {
          if (!ctrlShortcutArmedRef.current || !videoRef.current || !subtitleData) return;
          const adjustedTime = videoRef.current.currentTime - offset;
          const idx = findSegmentIndex(subtitleData.segments, adjustedTime);
          if (idx < 0) return;
          const segment = subtitleData.segments[idx];
          if (!videoRef.current.paused) {
            wasPlayingRef.current = true;
            videoRef.current.pause();
          }
          ctrlPeekOpenRef.current = true;
          window.dispatchEvent(
            new CustomEvent("hakkutsu:analyze", {
              detail: {
                text: segment.text,
                x: window.innerWidth / 2,
                y: window.innerHeight / 2,
                mode: "quick",
                placement: "player-overlay",
                transient: true,
              },
            })
          );
        }, 180);
        return;
      }

      if (e.ctrlKey) {
        ctrlShortcutArmedRef.current = false;
        if (ctrlHoldTimerRef.current !== null) {
          window.clearTimeout(ctrlHoldTimerRef.current);
          ctrlHoldTimerRef.current = null;
        }
        if (ctrlPeekOpenRef.current) {
          ctrlPeekOpenRef.current = false;
          window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss"));
        }
      }

      // Timing Offset Shortcuts: 'Z' / 'X'
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        adjustOffset(e.shiftKey ? -0.5 : -0.1);
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        adjustOffset(e.shiftKey ? 0.5 : 0.1);
        return;
      }

      if (!videoRef.current || !subtitleData || subtitleData.segments.length === 0) return;
      const adjustedTime = videoRef.current.currentTime - offset;
      const idx = findSegmentIndex(subtitleData.segments, adjustedTime);

      // Cue navigation: A / Left (Prev), D / Right (Next), S / Up (Replay)
      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A": {
          e.preventDefault();
          e.stopPropagation();
          if (idx > 0) {
            const cur = subtitleData.segments[idx];
            if (adjustedTime - cur.start < 1.0) {
              videoRef.current.currentTime = subtitleData.segments[idx - 1].start + offset;
            } else {
              videoRef.current.currentTime = cur.start + offset;
            }
          } else if (idx === 0) {
            videoRef.current.currentTime = subtitleData.segments[0].start + offset;
          }
          break;
        }
        case "ArrowRight":
        case "d":
        case "D": {
          e.preventDefault();
          e.stopPropagation();
          if (idx < subtitleData.segments.length - 1) {
            videoRef.current.currentTime = subtitleData.segments[idx + 1].start + offset;
          }
          break;
        }
        case "ArrowUp":
        case "s":
        case "S": {
          e.preventDefault();
          e.stopPropagation();
          if (idx >= 0) {
            videoRef.current.currentTime = subtitleData.segments[idx].start + offset;
            if (videoRef.current.paused) videoRef.current.play();
          }
          break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Control") return;
      ctrlShortcutArmedRef.current = false;
      if (ctrlHoldTimerRef.current !== null) {
        window.clearTimeout(ctrlHoldTimerRef.current);
        ctrlHoldTimerRef.current = null;
      }
      if (ctrlPeekOpenRef.current) {
        ctrlPeekOpenRef.current = false;
        window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss"));
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      ctrlShortcutArmedRef.current = false;
      if (ctrlHoldTimerRef.current !== null) {
        window.clearTimeout(ctrlHoldTimerRef.current);
      }
      ctrlPeekOpenRef.current = false;
    };
  }, [isEnabled, subtitleData, videoRef, offset, adjustOffset]);

  // ── Pause on Analysis Open ────────────────────────────────────────────

  useEffect(() => {
    const handleAnalysisOpened = () => {
      analysisOpenRef.current = true;
      if (videoRef.current && !videoRef.current.paused) {
        wasPlayingRef.current = true;
        videoRef.current.pause();
      }
    };
    const handleAnalysisClosed = () => {
      analysisOpenRef.current = false;
      if (videoRef.current && wasPlayingRef.current) {
        videoRef.current.play().catch(() => {});
        wasPlayingRef.current = false;
      }
    };
    window.addEventListener("hakkutsu:analysis-opened", handleAnalysisOpened);
    window.addEventListener("hakkutsu:analysis-closed", handleAnalysisClosed);
    return () => {
      window.removeEventListener("hakkutsu:analysis-opened", handleAnalysisOpened);
      window.removeEventListener("hakkutsu:analysis-closed", handleAnalysisClosed);
    };
  }, [videoRef]);

  // ── Hover Handlers ────────────────────────────────────────────────────

  const handleMouseEnter = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      wasPlayingRef.current = true;
      videoRef.current.pause();
    }
  }, [videoRef]);

  const handleMouseLeave = useCallback(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    if (videoRef.current && wasPlayingRef.current && !analysisOpenRef.current) {
      videoRef.current.play();
      wasPlayingRef.current = false;
    }
  }, [videoRef]);

  const analyzeWholeSentence = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!currentSegment) return;
      if (videoRef.current && !videoRef.current.paused) {
        wasPlayingRef.current = true;
        videoRef.current.pause();
      }
      const playerRect = videoRef.current?.getBoundingClientRect() ||
        document.querySelector("#movie_player")?.getBoundingClientRect();

      window.dispatchEvent(
        new CustomEvent("hakkutsu:analyze", {
          detail: {
            text: currentSegment.text,
            x: playerRect?.right ?? window.innerWidth - 24,
            y: e?.clientY ?? (playerRect?.bottom ?? window.innerHeight) - 120,
            mode: "phrase",
            placement: "player-overlay",
            transient: false,
          },
        })
      );
    },
    [currentSegment, videoRef]
  );

  const handleTokenClick = useCallback(
    (token: TokenAnalysis, index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!token.is_japanese) return;
      if (ctrlPeekOpenRef.current) {
        window.dispatchEvent(
          new CustomEvent("hakkutsu:token-hover", {
            detail: { index },
          })
        );
        return;
      }
      if (videoRef.current && !videoRef.current.paused) {
        wasPlayingRef.current = true;
        videoRef.current.pause();
      }

      window.dispatchEvent(
        new CustomEvent("hakkutsu:analyze", {
          detail: {
            text: currentSegment?.text || token.surface,
            x: e.clientX,
            y: e.clientY,
            mode: "dictionary",
            placement: "player-overlay",
            selectedIndex: index,
            transient: false,
          },
        })
      );

      chrome.runtime
        .sendMessage({
          type: "TEXT_SELECTED",
          payload: {
            text: token.dictionary_form || token.surface,
            context: currentSegment?.text,
            x: e.clientX,
            y: e.clientY,
            sourceUrl: currentUrl,
          },
        })
        .catch(() => {});
    },
    [currentSegment, currentUrl, videoRef]
  );

  const handleTokenHover = useCallback((index: number) => {
    if (!ctrlPeekOpenRef.current) return;
    window.dispatchEvent(
      new CustomEvent("hakkutsu:token-hover", {
        detail: { index },
      })
    );
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const selectedText = selection.toString().trim();
      if (!selectedText) return;

      window.dispatchEvent(
        new CustomEvent("hakkutsu:analyze", {
          detail: { text: selectedText, x: e.clientX, y: e.clientY, mode: "quick" },
        })
      );

      chrome.runtime
        .sendMessage({
          type: "TEXT_SELECTED",
          payload: {
            text: selectedText,
            context: currentSegment?.text,
            x: e.clientX,
            y: e.clientY,
            sourceUrl: currentUrl,
          },
        })
        .catch(() => {});
    },
    [currentSegment, currentUrl]
  );

  const handleTranscriptClick = useCallback(
    (segment: SubtitleSegment) => {
      if (videoRef.current) {
        videoRef.current.currentTime = segment.start + offset;
      }
    },
    [videoRef, offset]
  );

  const toggleSetting = useCallback((key: keyof SubtitleSettings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleCopySubtitle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (currentSegment) {
        navigator.clipboard.writeText(currentSegment.text);
      }
    },
    [currentSegment]
  );

  const handleExportAnki = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentSegment) return;

      const exportData = {
        word: currentSegment.text,
        reading: "",
        sentence: currentSegment.text,
        meaning: "",
        sourceUrl: currentUrl,
      };

      chrome.runtime
        .sendMessage({
          type: "EXPORT_ANKI",
          payload: exportData,
        })
        .catch(console.error);
    },
    [currentSegment, currentUrl]
  );

  // ── Render ────────────────────────────────────────────────────────────

  const subtitleSourceLabel =
    subtitleData?.source === "transcript_panel"
      ? "YouTube Transcript"
      : subtitleData?.source === "backend"
        ? "Backend local"
        : subtitleData?.source === "local_file"
          ? "Local Subtitle File"
          : subtitleData?.source === "text_track"
            ? "Embedded Track"
            : "Media Player Track";

  const renderToolbarContent = () => (
    <div
      className="hk-toolbar-wrapper"
      onMouseEnter={() => setShowSettings(true)}
      onMouseLeave={() => setShowSettings(false)}
    >
      <button
        type="button"
        aria-label="Hakkutsu Subtitles"
        aria-pressed={isEnabled}
        disabled={loading}
        className={`hk-yt-btn ${isEnabled ? "is-active" : "is-off"} ${error ? "is-error" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!subtitleData && error) {
            setShowSelectModal(true);
            return;
          }
          onToggleEnabled();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowSelectModal(true);
        }}
        title={
          error
            ? `Hakkutsu: ${error} · Click to Select Subtitles`
            : subtitleData
              ? `Hakkutsu (${subtitleData.trackName}) · Click to toggle · Right click for tracks`
              : "Hakkutsu Subtitles · Click to Select"
        }
      >
        <div className="hk-yt-btn__icon-wrapper">
          <span className={`hk-yt-btn__kanji ${loading ? "hk-yt-btn__kanji--loading" : ""}`}>
            発
          </span>
          {loading && (
            <div className="hk-yt-btn__spinner-overlay">
              <div className="hk-yt-btn__spinner" />
            </div>
          )}
          {error && <span className="hk-yt-btn__badge hk-yt-btn__badge--error" />}
        </div>
        <div className="hk-yt-btn__active-bar" />
      </button>

      {showSettings && (
        <div className="hk-toolbar-menu" onClick={(e) => e.stopPropagation()}>
          <div className="hk-toolbar-menu-header">Hakkutsu Subtitles</div>
          {subtitleData && (
            <div
              style={{
                padding: "0 12px 6px",
                color: "rgba(255,255,255,.6)",
                fontSize: 10,
                lineHeight: 1.3,
                wordBreak: "break-all",
              }}
            >
              <strong>{subtitleData.trackName}</strong>
              <div style={{ opacity: 0.75, marginTop: 2 }}>{subtitleSourceLabel}</div>
            </div>
          )}

          {/* Sync Offset Controls */}
          <div className="hk-sub__settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label>Sync Offset</label>
              <span className="hk-sub__offset-badge">
                {offset >= 0 ? `+${(offset * 1000).toFixed(0)}` : (offset * 1000).toFixed(0)} ms
              </span>
            </div>
            <div className="hk-sub__offset-controls">
              <button
                type="button"
                className="hk-sub__offset-btn"
                onClick={() => adjustOffset(-0.5)}
                title="Shift -500ms (Shift+Z)"
              >
                -0.5s
              </button>
              <button
                type="button"
                className="hk-sub__offset-btn"
                onClick={() => adjustOffset(-0.1)}
                title="Shift -100ms (Z)"
              >
                -100ms
              </button>
              <button
                type="button"
                className="hk-sub__offset-btn"
                onClick={() => {
                  if (onOffsetChange) onOffsetChange(0);
                  showOffsetNotification(0);
                }}
                title="Reset offset"
              >
                0
              </button>
              <button
                type="button"
                className="hk-sub__offset-btn"
                onClick={() => adjustOffset(0.1)}
                title="Shift +100ms (X)"
              >
                +100ms
              </button>
              <button
                type="button"
                className="hk-sub__offset-btn"
                onClick={() => adjustOffset(0.5)}
                title="Shift +500ms (Shift+X)"
              >
                +0.5s
              </button>
            </div>
          </div>

          {/* Select Subtitles Hub Button (asbplayer style) */}
          <div style={{ margin: "6px 0 4px" }}>
            <button
              type="button"
              className="hk-sub__file-btn"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.3) 0%, rgba(236, 72, 153, 0.3) 100%)",
                borderColor: "rgba(168, 85, 247, 0.6)",
                color: "#fff",
                fontWeight: 700,
                boxShadow: "0 2px 8px rgba(168, 85, 247, 0.25)",
              }}
              onClick={() => setShowSelectModal(true)}
            >
              <Layers size={13} style={{ color: "#d8b4fe" }} /> Select Subtitles (Tracks & Jimaku)
            </button>
          </div>

          {/* Subtitle File Loader */}
          <div style={{ margin: "4px 0" }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".srt,.vtt,.ass,.ssa"
              style={{ display: "none" }}
              onChange={handleFileInputChange}
            />
            <button
              type="button"
              className="hk-sub__file-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={13} /> Load Subtitle File (.srt, .vtt, .ass)
            </button>
            {subtitleData?.source === "local_file" && onUnloadCustomSubtitles && (
              <button
                type="button"
                className="hk-sub__file-btn"
                style={{
                  marginTop: 6,
                  background: "rgba(239, 68, 68, 0.15)",
                  borderColor: "rgba(239, 68, 68, 0.3)",
                }}
                onClick={onUnloadCustomSubtitles}
              >
                <XCircle size={13} /> Reset to Default Track
              </button>
            )}
          </div>

          {/* Toggles */}
          <div className="hk-sub__settings-row">
            <label>Furigana</label>
            <input
              type="checkbox"
              className="hk-sub__settings-checkbox"
              checked={settings.showFurigana}
              onChange={() => toggleSetting("showFurigana")}
            />
          </div>
          <div className="hk-sub__settings-row">
            <label>JLPT Colors</label>
            <input
              type="checkbox"
              className="hk-sub__settings-checkbox"
              checked={settings.showJlptColors}
              onChange={() => toggleSetting("showJlptColors")}
            />
          </div>
          <div className="hk-sub__settings-row">
            <label>Auto-Pause</label>
            <input
              type="checkbox"
              className="hk-sub__settings-checkbox"
              checked={settings.autoPause}
              onChange={() => toggleSetting("autoPause")}
            />
          </div>
          <div className="hk-sub__settings-row">
            <label>Transcript</label>
            <input
              type="checkbox"
              className="hk-sub__settings-checkbox"
              checked={settings.showTranscript}
              onChange={() => toggleSetting("showTranscript")}
            />
          </div>
        </div>
      )}
    </div>
  );

  const toolbarPortal = toolbarContainer
    ? createPortal(renderToolbarContent(), toolbarContainer)
    : null;

  const floatingBadge = isFloatingButton ? (
    <div
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 9999,
        pointerEvents: "auto",
      }}
    >
      {renderToolbarContent()}
    </div>
  ) : null;

  const fontSizeClass = `hk-sub--${settings.fontSize || "medium"}`;

  return (
    <>
      {toolbarPortal}
      {floatingBadge}

      {/* Drag & Drop Visual Dropzone */}
      {isDraggingFile && (
        <div className="hk-sub__dropzone">
          <div className="hk-sub__dropzone-icon">
            <Upload size={32} />
          </div>
          <div className="hk-sub__dropzone-text">Thả file phụ đề vào đây</div>
          <div className="hk-sub__dropzone-sub">Hỗ trợ các định dạng .srt, .vtt, .ass, .ssa</div>
        </div>
      )}

      {/* Subtitle Sync Offset Toast */}
      {offsetToast && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: "14%",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10002,
            padding: "6px 14px",
            borderRadius: 8,
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid rgba(168, 85, 247, 0.4)",
            color: "#f8fafc",
            fontSize: 13,
            fontWeight: 700,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            animation: "hk-sub-fade-in 0.15s ease-out",
          }}
        >
          {offsetToast}
        </div>
      )}

      {isEnabled && loading && !subtitleData && (
        <div
          role="status"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "18%",
            transform: "translateX(-50%)",
            zIndex: 70,
            padding: "10px 18px",
            borderRadius: 12,
            background: "#18181b",
            border: "1px solid rgba(168, 85, 247, 0.4)",
            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5), 0 0 15px rgba(168, 85, 247, 0.2)",
            color: "#f4f4f5",
            fontSize: 13.5,
            fontWeight: 600,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <div style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: "#a855f7",
            boxShadow: "0 0 8px #a855f7",
          }} />
          {t("sub_overlay_loading")}
        </div>
      )}

      {isEnabled && error && !subtitleData && (
        <div
          role="alert"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "18%",
            transform: "translateX(-50%)",
            zIndex: 70,
            maxWidth: "80%",
            width: "440px",
            padding: "16px 20px",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            borderRadius: "14px",
            background: "#18181b",
            boxShadow: "0 16px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(239, 68, 68, 0.15)",
            color: "#f4f4f5",
            fontSize: "13.5px",
            fontWeight: 500,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            pointerEvents: "auto",
          }}
        >
          <div style={{ lineHeight: 1.5, color: "#e4e4e7" }}>
            {error.startsWith("Tiện ích") || error.startsWith("Extension")
              ? t("sub_overlay_extension_updated")
              : error.includes("không có phụ đề tiếng Nhật") || error.includes("No Japanese subtitles")
                ? t("sub_overlay_no_ja")
                : `${t("sub_overlay_error_prefix")}${error}`}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "2px" }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowSelectModal(true);
              }}
              style={{
                padding: "8px 16px",
                background: "linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 10px rgba(168, 85, 247, 0.45)",
                pointerEvents: "auto",
              }}
            >
              <Layers size={14} /> Select Subtitles (Tracks & Jimaku)
            </button>

            {requiresPageReload && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: "7px 12px",
                  border: "1px solid rgba(254, 226, 226, 0.7)",
                  borderRadius: "6px",
                  background: "#fee2e2",
                  color: "#7f1d1d",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Tải lại trang
              </button>
            )}
          </div>
        </div>
      )}

      {isEnabled && (subtitleData || currentSegment) && (
        <div
          ref={containerRef}
          className={`hk-sub__container ${fontSizeClass} ${!currentSegment ? "hk-sub__container--hidden" : ""}`}
          onMouseUp={handleMouseUp}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {currentSegment && (
            <div
              className="hk-sub__overlay-wrapper"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <div className="hk-sub__brand">
                HAKKUTSU SUB · CTRL PHÂN TÍCH
                {offset !== 0 && (
                  <span style={{ marginLeft: 6, opacity: 0.8, fontSize: "0.85em" }}>
                    ({offset >= 0 ? `+${(offset * 1000).toFixed(0)}` : (offset * 1000).toFixed(0)}ms)
                  </span>
                )}
              </div>
              <div className="hk-sub__action-bar" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="hk-sub__action-btn hk-sub__action-btn--sentence"
                  onClick={analyzeWholeSentence}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Tạm dừng và gọi Gemini phân tích sâu toàn bộ câu"
                >
                  <Brain size={16} style={{ marginRight: 6 }} /> Gemini phân tích sâu
                </button>
                <button
                  type="button"
                  className="hk-sub__action-btn"
                  onClick={handleCopySubtitle}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Copy to clipboard"
                >
                  <Copy size={16} />
                </button>
                <button
                  type="button"
                  className="hk-sub__action-btn"
                  onClick={handleExportAnki}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Export sentence to Anki"
                >
                  <Download size={16} />
                </button>
                <button
                  type="button"
                  className="hk-sub__action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (videoRef.current) {
                      videoRef.current.currentTime = currentSegment.start + offset;
                      videoRef.current.play();
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Replay (S / Up Arrow)"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              <div className="hk-sub__bar" key={currentSegment.start}>
                {analyzedTokens && analyzedTokens.length > 0 ? (
                  analyzedTokens.map((token, i) => {
                    const jlptClass = settings.showJlptColors ? getJlptClass(token) : "";
                    const particleClass = isParticleToken(token) ? "hk-sub__token--particle" : "";
                    const showReading =
                      settings.showFurigana &&
                      token.is_japanese &&
                      token.reading.hiragana !== token.surface;

                    return (
                      <span
                        key={`${currentSegment.start}-${i}`}
                        className={`hk-sub__token ${jlptClass} ${particleClass}`}
                        onClick={(e) => handleTokenClick(token, i, e)}
                        onMouseEnter={() => handleTokenHover(i)}
                        title={
                          token.is_japanese
                            ? `${token.dictionary_form} — ${token.pos}`
                            : undefined
                        }
                      >
                        <span
                          className={`hk-sub__furigana ${!showReading ? "hk-sub__furigana--hidden" : ""}`}
                        >
                          {showReading ? token.reading.hiragana : "\u00A0"}
                        </span>
                        <span className="hk-sub__surface">{token.surface}</span>
                      </span>
                    );
                  })
                ) : (
                  <span className="hk-sub__surface">{currentSegment.text}</span>
                )}
              </div>

              {secondarySegment && (
                <div
                  className="hk-sub__secondary-bar"
                  style={{
                    marginTop: "6px",
                    fontSize: "0.88em",
                    color: "#f4f4f5",
                    fontWeight: 500,
                    textAlign: "center",
                    textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)",
                    pointerEvents: "auto",
                    backgroundColor: "rgba(24, 24, 27, 0.85)",
                    padding: "5px 12px",
                    borderRadius: "6px",
                    backdropFilter: "blur(4px)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    display: "inline-block",
                  }}
                >
                  {secondarySegment.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isEnabled && subtitleData && settings.showTranscript && (
        <div ref={transcriptRef} className="hk-sub__transcript">
          {subtitleData.segments.map((seg, i) => {
            const isActive = currentSegment && currentSegment.start === seg.start;
            return (
              <div
                key={`t-${i}`}
                className={`hk-sub__transcript-item ${isActive ? "hk-sub__transcript-item--active" : ""}`}
                onClick={() => handleTranscriptClick(seg)}
              >
                <span className="hk-sub__transcript-time">{formatTime(seg.start)}</span>
                <span className="hk-sub__transcript-text">{seg.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* asbplayer-style Select Subtitles Modal */}
      <SelectSubtitlesModal
        isOpen={showSelectModal}
        onClose={() => setShowSelectModal(false)}
        videoTitle={videoTitle || document.title.replace(/ - YouTube$/, "")}
        availableTracks={availableTracks}
        currentTrackId={currentTrackId || subtitleData?.trackName}
        secondaryTrackId={secondaryTrackId}
        onSelectTrack={async (track) => {
          if (onSelectTrack) {
            await onSelectTrack(track);
          }
        }}
        onSelectSecondaryTrack={onSelectSecondaryTrack}
        onCustomSubtitleLoaded={(res) => {
          if (onLoadCustomSubtitles) {
            onLoadCustomSubtitles(res);
          }
        }}
        onOpenSettings={() => {
          chrome.runtime?.sendMessage?.({ type: "OPEN_SETTINGS" });
        }}
      />
    </>
  );
};
