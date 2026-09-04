/**
 * Generic Video Player — Content Script Overlay
 *
 * Universal support for any HTML5 <video> page.
 * Activates on all URLs except Netflix and YouTube (which have dedicated scripts).
 *
 * Features:
 *  - Disabled by default; user must click the floating 発 button to enable per-site.
 *  - Per-origin opt-in persisted via chrome.storage.local.
 *  - Reads <track kind="subtitles|captions"> elements from the <video> for available tracks.
 *  - Accepts drag & drop .srt/.vtt/.ass files for custom subtitles.
 *  - Draggable floating pill button, position persisted in sessionStorage.
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
import { youtubeSubtitleCss, genericPlayerCss } from "~lib/youtube-subtitle-styles";
import { SubtitleOverlay } from "~components/subtitle-overlay";
import { SelectSubtitlesModal, type SubtitleTrackOption } from "~components/select-subtitles-modal";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/languages/locales";
import { containsJapanese } from "~lib/utils/japanese";
import { readSubtitleFile, parsedToSubtitleFetchResult } from "~lib/services/subtitle-parsers";
import { findSmartCue, buildSmartCues } from "~lib/services/smart-cue";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: [
    "*://*.netflix.com/*",
    "*://netflix.com/*",
    "*://*.youtube.com/*",
    "*://youtube.com/*",
  ],
  all_frames: true,
  run_at: "document_idle",
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () => {
  const video = document.querySelector("video");
  return video?.parentElement || video || document.body;
};

export const getShadowHostId = () => "hakkutsu-generic-subtitles-host";

export const mountShadowHost: PlasmoMountShadowHost = async ({
  shadowHost,
  mountState,
}) => {
  const mountToPlayer = () => {
    const video = document.querySelector<HTMLElement>("video");
    const container = video?.parentElement || video;
    if (!container) return false;

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

    if (!container.contains(host)) {
      container.appendChild(host);
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
    }, 500);
    setTimeout(() => clearInterval(interval), 15000);
  }
};

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + youtubeSubtitleCss + genericPlayerCss;
  return style;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "hk_generic_enabled_";
const FAB_POS_KEY = "hk_fab_pos";
const GENERIC_STYLE_ID = "hakkutsu-generic-global-style";

function injectGenericGlobalStyle(hideNative: boolean): void {
  let styleEl = document.getElementById(GENERIC_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = GENERIC_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = hideNative
    ? `
      /* Cleanly hide raw player subtitles when Hakkutsu is active */
      .jw-text-track-display,
      .vjs-text-track-display,
      .shaka-text-container,
      .art-subtitles,
      .plyr__captions,
      .subtitle-container:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      .video-js .vjs-text-track-display,
      [class*="subtitle-text" i]:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      [class*="caption-text" i]:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      [class*="timedtext" i]:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      [class*="player-subtitle" i]:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      [class*="subtitle-layer" i]:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      [class*="subtitles-overlay" i]:not(#hakkutsu-generic-subtitles-host *):not(.hk-sub__container *),
      video::cue {
        opacity: 0 !important;
        color: transparent !important;
        text-shadow: none !important;
        background: transparent !important;
      }
    `
    : "";
}

function getSiteKey(): string {
  return STORAGE_KEY_PREFIX + location.origin;
}

async function isSiteEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(getSiteKey());
    return result[getSiteKey()] !== false;
  } catch {
    return true;
  }
}

async function setSiteEnabled(enabled: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [getSiteKey()]: enabled });
  } catch {}
}

function loadFabPosition(): { right: number; bottom: number } | null {
  try {
    const raw = sessionStorage.getItem(FAB_POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveFabPosition(right: number, bottom: number): void {
  try {
    sessionStorage.setItem(FAB_POS_KEY, JSON.stringify({ right, bottom }));
  } catch {}
}

/** Read <track> elements from a <video> and return SubtitleTrackOption[] */
function readVideoTrackElements(video: HTMLVideoElement): SubtitleTrackOption[] {
  const options: SubtitleTrackOption[] = [];
  const seen = new Set<string>();

  // Read from the TextTrack API
  for (let i = 0; i < video.textTracks.length; i++) {
    const tt = video.textTracks[i];
    if (tt.kind !== "subtitles" && tt.kind !== "captions") continue;
    const id = `track-${i}-${tt.language}-${tt.label}`;
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      name: tt.label || tt.language || `Track ${i + 1}`,
      languageCode: tt.language || "und",
      isAutoGenerated: false,
    });
  }

  // Also scan <track> DOM elements for src URLs (may have URLs not yet loaded)
  const trackEls = video.querySelectorAll<HTMLTrackElement>("track[src]");
  trackEls.forEach((el, i) => {
    const kind = el.kind;
    if (kind !== "subtitles" && kind !== "captions") return;
    const lang = el.srclang || "und";
    const label = el.label || lang;
    const id = `track-el-${i}-${lang}-${label}`;
    if (seen.has(id)) return;
    seen.add(id);
    options.push({
      id,
      name: label,
      languageCode: lang,
      url: el.src,
      isAutoGenerated: false,
    });
  });

  return options;
}

/** Fetch a subtitle track from a URL, with background-script fallback */
async function fetchTrackContent(track: SubtitleTrackOption): Promise<SubtitleSegment[]> {
  if (!track.url) return [];

  let content = "";
  try {
    const res = await fetch(track.url);
    if (res.ok) content = await res.text();
  } catch {}

  if (!content) {
    try {
      const bgRes: any = await chrome.runtime.sendMessage({
        type: "FETCH_TIMEDTEXT_URL",
        payload: { url: track.url },
      });
      if (bgRes?.payload?.success && bgRes?.payload?.text) content = bgRes.payload.text;
    } catch {}
  }

  if (!content) return [];

  const { parseVtt, parseSrt } = await import("~lib/services/subtitle-parsers") as any;
  const trimmed = content.trim();
  let segments: SubtitleSegment[] = [];
  if (typeof parseVtt === "function" && trimmed.startsWith("WEBVTT")) {
    segments = parseVtt(content);
  } else if (typeof parseSrt === "function" && /^\d+\s*\n\d{2}:\d{2}/.test(trimmed)) {
    segments = parseSrt(content);
  }
  return buildSmartCues(segments, false);
}

// ── Draggable FAB ─────────────────────────────────────────────────────────────

function DraggableFab({
  isEnabled,
  onToggle,
  onOpenModal,
}: {
  isEnabled: boolean;
  onToggle: () => void;
  onOpenModal: () => void;
}) {
  const { t } = useTranslation();
  const defaultPos = loadFabPosition() || { right: 24, bottom: 24 };
  const [pos, setPos] = useState(defaultPos);
  const [isDragging, setIsDragging] = useState(false);
  const [showHoverMenu, setShowHoverMenu] = useState(false);

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startRight: number; startBottom: number } | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startRight: pos.right,
      startBottom: pos.bottom,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragStartRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.pointerX;
      const dy = moveEvent.clientY - dragStartRef.current.pointerY;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        setIsDragging(true);
      }

      const newRight = Math.max(4, dragStartRef.current.startRight - dx);
      const newBottom = Math.max(4, dragStartRef.current.startBottom - dy);
      setPos({ right: newRight, bottom: newBottom });
      saveFabPosition(newRight, newBottom);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      if (dragStartRef.current) {
        const dx = upEvent.clientX - dragStartRef.current.pointerX;
        const dy = upEvent.clientY - dragStartRef.current.pointerY;

        if (Math.hypot(dx, dy) <= 5) {
          onToggle();
        }
      }
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setShowHoverMenu(true);
  };

  const handleMouseLeave = () => {
    hideTimeoutRef.current = window.setTimeout(() => {
      setShowHoverMenu(false);
    }, 280);
  };

  return (
    <div
      style={{
        position: "fixed",
        right: `${pos.right}px`,
        bottom: `${pos.bottom}px`,
        zIndex: 2147483647,
        pointerEvents: "auto",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onPointerDown={handlePointerDown}
        title={isEnabled ? "Hakkutsu active — click to toggle" : "Click to enable Hakkutsu subtitles"}
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: isEnabled ? "rgba(20, 20, 26, 0.88)" : "rgba(30, 30, 35, 0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: isEnabled ? "1.5px solid rgba(192, 132, 252, 0.6)" : "1.5px solid rgba(255, 255, 255, 0.2)",
          boxShadow: isDragging
            ? "0 10px 28px rgba(168, 85, 247, 0.5), 0 0 0 2px rgba(192, 132, 252, 0.8)"
            : "0 6px 20px rgba(0, 0, 0, 0.6), 0 0 12px rgba(168, 85, 247, 0.2)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
          transition: isDragging ? "none" : "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
          transform: isDragging ? "scale(1.1)" : "scale(1)",
        }}
      >
        <span
          style={{
            color: isEnabled ? "#c084fc" : "#a1a1aa",
            fontWeight: 900,
            fontSize: "18px",
            lineHeight: 1,
            pointerEvents: "none",
          }}
        >
          発
        </span>
      </button>

      {showHoverMenu && !isDragging && (
        <div
          style={{
            position: "absolute",
            bottom: "52px",
            right: "0",
            width: "224px",
            background: "rgba(18, 18, 22, 0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "12px",
            boxShadow: "0 16px 36px rgba(0,0,0,0.85)",
            color: "#f4f4f5",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            zIndex: 2147483647,
            pointerEvents: "auto",
          }}
          onMouseEnter={() => {
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px", color: "#fff" }}>
              <span style={{ color: "#c084fc", fontWeight: 900, fontSize: "16px" }}>発</span>
              <span>{t("shortcut_manual_title")}</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowHoverMenu(false);
                onOpenModal();
              }}
              style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px", background: "rgba(168,85,247,0.25)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc", cursor: "pointer" }}
            >
              {t("shortcut_btn_settings")}
            </button>
          </div>

          <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>{t("shortcut_seek_cue")}</span>
              <div style={{ display: "flex", gap: "4px" }}>
                <kbd style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>A</kbd>
                <kbd style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>D</kbd>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>{t("shortcut_toggle_autopause")}</span>
              <kbd style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>E</kbd>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>{t("shortcut_toggle_furigana")}</span>
              <div style={{ display: "flex", gap: "4px" }}>
                <kbd style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>F</kbd>
                <kbd style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>W</kbd>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>{t("shortcut_toggle_translation")}</span>
              <kbd style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>V</kbd>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function GenericSubtitlesOverlay() {
  if (
    typeof window !== "undefined" &&
    (location.hostname.includes("netflix.com") || location.hostname.includes("youtube.com"))
  ) {
    return null;
  }

  const { settings, updateSettings } = useSettingsStore();

  // Per-site enable state — starts false until we check storage
  const [siteEnabled, setSiteEnabled_] = useState(false);
  const [siteChecked, setSiteChecked] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);

  const [isEnabled, setIsEnabled] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const hasActiveTextTrackRef = useRef(false);
  const lastDomTextRef = useRef("");

  // ── Inject CSS to hide raw player subtitles ─────────────────────────────────

  useEffect(() => {
    injectGenericGlobalStyle(isEnabled);
    return () => injectGenericGlobalStyle(false);
  }, [isEnabled]);

  // ── Helper to find DOM subtitle text from third-party players ───────────────

  const findSubtitleText = useCallback((): string => {
    const selectors = [
      ".jw-text-track-display",
      ".vjs-text-track-display",
      ".shaka-text-container",
      ".art-subtitles",
      ".plyr__captions",
      ".subtitle-container",
      ".video-js .vjs-text-track-display",
      "[class*='subtitle-text' i]",
      "[class*='caption-text' i]",
      "[class*='timedtext' i]",
      "[class*='player-subtitle' i]",
      "[class*='subtitle-layer' i]",
      "[class*='subtitles-overlay' i]",
      "[class*='subtitle' i]",
      "[class*='caption' i]",
    ];

    let fallbackText = "";

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (
          el.closest("#hakkutsu-generic-subtitles-host") ||
          el.closest(".hk-sub__container") ||
          el.closest("button") ||
          el.closest("[role='menu']") ||
          el.closest("[role='menuitem']") ||
          el.closest("[role='button']") ||
          el.closest("[class*='menu' i]") ||
          el.closest("[class*='control' i]") ||
          el.closest("[class*='select' i]") ||
          el.closest("[class*='dropdown' i]") ||
          el.closest("[class*='option' i]")
        ) {
          continue;
        }

        const spans = el.querySelectorAll("span, div, p");
        let text = "";
        if (spans.length > 0) {
          text = Array.from(spans)
            .map((s) => s.textContent?.trim() || "")
            .filter(Boolean)
            .join(" ")
            .trim();
        } else {
          text = el.textContent?.trim() || "";
        }

        if (text) {
          if (containsJapanese(text)) return text;
          if (!fallbackText) fallbackText = text;
        }
      }
    }

    return fallbackText;
  }, []);

  // ── Check for a video element on this page ────────────────────────────────

  useEffect(() => {
    const checkVideo = () => {
      const vid = document.querySelector<HTMLVideoElement>("video");
      if (vid) {
        videoRef.current = vid;
        setHasVideo(true);
      }
    };
    checkVideo();
    const interval = setInterval(checkVideo, 1500);
    return () => clearInterval(interval);
  }, []);

  // ── Load per-site opt-in from chrome.storage.local ────────────────────────

  useEffect(() => {
    isSiteEnabled().then((enabled) => {
      setSiteEnabled_(enabled);
      setIsEnabled(enabled && settings.subtitlesEnabled !== false);
      setSiteChecked(true);
    });
  }, []);

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(() => {
    setSiteEnabled_((prev) => {
      const next = !prev;
      setSiteEnabled(next);
      setIsEnabled(next && settings.subtitlesEnabled !== false);
      return next;
    });
  }, [settings.subtitlesEnabled]);

  // ── Read <track> elements when enabled ────────────────────────────────────

  const handleSelectPrimaryTrack = useCallback(async (track: SubtitleTrackOption) => {
    setCurrentTrackId(track.id);
    if (track.fetchResult) {
      setSubtitleData(track.fetchResult);
      return;
    }
    try {
      setLoading(true);
      const segments = await fetchTrackContent(track);
      setSubtitleData({
        videoId: "generic",
        language: track.languageCode,
        trackName: track.name,
        segments,
        fullText: segments.map((s) => s.text).join(" "),
        isAutoGenerated: false,
        source: "player",
      });
      setError(null);
    } catch {
      setError("Failed to load subtitle track");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectSecondaryTrack = useCallback(async (track: SubtitleTrackOption | null) => {
    if (!track) {
      setSecondaryTrackId("");
      setSecondaryData(null);
      return;
    }
    setSecondaryTrackId(track.id);
    if (track.fetchResult) {
      setSecondaryData(track.fetchResult);
      return;
    }
    try {
      const segments = await fetchTrackContent(track);
      setSecondaryData({
        videoId: "generic",
        language: track.languageCode,
        trackName: track.name,
        segments,
        fullText: segments.map((s) => s.text).join(" "),
        isAutoGenerated: false,
        source: "player",
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!isEnabled || !videoRef.current) return;

    const video = videoRef.current;
    const scan = () => {
      const tracks = readVideoTrackElements(video);
      if (tracks.length > 0) {
        setAvailableTracks((prev) => {
          const map = new Map(prev.map((t) => [t.id, t]));
          for (const t of tracks) {
            if (!map.has(t.id)) map.set(t.id, t);
          }
          return Array.from(map.values());
        });

        if (!currentTrackId) {
          const ja = tracks.find((t) => t.languageCode.startsWith("ja"));
          if (ja) {
            handleSelectPrimaryTrack(ja);
          } else if (tracks.length > 0 && !secondaryTrackId) {
            // Auto-select native non-Japanese track as secondary
            const nonJa = tracks.find((t) => !t.languageCode.startsWith("ja"));
            if (nonJa) {
              handleSelectSecondaryTrack(nonJa);
            }
          }
        }
      }
    };

    scan();
    const interval = setInterval(scan, 3000);
    const observer = new MutationObserver(scan);
    observer.observe(video, { childList: true, subtree: true });

    return () => {
      clearInterval(interval);
      observer.disconnect();
    };
  }, [isEnabled, currentTrackId, secondaryTrackId, handleSelectPrimaryTrack, handleSelectSecondaryTrack]);

  // ── Frame sync loop & Live TextTrack Cue Extraction ─────────────────────

  const getLiveTextTrackCue = useCallback(
    (video: HTMLVideoElement): { primary: SubtitleSegment | null; secondary: SubtitleSegment | null } => {
      if (!video.textTracks || video.textTracks.length === 0) {
        return { primary: null, secondary: null };
      }

      let primaryCue: SubtitleSegment | null = null;
      let secondaryCue: SubtitleSegment | null = null;

      for (let i = 0; i < video.textTracks.length; i++) {
        const tt = video.textTracks[i];
        if (tt.kind !== "subtitles" && tt.kind !== "captions") continue;

        // Hide native UI rendering while keeping activeCues firing
        if (tt.mode === "showing" || tt.mode === "disabled") {
          try {
            tt.mode = "hidden";
          } catch {}
        }

        const lang = tt.language || "";
        const label = tt.label || "";
        const trackId = `track-${i}-${lang}-${label}`;
        const isJa = lang.startsWith("ja") || /ja|jp|japanese/i.test(label);

        const isSelectedPrimary = currentTrackId
          ? currentTrackId === trackId || currentTrackId.includes(label) || currentTrackId.includes(lang)
          : isJa;
        const isSelectedSecondary = secondaryTrackId && secondaryTrackId !== "__auto_translate__"
          ? secondaryTrackId === trackId || secondaryTrackId.includes(label) || secondaryTrackId.includes(lang)
          : !isSelectedPrimary && !isJa;

        const activeCues = tt.activeCues;
        if (activeCues && activeCues.length > 0) {
          let text = "";
          let start = 0;
          let end = 0;
          for (let j = 0; j < activeCues.length; j++) {
            const cue = activeCues[j] as any;
            if (cue.text) {
              const cleaned = String(cue.text).replace(/<[^>]*>/g, "").trim();
              if (cleaned) {
                text += (text ? "\n" : "") + cleaned;
                start = cue.startTime;
                end = cue.endTime;
              }
            }
          }
          if (text) {
            const seg: SubtitleSegment = { text, start, duration: Math.max(2, end - start) };
            if (isSelectedPrimary && !primaryCue) {
              primaryCue = seg;
            } else if (isSelectedSecondary && !secondaryCue) {
              secondaryCue = seg;
            } else if (!primaryCue) {
              primaryCue = seg;
            }
          }
        }
      }

      return { primary: primaryCue, secondary: secondaryCue };
    },
    [currentTrackId, secondaryTrackId]
  );

  useEffect(() => {
    if (!isEnabled) {
      setCurrentSegment(null);
      setSecondarySegment(null);
      hasActiveTextTrackRef.current = false;
      lastDomTextRef.current = "";
      return;
    }

    const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
    if (!video) return;
    videoRef.current = video;

    const syncCues = () => {
      const adjustedTime = video.currentTime - offset;

      if (subtitleData?.segments?.length) {
        setCurrentSegment(findSmartCue(subtitleData.segments, adjustedTime));
      } else {
        const liveCues = getLiveTextTrackCue(video);
        if (liveCues.primary) {
          hasActiveTextTrackRef.current = true;
          setCurrentSegment(liveCues.primary);
        } else if (hasActiveTextTrackRef.current) {
          setCurrentSegment(null);
        } else {
          // DOM subtitle scanning fallback for third-party players
          const domText = findSubtitleText();
          if (domText) {
            if (domText !== lastDomTextRef.current) {
              lastDomTextRef.current = domText;
              setCurrentSegment({
                start: adjustedTime,
                duration: 4,
                text: domText,
              });
            }
          } else if (lastDomTextRef.current) {
            lastDomTextRef.current = "";
            setCurrentSegment(null);
          }
        }
      }

      if (secondaryData?.segments?.length) {
        setSecondarySegment(findSmartCue(secondaryData.segments, adjustedTime));
      } else {
        const liveCues = getLiveTextTrackCue(video);
        if (liveCues.secondary) {
          setSecondarySegment(liveCues.secondary);
        } else {
          setSecondarySegment(null);
        }
      }
    };

    syncCues();
    let running = true;
    const tick = () => {
      if (!running) return;
      syncCues();
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    video.addEventListener("seeked", syncCues);
    video.addEventListener("timeupdate", syncCues);

    return () => {
      running = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      video.removeEventListener("seeked", syncCues);
      video.removeEventListener("timeupdate", syncCues);
    };
  }, [isEnabled, subtitleData, secondaryData, offset, getLiveTextTrackCue, findSubtitleText]);

  // ── DOM MutationObserver Fallback for Third-Party Players ──────────────────

  useEffect(() => {
    if (!isEnabled || subtitleData) return;

    const target = document.body;
    if (!target) return;

    const observer = new MutationObserver(() => {
      if (subtitleData) return;

      const video = videoRef.current || document.querySelector<HTMLVideoElement>("video");
      if (video && getLiveTextTrackCue(video).primary) return;

      const text = findSubtitleText();
      if (text && text !== lastDomTextRef.current) {
        lastDomTextRef.current = text;
        const now = video?.currentTime || 0;
        setCurrentSegment({
          start: now,
          duration: 4,
          text,
        });
      } else if (!text && lastDomTextRef.current !== "") {
        lastDomTextRef.current = "";
        setCurrentSegment(null);
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [isEnabled, subtitleData, getLiveTextTrackCue, findSubtitleText]);

  const handleCustomSubtitleLoaded = useCallback((result: SubtitleFetchResult) => {
    const option: SubtitleTrackOption = {
      id: `custom-${Date.now()}`,
      name: result.trackName || "Custom Subtitles",
      languageCode: result.language || "ja",
      fetchResult: result,
    };
    setAvailableTracks((prev) => [option, ...prev]);
    setCurrentTrackId(option.id);
    setSubtitleData(result);

    if (!secondaryTrackId && availableTracks.length > 0) {
      const nonJaTrack = availableTracks.find((t) => !t.languageCode.startsWith("ja"));
      if (nonJaTrack) {
        handleSelectSecondaryTrack(nonJaTrack);
      }
    }
  }, [secondaryTrackId, availableTracks, handleSelectSecondaryTrack]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!hasVideo || !siteChecked) return null;

  return (
    <>
      <DraggableFab
        isEnabled={siteEnabled}
        onToggle={handleToggle}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {isEnabled && (
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
            videoTitle={document.title}
            availableTracks={availableTracks}
            currentTrackId={currentTrackId}
            secondaryTrackId={secondaryTrackId}
            offset={offset}
            onToggleEnabled={handleToggle}
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
            videoTitle={document.title}
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
      )}
    </>
  );
}
