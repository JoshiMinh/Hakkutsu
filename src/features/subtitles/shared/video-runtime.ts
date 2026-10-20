function videoScore(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  const usable = video.isConnected && (video.currentSrc || video.src || video.querySelector("source[src]") || video.readyState > 0 || area > 0);
  if (!usable) return -1;
  return (!video.paused && !video.ended ? 1_000_000_000 : 0)
    + (video.readyState >= 1 ? 100_000_000 : 0) + area;
}

/** Measure each candidate once; caption/UI mutations do not trigger player scans. */
export function findPrimaryVideo(root: ParentNode = document): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null, bestScore = -1;
  for (const video of root.querySelectorAll<HTMLVideoElement>("video")) {
    const score = videoScore(video);
    if (score > bestScore) { best = video; bestScore = score; }
  }
  return best;
}

export function observePrimaryVideo(onChange: (video: HTMLVideoElement | null) => void, root: ParentNode = document): () => void {
  let current: HTMLVideoElement | null | undefined;
  let scheduled = false, stopped = false;
  const scan = () => {
    scheduled = false;
    if (stopped) return;
    const next = findPrimaryVideo(root);
    if (next !== current) { current = next; onChange(next); }
  };
  const scheduleScan = () => {
    if (!scheduled && !stopped) { scheduled = true; queueMicrotask(scan); }
  };
  const hasMedia = (node: Node) => node.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).matches("video, source") || !!(node as Element).querySelector("video"));
  const observer = new MutationObserver(records => {
    if ((current && !current.isConnected) || records.some(record => record.type === "attributes"
      ? (record.target as Element).matches("video, source")
      : [...record.addedNodes, ...record.removedNodes].some(hasMedia))) scheduleScan();
  });
  observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  const events = ["play", "pause", "ended", "loadedmetadata"];
  const mediaEvent = (event: Event) => {
    if (event.target instanceof HTMLVideoElement && (root === document || (root as Node).contains(event.target))) scheduleScan();
  };
  for (const event of events) document.addEventListener(event, mediaEvent, true);
  scan();
  return () => {
    stopped = true; observer.disconnect();
    for (const event of events) document.removeEventListener(event, mediaEvent, true);
  };
}

interface VideoClock {
  listeners: Set<() => void>;
  dispose: () => void;
}
const videoClocks = new WeakMap<HTMLVideoElement, VideoClock>();

/** A single frame callback and event listener set shared by every video consumer. */
function createVideoClock(video: HTMLVideoElement): VideoClock {
  const listeners = new Set<() => void>();
  let frame: number | null = null, timer: number | null = null;
  let stopped = false, lastTime = NaN;
  const notify = (force = false) => {
    const time = video.currentTime;
    if (!force && time === lastTime) return;
    lastTime = time;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  };
  const cancel = () => {
    if (frame !== null) video.cancelVideoFrameCallback(frame);
    if (timer !== null) window.clearTimeout(timer);
    frame = null; timer = null;
  };
  const schedule = () => {
    if (stopped || frame !== null || timer !== null || video.paused || video.ended) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      frame = video.requestVideoFrameCallback(() => { frame = null; notify(); schedule(); });
    } else timer = window.setTimeout(() => { timer = null; notify(); schedule(); }, 125);
  };
  const play = () => { notify(true); schedule(); };
  const stop = () => { cancel(); notify(true); };
  const tick = () => notify();
  const force = () => notify(true);
  const bindings: Array<[string, () => void]> = [["play", play], ["playing", play], ["pause", stop], ["ended", stop],
    ["timeupdate", tick], ["seeked", force], ["ratechange", force], ["loadedmetadata", force]];
  for (const [event, listener] of bindings) video.addEventListener(event, listener);
  schedule();
  return { listeners, dispose() {
    stopped = true; cancel();
    for (const [event, listener] of bindings) video.removeEventListener(event, listener);
    videoClocks.delete(video);
  } };
}

export function subscribeToVideoTime(video: HTMLVideoElement, onTime: () => void): () => void {
  let clock = videoClocks.get(video);
  if (!clock) { clock = createVideoClock(video); videoClocks.set(video, clock); }
  // Each subscription owns its wrapper, even if callers reuse a function.
  const listener = () => onTime();
  clock.listeners.add(listener);
  listener();
  const current = clock;
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) current.dispose();
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

