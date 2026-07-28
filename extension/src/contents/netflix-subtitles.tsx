/**
 * Netflix Subtitles — Content Script Overlay
 *
 * Injects an interactive subtitle overlay into the Netflix player.
 * Since Netflix doesn't easily expose the full subtitle track in a predictable format,
 * this implementation uses a MutationObserver to read the currently displayed
 * native subtitle from the DOM.
 */

import type { PlasmoCSConfig, PlasmoGetOverlayAnchor, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SubtitleSegment } from "~types";
import { youtubeSubtitleCss, youtubeToolbarCss } from "./youtube-subtitle-styles"; // We can reuse the same CSS
import { SubtitleOverlay, type SubtitleSettings } from "~components/subtitle-overlay";

export const config: PlasmoCSConfig = {
  matches: ["https://www.netflix.com/watch/*"],
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.querySelector(".watch-video");

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = youtubeSubtitleCss + youtubeToolbarCss + `
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
    
    /* Override Netflix focus styles that might cause issues */
    #hk-toolbar-portal button {
      box-sizing: content-box;
    }
  `;
  return style;
};

const NetflixSubtitles = () => {
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(window.location.href);
  const [toolbarContainer, setToolbarContainer] = useState<Element | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ── Native Toolbar Injection ──────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      // Try multiple selectors for resilience: Netflix bottom right controls
      const controls = document.querySelector(".PlayerControlsNeo__button-control-row") 
                    || document.querySelector('[data-uia="control-fullscreen"]')?.parentElement
                    || document.querySelector('[data-uia="control-audio-subtitle"]')?.parentElement;
                    
      if (controls) {
        let container = document.getElementById("hk-toolbar-portal");
        if (!container) {
          container = document.createElement("div");
          container.id = "hk-toolbar-portal";
          container.className = "hk-toolbar-btn";
          // Insert it near the subtitle button
          controls.prepend(container);
        }
        if (toolbarContainer !== container) {
          setToolbarContainer(container);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [toolbarContainer]);

  // ── SPA Navigation ──────────────────────────────────────────────────

  useEffect(() => {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (lastUrl.includes("watch")) {
          setCurrentUrl(lastUrl);
          setCurrentSegment(null);
        } else {
          setCurrentSegment(null);
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

  // ── MutationObserver for DOM Subtitles ───────────────────────────────

  useEffect(() => {
    if (!isEnabled) return;

    const tickInterval = setInterval(() => {
      const video = document.querySelector("video");
      if (video) videoRef.current = video;
    }, 1000);

    let lastText = "";
    
    // Netflix renders subtitles in .player-timedtext > .player-timedtext-text-container
    const observeTarget = document.querySelector(".watch-video");
    if (!observeTarget) return;

    const observer = new MutationObserver(() => {
      const timedTextElement = document.querySelector(".player-timedtext");
      if (!timedTextElement) {
        if (lastText !== "") {
          lastText = "";
          setCurrentSegment(null);
        }
        return;
      }

      // Extract text, combining multiple lines
      let text = "";
      const spans = timedTextElement.querySelectorAll("span");
      if (spans.length > 0) {
        const textParts = [];
        spans.forEach(span => {
          // Exclude ruby/rt if Netflix somehow renders them, or just get pure text
          // Sometimes Netflix uses <br>, so innerText is better than textContent
          if (span.innerText.trim()) {
            textParts.push(span.innerText.trim());
          }
        });
        text = textParts.join(" ").replace(/\n/g, " ").trim();
      } else {
        text = (timedTextElement as HTMLElement).innerText.replace(/\n/g, " ").trim();
      }

      if (text !== lastText) {
        lastText = text;
        if (text) {
          const video = document.querySelector("video");
          const currentTime = video ? video.currentTime : 0;
          
          setCurrentSegment({
            text,
            start: currentTime,
            duration: 2 // We don't know the exact duration, but we just need start for the UI key
          });
        } else {
          setCurrentSegment(null);
        }
      }
    });

    observer.observe(observeTarget, { 
      childList: true, 
      subtree: true,
      characterData: true
    });

    return () => {
      clearInterval(tickInterval);
      observer.disconnect();
    };
  }, [isEnabled]);

  return (
    <SubtitleOverlay
      isEnabled={isEnabled}
      loading={false}
      error={null}
      subtitleData={null} // Netflix doesn't support full transcript via DOM scraping
      currentSegment={currentSegment}
      videoRef={videoRef}
      currentUrl={currentUrl}
      toolbarContainer={toolbarContainer}
      onToggleEnabled={() => setIsEnabled(prev => !prev)}
    />
  );
};

export default NetflixSubtitles;
