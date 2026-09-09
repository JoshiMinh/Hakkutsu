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
