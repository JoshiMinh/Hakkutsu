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
  /* ── Subtitle container position on Netflix ── */
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

    /* ── Hakkutsu Netflix Player Button & Wrapper (page DOM) ── */
    #hk-netflix-btn-wrapper {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      vertical-align: middle !important;
      position: relative !important;
      flex-shrink: 0 !important;
      margin: 0 12px 0 2px !important;
      padding: 0 !important;
      height: 100% !important;
      box-sizing: border-box !important;
    }

    button#hk-netflix-toolbar-btn {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
      width: 44px !important;
      height: 44px !important;
      min-width: 44px !important;
      min-height: 44px !important;
      background: transparent !important;
      border: none !important;
      border-radius: 50% !important;
      box-shadow: none !important;
      outline: none !important;
      cursor: pointer !important;
      padding: 0 !important;
      margin: 0 !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      flex-shrink: 0 !important;
      transition: background 0.15s ease, transform 0.15s ease !important;
      pointer-events: auto !important;
    }

    button#hk-netflix-toolbar-btn:hover {
      background: rgba(255, 255, 255, 0.15) !important;
      transform: scale(1.06) !important;
    }

    button#hk-netflix-toolbar-btn:active {
      transform: scale(0.94) !important;
    }

    /* Fade button when Netflix hides controls */
    .watch-video.inactive #hk-netflix-btn-wrapper,
    .VideoContainer.inactive #hk-netflix-btn-wrapper,
    .watch-video.inactive button#hk-netflix-toolbar-btn,
    .VideoContainer.inactive button#hk-netflix-toolbar-btn {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.5s ease !important;
    }

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

  const selectedTrackIdRef = useRef<string>("");
  const isCustomTrackRef = useRef<boolean>(false);
  const selectedSecondaryTrackIdRef = useRef<string>("__auto_translate__");

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

      // Preserve any custom subtitle track loaded by the user
      setAvailableTracks((prev) => {
        const customTracks = prev.filter((t) => t.id.startsWith("custom-"));
        return [...customTracks, ...options];
      });

      // If user is playing a custom local file, never overwrite with bridge TTML
      if (isCustomTrackRef.current) {
        return;
      }

      // If the user already selected a specific track:
      if (selectedTrackIdRef.current) {
        const selected = options.find((t) => t.id === selectedTrackIdRef.current);
        if (selected && selected.url) {
          try {
            setLoading(true);
            const segments = await loadTrackContent(selected);
            setSubtitleData({
              videoId: "netflix",
              language: selected.languageCode,
              trackName: selected.name,
              segments,
              fullText: segments.map((s) => s.text).join(" "),
              isAutoGenerated: false,
              source: "player",
            });
            setError(null);
          } catch (err) {
            console.warn("[Hakkutsu Subtitles] Failed to fetch selected Netflix TTML:", err);
          } finally {
            setLoading(false);
          }
        }
        return;
      }

      // Initial auto-detection: Look for Japanese track
      const jaTrack = options.find((t) => t.languageCode.startsWith("ja"));
      if (jaTrack) {
        selectedTrackIdRef.current = jaTrack.id;
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

      // Initial secondary track handling
      if (selectedSecondaryTrackIdRef.current === "__auto_translate__") {
        setSecondaryTrackId("__auto_translate__");
        setSecondaryData(null);
      } else if (selectedSecondaryTrackIdRef.current) {
        const secondary = options.find((t) => t.id === selectedSecondaryTrackIdRef.current);
        if (secondary && secondary.url) {
          try {
            const secSegments = await loadTrackContent(secondary);
            setSecondaryData({
              videoId: "netflix",
              language: secondary.languageCode,
              trackName: secondary.name,
              segments: secSegments,
              fullText: secSegments.map((s) => s.text).join(" "),
              isAutoGenerated: false,
              source: "player",
            });
          } catch {}
        }
      } else {
        // Check for native secondary track matching targetLanguage
        const targetLang = settings.targetLanguage || "en";
        const secondaryMatch = options.find(
          (t) => t.languageCode === targetLang || t.languageCode.startsWith(`${targetLang}-`) || t.languageCode.startsWith(targetLang)
        );

        if (secondaryMatch && secondaryMatch.url) {
          selectedSecondaryTrackIdRef.current = secondaryMatch.id;
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
            <span style="color: #a1a1aa;">Toggle Furigana</span>
            <div style="display: flex; gap: 4px;">
              <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">F</kbd>
              <kbd style="padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-size: 11px; font-weight: 700;">W</kbd>
            </div>
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

      // Position the menu centered directly above the button
      const btnRect = btnEl.getBoundingClientRect();
      const menuWidth = 230;

      hoverMenu.style.position = "fixed";
      hoverMenu.style.top = "auto";
      hoverMenu.style.bottom = `${window.innerHeight - btnRect.top + 10}px`;
      const btnCenter = btnRect.left + btnRect.width / 2;
      const menuLeft = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, btnCenter - menuWidth / 2));
      hoverMenu.style.left = `${menuLeft}px`;
      hoverMenu.style.right = "auto";
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
      // 1. Find the buttons in Netflix's right-controls area
      const subSelectors = [
        '[data-uia="control-audio-subtitle"]',
        '[data-uia="controls-subtitle-selector"]',
        '[data-uia="control-audio-subtitles"]',
        'button[data-uia*="subtitle" i]',
        'button[data-uia*="audio" i]',
        '.button-nfplayerSubtitles',
        'button[aria-label*="subtitle" i]',
        'button[aria-label*="audio" i]',
        'button[aria-label*="字幕" i]',
        'button[aria-label*="音声" i]',
      ];

      let subBtn: HTMLElement | null = null;
      for (const sel of subSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          subBtn = el;
          break;
        }
      }

      const speedBtn = document.querySelector<HTMLElement>(
        '[data-uia="control-speed"], button[data-uia*="speed" i]'
      );
      const fsBtn = document.querySelector<HTMLElement>(
        '[data-uia="control-fullscreen-enter"], [data-uia="control-fullscreen-exit"], button[data-uia*="fullscreen" i]'
      );

      // Find lowest common ancestor (the true controls flex-row)
      const btnA = subBtn || speedBtn;
      const btnB = fsBtn || speedBtn;

      let row: HTMLElement | null = null;
      if (btnA && btnB && btnA !== btnB) {
        let curr: HTMLElement | null = btnA.parentElement;
        while (curr && curr !== document.body) {
          if (curr.contains(btnB)) {
            row = curr;
            break;
          }
          curr = curr.parentElement;
        }
      }

      if (!row && (subBtn || speedBtn || fsBtn)) {
        const anyBtn = subBtn || speedBtn || fsBtn;
        let curr: HTMLElement | null = anyBtn?.parentElement || null;
        while (curr && curr !== document.body && !curr.classList.contains("watch-video")) {
          const display = window.getComputedStyle(curr).display;
          if (display === "flex" || display === "inline-flex") {
            row = curr;
            break;
          }
          curr = curr.parentElement;
        }
      }

      // If still no row, try well-known Netflix controls row selectors
      if (!row) {
        row = document.querySelector<HTMLElement>(
          ".watch-video--bottom-controls-container .controls-container-right, .controls-right, .watch-video--bottom-controls-container"
        );
      }

      if (!row) return;

      // Find the direct child of `row` that contains subBtn, speedBtn, or fsBtn
      const getDirectChildOfRow = (descendant: HTMLElement | null): HTMLElement | null => {
        if (!descendant || !row) return null;
        let curr: HTMLElement | null = descendant;
        while (curr && curr.parentElement !== row) {
          curr = curr.parentElement;
        }
        return curr;
      };

      const subChild = getDirectChildOfRow(subBtn);
      const speedChild = getDirectChildOfRow(speedBtn);
      const fsChild = getDirectChildOfRow(fsBtn);

      // We want to insert BEFORE the subtitle control in the row
      const targetChild = subChild || speedChild || fsChild;

      // 2. Create or get wrapper and button
      let wrapper = document.getElementById("hk-netflix-btn-wrapper") as HTMLDivElement | null;
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.id = "hk-netflix-btn-wrapper";
        wrapper.className = "hk-nf-control-wrapper";
      }

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

      if (btn.parentElement !== wrapper) {
        wrapper.appendChild(btn);
      }

      // Insert wrapper into row as a direct sibling BEFORE targetChild
      if (targetChild && targetChild !== wrapper) {
        if (wrapper.parentElement !== row || wrapper.nextSibling !== targetChild) {
          row.insertBefore(wrapper, targetChild);
        }
      } else if (wrapper.parentElement !== row) {
        row.appendChild(wrapper);
      }

      // Re-bind hover handlers
      btn.onmouseenter = () => {
        if (btn) showHoverMenu(btn);
      };
      btn.onmouseleave = scheduleHide;

      // Clean borderless kanji icon (no box border) with active indicator bar
      btn.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; position: relative;">
          <span style="
            font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
            font-size: 20px;
            font-weight: 800;
            color: ${isEnabled ? "#c084fc" : "#ffffff"};
            line-height: 1;
            letter-spacing: -0.5px;
            text-shadow: ${isEnabled ? "0 0 10px rgba(192, 132, 252, 0.75)" : "0 1px 2px rgba(0,0,0,0.5)"};
            pointer-events: none;
            display: inline-block;
            user-select: none;
            -webkit-user-select: none;
            opacity: ${isEnabled ? "1" : "0.85"};
            transition: color 0.15s ease, opacity 0.15s ease;
          ">発</span>
          <div style="
            position: absolute;
            bottom: 5px;
            left: 50%;
            transform: translateX(-50%);
            width: 18px;
            height: 3px;
            background: #a855f7;
            border-radius: 2px;
            box-shadow: 0 0 6px rgba(168, 85, 247, 0.8);
            opacity: ${isEnabled ? "1" : "0"};
            transition: opacity 0.2s ease;
          "></div>
        </div>
      `;

      // Precision vertical alignment: align vertical center to exact pixel of subBtn
      if (subBtn) {
        const subRect = subBtn.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        if (subRect.height > 0 && btnRect.height > 0) {
          const subCenter = subRect.top + subRect.height / 2;
          const btnCenter = btnRect.top + btnRect.height / 2;
          const diff = Math.round(subCenter - btnCenter);
          if (Math.abs(diff) >= 1 && Math.abs(diff) <= 20) {
            btn.style.transform = `translateY(${diff}px)`;
          } else if (diff === 0) {
            btn.style.transform = "";
          }
        }
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
      const existingWrapper = document.getElementById("hk-netflix-btn-wrapper");
      if (existingWrapper?.parentElement) {
        existingWrapper.parentElement.removeChild(existingWrapper);
      }
    };
  }, [isEnabled, offset, settings.subtitlesSecondaryEnabled, settings.subtitlesAutoPause, updateSettings]);

  // ── Track Selection & Custom File Handlers ─────────────────────────────────

  const handleSelectPrimaryTrack = async (track: SubtitleTrackOption) => {
    selectedTrackIdRef.current = track.id;
    setCurrentTrackId(track.id);

    if (track.fetchResult) {
      isCustomTrackRef.current = true;
      setSubtitleData(track.fetchResult);
      setIsEnabled(true);
      return;
    }

    isCustomTrackRef.current = false;
    if (!track.url) {
      setLoading(true);
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
      setIsEnabled(true);
    } catch (err) {
      console.error("Failed to switch Netflix track:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSecondaryTrack = async (track: SubtitleTrackOption | null) => {
    if (!track) {
      selectedSecondaryTrackIdRef.current = "";
      setSecondaryTrackId("");
      setSecondaryData(null);
      return;
    }
    if (track.id === "__auto_translate__") {
      selectedSecondaryTrackIdRef.current = "__auto_translate__";
      setSecondaryTrackId("__auto_translate__");
      setSecondaryData(null);
      return;
    }

    selectedSecondaryTrackIdRef.current = track.id;
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
    isCustomTrackRef.current = true;
    selectedTrackIdRef.current = customOption.id;
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
        showFurigana={settings.showFurigana !== false}
        onFuriganaChange={(fg) => updateSettings({ showFurigana: fg })}
        fontSize={settings.subtitlesFontSize || 26}
        onFontSizeChange={(size) => updateSettings({ subtitlesFontSize: size })}
        onSelectTrack={handleSelectPrimaryTrack}
        onSelectSecondaryTrack={handleSelectSecondaryTrack}
        onCustomSubtitleLoaded={handleCustomSubtitleLoaded}
      />
    </>
  );
}
