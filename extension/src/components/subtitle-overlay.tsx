import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import iconUrl from "url:~assets/icon.png";
import type { SubtitleSegment, SubtitleFetchResult, AnalyzeResponse, TokenAnalysis } from "~types";

// ── Cache ───────────────────────────────────────────────────────────────────

const analysisCache = new Map<string, TokenAnalysis[]>();

// ── Settings Interface ──────────────────────────────────────────────────────

export interface SubtitleSettings {
  showFurigana: boolean;
  showJlptColors: boolean;
  showTranscript: boolean;
  autoPause: boolean;
}

const DEFAULT_SUB_SETTINGS: SubtitleSettings = {
  showFurigana: true,
  showJlptColors: true,
  showTranscript: false,
  autoPause: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function findSegmentIndex(
  segments: SubtitleSegment[],
  currentTime: number
): number {
  let low = 0;
  let high = segments.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const seg = segments[mid];
    const segEnd = seg.start + seg.duration;

    if (currentTime >= seg.start && currentTime <= segEnd) {
      return mid;
    } else if (currentTime < seg.start) {
      high = mid - 1;
    } else {
      bestIdx = mid;
      low = mid + 1;
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
  subtitleData: SubtitleFetchResult | null;
  currentSegment: SubtitleSegment | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  currentUrl: string;
  toolbarContainer: Element | null;
  onToggleEnabled: () => void;
  // Hook for parent to know when settings change, e.g. for autoPause
  onSettingsChange?: (settings: SubtitleSettings) => void;
}

export const SubtitleOverlay = ({
  isEnabled,
  loading,
  error,
  subtitleData,
  currentSegment,
  videoRef,
  currentUrl,
  toolbarContainer,
  onToggleEnabled,
  onSettingsChange,
}: SubtitleOverlayProps) => {
  const [analyzedTokens, setAnalyzedTokens] = useState<TokenAnalysis[] | null>(null);
  const [settings, setSettings] = useState<SubtitleSettings>(DEFAULT_SUB_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wasPlayingRef = useRef(false);

  // ── Prefetch Analysis ─────────────────────────────────────────────────

  const prefetchAnalysis = useCallback((segment: SubtitleSegment) => {
    if (analysisCache.has(segment.text)) return;
    
    // Mark as fetching to avoid duplicates
    analysisCache.set(segment.text, []); 
    
    chrome.runtime
      .sendMessage({
        type: "ANALYZE_TEXT",
        payload: { text: segment.text, include_definitions: false },
      })
      .then((response) => {
        if (response?.type === "ANALYZE_RESULT") {
          analysisCache.set(segment.text, (response.payload as AnalyzeResponse).tokens);
          // If we prefetched the segment that is currently active, update state
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
      // It's not cached or currently fetching empty array, let prefetch handle it or fetch now
      prefetchAnalysis(currentSegment);
    }
    
    // Also prefetch next segment if we have subtitleData
    if (subtitleData) {
      const idx = subtitleData.segments.findIndex(s => s.start === currentSegment.start);
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

  // ── Keyboard Shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled || !subtitleData) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (!videoRef.current) return;
      const time = videoRef.current.currentTime;
      let idx = findSegmentIndex(subtitleData.segments, time);

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          if (idx > 0) {
            const cur = subtitleData.segments[idx];
            if (time - cur.start < 1.0) {
              videoRef.current.currentTime = subtitleData.segments[idx - 1].start;
            } else {
              videoRef.current.currentTime = cur.start;
            }
          } else if (idx === 0) {
            videoRef.current.currentTime = subtitleData.segments[0].start;
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          if (idx < subtitleData.segments.length - 1) {
            videoRef.current.currentTime = subtitleData.segments[idx + 1].start;
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          if (idx >= 0) {
            videoRef.current.currentTime = subtitleData.segments[idx].start;
            if (videoRef.current.paused) videoRef.current.play();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isEnabled, subtitleData, videoRef]);

  // ── Event Handlers ────────────────────────────────────────────────────

  const handleMouseEnter = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      wasPlayingRef.current = true;
      videoRef.current.pause();
    }
  }, [videoRef]);

  const handleMouseLeave = useCallback(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    if (videoRef.current && wasPlayingRef.current) {
      videoRef.current.play();
      wasPlayingRef.current = false;
    }
  }, [videoRef]);

  const handleTokenClick = useCallback(
    (token: TokenAnalysis, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!token.is_japanese) return;

      window.dispatchEvent(
        new CustomEvent("hakkutsu:analyze", {
          detail: {
            text: token.dictionary_form || token.surface,
            x: e.clientX,
            y: e.clientY,
          },
        })
      );

      chrome.runtime.sendMessage({
        type: "TEXT_SELECTED",
        payload: {
          text: token.dictionary_form || token.surface,
          context: currentSegment?.text,
          x: e.clientX,
          y: e.clientY,
          sourceUrl: currentUrl,
        },
      }).catch(() => {});
    },
    [currentSegment, currentUrl]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const selectedText = selection.toString().trim();
      if (!selectedText) return;

      window.dispatchEvent(
        new CustomEvent("hakkutsu:analyze", {
          detail: { text: selectedText, x: e.clientX, y: e.clientY },
        })
      );

      chrome.runtime.sendMessage({
        type: "TEXT_SELECTED",
        payload: {
          text: selectedText,
          context: currentSegment?.text,
          x: e.clientX,
          y: e.clientY,
          sourceUrl: currentUrl,
        },
      }).catch(() => {});
    },
    [currentSegment, currentUrl]
  );

  const handleTranscriptClick = useCallback((segment: SubtitleSegment) => {
    if (videoRef.current) {
      videoRef.current.currentTime = segment.start;
    }
  }, [videoRef]);

  const toggleSetting = useCallback(
    (key: keyof SubtitleSettings) => {
      setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  const handleCopySubtitle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentSegment) {
      navigator.clipboard.writeText(currentSegment.text);
    }
  }, [currentSegment]);

  const handleExportAnki = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentSegment) return;
    
    const exportData = {
      word: currentSegment.text,
      reading: "",
      sentence: currentSegment.text,
      meaning: "",
      sourceUrl: currentUrl
    };
    
    chrome.runtime.sendMessage({
      type: "EXPORT_ANKI",
      payload: exportData,
    }).catch(console.error);
  }, [currentSegment, currentUrl]);

  // ── Render ────────────────────────────────────────────────────────────

  const toolbarPortal = toolbarContainer ? createPortal(
    <div 
      className="hk-toolbar-wrapper"
      onMouseEnter={() => setShowSettings(true)}
      onMouseLeave={() => setShowSettings(false)}
    >
      <button
        className={`hk-toolbar-btn ${isEnabled ? "hk-toolbar-btn--active" : ""} ${loading ? "hk-toolbar-btn--loading" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleEnabled();
        }}
        title={error || (subtitleData ? (subtitleData.isAutoGenerated ? "自動字幕 (Auto)" : "字幕") : "Hakkutsu Subtitles")}
      >
        <img src={iconUrl} alt="Hakkutsu" className="hk-toolbar-icon" />
      </button>
      
      {showSettings && (
        <div className="hk-toolbar-menu" onClick={(e) => e.stopPropagation()}>
          <div className="hk-toolbar-menu-header">Hakkutsu Settings</div>
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
    </div>,
    toolbarContainer
  ) : null;

  return (
    <>
      {toolbarPortal}

      {isEnabled && (subtitleData || currentSegment) && (
        <div
          ref={containerRef}
          className={`hk-sub__container ${!currentSegment ? "hk-sub__container--hidden" : ""}`}
          onMouseUp={handleMouseUp}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {currentSegment && (
            <div className="hk-sub__overlay-wrapper" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
              <div className="hk-sub__action-bar">
                <button className="hk-sub__action-btn" onClick={handleCopySubtitle} title="Copy to clipboard">
                  📋
                </button>
                <button className="hk-sub__action-btn" onClick={handleExportAnki} title="Export sentence to Anki">
                  A
                </button>
                <button className="hk-sub__action-btn" onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) {
                    videoRef.current.currentTime = currentSegment.start;
                    videoRef.current.play();
                  }
                }} title="Replay (Up Arrow)">
                  ↺
                </button>
              </div>
              <div className="hk-sub__bar" key={currentSegment.start}>
                {analyzedTokens && analyzedTokens.length > 0 ? (
                  analyzedTokens.map((token, i) => {
                    const jlptClass = settings.showJlptColors ? getJlptClass(token) : "";
                    const particleClass = isParticleToken(token) ? "hk-sub__token--particle" : "";
                    const showReading = settings.showFurigana && token.is_japanese && token.reading.hiragana !== token.surface;

                    return (
                      <span
                        key={`${currentSegment.start}-${i}`}
                        className={`hk-sub__token ${jlptClass} ${particleClass}`}
                        onClick={(e) => handleTokenClick(token, e)}
                        title={token.is_japanese ? `${token.dictionary_form} — ${token.pos}` : undefined}
                      >
                        <span className={`hk-sub__furigana ${!showReading ? "hk-sub__furigana--hidden" : ""}`}>
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
    </>
  );
};
