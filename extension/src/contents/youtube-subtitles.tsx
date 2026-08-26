/**
 * YouTube Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the YouTube player.
 * Supports auto-fetching Japanese subtitles, drag-and-drop subtitle files,
 * sync timing offset, native caption replacement, and asbplayer-inspired navigation.
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
import {
  fetchTranscriptPanelSubtitles,
  tryExtractFromVideoTextTracks,
} from "~lib/services/youtube-transcript-dom";
import {
  extractYouTubeTabTracks,
  fetchYouTubeTrackInTab,
  getYouTubeVideoTitle,
  type YouTubePlayerTrack,
} from "~lib/services/youtube-tab-extractor";
import {
  findSmartCue,
  smartCueEnd,
} from "~lib/services/smart-cue";
import { injectMainWorldBridge } from "~lib/services/youtube-main-bridge-code";

// Inject Main-World Bridge immediately (asbplayer mechanism)
injectMainWorldBridge();

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
      overflow: "visible",
      zIndex: "2147483647",
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

// ── Cache & Global Native Subtitle Hiding ───────────────────────────────────

const subtitleCache = new Map<string, SubtitleFetchResult>();
const NATIVE_CAPTION_STYLE_ID = "hakkutsu-hide-youtube-captions";

function getVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !chrome.runtime?.id || /extension context invalidated/i.test(message);
}

function hideNativeCaptions(enabled: boolean): void {
  const player =
    document.querySelector("#movie_player") ||
    document.querySelector(".html5-video-player");
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
      #movie_player.hk-subs-active .ytp-caption-segment,
      .html5-video-player.hk-subs-active .ytp-caption-window-container,
      .html5-video-player.hk-subs-active .caption-window,
      .html5-video-player.hk-subs-active .captions-text,
      .html5-video-player.hk-subs-active .ytp-caption-segment {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translateY(-9999px) !important;
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
  const [secondarySubtitleData, setSecondarySubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [availableTracks, setAvailableTracks] = useState<SubtitleTrackOption[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string>("");
  const [secondaryTrackId, setSecondaryTrackId] = useState<string>("");
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [secondarySegment, setSecondarySegment] = useState<SubtitleSegment | null>(null);
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
  const hasAttemptedFetchRef = useRef<string | null>(null);

  const activeSubtitleData = customSubtitleData || subtitleData;
  const videoTitle = getYouTubeVideoTitle();

  const loadSubtitlesViaBackground = useCallback(
    async (videoId: string, language: string): Promise<SubtitleFetchResult | null> => {
      const response = await chrome.runtime.sendMessage({
        type: "GET_SUBTITLES",
        payload: { videoUrl: currentUrl, language },
      });

      if (response?.type === "SUBTITLES_RESULT" && response.payload) {
        return response.payload as SubtitleFetchResult;
      }

      if (response?.type === "ERROR") {
        const errorMessage =
          typeof response.payload === "object" &&
          response.payload &&
          "error" in response.payload
            ? String((response.payload as { error?: string }).error || "")
            : "";
        throw new Error(errorMessage || "Tải phụ đề thất bại.");
      }

      return null;
    },
    [currentUrl]
  );

  // ── Sync Native Caption Suppression (Replacing YouTube Subtitles) ──────────
  useEffect(() => {
    const shouldHide = isEnabled && Boolean(activeSubtitleData);
    hideNativeCaptions(shouldHide);

    // Keep class attached if YouTube re-renders the player element
    const interval = setInterval(() => {
      const player =
        document.querySelector("#movie_player") ||
        document.querySelector(".html5-video-player");
      if (player) {
        if (shouldHide && !player.classList.contains("hk-subs-active")) {
          player.classList.add("hk-subs-active");
        } else if (!shouldHide && player.classList.contains("hk-subs-active")) {
          player.classList.remove("hk-subs-active");
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      hideNativeCaptions(false);
    };
  }, [isEnabled, activeSubtitleData]);

  // ── Inject Main Toolbar Style ─────────────────────────────────────────────
  useEffect(() => {
    let styleEl = document.getElementById("hk-youtube-toolbar-style") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "hk-youtube-toolbar-style";
      styleEl.textContent = youtubeToolbarCss;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  }, []);

  // ── Native Toolbar Injection ──────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const rightControls = document.querySelector(".ytp-right-controls");
      if (rightControls) {
        let container = document.getElementById("hk-toolbar-portal");
        if (!container || !rightControls.contains(container)) {
          if (!container) {
            container = document.createElement("div");
            container.id = "hk-toolbar-portal";
            container.className = "ytp-button hk-toolbar-portal";
            Object.assign(container.style, {
              background: "transparent",
              backgroundColor: "transparent",
              border: "none",
              boxShadow: "none",
              outline: "none",
              padding: "0",
              margin: "0",
            });
          }
          rightControls.prepend(container);
          setToolbarContainer(container);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── SPA Navigation & Track Sync ───────────────────────────────────────────
  useEffect(() => {
    const handleUrlChange = () => {
      injectMainWorldBridge();
      const newUrl = window.location.href;
      if (newUrl !== currentUrl) {
        setCurrentUrl(newUrl);
        setSubtitleData(null);
        setCustomSubtitleData(null);
        setSecondarySubtitleData(null);
        setSecondaryTrackId("");
        setCurrentSegment(null);
        setSecondarySegment(null);
        setError(null);
        setAvailableTracks([]);
        setCurrentTrackId("");
        hasAttemptedFetchRef.current = null;
      }
    };

    const interval = setInterval(handleUrlChange, 800);
    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("yt-navigate-finish", handleUrlChange);
    window.addEventListener("yt-page-data-updated", handleUrlChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("popstate", handleUrlChange);
      window.removeEventListener("yt-navigate-finish", handleUrlChange);
      window.removeEventListener("yt-page-data-updated", handleUrlChange);
    };
  }, [currentUrl]);

  const refreshTracks = useCallback(async () => {
    let tabTracks = extractYouTubeTabTracks();
    if (tabTracks.length > 0) {
      const trackOptions: SubtitleTrackOption[] = tabTracks.map((t) => ({
        id: t.id,
        name: t.name,
        languageCode: t.languageCode,
        isAutoGenerated: t.isAutoGenerated,
        rawTrack: t,
      }));
      setAvailableTracks(trackOptions);
      return trackOptions;
    }

    try {
      const resp: any = await chrome.runtime.sendMessage({
        type: "GET_CAPTION_TRACKS",
        payload: { videoUrl: currentUrl },
      });
      if (
        resp?.type === "CAPTION_TRACKS_RESULT" &&
        Array.isArray(resp.payload?.tracks) &&
        resp.payload.tracks.length > 0
      ) {
        const bgTracks: SubtitleTrackOption[] = resp.payload.tracks.map(
          (t: any, i: number) => ({
            id: `bg_track_${i}_${t.languageCode}`,
            name: t.name || t.languageCode,
            languageCode: t.languageCode,
            isAutoGenerated: !!t.isAutoGenerated,
            rawTrack: {
              id: `bg_track_${i}_${t.languageCode}`,
              name: t.name || t.languageCode,
              languageCode: t.languageCode,
              baseUrl: t.baseUrl,
              isAutoGenerated: !!t.isAutoGenerated,
            },
          })
        );
        setAvailableTracks(bgTracks);
        return bgTracks;
      }
    } catch {}

    return [];
  }, [currentUrl]);

  useEffect(() => {
    if (currentUrl.includes("watch")) {
      refreshTracks();
      const timer = setInterval(() => {
        refreshTracks();
      }, 1500);
      return () => clearInterval(timer);
    }
  }, [currentUrl, refreshTracks]);

  useEffect(() => {
    const onBridgeTracks = () => {
      refreshTracks();
    };
    window.addEventListener("hakkutsu:bridge-tracks", onBridgeTracks);
    return () => window.removeEventListener("hakkutsu:bridge-tracks", onBridgeTracks);
  }, [refreshTracks]);

  // ── Multi-Tier Subtitle Fetcher (Bypasses YouTube Blocks) ──────────────────

  const loadSubtitles = useCallback(async () => {
    const videoId = getVideoId(currentUrl);
    if (!videoId || loadingRef.current) return;

    if (subtitleCache.has(videoId)) {
      const cached = subtitleCache.get(videoId)!;
      setSubtitleData(cached);
      setCurrentTrackId(cached.language);
      return;
    }

    try {
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      setRequiresPageReload(false);
      let jaTrack: YouTubePlayerTrack | null = null;

      // 1. Direct in-tab track extraction via Main-World Bridge (Fast & bypasses CORS/PO-token)
      let tabTracks = extractYouTubeTabTracks();
      if (tabTracks.length === 0) {
        try {
          const resp: any = await chrome.runtime.sendMessage({
            type: "GET_CAPTION_TRACKS",
            payload: { videoUrl: currentUrl },
          });
          if (
            resp?.type === "CAPTION_TRACKS_RESULT" &&
            Array.isArray(resp.payload?.tracks) &&
            resp.payload.tracks.length > 0
          ) {
            tabTracks = resp.payload.tracks.map((t: any, i: number) => ({
              id: `bg_track_${i}_${t.languageCode}`,
              name: t.name || t.languageCode,
              languageCode: t.languageCode,
              baseUrl: t.baseUrl,
              isAutoGenerated: !!t.isAutoGenerated,
            }));
          }
        } catch {}
      }

      if (tabTracks.length > 0) {
        const trackOptions: SubtitleTrackOption[] = tabTracks.map((t) => ({
          id: t.id,
          name: t.name,
          languageCode: t.languageCode,
          isAutoGenerated: t.isAutoGenerated,
          rawTrack: t,
        }));
        setAvailableTracks(trackOptions);

        // Find Japanese track (manual first, then auto-generated, then auto-translated, then first track)
        jaTrack =
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
          ) ||
          tabTracks[0];

        if (jaTrack) {
          try {
            const inTabResult = await fetchYouTubeTrackInTab(jaTrack, videoId);
            subtitleCache.set(videoId, inTabResult);
            setSubtitleData(inTabResult);
            setCurrentTrackId(jaTrack.id);
            hasAttemptedFetchRef.current = videoId;
            return;
          } catch (tabErr) {
            console.warn("Hakkutsu: Direct in-tab fetch failed, trying fallbacks", tabErr);
          }
        }
      }

      // 2. Background service worker fallback
      try {
        const resp = await loadSubtitlesViaBackground(videoId, "ja");
        if (resp && resp.segments && resp.segments.length > 0) {
          subtitleCache.set(videoId, resp);
          setSubtitleData(resp);
          setCurrentTrackId(resp.language);
          hasAttemptedFetchRef.current = videoId;
          return;
        }
      } catch (bgErr) {
        console.warn("Hakkutsu: Background fetch failed, trying HTML5 text tracks", bgErr);
      }

      // 3. HTML5 Video textTrack fallback
      const textTrackResult = tryExtractFromVideoTextTracks(videoId);
      if (textTrackResult && textTrackResult.segments.length > 0) {
        subtitleCache.set(videoId, textTrackResult);
        setSubtitleData(textTrackResult);
        setCurrentTrackId(textTrackResult.language);
        hasAttemptedFetchRef.current = videoId;
        return;
      }

      // 4. In-tab YouTube Transcript Panel Fallback (Handles botguard/protected videos)
      try {
        const transcriptResult = await fetchTranscriptPanelSubtitles(videoId);
        if (transcriptResult && transcriptResult.segments.length > 0) {
          subtitleCache.set(videoId, transcriptResult);
          setSubtitleData(transcriptResult);
          setCurrentTrackId("transcript");
          hasAttemptedFetchRef.current = videoId;
          return;
        }
      } catch (transcriptErr) {
        console.warn("Hakkutsu: Transcript panel fallback failed", transcriptErr);
      }

      if (jaTrack) {
        try {
          window.dispatchEvent(
            new CustomEvent("hakkutsu:set-player-track", {
              detail: { track: jaTrack },
            })
          );
        } catch {}
        setIsEnabled(true);
        setCurrentTrackId(jaTrack.id);
        setError(null);
        hasAttemptedFetchRef.current = videoId;
        return;
      }

      throw new Error("Video này không có phụ đề tiếng Nhật. Hãy tìm phụ đề trên Jimaku hoặc mở file phụ đề.");
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
          message.includes("no usable data") ||
          message.includes("PO token") ||
          message.includes("Tải phụ đề thất bại") ||
          message.includes("YouTube direct failed")
        ) {
          message =
            "Video này không tải được phụ đề trực tiếp từ YouTube. Hãy thử bấm 'Đọc Transcript' hoặc tìm phụ đề trên Jimaku.";
        }

        setError(message);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [currentUrl, loadSubtitlesViaBackground]);

  const handleTryTranscript = useCallback(async () => {
    const videoId = getVideoId(currentUrl);
    if (!videoId) return;
    try {
      setLoading(true);
      setError(null);
      const result = await fetchTranscriptPanelSubtitles(videoId);
      subtitleCache.set(videoId, result);
      setSubtitleData(result);
      setCustomSubtitleData(null);
      setIsEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể đọc transcript từ trang YouTube.");
    } finally {
      setLoading(false);
    }
  }, [currentUrl]);

  useEffect(() => {
    // Auto-fetch on navigation for this URL
    const videoId = getVideoId(currentUrl);
    if (!videoId) return;

    if (hasAttemptedFetchRef.current === videoId && subtitleData) return;

    const shouldAutoFetch = settings.autoFetchJapaneseSubtitles !== false;
    if (shouldAutoFetch && currentUrl.includes("watch")) {
      const timer = window.setTimeout(loadSubtitles, 300);
      return () => window.clearTimeout(timer);
    }
  }, [currentUrl, loadSubtitles, subtitleData, settings.autoFetchJapaneseSubtitles]);

  // ── Time Sync & Auto Pause ────────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled || (!activeSubtitleData && !secondarySubtitleData)) return;

    const video = document.querySelector("video");
    if (!video) return;
    videoRef.current = video;

    const updateSegment = () => {
      const adjustedTime = video.currentTime - offset;

      if (activeSubtitleData && activeSubtitleData.segments) {
        const segment = findSmartCue(activeSubtitleData.segments, adjustedTime);

        if (segment !== currentSegmentRef.current) {
          // Auto Pause logic
          if (!video.paused && autoPause && currentSegmentRef.current) {
            const previousIndex = activeSubtitleData.segments.indexOf(
              currentSegmentRef.current
            );
            const prevEnd = smartCueEnd(
              activeSubtitleData.segments,
              previousIndex
            );
            if (adjustedTime >= prevEnd && adjustedTime < prevEnd + 0.5) {
              video.pause();
            }
          }

          currentSegmentRef.current = segment;
          setCurrentSegment(segment);
        }
      }

      if (secondarySubtitleData && secondarySubtitleData.segments) {
        const secSeg = findSmartCue(secondarySubtitleData.segments, adjustedTime);
        setSecondarySegment(secSeg);
      } else {
        setSecondarySegment(null);
      }
    };

    // Update segment immediately on track change or initial mount
    updateSegment();

    const tick = () => {
      updateSegment();
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    const events = ["timeupdate", "seeked", "play", "pause", "ratechange"];
    events.forEach((evt) => video.addEventListener(evt, updateSegment));

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      events.forEach((evt) => video.removeEventListener(evt, updateSegment));
    };
  }, [isEnabled, activeSubtitleData, secondarySubtitleData, autoPause, offset]);

  // ── Live TextTrack & DOM Caption Sync Engine (100% Reliable Backup) ───────
  useEffect(() => {
    if (!isEnabled) return;
    const video = document.querySelector("video");
    if (!video) return;

    const syncLiveCues = () => {
      if (!video.textTracks || video.textTracks.length === 0) return;

      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.cues && track.cues.length > 0) {
          // If we have full cues list and no activeSubtitleData yet, build full subtitle data
          if (!activeSubtitleData || activeSubtitleData.segments.length < track.cues.length) {
            const segs: SubtitleSegment[] = [];
            for (let j = 0; j < track.cues.length; j++) {
              const cue = track.cues[j] as VTTCue;
              if (cue && cue.text && cue.text.trim()) {
                segs.push({
                  start: cue.startTime,
                  duration: Math.max(0.1, cue.endTime - cue.startTime),
                  text: cue.text.trim(),
                });
              }
            }
            if (segs.length > 0) {
              const result: SubtitleFetchResult = {
                videoId: getVideoId(currentUrl) || "yt_live",
                language: track.language || "ja",
                trackName: track.label || "YouTube Native Player",
                segments: segs,
                fullText: segs.map((s) => s.text).join(" "),
                isAutoGenerated: false,
                source: "player",
              };
              subtitleCache.set(result.videoId, result);
              setSubtitleData(result);
              setError(null);
            }
          }

          // Also check activeCues for immediate display
          if (track.activeCues && track.activeCues.length > 0) {
            const activeCue = track.activeCues[0] as VTTCue;
            if (activeCue && activeCue.text && activeCue.text.trim()) {
              const liveSeg: SubtitleSegment = {
                start: activeCue.startTime,
                duration: Math.max(0.1, activeCue.endTime - activeCue.startTime),
                text: activeCue.text.trim(),
              };
              currentSegmentRef.current = liveSeg;
              setCurrentSegment(liveSeg);
              setError(null);
            }
          }
        }
      }
    };

    // Attach to all textTracks
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].oncuechange = syncLiveCues;
      try {
        video.textTracks[i].mode = "hidden";
      } catch {}
    }
    video.textTracks.onaddtrack = (e) => {
      if (e.track) {
        e.track.oncuechange = syncLiveCues;
        try {
          e.track.mode = "hidden";
        } catch {}
      }
    };

    // Also observe .ytp-caption-segment text changes
    const captionContainer =
      document.querySelector(".ytp-caption-window-container") ||
      document.querySelector("#movie_player") ||
      document.querySelector(".html5-video-player");

    let observer: MutationObserver | null = null;
    if (captionContainer) {
      observer = new MutationObserver(() => {
        const segEls = document.querySelectorAll(".ytp-caption-segment");
        if (segEls.length > 0) {
          const fullText = Array.from(segEls)
            .map((el) => el.textContent || "")
            .join(" ")
            .trim();
          if (fullText) {
            const time = video.currentTime - offset;
            const liveSeg: SubtitleSegment = {
              start: time,
              duration: 3,
              text: fullText,
            };
            currentSegmentRef.current = liveSeg;
            setCurrentSegment(liveSeg);
            setError(null);
          }
        }
      });

      observer.observe(captionContainer, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    const cueInterval = setInterval(syncLiveCues, 500);

    return () => {
      clearInterval(cueInterval);
      if (observer) observer.disconnect();
    };
  }, [isEnabled, activeSubtitleData, currentUrl, offset]);

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

      setLoading(true);
      setError(null);

      try {
        let playerTrack: YouTubePlayerTrack | null = null;
        if (track.rawTrack && "baseUrl" in track.rawTrack) {
          playerTrack = track.rawTrack as YouTubePlayerTrack;
        } else {
          const tabTracks = extractYouTubeTabTracks();
          playerTrack =
            tabTracks.find((t) => t.id === track.id) ||
            tabTracks.find(
              (t) =>
                t.name === track.name &&
                t.languageCode === track.languageCode &&
                t.isAutoGenerated === !!track.isAutoGenerated
            ) ||
            tabTracks.find((t) => t.name === track.name) ||
            tabTracks.find(
              (t) =>
                t.languageCode === track.languageCode &&
                t.isAutoGenerated === !!track.isAutoGenerated
            ) ||
            tabTracks.find((t) => t.languageCode === track.languageCode) ||
            null;
        }

        let result: SubtitleFetchResult | null = null;
        if (playerTrack && playerTrack.baseUrl) {
          try {
            result = await fetchYouTubeTrackInTab(playerTrack, videoId);
          } catch (tabErr) {
            console.warn("Hakkutsu: In-tab track fetch failed, trying background", tabErr);
          }
        }

        if (!result) {
          try {
            const backgroundResult = await loadSubtitlesViaBackground(
              videoId,
              track.languageCode || "ja"
            );
            if (backgroundResult && backgroundResult.segments.length > 0) {
              result = backgroundResult;
            }
          } catch (bgErr) {
            console.warn("Hakkutsu: Background track fetch failed, trying transcript", bgErr);
          }
        }

        if (!result) {
          try {
            result = await fetchTranscriptPanelSubtitles(videoId);
          } catch {}
        }

        if (result && result.segments.length > 0) {
          subtitleCache.set(videoId, result);
          setSubtitleData(result);
        }

        setCustomSubtitleData(null);
        setCurrentTrackId(track.id);
        setError(null);
        setIsEnabled(true);
      } catch (err) {
        console.warn("Hakkutsu: Full track download unavailable, live sync engine is active", err);
        setError(null);
        setIsEnabled(true);
        setCurrentTrackId(track.id);
      } finally {
        setLoading(false);
      }
    },
    [currentUrl, loadSubtitlesViaBackground]
  );

  const handleSelectSecondaryTrack = useCallback(
    async (track: SubtitleTrackOption | null) => {
      const videoId = getVideoId(currentUrl);
      if (!videoId || !track || !track.id) {
        setSecondarySubtitleData(null);
        setSecondaryTrackId("");
        setSecondarySegment(null);
        return;
      }

      try {
        let playerTrack: YouTubePlayerTrack | null = null;
        if (track.rawTrack && "baseUrl" in track.rawTrack) {
          playerTrack = track.rawTrack as YouTubePlayerTrack;
        } else {
          const tabTracks = extractYouTubeTabTracks();
          playerTrack =
            tabTracks.find((t) => t.id === track.id || t.languageCode === track.languageCode) ||
            tabTracks.find((t) => t.name === track.name) ||
            null;
        }

        if (!playerTrack || !playerTrack.baseUrl) return;

        const result = await fetchYouTubeTrackInTab(playerTrack, videoId);
        setSecondarySubtitleData(result);
        setSecondaryTrackId(track.id);
      } catch (err) {
        console.warn("Hakkutsu: Error loading secondary track", err);
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
      secondarySegment={secondarySegment}
      videoRef={videoRef}
      currentUrl={currentUrl}
      toolbarContainer={toolbarContainer}
      onToggleEnabled={() => setIsEnabled((prev) => !prev)}
      onSettingsChange={handleSettingsChange}
      offset={offset}
      onOffsetChange={setOffset}
      onLoadCustomSubtitles={handleLoadCustomSubtitles}
      onUnloadCustomSubtitles={handleUnloadCustomSubtitles}
      onTryTranscript={handleTryTranscript}
      videoTitle={videoTitle}
      availableTracks={availableTracks}
      currentTrackId={currentTrackId}
      secondaryTrackId={secondaryTrackId}
      onSelectTrack={handleSelectTrack}
      onSelectSecondaryTrack={handleSelectSecondaryTrack}
    />
  );
};

export default YouTubeSubtitles;
