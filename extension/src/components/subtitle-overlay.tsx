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
  requiresPageReload?: boolean;
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
  requiresPageReload = false,
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
  const analysisOpenRef = useRef(false);
  const ctrlShortcutArmedRef = useRef(false);
  const ctrlPeekOpenRef = useRef(false);
  const ctrlHoldTimerRef = useRef<number | null>(null);

  // ── Prefetch Analysis ─────────────────────────────────────────────────

  const prefetchAnalysis = useCallback((segment: SubtitleSegment) => {
    if (analysisCache.has(segment.text)) return;
    
    // Mark as fetching to avoid duplicates
    analysisCache.set(segment.text, []); 
    
    chrome.runtime
      .sendMessage({
        type: "ANALYZE_JAVI",
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

    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return (
        element?.tagName === "INPUT" ||
        element?.tagName === "TEXTAREA" ||
        Boolean(element?.isContentEditable)
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (isEditableTarget(e.target)) return;

      if (e.key === "Control") {
        if (e.repeat || ctrlShortcutArmedRef.current) return;
        ctrlShortcutArmedRef.current = true;
        ctrlHoldTimerRef.current = window.setTimeout(() => {
          if (!ctrlShortcutArmedRef.current || !videoRef.current) return;
          const idx = findSegmentIndex(
            subtitleData.segments,
            videoRef.current.currentTime
          );
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
  }, [currentUrl, isEnabled, subtitleData, videoRef]);

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

    if (
      videoRef.current &&
      wasPlayingRef.current &&
      !analysisOpenRef.current
    ) {
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
      const playerRect = document
        .querySelector("#movie_player")
        ?.getBoundingClientRect();
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

  const subtitleSourceLabel =
    subtitleData?.source === "transcript_panel"
      ? "YouTube Transcript panel"
      : subtitleData?.source === "backend"
        ? "Backend local"
        : "YouTube player";

  const toolbarPortal = toolbarContainer ? createPortal(
    <div 
      className="hk-toolbar-wrapper"
      onMouseEnter={() => setShowSettings(true)}
      onMouseLeave={() => setShowSettings(false)}
    >
      <button
        type="button"
        role="switch"
        aria-checked={isEnabled}
        disabled={loading}
        className={`hk-yt-switch ${isEnabled ? "is-on" : ""} ${error ? "is-error" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleEnabled();
        }}
        title={
          error ||
          (subtitleData
            ? `${subtitleData.trackName} · ${subtitleSourceLabel}`
            : "Hakkutsu Subtitles")
        }
      >
        <div className="hk-yt-switch-track">
          <div className="hk-yt-switch-thumb">
            {loading ? (
              <span className="hk-spinner-small" />
            ) : error ? (
              <span className="hk-error-mark-small">!</span>
            ) : (
              <span className="hk-yt-switch-icon">発</span>
            )}
          </div>
        </div>
      </button>
      
      {showSettings && (
        <div className="hk-toolbar-menu" onClick={(e) => e.stopPropagation()}>
          <div className="hk-toolbar-menu-header">Hakkutsu Settings</div>
          {subtitleData && (
            <div
              style={{
                padding: "0 12px 8px",
                color: "rgba(255,255,255,.55)",
                fontSize: 10,
              }}
            >
              {subtitleData.trackName} · {subtitleSourceLabel}
            </div>
          )}
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

      {isEnabled && loading && !subtitleData && (
        <div
          role="status"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "18%",
            transform: "translateX(-50%)",
            zIndex: 70,
            padding: "8px 14px",
            borderRadius: 8,
            background: "rgba(15, 23, 42, 0.92)",
            color: "#f8fafc",
            fontSize: 14,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          Hakkutsu đang tải phụ đề tiếng Nhật…
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
            maxWidth: "70%",
            padding: "9px 14px",
            border: "1px solid rgba(248, 113, 113, 0.75)",
            borderRadius: 8,
            background: "rgba(69, 10, 10, 0.94)",
            color: "#fee2e2",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          <div>{error === "Video này không có phụ đề." ? error : `Hakkutsu không tải được phụ đề: ${error}`}</div>
          {requiresPageReload && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 8,
                padding: "7px 12px",
                border: "1px solid rgba(254, 226, 226, 0.7)",
                borderRadius: 6,
                background: "#fee2e2",
                color: "#7f1d1d",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Tải lại tab YouTube
            </button>
          )}
        </div>
      )}

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
              <div className="hk-sub__brand">HAKKUTSU SUB · CTRL PHÂN TÍCH</div>
              <div className="hk-sub__action-bar">
                <button
                  className="hk-sub__action-btn hk-sub__action-btn--sentence"
                  onClick={analyzeWholeSentence}
                  title="Tạm dừng và gọi Qwen phân tích sâu toàn bộ câu"
                >
                  Qwen phân tích sâu
                </button>
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
                        onClick={(e) => handleTokenClick(token, i, e)}
                        onMouseEnter={() => handleTokenHover(i)}
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
