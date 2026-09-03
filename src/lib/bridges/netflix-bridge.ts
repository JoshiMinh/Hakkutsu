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

export function initNetflixPageBridge(): void {
  function bridgeMain() {
    if ((window as any).__HAKKUTSU_NETFLIX_BRIDGE_INITIALIZED__) return;
    (window as any).__HAKKUTSU_NETFLIX_BRIDGE_INITIALIZED__ = true;

    interface NetflixTrackDef {
      id: string;
      trackId: string;
      label: string;
      language: string;
      bcp47: string;
      url?: string;
      isClosedCaptions: boolean;
    }

    function pollCondition<T>(fn: () => T | null | undefined | false, timeoutMs: number = 8000, intervalMs: number = 200): Promise<T | null> {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const check = () => {
          try {
            const result = fn();
            if (result) {
              resolve(result);
              return;
            }
          } catch {
            // ignore
          }

          if (Date.now() - startTime >= timeoutMs) {
            resolve(null);
          } else {
            setTimeout(check, intervalMs);
          }
        };
        check();
      });
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

        try {
          if (
            node.type === "timedtext" &&
            typeof node.trackId === "string" &&
            Array.isArray(node.urls) &&
            node.urls.length > 0 &&
            typeof node.urls[0]?.url === "string" &&
            !urls.has(node.trackId)
          ) {
            urls.set(node.trackId, node.urls[0].url);
          }
        } catch {
          // ignore
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

      return {
        id: `${track.trackId || language}`,
        trackId: track.trackId,
        label,
        language,
        bcp47: track.bcp47,
        url: urlsByTrackId.get(track.trackId),
        isClosedCaptions,
      };
    }

    async function publishNetflixTracks(): Promise<void> {
      const np = getActivePlayer();
      if (!np) return;

      const rawTracks = np.getTimedTextTrackList?.() || [];
      if (rawTracks.length === 0) return;

      const urlsByTrackId = findCadmiumTimedTextUrls();
      const tracks: NetflixTrackDef[] = rawTracks
        .map((t: any) => getTrackData(t, urlsByTrackId))
        .filter((t): t is NetflixTrackDef => t !== null);

      const title = document.title.replace(/ - Netflix$/i, "").trim() || "Netflix Video";

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

      const currentTrack = np.getTimedTextTrack?.();
      const allTracks = np.getTimedTextTrackList?.() || [];
      const targetTrack = allTracks.find((t: any) => t.trackId === targetTrackId);

      if (!targetTrack) return;

      let urls = findCadmiumTimedTextUrls();
      if (urls.has(targetTrackId)) {
        void publishNetflixTracks();
        return;
      }

      let shouldRevert = false;
      try {
        await np.setTimedTextTrack?.(targetTrack);
        shouldRevert = true;

        const found = await pollCondition(() => {
          urls = findCadmiumTimedTextUrls();
          return urls.has(targetTrackId);
        }, 4000);

        if (found) {
          void publishNetflixTracks();
        }
      } catch (err) {
        console.warn("[Hakkutsu Bridge] Failed to lazy load Netflix track:", err);
      } finally {
        if (shouldRevert && currentTrack) {
          try {
            await np.setTimedTextTrack?.(currentTrack);
          } catch {
            // ignore
          }
        }
      }
    }

    document.addEventListener("hakkutsu:request-netflix-tracks", () => {
      void publishNetflixTracks();
    });

    document.addEventListener("hakkutsu:netflix-lazy-load-track", (e: Event) => {
      const trackId = (e as CustomEvent).detail?.trackId;
      if (trackId) {
        void fetchTrackUrlForLanguage(trackId);
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

  if (typeof document === "undefined") return;
  const BRIDGE_ID = "hakkutsu-netflix-main-bridge";
  if (document.getElementById(BRIDGE_ID)) return;

  const script = document.createElement("script");
  script.id = BRIDGE_ID;
  const code = `(${bridgeMain.toString()})();`;

  try {
    const trustedTypes = (window as any).trustedTypes;
    if (trustedTypes && typeof trustedTypes.createPolicy === "function") {
      let policy: any;
      try {
        policy = trustedTypes.createPolicy("hakkutsu-netflix-policy", {
          createScript: (s: string) => s,
        });
      } catch {
        policy = trustedTypes.defaultPolicy;
      }
      if (policy?.createScript) {
        script.textContent = policy.createScript(code);
      } else {
        script.textContent = code;
      }
    } else {
      script.textContent = code;
    }
  } catch {
    script.textContent = code;
  }

  (document.head || document.documentElement).appendChild(script);
}

