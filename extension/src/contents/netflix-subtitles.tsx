/**
 * Netflix Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the Netflix player.
 * Reads native subtitles from the DOM observer (.player-timedtext),
 * hides native captions cleanly to prevent overlapping,
 * and supports custom external subtitle files (.srt, .vtt, .ass) via drag-and-drop.
 */

import type { PlasmoCSConfig, PlasmoGetOverlayAnchor, PlasmoGetStyle, PlasmoMountShadowHost } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SubtitleSegment, SubtitleFetchResult } from "~lib/types";
import { youtubeSubtitleCss, youtubeToolbarCss } from "~lib/youtube-subtitle-styles";
import { SubtitleOverlay, type SubtitleSettings } from "~components/subtitle-overlay";
import { useSettingsStore } from "~lib/utils/settings";
import { findSmartCue } from "~lib/services/smart-cue";

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
    }, 300);
    setTimeout(() => clearInterval(interval), 15000);
  }
};

import cssText from "data-text:~style.css";

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

const netflixGlobalCss = `
  /* ── Hide ALL possible native Netflix subtitles when Hakkutsu is active ── */
  .watch-video.hk-subs-active .player-timedtext,
  .watch-video.hk-subs-active .player-timedtext *,
  .watch-video.hk-subs-active .timedtext-container,
  .watch-video.hk-subs-active .timedtext-container *,
  .watch-video.hk-subs-active [data-uia*="timedtext"],
  .watch-video.hk-subs-active [data-uia*="timedtext"] *,
  .watch-video.hk-subs-active .ltr-timedtext,
    opacity: 0 !important;
    visibility: hidden !important;
  }

  /* ── Fix alignment of injected button in Netflix control bar ── */
  #hk-toolbar-portal,
  #hk-toolbar-portal.hk-toolbar-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 44px !important;
    min-width: 44px !important;
    height: 44px !important;
    margin: 0 4px !important;
    padding: 0 !important;
    position: relative !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    vertical-align: middle !important;
    z-index: 10 !important;
    flex-shrink: 0 !important;
  }

  #hk-toolbar-portal .hk-toolbar-wrapper {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100% !important;
    height: 100% !important;
  }

  #hk-toolbar-portal .hk-yt-btn {
    width: 38px !important;
    height: 38px !important;
    border-radius: 50% !important;
    background: rgba(255, 255, 255, 0.08) !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    color: #f4f4f5 !important;
    transition: all 0.2s ease !important;
  }

  #hk-toolbar-portal .hk-yt-btn:hover {
    background: rgba(168, 85, 247, 0.3) !important;
    border-color: #a855f7 !important;
    transform: scale(1.05) !important;
  }

  #hk-toolbar-portal .hk-yt-btn.is-active {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(236, 72, 153, 0.4)) !important;
    border-color: #a855f7 !important;
  }

  #hk-toolbar-portal .hk-yt-btn__active-bar {
    display: none !important;
  }

  ${youtubeToolbarCss}
`;

function injectNetflixGlobalStyle(enabled: boolean): void {
  const player = document.querySelector(".watch-video") || document.querySelector(".VideoContainer");
  if (player) {
    if (enabled) {
      player.classList.add("hk-subs-active");
    } else {
      player.classList.remove("hk-subs-active");
    }
  }

  let styleEl = document.getElementById(NETFLIX_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = NETFLIX_STYLE_ID;
    styleEl.textContent = netflixGlobalCss;
    (document.head || document.documentElement).appendChild(styleEl);
  }
}

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

  // ── Inject Global Style & Hide Native Captions ─────────────────────────────
  useEffect(() => {
    injectNetflixGlobalStyle(isEnabled);

    const interval = setInterval(() => {
      const player = document.querySelector(".watch-video") || document.querySelector(".VideoContainer");
      if (player) {
        if (isEnabled && !player.classList.contains("hk-subs-active")) {
          player.classList.add("hk-subs-active");
        } else if (!isEnabled && player.classList.contains("hk-subs-active")) {
          player.classList.remove("hk-subs-active");
        }
      }
    }, 800);

    return () => {
      clearInterval(interval);
      injectNetflixGlobalStyle(false);
    };
  }, [isEnabled]);

  // ── Native Toolbar Injection (Separated from Netflix audio button) ─────────
  useEffect(() => {
    const interval = setInterval(() => {
      const audioSubBtn = document.querySelector('[data-uia="control-audio-subtitle"]');
      const fullscreenBtn = document.querySelector('[data-uia="control-fullscreen"]');
      const speedBtn = document.querySelector('[data-uia="control-playback-speed"]');
      const buttonRow =
        document.querySelector(".PlayerControlsNeo__button-control-row") ||
        audioSubBtn?.closest(".PlayerControlsNeo__button-control-row") ||
        fullscreenBtn?.closest(".PlayerControlsNeo__button-control-row");

      let container = document.getElementById("hk-toolbar-portal");
      if (!container) {
        container = document.createElement("div");
        container.id = "hk-toolbar-portal";
        container.className = "hk-toolbar-btn";
      }

      if (audioSubBtn && audioSubBtn.parentElement) {
        // Insert as sibling right BEFORE audioSubBtn in the row
        if (container.parentElement !== audioSubBtn.parentElement || container.nextElementSibling !== audioSubBtn) {
          audioSubBtn.parentElement.insertBefore(container, audioSubBtn);
          setToolbarContainer(container);
        }
      } else if (speedBtn && speedBtn.parentElement) {
        if (container.parentElement !== speedBtn.parentElement) {
          speedBtn.parentElement.insertBefore(container, speedBtn);
          setToolbarContainer(container);
        }
      } else if (buttonRow) {
        if (!buttonRow.contains(container)) {
          buttonRow.appendChild(container);
          setToolbarContainer(container);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── SPA Navigation ────────────────────────────────────────────────────────
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

  // ── Video Reference ───────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const video = document.querySelector("video");
      if (video) videoRef.current = video;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Custom File Time Sync (if loaded) ─────────────────────────────────────
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

  // ── MutationObserver for Native DOM Subtitles ─────────────────────────────
  useEffect(() => {
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
      videoTitle={document.title.replace(/ - Netflix$/, "")}
    />
  );
};

export default NetflixSubtitles;
