function isUsableVideo(video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect();
  return (
    video.isConnected &&
    (video.currentSrc.length > 0 || video.readyState > HTMLMediaElement.HAVE_NOTHING || rect.width > 0 || rect.height > 0)
  );
}

function videoScore(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const visibleArea = Math.max(0, rect.width) * Math.max(0, rect.height);
  const playingBonus = !video.paused && !video.ended ? 1_000_000_000 : 0;
  const readyBonus = video.readyState >= HTMLMediaElement.HAVE_METADATA ? 100_000_000 : 0;
  return playingBonus + readyBonus + visibleArea;
}

/** Pick the active/visible player instead of whichever video happens to be first in the DOM. */
export function findPrimaryVideo(root: ParentNode = document): HTMLVideoElement | null {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>("video")).filter(isUsableVideo);
  if (videos.length === 0) return null;
  return videos.reduce((best, video) => (videoScore(video) > videoScore(best) ? video : best));
}

/**
 * Observe SPA player replacement without a permanent polling timer. Media events
 * also re-evaluate the preferred player when a page keeps multiple videos mounted.
 */
export function observePrimaryVideo(
  onChange: (video: HTMLVideoElement | null) => void,
  root: ParentNode = document
): () => void {
  let current: HTMLVideoElement | null | undefined;
  let scheduled = false;

  const scan = () => {
    scheduled = false;
    const next = findPrimaryVideo(root);
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };
  const scheduleScan = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(root === document ? document.documentElement : root, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("play", scheduleScan, true);
  document.addEventListener("loadedmetadata", scheduleScan, true);
  scan();

  return () => {
    observer.disconnect();
    document.removeEventListener("play", scheduleScan, true);
    document.removeEventListener("loadedmetadata", scheduleScan, true);
  };
}

/**
 * Drive subtitle updates from decoded video frames. The timeout fallback is used
 * only by browsers/players without requestVideoFrameCallback.
 */
export function subscribeToVideoTime(video: HTMLVideoElement, onTime: () => void): () => void {
  const frameVideo = video;
  let frameHandle: number | null = null;
  let fallbackTimer: number | null = null;
  let stopped = false;

  const cancelScheduledTick = () => {
    if (frameHandle !== null) {
      frameVideo.cancelVideoFrameCallback(frameHandle);
    }
    frameHandle = null;
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };

  const scheduleTick = () => {
    cancelScheduledTick();
    if (stopped || video.paused || video.ended) return;
    if (typeof frameVideo.requestVideoFrameCallback === "function") {
      frameHandle = frameVideo.requestVideoFrameCallback(() => {
        frameHandle = null;
        onTime();
        scheduleTick();
      });
    } else {
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        onTime();
        scheduleTick();
      }, 125);
    }
  };

  const handlePlay = () => {
    onTime();
    scheduleTick();
  };
  const handleStop = () => {
    onTime();
    cancelScheduledTick();
  };

  onTime();
  video.addEventListener("play", handlePlay);
  video.addEventListener("playing", handlePlay);
  video.addEventListener("pause", handleStop);
  video.addEventListener("ended", handleStop);
  video.addEventListener("seeked", onTime);
  video.addEventListener("loadedmetadata", onTime);
  if (!video.paused) scheduleTick();

  return () => {
    stopped = true;
    cancelScheduledTick();
    video.removeEventListener("play", handlePlay);
    video.removeEventListener("playing", handlePlay);
    video.removeEventListener("pause", handleStop);
    video.removeEventListener("ended", handleStop);
    video.removeEventListener("seeked", onTime);
    video.removeEventListener("loadedmetadata", onTime);
  };
}

/**
 * Track immersion seconds during active video playback.
 * Sends TRACK_VIDEO_IMMERSION messages periodically (every 10s of active playback and on pause/unload).
 */
export function trackVideoImmersion(video: HTMLVideoElement): () => void {
  let accumulatedSeconds = 0;
  let lastTimestamp = Date.now();
  let intervalTimer: number | null = null;

  const flush = () => {
    if (accumulatedSeconds >= 1 && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      const secondsToSend = Math.floor(accumulatedSeconds);
      accumulatedSeconds -= secondsToSend;
      chrome.runtime.sendMessage({
        type: "TRACK_VIDEO_IMMERSION",
        payload: { seconds: secondsToSend },
      }).catch(() => {});
    }
  };

  const startTracking = () => {
    lastTimestamp = Date.now();
    if (intervalTimer !== null) clearInterval(intervalTimer);
    intervalTimer = window.setInterval(() => {
      if (!video.paused && !video.ended && video.isConnected) {
        const now = Date.now();
        const deltaSec = (now - lastTimestamp) / 1000;
        lastTimestamp = now;
        if (deltaSec > 0 && deltaSec < 30) {
          accumulatedSeconds += deltaSec;
          if (accumulatedSeconds >= 10) {
            flush();
          }
        }
      } else {
        lastTimestamp = Date.now();
      }
    }, 5000);
  };

  const stopTracking = () => {
    if (!video.paused && !video.ended) {
      const now = Date.now();
      const deltaSec = (now - lastTimestamp) / 1000;
      if (deltaSec > 0 && deltaSec < 30) {
        accumulatedSeconds += deltaSec;
      }
    }
    flush();
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };

  video.addEventListener("play", startTracking);
  video.addEventListener("playing", startTracking);
  video.addEventListener("pause", stopTracking);
  video.addEventListener("ended", stopTracking);
  window.addEventListener("beforeunload", flush);

  if (!video.paused && !video.ended) {
    startTracking();
  }

  return () => {
    stopTracking();
    video.removeEventListener("play", startTracking);
    video.removeEventListener("playing", startTracking);
    video.removeEventListener("pause", stopTracking);
    video.removeEventListener("ended", stopTracking);
    window.removeEventListener("beforeunload", flush);
  };
}

