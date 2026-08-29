/**
 * Netflix Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the Netflix HTML5 player.
 * Syncs with the MAIN-world bridge (netflix-page-bridge.ts) using ASBPlayer's Cadmium player architecture.
 * Supports primary Japanese tracks (IMSC 1.1 TTML), secondary tracks, local subtitle files,
 * DOM MutationObserver fallback, immersion shortcuts, and 1-click Anki sentence mining.
 */

import type {
  PlasmoCSConfig,
  PlasmoGetOverlayAnchor,
  PlasmoGetStyle,
  PlasmoMountShadowHost,
} from "plasmo";
import React, { useEffect, useState, useRef, useCallback } from "react";
import cssText from "data-text:~style.css";
import type { SubtitleSegment, SubtitleFetchResult } from "~lib/types";
import { youtubeSubtitleCss, youtubeToolbarCss } from "~lib/youtube-subtitle-styles";
import { SubtitleOverlay } from "~components/subtitle-overlay";
import { SelectSubtitlesModal, type SubtitleTrackOption } from "~components/select-subtitles-modal";
import { useSettingsStore } from "~lib/utils/settings";
import {
  parseNetflixTtml,
  readSubtitleFile,
  parsedToSubtitleFetchResult,
} from "~lib/services/subtitle-parsers";
import { findSmartCue, buildSmartCues } from "~lib/services/smart-cue";
import { initNetflixPageBridge, type HakkutsuNetflixSyncedData, type HakkutsuNetflixTrack } from "~lib/bridges/netflix-bridge";

export const config: PlasmoCSConfig = {
  matches: ["https://www.netflix.com/watch/*", "https://www.netflix.com/*"],
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.querySelector(".watch-video") ||
  document.querySelector(".VideoContainer") ||
  document.querySelector("video");

export const getShadowHostId = () => "hakkutsu-netflix-subtitles-host";

export const mountShadowHost: PlasmoMountShadowHost = async ({
  shadowHost,
  mountState,
}) => {
  const mountToPlayer = () => {
    const player =
      (mountState?.overlayTargetList?.[0] as HTMLElement | undefined) ||
      document.querySelector<HTMLElement>(".watch-video") ||
      document.querySelector<HTMLElement>(".VideoContainer");

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

    const shadowContainer = host.shadowRoot?.getElementById("plasmo-shadow-container");
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

const netflixSpecificCss = `
  /* ── Extra styles for Netflix ── */
  .watch-video .hk-sub__container,
  .VideoContainer .hk-sub__container {
    bottom: 72px;
    transition: bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  }

  .watch-video.active .hk-sub__container,
  .watch-video:hover .hk-sub__container,
  .watch-video--bottom-controls-container:hover ~ * .hk-sub__container {
    bottom: 126px;
  }

  .watch-video.inactive .hk-sub__container {
    bottom: 50px;
  }

  /* ── Floating Overlay Netflix Toolbar Button ── */
  button#hk-netflix-toolbar-btn.hk-netflix-btn,
  .hk-netflix-btn {
    position: absolute !important;
    right: 28px !important;
    bottom: 72px !important;
    width: 36px !important;
    height: 36px !important;
    border-radius: 10px !important;
    background: rgba(18, 18, 22, 0.85) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    border: 1px solid rgba(255, 255, 255, 0.16) !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
    transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, opacity 0.25s ease !important;
    z-index: 2147483647 !important;
    pointer-events: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    appearance: none !important;
    -webkit-appearance: none !important;
  }

  button#hk-netflix-toolbar-btn.hk-netflix-btn.is-active,
  .hk-netflix-btn.is-active {
    background: rgba(24, 18, 36, 0.92) !important;
    border-color: rgba(192, 132, 252, 0.5) !important;
    box-shadow: 0 4px 18px rgba(168, 85, 247, 0.35) !important;
    opacity: 1 !important;
  }

  button#hk-netflix-toolbar-btn.hk-netflix-btn.is-off,
  .hk-netflix-btn.is-off {
    background: rgba(18, 18, 22, 0.75) !important;
    border-color: rgba(255, 255, 255, 0.12) !important;
    opacity: 0.8 !important;
  }

  button#hk-netflix-toolbar-btn.hk-netflix-btn:hover,
  .hk-netflix-btn:hover {
    transform: scale(1.12) !important;
    background: rgba(36, 26, 54, 0.96) !important;
    border-color: rgba(192, 132, 252, 0.7) !important;
    opacity: 1 !important;
  }

  button#hk-netflix-toolbar-btn.hk-netflix-btn.is-off:hover,
  .hk-netflix-btn.is-off:hover {
    opacity: 0.95 !important;
  }

  .watch-video.inactive button#hk-netflix-toolbar-btn.hk-netflix-btn,
  .VideoContainer.inactive button#hk-netflix-toolbar-btn.hk-netflix-btn {
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + youtubeSubtitleCss + netflixSpecificCss;
  return style;
};

const NETFLIX_STYLE_ID = "hakkutsu-netflix-global-style";

function injectNetflixGlobalStyle(hideNative: boolean): void {
  let styleEl = document.getElementById(NETFLIX_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = NETFLIX_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    ${youtubeToolbarCss}
    ${
      hideNative
        ? `
      /* Cleanly hide native Netflix subtitles when Hakkutsu is active */
      .player-timedtext,
      .player-timedtext *,
      .timedtext-container,
      .timedtext-container *,
      [data-uia*="timedtext"],
      [data-uia*="timedtext"] *,
      .ltr-timedtext,
      .ltr-timedtext *,
      [class*="timedtext"],
      [class*="timedtext"] *,
      .player-timedtext-text-container,
      .player-timedtext-text-container * {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `
        : ""
    }
  `;
}

export default function NetflixSubtitlesOverlay() {
  const { settings, updateSettings } = useSettingsStore();

  const [isEnabled, setIsEnabled] = useState(settings.subtitlesEnabled !== false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [videoTitle, setVideoTitle] = useState<string>("");
  const [availableTracks, setAvailableTracks] = useState<SubtitleTrackOption[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string>("");
  const [secondaryTrackId, setSecondaryTrackId] = useState<string>("__auto_translate__");

  const [subtitleData, setSubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [secondaryData, setSecondaryData] = useState<SubtitleFetchResult | null>(null);

  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [secondarySegment, setSecondarySegment] = useState<SubtitleSegment | null>(null);
  const [offset, setOffset] = useState(settings.subtitlesOffset || 0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentUrlRef = useRef(window.location.href);

  // ── Initialize Main-World Bridge ───────────────────────────────────────────

  useEffect(() => {
    initNetflixPageBridge();
  }, []);

  // ── Global Style & Native Caption Suppression ──────────────────────────────

  useEffect(() => {
    injectNetflixGlobalStyle(isEnabled && Boolean(subtitleData));
    return () => {
      injectNetflixGlobalStyle(false);
    };
  }, [isEnabled, subtitleData]);

  // ── Video Reference Tracking ───────────────────────────────────────────────

  useEffect(() => {
    const updateVideoRef = () => {
      const video = document.querySelector<HTMLVideoElement>("video");
      if (video) videoRef.current = video;
    };
    updateVideoRef();
    const interval = setInterval(updateVideoRef, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Load Track Content (IMSC TTML) ─────────────────────────────────────────

  const loadTrackContent = useCallback(async (track: SubtitleTrackOption): Promise<SubtitleSegment[]> => {
    if (!track.url) return [];

    const res = await fetch(track.url);
    if (!res.ok) throw new Error(`HTTP error ${res.status} fetching Netflix TTML`);
    const content = await res.text();

    const segments = parseNetflixTtml(content);
    return buildSmartCues(segments, false);
  }, []);

  // ── Listen for Synced Tracks from Main-World Bridge ─────────────────────────

  const handleSyncedTracks = useCallback(
    async (e: Event) => {
      const detail = (e as CustomEvent).detail as HakkutsuNetflixSyncedData | undefined;
      if (!detail || !Array.isArray(detail.tracks)) return;

      setVideoTitle(detail.title || document.title);

      const options: SubtitleTrackOption[] = detail.tracks.map((t) => ({
        id: t.id,
        name: t.label,
        languageCode: t.language,
        url: t.url,
      }));

      setAvailableTracks(options);

      // Look for Japanese track
      const jaTrack = options.find((t) => t.languageCode.startsWith("ja"));
      if (jaTrack) {
        setCurrentTrackId(jaTrack.id);

        if (jaTrack.url) {
          try {
            setLoading(true);
            const segments = await loadTrackContent(jaTrack);
            setSubtitleData({
              videoId: "netflix",
              language: jaTrack.languageCode,
              trackName: jaTrack.name,
              segments,
              fullText: segments.map((s) => s.text).join(" "),
              isAutoGenerated: false,
              source: "player",
            });
            setError(null);
          } catch (err) {
            console.warn("[Hakkutsu Subtitles] Failed to fetch Netflix TTML:", err);
            setError("Failed to load Netflix subtitles");
          } finally {
            setLoading(false);
          }
        } else {
          // Track URL is lazy; request bridge to fetch it
          document.dispatchEvent(
            new CustomEvent("hakkutsu:netflix-lazy-load-track", {
              detail: { trackId: jaTrack.id },
            })
          );
        }
      }

      // Check for native secondary track matching targetLanguage
      const targetLang = settings.targetLanguage || "en";
      const secondaryMatch = options.find(
        (t) => t.languageCode === targetLang || t.languageCode.startsWith(`${targetLang}-`) || t.languageCode.startsWith(targetLang)
      );

      if (secondaryMatch && secondaryMatch.url) {
        setSecondaryTrackId(secondaryMatch.id);
        try {
          const secSegments = await loadTrackContent(secondaryMatch);
          setSecondaryData({
            videoId: "netflix",
            language: secondaryMatch.languageCode,
            trackName: secondaryMatch.name,
            segments: secSegments,
            fullText: secSegments.map((s) => s.text).join(" "),
            isAutoGenerated: false,
            source: "player",
          });
        } catch {
          // keep fallback
        }
      } else {
        setSecondaryTrackId("__auto_translate__");
        setSecondaryData(null);
      }
    },
    [loadTrackContent, settings.targetLanguage]
  );

  useEffect(() => {
    document.addEventListener("hakkutsu:netflix-synced-tracks", handleSyncedTracks);
    document.dispatchEvent(new CustomEvent("hakkutsu:request-netflix-tracks"));

    return () => {
      document.removeEventListener("hakkutsu:netflix-synced-tracks", handleSyncedTracks);
    };
  }, [handleSyncedTracks]);

  // ── Frame Loop & Seek Sync ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled) {
      setCurrentSegment(null);
      setSecondarySegment(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const syncCues = () => {
      const adjustedTime = video.currentTime - offset;

      if (subtitleData) {
        const primary = findSmartCue(subtitleData.segments, adjustedTime);
        setCurrentSegment(primary);
      }

      if (secondaryData && secondaryData.segments.length > 0) {
        const sec = findSmartCue(secondaryData.segments, adjustedTime);
        setSecondarySegment(sec);
      } else {
        setSecondarySegment(null);
      }
    };

    syncCues();

    let isRunning = true;
    const tick = () => {
      if (!isRunning) return;
      syncCues();
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);

    video.addEventListener("seeked", syncCues);
    video.addEventListener("timeupdate", syncCues);

    return () => {
      isRunning = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      video.removeEventListener("seeked", syncCues);
      video.removeEventListener("timeupdate", syncCues);
    };
  }, [isEnabled, subtitleData, secondaryData, offset]);

  // ── DOM MutationObserver Fallback for Netflix ───────────────────────────────

  useEffect(() => {
    // If Cadmium subtitles are loaded or feature disabled, do not run DOM observer
    if (!isEnabled || subtitleData) return;

    let lastObservedText = "";
    const target = document.querySelector(".watch-video") || document.body;
    if (!target) return;

    const observer = new MutationObserver(() => {
      if (subtitleData) return;

      const timedTextEl = document.querySelector(".player-timedtext");
      if (!timedTextEl) {
        if (lastObservedText !== "") {
          lastObservedText = "";
          setCurrentSegment(null);
        }
        return;
      }

      const spans = timedTextEl.querySelectorAll("span");
      let text = "";
      if (spans.length > 0) {
        text = Array.from(spans)
          .map((s) => s.textContent?.trim() || "")
          .filter(Boolean)
          .join(" ")
          .trim();
      } else {
        text = timedTextEl.textContent?.trim() || "";
      }

      if (text && text !== lastObservedText) {
        lastObservedText = text;
        const video = videoRef.current;
        const now = video?.currentTime || 0;
        setCurrentSegment({
          start: now,
          duration: 4,
          text,
        });
      } else if (!text && lastObservedText !== "") {
        lastObservedText = "";
        setCurrentSegment(null);
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [isEnabled, subtitleData]);

  // ── Injected Player Toolbar Button & Hover Menu ───────────────────────────

  useEffect(() => {
    let hoverMenu = document.getElementById("hk-netflix-hover-menu") as HTMLDivElement | null;
    let menuHideTimeout: number | null = null;

    const renderMenuContent = () => {
      if (!hoverMenu) return;
      hoverMenu.innerHTML = `
        <div style="padding: 10px 14px 8px; border-bottom: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: #fff;">
            <span style="color: #c084fc; font-weight: 900; font-size: 16px;">発</span>
            <span>Shortcuts Manual</span>
          </div>
          <button id="hk-nf-menu-open-modal" style="font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: rgba(168,85,247,0.25); border: 1px solid rgba(168,85,247,0.4); color: #c084fc; cursor: pointer; transition: all 0.15s ease;">
            SETTINGS ⚙
          </button>
        </div>

        <div style="padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #a1a1aa;">Seek Prev / Next Cue</span>
            <div style="display: flex; gap: 4px;">
              <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">A</kbd>
              <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">D</kbd>
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #a1a1aa;">Repeat Current Cue</span>
            <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">R</kbd>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #a1a1aa;">Toggle Auto-Pause</span>
            <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">E</kbd>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #a1a1aa;">Toggle Translation</span>
            <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">V</kbd>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #a1a1aa;">Open Settings / Tracks</span>
            <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">C</kbd>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; margin-top: 2px;">
            <span style="color: #a1a1aa;">Word Lookup</span>
            <span style="color: #c084fc; font-weight: 600;">Hover / Click Token</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #a1a1aa;">Load Subtitles</span>
            <span style="color: #c084fc; font-weight: 600;">Drag &amp; Drop .srt/.vtt</span>
          </div>
        </div>
      `;

      document.getElementById("hk-nf-menu-open-modal")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hideHoverMenuImmediate();
        setIsModalOpen(true);
      });
    };

    injectNetflixGlobalStyle(isEnabled);

    const showHoverMenu = (btnEl: HTMLElement) => {
      if (menuHideTimeout) {
        clearTimeout(menuHideTimeout);
        menuHideTimeout = null;
      }

      if (!hoverMenu) {
        hoverMenu = document.createElement("div");
        hoverMenu.id = "hk-netflix-hover-menu";
        hoverMenu.style.cssText = `
          position: absolute;
          width: 224px;
          background: rgba(18, 18, 22, 0.96);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 12px;
          box-shadow: 0 16px 36px rgba(0,0,0,0.85);
          color: #f4f4f5;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          z-index: 2147483647;
          pointer-events: auto;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.15s ease, transform 0.15s ease;
        `;

        hoverMenu.onmouseenter = () => {
          if (menuHideTimeout) {
            clearTimeout(menuHideTimeout);
            menuHideTimeout = null;
          }
        };
        hoverMenu.onmouseleave = scheduleHide;

        const player =
          document.querySelector(".watch-video") ||
          document.querySelector(".VideoContainer") ||
          document.body;
        player.appendChild(hoverMenu);
      }

      renderMenuContent();

      const btnRect = btnEl.getBoundingClientRect();
      const playerEl =
        document.querySelector<HTMLElement>(".watch-video") ||
        document.querySelector<HTMLElement>(".VideoContainer") ||
        document.body;
      const playerRect = playerEl.getBoundingClientRect();

      const bottomOffset = Math.max(50, playerRect.bottom - btnRect.top + 10);
      const rightOffset = Math.max(12, playerRect.right - btnRect.right);

      hoverMenu.style.bottom = `${bottomOffset}px`;
      hoverMenu.style.right = `${rightOffset}px`;
      hoverMenu.style.top = "auto";
      hoverMenu.style.left = "auto";
      hoverMenu.style.display = "block";

      requestAnimationFrame(() => {
        if (hoverMenu) {
          hoverMenu.style.opacity = "1";
          hoverMenu.style.transform = "translateY(0)";
        }
      });
    };

    const hideHoverMenuImmediate = () => {
      if (hoverMenu) {
        hoverMenu.style.opacity = "0";
        hoverMenu.style.transform = "translateY(8px)";
        setTimeout(() => {
          if (hoverMenu && hoverMenu.style.opacity === "0") {
            hoverMenu.style.display = "none";
          }
        }, 150);
      }
    };

    const scheduleHide = () => {
      if (menuHideTimeout) clearTimeout(menuHideTimeout);
      menuHideTimeout = window.setTimeout(hideHoverMenuImmediate, 280);
    };

    const injectToolbarButton = () => {
      const player =
        document.querySelector<HTMLElement>(".watch-video") ||
        document.querySelector<HTMLElement>(".VideoContainer") ||
        document.querySelector<HTMLVideoElement>("video")?.parentElement;

      if (!player) return;

      let btn = document.getElementById("hk-netflix-toolbar-btn") as HTMLButtonElement | null;
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "hk-netflix-toolbar-btn";
        btn.title = "Hakkutsu Subtitles (発掘) · Click to Toggle · Hover for Shortcuts";

        btn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsEnabled((prev) => {
            const next = !prev;
            updateSettings({ subtitlesEnabled: next });
            return next;
          });
        };
      }

      btn.className = `hk-netflix-btn ${isEnabled ? "is-active" : "is-off"}`;

      if (btn.parentElement !== player) {
        player.appendChild(btn);
      }

      // Re-bind hover handlers to active closure every run
      btn.onmouseenter = () => {
        if (btn) showHoverMenu(btn);
      };
      btn.onmouseleave = scheduleHide;

      btn.innerHTML = `
        <span style="font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; font-size: 15px; font-weight: 800; color: ${isEnabled ? "#c084fc" : "rgba(255,255,255,0.75)"}; line-height: 1; text-shadow: ${isEnabled ? "0 0 10px rgba(192, 132, 252, 0.85)" : "none"}; pointer-events: none; display: inline-block;">発</span>
      `;
    };

    injectToolbarButton();
    const interval = setInterval(injectToolbarButton, 1000);

    return () => {
      clearInterval(interval);
      if (menuHideTimeout) clearTimeout(menuHideTimeout);
      if (hoverMenu && hoverMenu.parentElement) {
        hoverMenu.parentElement.removeChild(hoverMenu);
      }
    };
  }, [isEnabled, offset, settings.subtitlesSecondaryEnabled, settings.subtitlesAutoPause, updateSettings]);

  // ── Track Selection & Custom File Handlers ─────────────────────────────────

  const handleSelectPrimaryTrack = async (track: SubtitleTrackOption) => {
    setCurrentTrackId(track.id);
    if (track.fetchResult) {
      setSubtitleData(track.fetchResult);
      return;
    }
    if (!track.url) {
      document.dispatchEvent(
        new CustomEvent("hakkutsu:netflix-lazy-load-track", {
          detail: { trackId: track.id },
        })
      );
      return;
    }
    try {
      setLoading(true);
      const segments = await loadTrackContent(track);
      setSubtitleData({
        videoId: "netflix",
        language: track.languageCode,
        trackName: track.name,
        segments,
        fullText: segments.map((s) => s.text).join(" "),
        isAutoGenerated: false,
        source: "player",
      });
    } catch (err) {
      console.error("Failed to switch Netflix track:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSecondaryTrack = async (track: SubtitleTrackOption | null) => {
    if (!track) {
      setSecondaryTrackId("");
      setSecondaryData(null);
      return;
    }
    if (track.id === "__auto_translate__") {
      setSecondaryTrackId("__auto_translate__");
      setSecondaryData(null);
      return;
    }

    setSecondaryTrackId(track.id);
    if (track.fetchResult) {
      setSecondaryData(track.fetchResult);
      return;
    }
    if (track.url) {
      try {
        const segments = await loadTrackContent(track);
        setSecondaryData({
          videoId: "netflix",
          language: track.languageCode,
          trackName: track.name,
          segments,
          fullText: segments.map((s) => s.text).join(" "),
          isAutoGenerated: false,
          source: "player",
        });
      } catch {
        // keep fallback
      }
    }
  };

  const handleCustomSubtitleLoaded = (result: SubtitleFetchResult) => {
    const customOption: SubtitleTrackOption = {
      id: `custom-${Date.now()}`,
      name: result.trackName || "Custom Subtitles",
      languageCode: result.language || "ja",
      fetchResult: result,
    };
    setAvailableTracks((prev) => [customOption, ...prev]);
    setCurrentTrackId(customOption.id);
    setSubtitleData(result);
    setIsEnabled(true);
  };

  return (
    <>
      <SubtitleOverlay
        isEnabled={isEnabled}
        loading={loading}
        error={error}
        subtitleData={subtitleData}
        currentSegment={currentSegment}
        secondarySegment={secondarySegment}
        videoRef={videoRef}
        currentUrl={currentUrlRef.current}
        videoTitle={videoTitle}
        availableTracks={availableTracks}
        currentTrackId={currentTrackId}
        secondaryTrackId={secondaryTrackId}
        offset={offset}
        onToggleEnabled={() => {
          setIsEnabled((prev) => {
            const next = !prev;
            updateSettings({ subtitlesEnabled: next });
            return next;
          });
        }}
        onOffsetChange={(newOffset) => setOffset(newOffset)}
        onSelectTrack={handleSelectPrimaryTrack}
        onSelectSecondaryTrack={handleSelectSecondaryTrack}
        onLoadCustomSubtitles={handleCustomSubtitleLoaded}
        onOpenModal={() => setIsModalOpen(true)}
        onSeekToCue={(cue) => {
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, cue.start + offset);
          }
        }}
      />

      <SelectSubtitlesModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        videoTitle={videoTitle || "Netflix Video"}
        availableTracks={availableTracks}
        currentTrackId={currentTrackId}
        secondaryTrackId={secondaryTrackId}
        offset={offset}
        onOffsetChange={(newOffset) => {
          setOffset(newOffset);
          updateSettings({ subtitlesOffset: newOffset });
        }}
        autoPause={settings.subtitlesAutoPause}
        onAutoPauseChange={(ap) => updateSettings({ subtitlesAutoPause: ap })}
        fontSize={settings.subtitlesFontSize || 26}
        onFontSizeChange={(size) => updateSettings({ subtitlesFontSize: size })}
        onSelectTrack={handleSelectPrimaryTrack}
        onSelectSecondaryTrack={handleSelectSecondaryTrack}
        onCustomSubtitleLoaded={handleCustomSubtitleLoaded}
      />
    </>
  );
}
