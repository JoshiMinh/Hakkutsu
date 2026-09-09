/**
 * Netflix Page Bridge — runs in Netflix's MAIN world.
 *
 * Adopts ASBPlayer's proven extraction techniques:
 * 1. Inspects window.netflix.appContext.state.playerApp.getAPI().videoPlayer.
 * 2. Traverses cadmiumPlayerRepository state for signed IMSC 1.1 TTML subtitle URLs.
 * 3. Supports lazy track loading by temporarily setting timed text track and reverting.
 * 4. Communicates with Hakkutsu content script via CustomEvents.
 */

export interface HakkutsuNetflixTrack {
  id: string;
  trackId: string;
  label: string;
  language: string;
  bcp47: string;
  url?: string;
  isClosedCaptions: boolean;
}

export interface HakkutsuNetflixSyncedData {
  title: string;
  tracks: HakkutsuNetflixTrack[];
  error?: string;
}

export function runNetflixBridgeMain(): void {
  if ((window as any).__HAKKUTSU_NETFLIX_BRIDGE_INITIALIZED__) return;
  (window as any).__HAKKUTSU_NETFLIX_BRIDGE_INITIALIZED__ = true;
  let lastPublishedSignature = "";

  interface NetflixTrackDef {
    id: string;
    trackId: string;
    label: string;
    language: string;
    bcp47: string;
    url?: string;
    isClosedCaptions: boolean;
  }

  function getNetflixAPI(): any | undefined {
    const netflix = (window as any).netflix;
    return netflix?.appContext?.state?.playerApp?.getAPI?.();
  }

  function getVideoPlayer(): any | undefined {
    return getNetflixAPI()?.videoPlayer;
  }

  function getActivePlayer(): any | undefined {
    const vp = getVideoPlayer();
    if (!vp) return undefined;
    const sessionIds = vp.getAllPlayerSessionIds?.() || [];
    if (sessionIds.length === 0) return undefined;
    const activeSessionId = sessionIds[sessionIds.length - 1];
    return vp.getVideoPlayerBySessionId?.(activeSessionId);
  }

  function findCadmiumTimedTextUrls(): Map<string, string> {
    const urls = new Map<string, string>();
    const vp = getVideoPlayer();
    const sessionIds = vp?.getAllPlayerSessionIds?.() || [];
    if (sessionIds.length === 0) return urls;

    const activeSessionId = sessionIds[sessionIds.length - 1];
    const netflix = (window as any).netflix;
    const root =
      netflix?.appContext?.state?.playerApp?.getState?.()?.videoPlayer?.cadmiumPlayerRepository?.playersById?.[activeSessionId];

    if (!root) return urls;

    const seen = new WeakSet<object>();
    const stack: { node: any; depth: number }[] = [{ node: root, depth: 0 }];

    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (node === null || typeof node !== "object" || depth > 20 || seen.has(node)) {
        continue;
      }
      seen.add(node);

      if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) {
        continue;
      }

        const isTimedTextNode =
          node.type === "timedtext" ||
          node.trackType === "timedtext" ||
          node.rawTrackType === "TIMEDTEXT" ||
          (typeof node.isTimedText === "boolean" && node.isTimedText);

        if (node.trackId !== undefined && node.trackId !== null) {
          const tid = String(node.trackId);
          let foundUrl: string | undefined;

          if (Array.isArray(node.urls) && node.urls.length > 0) {
            for (const u of node.urls) {
              if (typeof u?.url === "string" && (isTimedTextNode || /timedtext|ttml|imsc|syntax/i.test(u.url))) {
                foundUrl = u.url;
                break;
              }
            }
          } else if (typeof node.url === "string" && (isTimedTextNode || /timedtext|ttml|imsc|syntax/i.test(node.url))) {
            foundUrl = node.url;
          } else if (typeof node.cdnUrl === "string" && (isTimedTextNode || /timedtext|ttml|imsc|syntax/i.test(node.cdnUrl))) {
            foundUrl = node.cdnUrl;
          }

          if (foundUrl) {
            if (!urls.has(tid)) urls.set(tid, foundUrl);
            if (node.bcp47 && !urls.has(String(node.bcp47))) urls.set(String(node.bcp47), foundUrl);
            if (node.bcp47 && !urls.has(String(node.bcp47).toLowerCase())) urls.set(String(node.bcp47).toLowerCase(), foundUrl);
            if (node.language && !urls.has(String(node.language))) urls.set(String(node.language), foundUrl);
            if (node.id && !urls.has(String(node.id))) urls.set(String(node.id), foundUrl);
          }
        }

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          stack.push({ node: node[i], depth: depth + 1 });
        }
      } else {
        for (const key of Object.keys(node)) {
          stack.push({ node: node[key], depth: depth + 1 });
        }
      }
    }

    return urls;
  }

  function getTrackData(track: any, urlsByTrackId: Map<string, string>): NetflixTrackDef | null {
    if (!track.bcp47 || track.isNoneTrack || track.isForcedNarrative || track.isImageBased) {
      return null;
    }

    const isClosedCaptions = track.rawTrackType === "CLOSEDCAPTIONS";
    const language = isClosedCaptions ? `${track.bcp47.toLowerCase()}-CC` : track.bcp47.toLowerCase();
    const label = `${track.bcp47} - ${track.displayName || ""}${isClosedCaptions ? " [CC]" : ""}`;
    const trackIdStr = String(track.trackId || language);

    const foundUrl =
      urlsByTrackId.get(trackIdStr) ||
      urlsByTrackId.get(track.bcp47) ||
      urlsByTrackId.get(language) ||
      urlsByTrackId.get(track.bcp47.toLowerCase()) ||
      urlsByTrackId.get(String(track.id || ""));

    return {
      id: trackIdStr,
      trackId: trackIdStr,
      label,
      language,
      bcp47: track.bcp47,
      url: foundUrl,
      isClosedCaptions,
    };
  }

  async function publishNetflixTracks(force = false): Promise<void> {
    const np = getActivePlayer();
    if (!np) return;

    const rawTracks = np.getTimedTextTrackList?.() || [];
    if (rawTracks.length === 0) return;

    const urlsByTrackId = findCadmiumTimedTextUrls();
    const tracks: NetflixTrackDef[] = rawTracks
      .map((t: any) => getTrackData(t, urlsByTrackId))
      .filter((t: NetflixTrackDef | null): t is NetflixTrackDef => t !== null);

    const title = document.title.replace(/ - Netflix$/i, "").trim() || "Netflix Video";
    const signature = `${title}|${tracks.map((track) => `${track.id}:${track.url || ""}`).join("|")}`;
    if (!force && signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;

    document.dispatchEvent(
      new CustomEvent("hakkutsu:netflix-synced-tracks", {
        detail: {
          title,
          tracks,
        },
      })
    );
  }

  async function fetchTrackUrlForLanguage(targetTrackId: string): Promise<void> {
    const np = getActivePlayer();
    if (!np) return;

    const targetTrackIdStr = String(targetTrackId);
    const urls = findCadmiumTimedTextUrls();
    if (urls.has(targetTrackIdStr)) {
      void publishNetflixTracks();
      return;
    }

    const allTracks = np.getTimedTextTrackList?.() || [];
    const targetTrack = allTracks.find(
      (t: any) =>
        String(t.trackId) === targetTrackIdStr ||
        String(t.bcp47) === targetTrackIdStr ||
        String(t.bcp47?.toLowerCase()) === targetTrackIdStr.toLowerCase()
    );
    if (targetTrack) {
      try {
        const previousTrack = np.getTimedTextTrack?.();
        np.setTimedTextTrack?.(targetTrack);
        setTimeout(() => {
          void publishNetflixTracks(true);
          if (previousTrack && previousTrack !== targetTrack) {
            try {
              np.setTimedTextTrack?.(previousTrack);
            } catch {}
          }
        }, 800);
      } catch (err) {
        console.warn("[Hakkutsu Bridge] Set Netflix track error:", err);
      }
    }
  }

  document.addEventListener("hakkutsu:request-netflix-tracks", () => {
    void publishNetflixTracks(true);
  });

  document.addEventListener("hakkutsu:netflix-lazy-load-track", (e: Event) => {
    const trackId = (e as CustomEvent).detail?.trackId;
    if (trackId) {
      void fetchTrackUrlForLanguage(trackId);
    }
  });

  document.addEventListener("hakkutsu:netflix-seek", (e: Event) => {
    const timeMs = (e as CustomEvent).detail?.timeMs;
    if (typeof timeMs === "number") {
      try {
        const np = getActivePlayer();
        if (np && typeof np.seek === "function") {
          np.seek(timeMs);
        }
      } catch (err) {
        console.warn("[Hakkutsu Bridge] Netflix seek error:", err);
      }
    }
  });

  setInterval(() => {
    if (window.location.pathname.includes("/watch/")) {
      const np = getActivePlayer();
      if (np) {
        void publishNetflixTracks();
      }
    }
  }, 3000);
}

export function initNetflixPageBridge(): void {
  if (typeof window === "undefined") return;

  const extensionRuntime = (globalThis as any).browser?.runtime || (globalThis as any).chrome?.runtime;
  if (extensionRuntime?.id) {
    const scriptId = "hakkutsu-netflix-main-bridge";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = extensionRuntime.getURL("content-scripts/netflix-bridge.js");
      script.addEventListener("load", () => script.remove(), { once: true });
      (document.head || document.documentElement).appendChild(script);
    }
    return;
  }

  runNetflixBridgeMain();
}

