/**
 * Netflix Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the Netflix player.
 * Reads native subtitles from the DOM observer (.player-timedtext) and
 * supports custom external subtitle files (.srt, .vtt, .ass) via drag-and-drop.
 */

import type { PlasmoCSConfig, PlasmoGetOverlayAnchor, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SubtitleSegment, SubtitleFetchResult } from "~lib/types";
import { youtubeSubtitleCss, youtubeToolbarCss } from "~lib/youtube-subtitle-styles";
import { SubtitleOverlay, type SubtitleSettings } from "~components/subtitle-overlay";
import { useSettingsStore } from "~lib/utils/settings";
import { findSmartCue } from "~lib/services/smart-cue";

export const config: PlasmoCSConfig = {
  matches: ["https://www.netflix.com/watch/*"],
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.querySelector(".watch-video");

import cssText from "data-text:~style.css";

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent =
    cssText +
    youtubeSubtitleCss +
    youtubeToolbarCss +
    `
    /* Extra styles for Netflix */
    .hk-subs-active .player-timedtext {
      opacity: 0 !important; /* Hide native subs visually but keep in DOM for observer */
    }
    
    /* Fix alignment and clipping of our injected button in Netflix's control bar */
    #hk-toolbar-portal {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      flex-shrink: 0;
      margin-right: 8px;
      overflow: visible !important;
    }
    
    #hk-toolbar-portal .hk-toolbar-wrapper {
      overflow: visible !important;
      min-width: 48px;
    }
  `;
  return style;
};

const NetflixSubtitles = () => {
  const [customSubtitleData, setCustomSubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [isEnabled, setIsEnabled] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(window.location.href);
  const [toolbarContainer, setToolbarContainer] = useState<Element | null>(null);
  const [offset, setOffset] = useState(0);
  const [autoPause, setAutoPause] = useState(false);
  const { settings } = useSettingsStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // ── Inject Toolbar CSS into Main Document ────────────────────────────
  useEffect(() => {
    let styleEl = document.getElementById("hk-netflix-toolbar-style") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "hk-netflix-toolbar-style";
      styleEl.textContent = youtubeToolbarCss;
      document.head.appendChild(styleEl);
    }
  }, []);

  // ── Native Toolbar Injection ──────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const controls =
        document.querySelector(".PlayerControlsNeo__button-control-row") ||
        document.querySelector('[data-uia="control-fullscreen"]')?.parentElement ||
        document.querySelector('[data-uia="control-audio-subtitle"]')?.parentElement;

      if (controls) {
        let container = document.getElementById("hk-toolbar-portal");
        if (!container || !controls.contains(container)) {
          if (!container) {
            container = document.createElement("div");
            container.id = "hk-toolbar-portal";
            container.className = "hk-toolbar-btn";
          }
          controls.prepend(container);
          setToolbarContainer(container);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── SPA Navigation ──────────────────────────────────────────────────

  useEffect(() => {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (lastUrl.includes("watch")) {
          setCurrentUrl(lastUrl);
          setCurrentSegment(null);
          setCustomSubtitleData(null);
          setOffset(0);
        } else {
          setCurrentSegment(null);
          setCustomSubtitleData(null);
          setIsEnabled(false);
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  // ── Hide Native Captions ─────────────────────────────────────────────

  useEffect(() => {
    const player = document.querySelector(".watch-video");
    if (player) {
      if (isEnabled) {
        player.classList.add("hk-subs-active");
      } else {
        player.classList.remove("hk-subs-active");
      }
    }
  }, [isEnabled]);

  // ── Video Reference ──────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const video = document.querySelector("video");
      if (video) videoRef.current = video;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Track Custom File Sync (if loaded) ───────────────────────────────

  useEffect(() => {
    if (!isEnabled || !customSubtitleData) return;

    const video = document.querySelector("video");
    if (!video) return;
    videoRef.current = video;

    const tick = () => {
      if (!video.paused && customSubtitleData) {
        const adjustedTime = video.currentTime - offset;
        const segment = findSmartCue(customSubtitleData.segments, adjustedTime);
        setCurrentSegment(segment);
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    const handleSeeked = () => {
      const adjustedTime = video.currentTime - offset;
      const segment = findSmartCue(customSubtitleData.segments, adjustedTime);
      setCurrentSegment(segment);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    video.addEventListener("seeked", handleSeeked);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [isEnabled, customSubtitleData, offset]);

  // ── MutationObserver for Native DOM Subtitles ────────────────────────

  useEffect(() => {
    // If user loaded a custom file, skip DOM scraping
    if (!isEnabled || customSubtitleData) return;

    let lastText = "";
    const observeTarget = document.querySelector(".watch-video") || document.body;
    if (!observeTarget) return;

    const observer = new MutationObserver(() => {
      if (customSubtitleData) return;

      const timedTextElement = document.querySelector(".player-timedtext");
      if (!timedTextElement) {
        if (lastText !== "") {
          lastText = "";
          setCurrentSegment(null);
        }
        return;
      }

      let text = "";
      const spans = timedTextElement.querySelectorAll("span");
      if (spans.length > 0) {
        const textParts: string[] = [];
        spans.forEach((span) => {
          const content = (span as HTMLElement).innerText?.trim() || span.textContent?.trim() || "";
          if (content) {
            textParts.push(content);
          }
        });
        text = textParts.join(" ").replace(/\n/g, " ").trim();
      } else {
        text = ((timedTextElement as HTMLElement).innerText || timedTextElement.textContent || "")
          .replace(/\n/g, " ")
          .trim();
      }

      if (text !== lastText) {
        lastText = text;
        if (text) {
          const video = document.querySelector("video");
          const currentTime = video ? video.currentTime : 0;

          setCurrentSegment({
            text,
            start: currentTime,
            duration: 2,
          });
        } else {
          setCurrentSegment(null);
        }
      }
    });

    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [isEnabled, customSubtitleData]);

  const handleSettingsChange = useCallback((newSettings: SubtitleSettings) => {
    setAutoPause(newSettings.autoPause);
  }, []);

  const handleLoadCustomSubtitles = useCallback((result: SubtitleFetchResult) => {
    setCustomSubtitleData(result);
    setIsEnabled(true);
  }, []);

  const handleUnloadCustomSubtitles = useCallback(() => {
    setCustomSubtitleData(null);
    setCurrentSegment(null);
  }, []);

  return (
    <SubtitleOverlay
      isEnabled={isEnabled}
      loading={false}
      error={null}
      subtitleData={customSubtitleData}
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
    />
  );
};

export default NetflixSubtitles;
