/**
 * Universal Subtitles — Content Script Overlay for all third-party media players.
 *
 * Injects a floating interactive subtitle overlay on any HTML5 <video> element
 * across the web (streaming sites, anime sites, online courses, etc.).
 * Supports auto-detecting embedded Japanese tracks, drag-and-drop SRT/VTT/ASS files,
 * timing synchronization, and asbplayer-inspired navigation.
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
import { parseTextTrack } from "~lib/services/subtitle-parsers";
import { findSmartCue, smartCueEnd } from "~lib/services/smart-cue";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: [
    "*://*.youtube.com/*",
    "*://*.netflix.com/*",
  ],
  all_frames: true,
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.body || document.documentElement;

export const getShadowHostId = () => "hakkutsu-universal-subtitles-host";

export const mountShadowHost: PlasmoMountShadowHost = async ({
  shadowHost,
  mountState,
}) => {
  const host = shadowHost as HTMLElement;
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    display: "block",
    overflow: "hidden",
    zIndex: "2147483640",
    pointerEvents: "none",
  });

  if (!document.body.contains(host)) {
    document.body.appendChild(host);
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
};

import cssText from "data-text:~style.css";

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + youtubeSubtitleCss + youtubeToolbarCss;
  return style;
};

const UniversalSubtitles = () => {
  const [subtitleData, setSubtitleData] = useState<SubtitleFetchResult | null>(null);
  const [availableTracks, setAvailableTracks] = useState<SubtitleTrackOption[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string>("");
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [isEnabled, setIsEnabled] = useState(true);
  const [hasVideo, setHasVideo] = useState(false);
  const [offset, setOffset] = useState(0);
  const [autoPause, setAutoPause] = useState(false);
  const { settings } = useSettingsStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentSegmentRef = useRef<SubtitleSegment | null>(null);

  // ── Video Element Discovery ───────────────────────────────────────────

  useEffect(() => {
    const findVideo = () => {
      const video = document.querySelector("video");
      if (video && video !== videoRef.current) {
        videoRef.current = video;
        setHasVideo(true);

        // Check for embedded text tracks
        if (video.textTracks && video.textTracks.length > 0) {
          const trackOptions: SubtitleTrackOption[] = [];
          for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            const name = track.label || track.language || `Track ${i + 1}`;
            trackOptions.push({
              id: `text_track_${i}`,
              name,
              languageCode: track.language || "ja",
              rawTrack: track,
            });
          }
          setAvailableTracks(trackOptions);

          if (settings.autoFetchJapaneseSubtitles !== false) {
            for (let i = 0; i < video.textTracks.length; i++) {
              const track = video.textTracks[i];
              const lang = (track.language || "").toLowerCase();
              const label = (track.label || "").toLowerCase();

              if (
                lang.startsWith("ja") ||
                lang === "jpn" ||
                label.includes("japanese") ||
                label.includes("日本語")
              ) {
                track.mode = "hidden";
                const segments = parseTextTrack(track);
                if (segments.length > 0) {
                  setSubtitleData({
                    videoId: window.location.href,
                    language: "ja",
                    trackName: track.label || "Embedded Japanese Subtitles",
                    segments,
                    fullText: segments.map((s) => s.text).join(" "),
                    isAutoGenerated: false,
                    source: "text_track",
                  });
                  setCurrentTrackId(`text_track_${i}`);
                  break;
                }
              }
            }
          }
        }
      }
    };

    findVideo();
    const interval = setInterval(findVideo, 1000);
    return () => clearInterval(interval);
  }, [settings.autoFetchJapaneseSubtitles]);

  // ── Time Sync & Auto Pause ────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled || !subtitleData || !videoRef.current) return;

    const video = videoRef.current;

    const tick = () => {
      if (!video.paused && subtitleData) {
        const adjustedTime = video.currentTime - offset;
        const segment = findSmartCue(subtitleData.segments, adjustedTime);

        if (segment !== currentSegmentRef.current) {
          // Auto Pause logic
          if (autoPause && currentSegmentRef.current) {
            const previousIndex = subtitleData.segments.indexOf(
              currentSegmentRef.current
            );
            const prevEnd = smartCueEnd(
              subtitleData.segments,
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
      rafIdRef.current = requestAnimationFrame(tick);
    };

    const handleSeeked = () => {
      const adjustedTime = video.currentTime - offset;
      const segment = findSmartCue(subtitleData.segments, adjustedTime);
      currentSegmentRef.current = segment;
      setCurrentSegment(segment);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    video.addEventListener("seeked", handleSeeked);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [isEnabled, subtitleData, autoPause, offset]);

  const handleSettingsChange = useCallback((newSettings: SubtitleSettings) => {
    setAutoPause(newSettings.autoPause);
  }, []);

  const handleLoadCustomSubtitles = useCallback((result: SubtitleFetchResult) => {
    setSubtitleData(result);
    setCurrentTrackId(result.trackName);
    setIsEnabled(true);
  }, []);

  const handleUnloadCustomSubtitles = useCallback(() => {
    setSubtitleData(null);
    setCurrentSegment(null);
  }, []);

  const handleSelectTrack = useCallback((track: SubtitleTrackOption) => {
    if (track.rawTrack && track.rawTrack instanceof TextTrack) {
      track.rawTrack.mode = "hidden";
      const segments = parseTextTrack(track.rawTrack);
      if (segments.length > 0) {
        setSubtitleData({
          videoId: window.location.href,
          language: track.languageCode || "ja",
          trackName: track.name,
          segments,
          fullText: segments.map((s) => s.text).join(" "),
          isAutoGenerated: false,
          source: "text_track",
        });
        setCurrentTrackId(track.id);
      }
    }
  }, []);

  // Do not render if universal video is disabled in settings or no video exists on page
  if (settings.universalVideoEnabled === false || !hasVideo) {
    return null;
  }

  return (
    <SubtitleOverlay
      isEnabled={isEnabled}
      loading={false}
      error={null}
      subtitleData={subtitleData}
      currentSegment={currentSegment}
      videoRef={videoRef}
      currentUrl={window.location.href}
      toolbarContainer={null}
      isFloatingButton={true}
      onToggleEnabled={() => setIsEnabled((prev) => !prev)}
      onSettingsChange={handleSettingsChange}
      offset={offset}
      onOffsetChange={setOffset}
      onLoadCustomSubtitles={handleLoadCustomSubtitles}
      onUnloadCustomSubtitles={handleUnloadCustomSubtitles}
      videoTitle={document.title}
      availableTracks={availableTracks}
      currentTrackId={currentTrackId}
      onSelectTrack={handleSelectTrack}
    />
  );
};

export default UniversalSubtitles;
