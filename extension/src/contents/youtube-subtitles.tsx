/**
 * YouTube Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the YouTube player.
 * Supports auto-fetching Japanese subtitles, drag-and-drop subtitle files,
 * sync timing offset, and asbplayer-inspired navigation.
 */

import type {
  PlasmoCSConfig,
  PlasmoGetOverlayAnchor,
  PlasmoGetStyle,
  PlasmoMountShadowHost,
} from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SubtitleSegment, SubtitleFetchResult } from "~lib/types";
import { youtubeSubtitleCss, youtubeToolbarCss } from "~lib/youtube-subtitle-styles";
import { SubtitleOverlay, type SubtitleSettings } from "~components/subtitle-overlay";
import type { SubtitleTrackOption } from "~components/select-subtitles-modal";
import { useSettingsStore } from "~lib/utils/settings";
import { fetchTranscriptPanelSubtitles } from "~lib/services/youtube-transcript-dom";
import {
  extractYouTubeTabTracks,
  fetchYouTubeTrackInTab,
  getYouTubeVideoTitle,
  type YouTubePlayerTrack,
} from "~lib/services/youtube-tab-extractor";
import {
  buildSmartCues,
  findSmartCue,
  smartCueEnd,
} from "~lib/services/smart-cue";

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.youtube.com/*",
  ],
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.querySelector("#movie_player") ||
  document.querySelector(".html5-video-player") ||
  document.querySelector("video");

export const getShadowHostId = () => "hakkutsu-youtube-subtitles-host";

export const mountShadowHost: PlasmoMountShadowHost = async ({
  shadowHost,
  mountState,
}) => {
  const mountToPlayer = () => {
    const player =
      (mountState?.overlayTargetList?.[0] as HTMLElement | undefined) ||
      document.querySelector<HTMLElement>("#movie_player") ||
      document.querySelector<HTMLElement>(".html5-video-player");

    if (!player) return false;

    const host = shadowHost as HTMLElement;
    Object.assign(host.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      overflow: "hidden",
      zIndex: "70",
      pointerEvents: "none",
    });

    if (!player.contains(host)) {
      player.appendChild(host);
    }

    const shadowContainer = host.shadowRoot?.getElementById(
      "plasmo-shadow-container"
    );
    if (shadowContainer) {
      Object.assign(shadowContainer.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      });
    }
    return true;
  };

  if (!mountToPlayer()) {
    const interval = setInterval(() => {
      if (mountToPlayer()) clearInterval(interval);
    }, 250);
    setTimeout(() => clearInterval(interval), 15000);
  }
};

import cssText from "data-text:~style.css";

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + youtubeSubtitleCss;
  return style;
};

// ── Cache ───────────────────────────────────────────────────────────────────

const subtitleCache = new Map<string, SubtitleFetchResult>();
const NATIVE_CAPTION_STYLE_ID = "hakkutsu-hide-youtube-captions";

// ── Helpers ─────────────────────────────────────────────────────────────────

function getVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !chrome.runtime?.id || /extension context invalidated/i.test(message);
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

  let style = document.getElementById(
    NATIVE_CAPTION_STYLE_ID
  ) as HTMLStyleElement | null;
  
  if (!style) {
    style = document.createElement("style");
    style.id = NATIVE_CAPTION_STYLE_ID;
    style.textContent = `
      #movie_player.hk-subs-active .ytp-caption-window-container,
      #movie_player.hk-subs-active .caption-window,
      #movie_player.hk-subs-active .captions-text,
      #movie_player.hk-subs-active .ytp-caption-segment {
        display: none !important;
        visibility: hidden !important;
      }

      ${youtubeToolbarCss}
    `;
    (document.head || document.documentElement).appendChild(style);
  }
}

// ── Component ───────────────────────────────────────────────────────────────

const YouTubeSubtitles = () => {
  const [subtitleData, setSubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [customSubtitleData, setCustomSubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [availableTracks, setAvailableTracks] = useState<SubtitleTrackOption[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string>("");
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresPageReload, setRequiresPageReload] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(window.location.href);
  const [toolbarContainer, setToolbarContainer] = useState<Element | null>(null);
  const [autoPause, setAutoPause] = useState(false);
  const [offset, setOffset] = useState(0);
  const { settings } = useSettingsStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentSegmentRef = useRef<SubtitleSegment | null>(null);
  const loadingRef = useRef(false);

  const activeSubtitleData = customSubtitleData || subtitleData;
  const videoTitle = getYouTubeVideoTitle();

  // ── Inject Toolbar CSS into Main Document ────────────────────────────
  useEffect(() => {
    let styleEl = document.getElementById("hk-youtube-toolbar-style") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "hk-youtube-toolbar-style";
      styleEl.textContent = youtubeToolbarCss;
      document.head.appendChild(styleEl);
    }
  }, []);

  // ── Native Toolbar Injection ──────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const rightControls = document.querySelector(".ytp-right-controls");
      if (rightControls) {
        let container = document.getElementById("hk-toolbar-portal");
        if (!container || !rightControls.contains(container)) {
          if (!container) {
            container = document.createElement("div");
            container.id = "hk-toolbar-portal";
            container.className = "ytp-button";
          }
          rightControls.prepend(container);
          setToolbarContainer(container);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── SPA & Player Response ─────────────────────────────────────────────

  useEffect(() => {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (lastUrl.includes("watch")) {
          setCurrentUrl(lastUrl);
          setSubtitleData(null);
          setCustomSubtitleData(null);
          setCurrentSegment(null);
          setError(null);
          setRequiresPageReload(false);
          setOffset(0);
          setIsEnabled(true);
        } else {
          setSubtitleData(null);
          setCustomSubtitleData(null);
          setCurrentSegment(null);
          setIsEnabled(false);
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    hideNativeCaptions(isEnabled);
    return () => hideNativeCaptions(false);
  }, [isEnabled]);

  // ── Fetch Subtitles ───────────────────────────────────────────────────

  // ── Fetch Subtitles ───────────────────────────────────────────────────

  const loadSubtitles = useCallback(async () => {
    const videoId = getVideoId(currentUrl);
    if (!videoId || loadingRef.current) return;

    if (subtitleCache.has(videoId)) {
      setSubtitleData(subtitleCache.get(videoId)!);
      return;
    }

    try {
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      setRequiresPageReload(false);

      // 1. Direct in-tab track extraction (Fast & reliable, bypasses CORS/PO-token)
      const tabTracks = extractYouTubeTabTracks();
      if (tabTracks.length > 0) {
        const trackOptions: SubtitleTrackOption[] = tabTracks.map((t) => ({
          id: t.id,
          name: t.name,
          languageCode: t.languageCode,
          isAutoGenerated: t.isAutoGenerated,
          rawTrack: t,
        }));
        setAvailableTracks(trackOptions);

        // Find Japanese track (manual first, then auto-generated)
        const jaTrack =
          tabTracks.find(
            (t) =>
              (t.languageCode === "ja" ||
                t.languageCode.startsWith("ja") ||
                t.name.includes("日本語") ||
                t.name.includes("Japanese")) &&
              !t.isAutoGenerated
          ) ||
          tabTracks.find(
            (t) =>
              t.languageCode === "ja" ||
              t.languageCode.startsWith("ja") ||
              t.name.includes("日本語") ||
              t.name.includes("Japanese")
          );

        if (jaTrack) {
          try {
            const inTabResult = await fetchYouTubeTrackInTab(jaTrack, videoId);
            subtitleCache.set(videoId, inTabResult);
            setSubtitleData(inTabResult);
            setCurrentTrackId(jaTrack.id);
            return;
          } catch (tabErr) {
            console.warn("Hakkutsu: Direct in-tab fetch failed, trying fallbacks", tabErr);
          }
        }
      }

      const failures: string[] = [];
      let result: SubtitleFetchResult | null = null;

      // 2. Background service worker fetch
      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_SUBTITLES",
          payload: {
            videoUrl: currentUrl,
            language: "ja",
            strategy: "youtube",
          },
        });
        if (response?.type === "ERROR") {
          throw new Error(response.payload?.error || "YouTube direct failed");
        }
        if (response?.type !== "SUBTITLES_RESULT") {
          throw new Error("Background không trả dữ liệu subtitle");
        }
        result = response.payload as SubtitleFetchResult;
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          throw error;
        }
        failures.push(`player: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 3. YouTube Transcript DOM Panel fallback
      if (!result) {
        try {
          result = await fetchTranscriptPanelSubtitles(videoId);
        } catch (error) {
          failures.push(
            `transcript panel: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // 4. Backend local API fallback
      if (!result) {
        try {
          const response = await chrome.runtime.sendMessage({
            type: "GET_SUBTITLES",
            payload: {
              videoUrl: currentUrl,
              language: "ja",
              strategy: "backend",
            },
          });
          if (response?.type === "ERROR") {
            throw new Error(response.payload?.error || "Backend subtitle failed");
          }
          if (response?.type !== "SUBTITLES_RESULT") {
            throw new Error("Backend không trả dữ liệu subtitle");
          }
          result = response.payload as SubtitleFetchResult;
        } catch (error) {
          if (isExtensionContextInvalidated(error)) {
            throw error;
          }
          failures.push(`backend: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!result) {
        throw new Error(failures.join(" · "));
      }
      
      if (result.segments.length === 0) {
        throw new Error("Video có track phụ đề nhưng không có đoạn subtitle nào");
      }

      const smartSegments = buildSmartCues(
        result.segments,
        result.isAutoGenerated
      );
      result = {
        ...result,
        segments: smartSegments,
        fullText: smartSegments.map((segment) => segment.text).join(" "),
      };
      subtitleCache.set(videoId, result);
      setSubtitleData(result);
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : "Failed to load subtitles";
      if (isExtensionContextInvalidated(err)) {
        console.warn("Hakkutsu: Extension was reloaded; this YouTube tab must be refreshed.");
        setRequiresPageReload(true);
        setError("Tiện ích vừa được cập nhật nên tab YouTube này đang dùng mã cũ.");
      } else {
        console.error("Hakkutsu: Subtitle fetch failed", err);
        
        if (
          message.includes("No caption tracks found") || 
          message.includes("Video không có subtitle track") ||
          message.includes("no usable data")
        ) {
          message = "Video này không có phụ đề tiếng Nhật. Bấm 'Select Subtitles' để chọn track khác hoặc tìm trên Jimaku.";
        }
        
        setError(message);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [currentUrl]);

  useEffect(() => {
    // Auto-fetch if enabled in settings and no custom subtitle loaded
    const shouldAutoFetch = settings.autoFetchJapaneseSubtitles !== false;
    if (isEnabled && shouldAutoFetch && !activeSubtitleData && currentUrl.includes("watch")) {
      const timer = window.setTimeout(loadSubtitles, 0);
      return () => window.clearTimeout(timer);
    }
  }, [isEnabled, currentUrl, loadSubtitles, activeSubtitleData, settings.autoFetchJapaneseSubtitles]);

  // ── Time Sync & Auto Pause ────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled || !activeSubtitleData) return;

    const video = document.querySelector("video");
    if (!video) return;
    videoRef.current = video;

    const tick = () => {
      if (!video.paused && activeSubtitleData) {
        const adjustedTime = video.currentTime - offset;
        const segment = findSmartCue(activeSubtitleData.segments, adjustedTime);

        if (segment !== currentSegmentRef.current) {
          // Auto Pause logic
          if (autoPause && currentSegmentRef.current) {
            const previousIndex = activeSubtitleData.segments.indexOf(
              currentSegmentRef.current
            );
            const prevEnd = smartCueEnd(
              activeSubtitleData.segments,
              previousIndex
            );
            // If we just crossed the end of the previous segment
            if (adjustedTime >= prevEnd && adjustedTime < prevEnd + 0.5) {
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
      const adjustedTime = video.currentTime - offset;
      const segment = findSmartCue(activeSubtitleData.segments, adjustedTime);
      currentSegmentRef.current = segment;
      setCurrentSegment(segment);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    video.addEventListener("seeked", handleSeeked);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [isEnabled, activeSubtitleData, autoPause, offset]);

  const handleSettingsChange = useCallback((newSettings: SubtitleSettings) => {
    setAutoPause(newSettings.autoPause);
  }, []);

  const handleLoadCustomSubtitles = useCallback((result: SubtitleFetchResult) => {
    setCustomSubtitleData(result);
    setError(null);
    setIsEnabled(true);
  }, []);

  const handleUnloadCustomSubtitles = useCallback(() => {
    setCustomSubtitleData(null);
  }, []);

  const handleSelectTrack = useCallback(
    async (track: SubtitleTrackOption) => {
      const videoId = getVideoId(currentUrl);
      if (!videoId) return;

      if (track.rawTrack && "baseUrl" in track.rawTrack) {
        setLoading(true);
        try {
          const result = await fetchYouTubeTrackInTab(track.rawTrack as YouTubePlayerTrack, videoId);
          setSubtitleData(result);
          setCustomSubtitleData(null);
          setCurrentTrackId(track.id);
          setError(null);
          setIsEnabled(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Không thể tải track phụ đề này");
        } finally {
          setLoading(false);
        }
      }
    },
    [currentUrl]
  );

  return (
    <SubtitleOverlay
      isEnabled={isEnabled}
      loading={loading}
      error={error}
      requiresPageReload={requiresPageReload}
      subtitleData={activeSubtitleData}
      currentSegment={currentSegment}
      videoRef={videoRef}
      currentUrl={currentUrl}
      toolbarContainer={toolbarContainer}
      onToggleEnabled={() => setIsEnabled((prev) => !prev)}
      onSettingsChange={handleSettingsChange}
      offset={offset}
      onOffsetChange={setOffset}
      onLoadCustomSubtitles={handleLoadCustomSubtitles}
      onUnloadCustomSubtitles={handleUnloadCustomSubtitles}
      videoTitle={videoTitle}
      availableTracks={availableTracks}
      currentTrackId={currentTrackId}
      onSelectTrack={handleSelectTrack}
    />
  );
};

export default YouTubeSubtitles;
