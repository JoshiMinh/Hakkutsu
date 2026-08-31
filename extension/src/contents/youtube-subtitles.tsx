/**
 * YouTube Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the YouTube HTML5 player.
 * Syncs with the MAIN-world bridge using ASBPlayer's architecture.
 * Supports primary Japanese tracks, auto-translated tracks (tlang=ja),
 * background-assisted timedtext fetching, continuous live screen caption reader,
 * local subtitle files, immersion shortcuts, and 1-click Anki sentence mining.
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
  parseYouTubeTimedTextXml,
  parseYouTubeJson3,
  readSubtitleFile,
  parsedToSubtitleFetchResult,
  deduplicateCueText,
} from "~lib/services/subtitle-parsers";
import { findSmartCue, buildSmartCues } from "~lib/services/smart-cue";
import {
  initYouTubePageBridge,
  type HakkutsuYouTubeSyncedData,
  type HakkutsuYouTubeTrack,
} from "~lib/bridges/youtube-bridge";

export const config: PlasmoCSConfig = {
  matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
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

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + youtubeSubtitleCss;
  return style;
};

const YT_GLOBAL_STYLE_ID = "hakkutsu-yt-global-style";

function injectYouTubeGlobalStyle(hideNative: boolean): void {
  let styleEl = document.getElementById(YT_GLOBAL_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = YT_GLOBAL_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    ${youtubeToolbarCss}
    ${
      hideNative
        ? `
      /* Visually conceal native captions so Hakkutsu interactive overlay replaces them */
      .ytp-caption-window-container,
      .caption-window,
      .ytp-caption-segment {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `
        : ""
    }
  `;
}

/** Extract caption tracks embedded in YouTube static page scripts with auto-translate fallback */
function extractYouTubeCaptionTracksFromHtml(): SubtitleTrackOption[] {
  const tracks: SubtitleTrackOption[] = [];
  const seen = new Set<string>();

  try {
    const scripts = document.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || "";
      if (text.includes("captionTracks")) {
        const match = text.match(/"captionTracks":\s*(\[[^\]]+\])/);
        if (match && match[1]) {
          try {
            const raw = JSON.parse(match[1]);
            if (Array.isArray(raw)) {
              for (const t of raw) {
                const url = t.baseUrl || t.url;
                if (!url) continue;
                const lang = t.languageCode || "ja";
                const isAuto = t.kind === "asr" || (t.vssId && t.vssId.startsWith("a."));
                const label = t.name?.simpleText || t.name?.runs?.[0]?.text || t.displayName || lang;
                const id = `${lang}-${t.vssId || ""}-${isAuto ? "auto" : "std"}`;
                if (!seen.has(id)) {
                  seen.add(id);
                  tracks.push({
                    id,
                    name: label,
                    languageCode: lang,
                    url: url.includes("fmt=") ? url : `${url}&fmt=srv3`,
                    isAutoGenerated: isAuto,
                  });
                }
              }
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("[Hakkutsu] Static caption tracks parse error:", err);
  }

  // Synthesize Japanese Auto-Translate track if video has other language tracks (e.g. English)
  const hasJa = tracks.some((t) => t.languageCode.startsWith("ja"));
  if (!hasJa && tracks.length > 0) {
    const baseTrack = tracks.find((t) => !t.isAutoGenerated && t.url) || tracks[0];
    if (baseTrack && baseTrack.url) {
      const autoJaUrl = baseTrack.url.includes("tlang=")
        ? baseTrack.url.replace(/tlang=[^&]+/, "tlang=ja")
        : `${baseTrack.url}&tlang=ja`;

      tracks.unshift({
        id: "yt-auto-translate-ja",
        name: `日本語 (${baseTrack.name} - Auto Translate)`,
        languageCode: "ja",
        url: autoJaUrl,
        isAutoGenerated: true,
      });
    }
  }

  return tracks;
}

export default function YouTubeSubtitlesOverlay() {
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
  const [hasLiveCues, setHasLiveCues] = useState(false);
  const [offset, setOffset] = useState(settings.subtitlesOffset || 0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentUrlRef = useRef(window.location.href);

  // ── Initialize Main-World Bridge ───────────────────────────────────────────

  useEffect(() => {
    initYouTubePageBridge();
  }, []);

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

  // ── Global Style & Native Caption Suppression ──────────────────────────────

  useEffect(() => {
    injectYouTubeGlobalStyle(isEnabled && (Boolean(subtitleData) || Boolean(currentSegment) || hasLiveCues));
    return () => {
      injectYouTubeGlobalStyle(false);
    };
  }, [isEnabled, subtitleData, currentSegment, hasLiveCues]);

  // ── Read Current Screen Caption Helper ─────────────────────────────────────

  const readCurrentScreenCaption = useCallback((): SubtitleSegment | null => {
    // 1. Check DOM caption elements
    const segEls = document.querySelectorAll(".ytp-caption-segment");
    if (segEls.length > 0) {
      const uniqueTexts: string[] = [];
      const seen = new Set<string>();
      segEls.forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          uniqueTexts.push(t);
        }
      });
      const rawText = uniqueTexts.join(" ").trim();
      const text = deduplicateCueText(rawText);
      if (text) {
        const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
        const time = video ? Math.max(0, video.currentTime - offset) : 0;
        return {
          start: time,
          duration: 3.5,
          text,
        };
      }
    }

    // 2. Check HTML5 video textTracks
    const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
    if (video?.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.activeCues && track.activeCues.length > 0) {
          const cue = track.activeCues[0] as VTTCue;
          if (cue?.text) {
            return {
              start: cue.startTime,
              duration: Math.max(0.5, cue.endTime - cue.startTime),
              text: cue.text.replace(/<[^>]+>/g, "").trim(),
            };
          }
        }
      }
    }

    return null;
  }, [offset]);

  // ── Fetch Track Content Helper (Direct + Background Fallback) ──────────────

  const loadTrackContent = useCallback(async (track: SubtitleTrackOption): Promise<SubtitleSegment[]> => {
    if (!track.url) return [];

    let content = "";
    try {
      const res = await fetch(track.url);
      if (res.ok) {
        content = await res.text();
      }
    } catch {}

    if (!content || !content.trim()) {
      try {
        const bgRes: any = await chrome.runtime.sendMessage({
          type: "FETCH_TIMEDTEXT_URL",
          payload: { url: track.url },
        });
        if (bgRes?.payload?.success && bgRes?.payload?.text) {
          content = bgRes.payload.text;
        }
      } catch (bgErr) {
        console.warn("[Hakkutsu] Background timedtext fetch error:", bgErr);
      }
    }

    if (!content || !content.trim()) {
      throw new Error(`Failed to load subtitle content for track: ${track.name}`);
    }

    let segments: SubtitleSegment[] = [];
    if (content.trim().startsWith("{")) {
      segments = parseYouTubeJson3(content);
    } else {
      segments = parseYouTubeTimedTextXml(content);
    }

    return buildSmartCues(segments, Boolean(track.isAutoGenerated));
  }, []);

  // ── Manual Track Selection Handlers ────────────────────────────────────────

  const handleSelectPrimaryTrack = useCallback(
    async (track: SubtitleTrackOption) => {
      setCurrentTrackId(track.id);
      if (track.fetchResult) {
        setSubtitleData(track.fetchResult);
        return;
      }
      try {
        setLoading(true);
        const segments = await loadTrackContent(track);
        setSubtitleData({
          videoId: "current",
          language: track.languageCode,
          trackName: track.name,
          segments,
          fullText: segments.map((s) => s.text).join(" "),
          isAutoGenerated: Boolean(track.isAutoGenerated),
          source: "player",
        });
        setError(null);
      } catch (err) {
        console.warn("[Hakkutsu Subtitles] Primary track fetch failed, using live DOM fallback:", err);
      } finally {
        setLoading(false);
      }
    },
    [loadTrackContent]
  );

  const handleSelectSecondaryTrack = useCallback(
    async (track: SubtitleTrackOption | null) => {
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
      try {
        const segments = await loadTrackContent(track);
        setSecondaryData({
          videoId: "current",
          language: track.languageCode,
          trackName: track.name,
          segments,
          fullText: segments.map((s) => s.text).join(" "),
          isAutoGenerated: Boolean(track.isAutoGenerated),
          source: "player",
        });
      } catch {
        // keep fallback
      }
    },
    [loadTrackContent]
  );

  // ── Listen for Synced Tracks from Main-World Bridge ─────────────────────────

  const handleSyncedTracks = useCallback(
    async (e: Event) => {
      const detail = (e as CustomEvent).detail as HakkutsuYouTubeSyncedData | undefined;
      if (!detail || !Array.isArray(detail.tracks)) return;

      setVideoTitle(detail.title || document.title);

      const options: SubtitleTrackOption[] = detail.tracks.map((t) => ({
        id: t.id,
        name: t.label,
        languageCode: t.language,
        isAutoGenerated: t.isAutoGenerated,
        url: t.url,
      }));

      // Add auto-translate Japanese track if needed
      const hasJa = options.some((t) => t.languageCode.startsWith("ja"));
      if (!hasJa && options.length > 0) {
        const base = options.find((t) => !t.isAutoGenerated && t.url) || options[0];
        if (base?.url) {
          const autoJaUrl = base.url.includes("tlang=")
            ? base.url.replace(/tlang=[^&]+/, "tlang=ja")
            : `${base.url}&tlang=ja`;
          options.unshift({
            id: "yt-auto-translate-ja",
            name: `日本語 (${base.name} - Auto Translate)`,
            languageCode: "ja",
            url: autoJaUrl,
            isAutoGenerated: true,
          });
        }
      }

      setAvailableTracks(options);

      // Auto-select primary Japanese track
      const jaManual = options.find((t) => t.languageCode.startsWith("ja") && !t.isAutoGenerated);
      const jaAuto = options.find((t) => t.languageCode.startsWith("ja") && t.isAutoGenerated);
      const chosenJa = jaManual || jaAuto;

      if (chosenJa && !subtitleData) {
        handleSelectPrimaryTrack(chosenJa);
      }

      // Auto-select secondary track matching user's language selected in app settings (e.g. English)
      const userTargetLang = settings.targetLanguage || "en";
      const nativeSecTrack = options.find(
        (t) => t.languageCode.startsWith(userTargetLang) && t.id !== chosenJa?.id
      );

      if (nativeSecTrack && !secondaryData) {
        handleSelectSecondaryTrack(nativeSecTrack);
      } else if (!secondaryTrackId) {
        setSecondaryTrackId("__auto_translate__");
        setSecondaryData(null);
      }
    },
    [subtitleData, secondaryData, secondaryTrackId, settings.targetLanguage, handleSelectPrimaryTrack, handleSelectSecondaryTrack]
  );

  useEffect(() => {
    document.addEventListener("hakkutsu:youtube-synced-tracks", handleSyncedTracks);
    document.dispatchEvent(new CustomEvent("hakkutsu:request-youtube-tracks"));

    return () => {
      document.removeEventListener("hakkutsu:youtube-synced-tracks", handleSyncedTracks);
    };
  }, [handleSyncedTracks]);

  // ── Static In-Tab Track Discovery ───────────────────────────────────────────

  useEffect(() => {
    const scan = () => {
      const staticTracks = extractYouTubeCaptionTracksFromHtml();
      if (staticTracks.length > 0) {
        setAvailableTracks((prev) => {
          const map = new Map(prev.map((t) => [t.id, t]));
          for (const st of staticTracks) {
            if (!map.has(st.id)) map.set(st.id, st);
          }
          return Array.from(map.values());
        });

        if (!subtitleData) {
          const ja =
            staticTracks.find((t) => t.languageCode.startsWith("ja") && !t.isAutoGenerated) ||
            staticTracks.find((t) => t.languageCode.startsWith("ja"));
          if (ja) {
            handleSelectPrimaryTrack(ja);
          }
        }
      }
    };

    scan();
    const interval = setInterval(scan, 2500);
    return () => clearInterval(interval);
  }, [subtitleData, handleSelectPrimaryTrack]);

  // ── Continuous Frame & Live Screen Caption Sync ────────────────────────────

  useEffect(() => {
    if (!isEnabled) {
      setCurrentSegment(null);
      setSecondarySegment(null);
      setHasLiveCues(false);
      return;
    }

    const syncCues = () => {
      const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
      if (!video) return;

      const adjustedTime = video.currentTime - offset;

      if (subtitleData && subtitleData.segments.length > 0) {
        const primary = findSmartCue(subtitleData.segments, adjustedTime);
        if (primary) {
          setCurrentSegment(primary);
          setHasLiveCues(false);
        } else {
          const screen = readCurrentScreenCaption();
          if (screen) {
            setCurrentSegment(screen);
            setHasLiveCues(true);
          } else {
            setCurrentSegment(null);
          }
        }

        if (secondaryData && secondaryData.segments.length > 0) {
          const sec = findSmartCue(secondaryData.segments, adjustedTime);
          setSecondarySegment(sec);
        } else {
          setSecondarySegment(null);
        }
      } else {
        const live = readCurrentScreenCaption();
        if (live) {
          setCurrentSegment(live);
          setHasLiveCues(true);
        }

        if (secondaryData && secondaryData.segments.length > 0) {
          const sec = findSmartCue(secondaryData.segments, adjustedTime);
          setSecondarySegment(sec);
        } else {
          setSecondarySegment(null);
        }
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

    const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
    if (video) {
      video.addEventListener("seeked", syncCues);
      video.addEventListener("timeupdate", syncCues);
      video.addEventListener("pause", syncCues);
      video.addEventListener("play", syncCues);
    }

    const interval = setInterval(syncCues, 200);

    return () => {
      isRunning = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      clearInterval(interval);
      if (video) {
        video.removeEventListener("seeked", syncCues);
        video.removeEventListener("timeupdate", syncCues);
        video.removeEventListener("pause", syncCues);
        video.removeEventListener("play", syncCues);
      }
    };
  }, [isEnabled, subtitleData, secondaryData, offset, readCurrentScreenCaption]);

  // ── Injected Player Toolbar Button & Hover Menu ───────────────────────────

  useEffect(() => {
    let hoverMenu = document.getElementById("hk-yt-hover-menu") as HTMLDivElement | null;
    let menuHideTimeout: number | null = null;
    const renderMenuContent = () => {
      if (!hoverMenu) return;
      hoverMenu.innerHTML = `
        <div style="padding: 10px 14px 8px; border-bottom: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: #fff;">
            <span style="color: #c084fc; font-weight: 900; font-size: 16px;">発</span>
            <span>Shortcuts Manual</span>
          </div>
          <button data-hk-action="open-modal" style="font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: rgba(168,85,247,0.25); border: 1px solid rgba(168,85,247,0.4); color: #c084fc; cursor: pointer; transition: all 0.15s ease;">
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
    };

    const showHoverMenu = (btnEl: HTMLElement) => {
      if (menuHideTimeout) {
        clearTimeout(menuHideTimeout);
        menuHideTimeout = null;
      }

      if (!hoverMenu || !hoverMenu.parentElement) {
        hoverMenu = document.createElement("div");
        hoverMenu.id = "hk-yt-hover-menu";
        hoverMenu.style.cssText = `
          position: absolute;
          width: 260px;
          background: rgba(13, 13, 17, 0.96);
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

        // Delegate SETTINGS button click — survives innerHTML re-renders
        hoverMenu.addEventListener("click", (ev) => {
          const target = ev.target as HTMLElement;
          if (target.closest("[data-hk-action='open-modal']")) {
            ev.stopPropagation();
            hideHoverMenuImmediate();
            setIsModalOpen(true);
          }
        });

        const player =
          document.querySelector("#movie_player") ||
          document.querySelector(".html5-video-player") ||
          document.body;
        player.appendChild(hoverMenu);
      }

      renderMenuContent();

      const btnRect = btnEl.getBoundingClientRect();
      const playerEl =
        document.querySelector<HTMLElement>("#movie_player") ||
        document.querySelector<HTMLElement>(".html5-video-player") ||
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
      const rightControls = document.querySelector(".ytp-right-controls");
      if (!rightControls) return;

      let btn = document.getElementById("hk-yt-toolbar-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "hk-yt-toolbar-btn";
        btn.className = "ytp-button hk-yt-btn";
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

        rightControls.insertBefore(btn, rightControls.firstChild);
      }

      // Re-bind hover handlers to active closure every run so state updates never stale-out handlers
      btn.onmouseenter = () => {
        if (btn) showHoverMenu(btn);
      };
      btn.onmouseleave = scheduleHide;

      btn.innerHTML = `
        <div class="hk-toolbar-wrapper" style="display: flex; align-items: center; justify-content: center; height: 100%; position: relative; width: 100%;">
          <span class="hk-yt-btn__kanji" style="font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; font-size: 16px; font-weight: 800; color: ${isEnabled ? "#c084fc" : "#a1a1aa"}; line-height: 1; text-shadow: ${isEnabled ? "0 0 8px rgba(192, 132, 252, 0.4)" : "none"};">発</span>
          <div class="hk-yt-btn__active-bar" style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 22px; height: 3px; background: #a855f7; border-radius: 2px 2px 0 0; box-shadow: 0 0 6px rgba(168, 85, 247, 0.8); opacity: ${isEnabled ? "1" : "0"}; transition: opacity 0.2s ease;"></div>
        </div>
      `;

      if (isEnabled) {
        btn.classList.add("is-active");
      } else {
        btn.classList.remove("is-active");
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
        videoTitle={videoTitle || (typeof document !== "undefined" ? document.title.replace(/ - YouTube$/, "") : "")}
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
