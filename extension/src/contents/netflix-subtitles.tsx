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
      .ltr-timedtext {
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
      const secondaryOn = settings.subtitlesSecondaryEnabled !== false;
      const autoPauseOn = Boolean(settings.subtitlesAutoPause);

      hoverMenu.innerHTML = `
        <div style="padding: 8px 12px 6px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: #fff;">
            <span style="color: #c084fc; font-weight: 900; font-size: 15px;">発</span>
            <span>Hakkutsu Subtitles</span>
          </div>
          <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${isEnabled ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.1)"}; color: ${isEnabled ? "#c084fc" : "#a1a1aa"};">
            ${isEnabled ? "ON" : "OFF"}
          </span>
        </div>

        <div style="padding: 6px;">
          <!-- Select Subtitles Modal Button -->
          <button id="hk-nf-menu-open-tracks" style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 8px; border: none; background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 12px; font-weight: 600; cursor: pointer; margin-bottom: 4px; text-align: left;">
            <span>Tracks &amp; Settings...</span>
            <span style="font-size: 11px; opacity: 0.8;">Open &gt;</span>
          </button>

          <!-- Toggle Translation -->
          <button id="hk-nf-menu-toggle-secondary" style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 6px; border: none; background: transparent; color: #f4f4f5; font-size: 12px; cursor: pointer; text-align: left;">
            <span>Secondary Translation</span>
            <span style="color: ${secondaryOn ? "#4ade80" : "#71717a"}; font-weight: 600;">${secondaryOn ? "ON" : "OFF"}</span>
          </button>

          <!-- Toggle Auto-Pause -->
          <button id="hk-nf-menu-toggle-autopause" style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 6px; border: none; background: transparent; color: #f4f4f5; font-size: 12px; cursor: pointer; text-align: left;">
            <span>Auto-Pause on Cue (E)</span>
            <span style="color: ${autoPauseOn ? "#4ade80" : "#71717a"}; font-weight: 600;">${autoPauseOn ? "ON" : "OFF"}</span>
          </button>

          <!-- Sync Offset Nudge -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; font-size: 11px; color: #a1a1aa;">
            <span>Sync: ${offset >= 0 ? "+" : ""}${offset.toFixed(1)}s</span>
            <div style="display: flex; gap: 4px;">
              <button id="hk-nf-menu-offset-minus" style="padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; font-size: 10px;">-0.1s</button>
              <button id="hk-nf-menu-offset-reset" style="padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; font-size: 10px;">0s</button>
              <button id="hk-nf-menu-offset-plus" style="padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; font-size: 10px;">+0.1s</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById("hk-nf-menu-open-tracks")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hideHoverMenuImmediate();
        setIsModalOpen(true);
      });

      document.getElementById("hk-nf-menu-toggle-secondary")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const next = !secondaryOn;
        updateSettings({ subtitlesSecondaryEnabled: next });
        renderMenuContent();
      });

      document.getElementById("hk-nf-menu-toggle-autopause")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const next = !autoPauseOn;
        updateSettings({ subtitlesAutoPause: next });
        renderMenuContent();
      });

      document.getElementById("hk-nf-menu-offset-minus")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const newOffset = Math.round((offset - 0.1) * 10) / 10;
        setOffset(newOffset);
        updateSettings({ subtitlesOffset: newOffset });
        renderMenuContent();
      });

      document.getElementById("hk-nf-menu-offset-reset")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setOffset(0);
        updateSettings({ subtitlesOffset: 0 });
        renderMenuContent();
      });

      document.getElementById("hk-nf-menu-offset-plus")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const newOffset = Math.round((offset + 0.1) * 10) / 10;
        setOffset(newOffset);
        updateSettings({ subtitlesOffset: newOffset });
        renderMenuContent();
      });
    };

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
      const bottomOffset = playerRect.bottom - btnRect.top + 8;
      const rightOffset = Math.max(8, playerRect.right - btnRect.right - 10);

      hoverMenu.style.bottom = `${bottomOffset}px`;
      hoverMenu.style.right = `${rightOffset}px`;
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
      const audioSubBtn = document.querySelector('[data-uia="control-audio-subtitle"]');
      const buttonRow =
        document.querySelector(".PlayerControlsNeo__button-control-row") ||
        audioSubBtn?.closest(".PlayerControlsNeo__button-control-row");

      if (!buttonRow) return;

      let btn = document.getElementById("hk-netflix-toolbar-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "hk-netflix-toolbar-btn";
        btn.className = "hk-yt-btn";
        btn.title = "Hakkutsu Subtitles (発掘) · Click to Toggle · Hover for Options";
        btn.style.cssText = `
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.15);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          margin-right: 8px;
          transition: all 0.2s;
        `;

        btn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsEnabled((prev) => {
            const next = !prev;
            updateSettings({ subtitlesEnabled: next });
            return next;
          });
        };

        btn.onmouseenter = () => {
          if (btn) showHoverMenu(btn);
        };
        btn.onmouseleave = scheduleHide;

        if (audioSubBtn && audioSubBtn.parentElement) {
          audioSubBtn.parentElement.insertBefore(btn, audioSubBtn);
        } else {
          buttonRow.appendChild(btn);
        }
      }

      btn.innerHTML = `
        <span style="font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; font-size: 16px; font-weight: 800; color: ${isEnabled ? "#c084fc" : "#a1a1aa"}; line-height: 1; text-shadow: ${isEnabled ? "0 0 8px rgba(192, 132, 252, 0.4)" : "none"};">発</span>
      `;

      if (isEnabled) {
        btn.style.backgroundColor = "rgba(168, 85, 247, 0.35)";
        btn.style.borderColor = "#a855f7";
      } else {
        btn.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
        btn.style.borderColor = "rgba(255, 255, 255, 0.15)";
      }
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
