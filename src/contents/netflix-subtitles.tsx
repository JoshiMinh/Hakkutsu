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
import type { SubtitleSegment, SubtitleFetchResult } from "~lib/utils/types";
import { youtubeSubtitleCss, youtubeToolbarCss } from "~lib/utils/youtube-subtitle-styles";
import { SubtitleOverlay } from "~components/subtitle-overlay";
import { SelectSubtitlesModal, type SubtitleTrackOption } from "~components/select-subtitles-modal";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";
import {
  parseNetflixTtml,
  readSubtitleFile,
  parsedToSubtitleFetchResult,
  deduplicateCueText,
} from "~lib/services/subtitle-parsers";
import { findSmartCue, buildSmartCues } from "~lib/services/smart-cue";
import { initNetflixPageBridge, type HakkutsuNetflixSyncedData, type HakkutsuNetflixTrack } from "~lib/services/netflix-bridge";

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
    bottom: 110px;
    transition: bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  }

  .watch-video.active .hk-sub__container,
  .watch-video:hover .hk-sub__container,
  .watch-video--bottom-controls-container:hover ~ * .hk-sub__container {
    bottom: 170px;
  }

  .watch-video.inactive .hk-sub__container {
    bottom: 90px;
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

  useEffect(() => {
    setIsEnabled(settings.subtitlesEnabled !== false);
  }, [settings.subtitlesEnabled]);

  useEffect(() => {
    setOffset(settings.subtitlesOffset || 0);
  }, [settings.subtitlesOffset]);

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

      const leafSpans = Array.from(timedTextEl.querySelectorAll("span")).filter(
        (s) => s.children.length === 0 && s.textContent?.trim()
      );
      let rawText = "";
      if (leafSpans.length > 0) {
        rawText = leafSpans.map((s) => s.textContent?.trim() || "").join(" ");
      } else {
        rawText = timedTextEl.textContent?.trim() || "";
      }
      const text = deduplicateCueText(rawText);

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

  // ── Floating Netflix Button Component ─────────────────────────────────────

  useEffect(() => {
    injectNetflixGlobalStyle(isEnabled);
  }, [isEnabled]);

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
      <FloatingNetflixButton
        onOpenModal={() => setIsModalOpen(true)}
        isEnabled={isEnabled}
      />

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

const FloatingNetflixButton: React.FC<{
  onOpenModal: () => void;
  isEnabled: boolean;
}> = ({ onOpenModal, isEnabled }) => {
  const { settings, updateSettings } = useSettingsStore();
  const { t } = useTranslation();

  const pos = settings.netflixBtnPosition || { x: 90, y: 12 };
  const [currentPos, setCurrentPos] = useState(pos);
  const [isDragging, setIsDragging] = useState(false);
  const [showHoverMenu, setShowHoverMenu] = useState(false);

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (settings.netflixBtnPosition) {
      setCurrentPos(settings.netflixBtnPosition);
    }
  }, [settings.netflixBtnPosition]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: currentPos.x,
      startY: currentPos.y,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragStartRef.current) return;
      const player = document.querySelector(".watch-video") || document.querySelector(".VideoContainer") || document.body;
      const rect = player.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const deltaX = moveEvent.clientX - dragStartRef.current.pointerX;
      const deltaY = moveEvent.clientY - dragStartRef.current.pointerY;

      const percentX = (deltaX / rect.width) * 100;
      const percentY = (deltaY / rect.height) * 100;

      const newX = Math.max(2, Math.min(96, dragStartRef.current.startX + percentX));
      const newY = Math.max(2, Math.min(96, dragStartRef.current.startY + percentY));

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        setIsDragging(true);
      }

      setCurrentPos({ x: newX, y: newY });
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      if (dragStartRef.current) {
        const deltaX = upEvent.clientX - dragStartRef.current.pointerX;
        const deltaY = upEvent.clientY - dragStartRef.current.pointerY;

        if (Math.hypot(deltaX, deltaY) > 5) {
          updateSettings({ netflixBtnPosition: currentPos });
        } else {
          onOpenModal();
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
        position: "absolute",
        left: `${currentPos.x}%`,
        top: `${currentPos.y}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 2147483647,
        pointerEvents: "auto",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onPointerDown={handlePointerDown}
        title="Hakkutsu Netflix Control"
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
            top: "52px",
            right: currentPos.x > 50 ? "0" : "auto",
            left: currentPos.x <= 50 ? "0" : "auto",
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

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "6px", marginTop: "2px" }}>
              <span style={{ color: "#a1a1aa" }}>{t("shortcut_word_lookup")}</span>
              <span style={{ color: "#c084fc", fontWeight: 600 }}>{t("shortcut_word_lookup_val")}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#a1a1aa" }}>{t("shortcut_load_subtitles")}</span>
              <span style={{ color: "#c084fc", fontWeight: 600 }}>{t("shortcut_load_subtitles_val")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
