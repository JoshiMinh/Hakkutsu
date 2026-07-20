/**
 * YouTube Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the YouTube player.
 */

import type { PlasmoCSConfig, PlasmoGetOverlayAnchor, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SubtitleSegment, SubtitleFetchResult } from "~types";
import { youtubeSubtitleCss } from "./youtube-subtitle-styles";
import { fetchSubtitlesFromPlayerResponse } from "~services/subtitle-fetcher";
import { SubtitleOverlay, type SubtitleSettings } from "~components/subtitle-overlay";

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function getVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
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
  const [error, setError] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(window.location.href);
  const [playerResponse, setPlayerResponse] = useState<Record<string, unknown> | null>(null);
  const [toolbarContainer, setToolbarContainer] = useState<Element | null>(null);
  const [autoPause, setAutoPause] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentSegmentRef = useRef<SubtitleSegment | null>(null);

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
          if (autoPause && currentSegmentRef.current) {
            const prevEnd = currentSegmentRef.current.start + currentSegmentRef.current.duration;
            // If we just crossed the end of the previous segment
            if (time >= prevEnd && time < prevEnd + 0.5) {
               video.pause();
            }
          }

          currentSegmentRef.current = segment;
          setCurrentSegment(segment);
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
  }, [isEnabled, subtitleData, autoPause]);

  const handleSettingsChange = useCallback((newSettings: SubtitleSettings) => {
    setAutoPause(newSettings.autoPause);
  }, []);

  return (
    <SubtitleOverlay
      isEnabled={isEnabled}
      loading={loading}
      error={error}
      subtitleData={subtitleData}
      currentSegment={currentSegment}
      videoRef={videoRef}
      currentUrl={currentUrl}
      toolbarContainer={toolbarContainer}
      onToggleEnabled={() => setIsEnabled(prev => !prev)}
      onSettingsChange={handleSettingsChange}
    />
  );
};

export default YouTubeSubtitles;
