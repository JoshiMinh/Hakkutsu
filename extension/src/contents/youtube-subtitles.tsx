/**
 * YouTube Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the YouTube player.
 * Features:
 * - Direct memory access to ytInitialPlayerResponse for fast subtitle extraction
 * - Tokenized text with inline furigana and JLPT color coding
 * - Click-to-lookup triggers inline dictionary
 * - Pause-on-hover for comfortable reading
 * - Keyboard shortcuts (ArrowLeft/Right/Up)
 * - Prefetching next segments for instant rendering
 */

import type { PlasmoCSConfig, PlasmoGetOverlayAnchor, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import iconUrl from "url:~assets/icon.png";
import type {
  SubtitleSegment,
  SubtitleFetchResult,
  AnalyzeResponse,
  TokenAnalysis,
} from "~types";
import { youtubeSubtitleCss } from "./youtube-subtitle-styles";
import { fetchSubtitlesFromPlayerResponse } from "~services/subtitle-fetcher";

export const config: PlasmoCSConfig = {
  matches: ["https://www.youtube.com/watch*"],
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.querySelector("#movie_player") || document.querySelector(".html5-video-player");

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = youtubeSubtitleCss;
  return style;
};

// ── Cache ───────────────────────────────────────────────────────────────────

const subtitleCache = new Map<string, SubtitleFetchResult>();
const analysisCache = new Map<string, TokenAnalysis[]>();

// ── Settings Interface ──────────────────────────────────────────────────────

interface SubtitleSettings {
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

function getVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function findCurrentSegment(
  segments: SubtitleSegment[],
  currentTime: number
): SubtitleSegment | null {
  let low = 0;
  let high = segments.length - 1;
  let result: SubtitleSegment | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const seg = segments[mid];
    const segEnd = seg.start + seg.duration;

    if (currentTime >= seg.start && currentTime <= segEnd) {
      return seg;
    } else if (currentTime < seg.start) {
      high = mid - 1;
    } else {
      result = null;
      low = mid + 1;
    }
  }

  return result;
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

function hideNativeCaptions(enabled: boolean): void {
  const player = document.querySelector("#movie_player");
  if (player) {
    if (enabled) {
      player.classList.add("hk-subs-active");
    } else {
      player.classList.remove("hk-subs-active");
    }
  }
}

// ── Component ───────────────────────────────────────────────────────────────

const YouTubeSubtitles = () => {
  const [subtitleData, setSubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [analyzedTokens, setAnalyzedTokens] = useState<TokenAnalysis[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SubtitleSettings>(DEFAULT_SUB_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(window.location.href);
  const [playerResponse, setPlayerResponse] = useState<Record<string, unknown> | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentSegmentRef = useRef<SubtitleSegment | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wasPlayingRef = useRef(false);
  const [toolbarContainer, setToolbarContainer] = useState<Element | null>(null);

  // ── Native Toolbar Injection ──────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const rightControls = document.querySelector(".ytp-right-controls");
      if (rightControls) {
        let container = document.getElementById("hk-toolbar-portal");
        if (!container) {
          container = document.createElement("div");
          container.id = "hk-toolbar-portal";
          container.className = "ytp-button hk-toolbar-btn";
          // Prepend to place it on the far left of the right controls
          rightControls.prepend(container);
        }
        if (toolbarContainer !== container) {
          setToolbarContainer(container);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [toolbarContainer]);

  // ── SPA & Player Response ─────────────────────────────────────────────

  useEffect(() => {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (lastUrl.includes("watch")) {
          setCurrentUrl(lastUrl);
          setSubtitleData(null);
          setCurrentSegment(null);
          setAnalyzedTokens(null);
          setError(null);
        } else {
          setSubtitleData(null);
          setCurrentSegment(null);
          setIsEnabled(false);
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "HAKKUTSU_YT_PLAYER_RESPONSE") {
        setPlayerResponse(event.data.payload);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    hideNativeCaptions(isEnabled);
    return () => hideNativeCaptions(false);
  }, [isEnabled]);

  // ── Fetch Subtitles ───────────────────────────────────────────────────

  const loadSubtitles = useCallback(async () => {
    const videoId = getVideoId(currentUrl);
    if (!videoId) return;

    if (subtitleCache.has(videoId)) {
      setSubtitleData(subtitleCache.get(videoId)!);
      return;
    }

    if (!playerResponse) return;

    try {
      setLoading(true);
      setError(null);

      const result = await fetchSubtitlesFromPlayerResponse(playerResponse, videoId, "ja");
      
      if (result.segments.length === 0) {
        throw new Error("No Japanese subtitle segments found");
      }

      subtitleCache.set(videoId, result);
      setSubtitleData(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load subtitles";
      console.error("Hakkutsu: Subtitle fetch failed", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentUrl, playerResponse]);

  useEffect(() => {
    if (isEnabled && !subtitleData && currentUrl.includes("watch") && playerResponse) {
      loadSubtitles();
    }
  }, [isEnabled, currentUrl, playerResponse, loadSubtitles, subtitleData]);

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
          if (currentSegmentRef.current?.text === segment.text) {
            setAnalyzedTokens(analysisCache.get(segment.text)!);
          }
        } else {
          analysisCache.delete(segment.text);
        }
      })
      .catch(() => {
        analysisCache.delete(segment.text);
      });
  }, []);

  // ── Time Sync & Auto Pause ────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled || !subtitleData) return;

    const video = document.querySelector("video");
    if (!video) return;
    videoRef.current = video;

    const tick = () => {
      if (!video.paused && subtitleData) {
        const time = video.currentTime;
        const segment = findCurrentSegment(subtitleData.segments, time);

        if (segment !== currentSegmentRef.current) {
          // Auto Pause logic
          if (settings.autoPause && currentSegmentRef.current) {
            const prevEnd = currentSegmentRef.current.start + currentSegmentRef.current.duration;
            // If we just crossed the end of the previous segment
            if (time >= prevEnd && time < prevEnd + 0.5) {
               video.pause();
            }
          }

          currentSegmentRef.current = segment;
          setCurrentSegment(segment);

          // Prefetch next 2 segments
          const idx = findSegmentIndex(subtitleData.segments, time);
          if (idx >= 0) {
            if (idx + 1 < subtitleData.segments.length) prefetchAnalysis(subtitleData.segments[idx + 1]);
            if (idx + 2 < subtitleData.segments.length) prefetchAnalysis(subtitleData.segments[idx + 2]);
          }
        }
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    const handleSeeked = () => {
      const time = video.currentTime;
      const segment = findCurrentSegment(subtitleData.segments, time);
      currentSegmentRef.current = segment;
      setCurrentSegment(segment);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    video.addEventListener("seeked", handleSeeked);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [isEnabled, subtitleData, settings.autoPause, prefetchAnalysis]);

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
  }, [currentSegment, isEnabled, prefetchAnalysis]);

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
            // If we're currently in a segment but near the start, go to previous
            // Otherwise, go to start of current
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
  }, [isEnabled, subtitleData]);

  // ── Event Handlers ────────────────────────────────────────────────────

  const handleMouseEnter = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      wasPlayingRef.current = true;
      videoRef.current.pause();
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    if (videoRef.current && wasPlayingRef.current) {
      videoRef.current.play();
      wasPlayingRef.current = false;
    }
  }, []);

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
          sourceUrl: window.location.href,
        },
      }).catch(() => {});
    },
    [currentSegment]
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
          sourceUrl: window.location.href,
        },
      }).catch(() => {});
    },
    [currentSegment]
  );

  const handleTranscriptClick = useCallback((segment: SubtitleSegment) => {
    if (videoRef.current) {
      videoRef.current.currentTime = segment.start;
    }
  }, []);

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
    
    // Quick export of the current sentence
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
          setIsEnabled(!isEnabled);
          setError(null);
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

      {isEnabled && subtitleData && (
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

export default YouTubeSubtitles;
